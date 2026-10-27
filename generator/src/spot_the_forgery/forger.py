"""Generate forgery candidates with OpenRouter's image API."""

import base64
import binascii
import logging
from collections.abc import Sequence
from typing import Any

import httpx

from spot_the_forgery.budget import Budget
from spot_the_forgery.models import AspectRatio, Brief, Candidate, RoundFailed
from spot_the_forgery.normalize import sniff_media_type

IMAGES_URL = "https://openrouter.ai/api/v1/images"
PRIMARY_MODEL = "black-forest-labs/flux-3-image-klein"
FALLBACK_MODEL = "tencent/hy-image-v3.5-preview"
ATTEMPTS_PER_MODEL = 2
TIMEOUT_SECONDS = 120

# The account can't make images (bad key, no credits, a spent limit): retrying only burns the
# budget. A 403 can also mean one prompt was flagged or refused; see _refused_prompt.
FATAL_STATUSES = frozenset({401, 402, 403})
REFUSAL_TYPES = frozenset({"content_policy_violation", "refusal"})

log = logging.getLogger(__name__)


class ForgerUnavailable(Exception):
    """The image API refused the account itself; the run should stop."""


def _refused_prompt(response: httpx.Response) -> bool:
    """Whether a 403 is about this prompt (moderation, content policy, a model refusal) rather
    than the account. Anything unrecognised counts as the account, which stops the run."""
    try:
        metadata = response.json()["error"]["metadata"]
    except (ValueError, KeyError, TypeError):
        return False
    if not isinstance(metadata, dict) or "limit_source" in metadata:
        return False
    return "flagged_input" in metadata or metadata.get("error_type") in REFUSAL_TYPES


def _data_url(data: bytes) -> str:
    return f"data:{sniff_media_type(data)};base64,{base64.b64encode(data).decode('ascii')}"


def _prompt(brief: Brief) -> str:
    if not brief.forbidden:
        return brief.prompt
    return f"{brief.prompt}\nAvoid: {'; '.join(brief.forbidden)}"


class OpenRouterImageGenerator:
    def __init__(
        self,
        client: httpx.Client,
        api_key: str,
        budget: Budget,
        models: Sequence[str] = (PRIMARY_MODEL, FALLBACK_MODEL),
    ) -> None:
        self._client = client
        self._api_key = api_key
        self._budget = budget
        self._models = tuple(models)

    def generate(
        self, brief: Brief, reference_images: Sequence[bytes], aspect_ratio: AspectRatio
    ) -> Candidate:
        references = [
            {"type": "image_url", "image_url": {"url": _data_url(data)}}
            for data in reference_images
        ]
        for model in self._models:
            body: dict[str, Any] = {
                "model": model,
                "prompt": _prompt(brief),
                "aspect_ratio": aspect_ratio,
                "resolution": "1K",
                "n": 1,
                "input_references": references,
            }
            for attempt in range(1, ATTEMPTS_PER_MODEL + 1):
                self._budget.spend()
                try:
                    return self._attempt(model, body)
                except RoundFailed as exc:
                    log.warning("image attempt %d with %s failed: %s", attempt, model, exc)
        raise RoundFailed("every image model failed")

    def _attempt(self, model: str, body: dict[str, Any]) -> Candidate:
        try:
            response = self._client.post(
                IMAGES_URL,
                json=body,
                headers={"Authorization": f"Bearer {self._api_key}"},
                timeout=TIMEOUT_SECONDS,
            )
        except httpx.HTTPError as exc:
            raise RoundFailed(f"{type(exc).__name__}: {exc}") from exc
        if response.status_code in FATAL_STATUSES and not _refused_prompt(response):
            raise ForgerUnavailable(f"HTTP {response.status_code}: {response.text[:200]}")
        if response.is_error:
            raise RoundFailed(f"HTTP {response.status_code}: {response.text[:200]}")
        try:
            payload = response.json()
            data = base64.b64decode(payload["data"][0]["b64_json"], validate=True)
            media_type = sniff_media_type(data)
        except (KeyError, IndexError, TypeError, ValueError, binascii.Error) as exc:
            raise RoundFailed(f"unusable response: {type(exc).__name__}: {exc}") from exc
        cost = (payload.get("usage") or {}).get("cost")
        log.info("image from %s (%s, cost %s)", model, media_type, cost)
        return Candidate(data=data, model=model)
