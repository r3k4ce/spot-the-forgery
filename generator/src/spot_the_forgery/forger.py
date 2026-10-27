"""Generate forgery candidates with OpenRouter's image API."""

import base64
import binascii
import logging
from collections.abc import Sequence
from typing import Any

import httpx

from spot_the_forgery.budget import Budget
from spot_the_forgery.models import Brief, Candidate, RoundFailed
from spot_the_forgery.normalize import sniff_media_type

IMAGES_URL = "https://openrouter.ai/api/v1/images"
PRIMARY_MODEL = "black-forest-labs/flux-3-image-klein"
FALLBACK_MODEL = "tencent/hy-image-v3.5-preview"
ATTEMPTS_PER_MODEL = 2
TIMEOUT_SECONDS = 120

log = logging.getLogger(__name__)


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

    def generate(self, brief: Brief, reference_images: Sequence[bytes]) -> Candidate:
        references = [
            {"type": "image_url", "image_url": {"url": _data_url(data)}}
            for data in reference_images
        ]
        for model in self._models:
            body: dict[str, Any] = {
                "model": model,
                "prompt": _prompt(brief),
                "aspect_ratio": brief.aspect_ratio,
                "resolution": "1K",
                "n": 1,
                "input_references": references,
            }
            for attempt in range(1, ATTEMPTS_PER_MODEL + 1):
                self._budget.spend()
                candidate = self._attempt(model, body)
                if candidate is not None:
                    return candidate
                log.warning("image attempt %d with %s failed", attempt, model)
        raise RoundFailed("every image model failed")

    def _attempt(self, model: str, body: dict[str, Any]) -> Candidate | None:
        try:
            response = self._client.post(
                IMAGES_URL,
                json=body,
                headers={"Authorization": f"Bearer {self._api_key}"},
                timeout=TIMEOUT_SECONDS,
            )
            response.raise_for_status()
            data = base64.b64decode(response.json()["data"][0]["b64_json"], validate=True)
            return Candidate(data=data, media_type=sniff_media_type(data), model=model)
        except (httpx.HTTPError, KeyError, IndexError, ValueError, binascii.Error):
            return None
