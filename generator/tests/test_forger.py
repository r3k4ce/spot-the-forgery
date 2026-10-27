import base64
import json
import logging
from collections.abc import Callable
from typing import Any

import httpx
import pytest
from imaging import SVG, make_image

from spot_the_forgery.budget import Budget, BudgetExceeded
from spot_the_forgery.forger import (
    FALLBACK_MODEL,
    IMAGES_URL,
    PRIMARY_MODEL,
    ForgerUnavailable,
    OpenRouterImageGenerator,
)
from spot_the_forgery.models import AspectRatio, Brief, RoundFailed

BRIEF = Brief(prompt="A river at dusk", forbidden=("electric light", "plastic"))
ASPECT: AspectRatio = "3:2"
REFS = [make_image(30, 20, "JPEG")]
PNG = make_image(64, 48, "PNG")


def ok(data: bytes) -> httpx.Response:
    b64 = base64.b64encode(data).decode()
    return httpx.Response(200, json={"data": [{"b64_json": b64, "media_type": "image/png"}]})


def generator(
    responses: Callable[[dict[str, Any]], httpx.Response], budget: Budget
) -> tuple[OpenRouterImageGenerator, list[httpx.Request]]:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return responses(json.loads(request.content))

    client = httpx.Client(transport=httpx.MockTransport(handler))
    return OpenRouterImageGenerator(client, "sk-test", budget), seen


def test_request_shape():
    gen, seen = generator(lambda body: ok(PNG), Budget(5))
    gen.generate(BRIEF, REFS, ASPECT)
    request = seen[0]
    assert str(request.url) == IMAGES_URL
    assert request.method == "POST"
    assert request.headers["Authorization"] == "Bearer sk-test"
    body = json.loads(request.content)
    assert body["model"] == PRIMARY_MODEL
    assert body["n"] == 1
    assert body["resolution"] == "1K"
    assert body["aspect_ratio"] == "3:2"
    assert "A river at dusk" in body["prompt"]
    assert "electric light" in body["prompt"] and "plastic" in body["prompt"]
    ref_url = body["input_references"][0]["image_url"]["url"]
    assert body["input_references"][0]["type"] == "image_url"
    assert ref_url == "data:image/jpeg;base64," + base64.b64encode(REFS[0]).decode()


def test_success_returns_candidate():
    budget = Budget(5)
    gen, _ = generator(lambda body: ok(PNG), budget)
    candidate = gen.generate(BRIEF, REFS, ASPECT)
    assert (candidate.data, candidate.model) == (PNG, PRIMARY_MODEL)
    assert budget.remaining == 4


def test_retry_then_fallback():
    budget = Budget(5)

    def respond(body: dict[str, Any]) -> httpx.Response:
        return httpx.Response(500) if body["model"] == PRIMARY_MODEL else ok(PNG)

    gen, seen = generator(respond, budget)
    assert gen.generate(BRIEF, REFS, ASPECT).model == FALLBACK_MODEL
    assert budget.remaining == 2
    assert len(seen) == 3


@pytest.mark.parametrize("fmt", ["JPEG", "WEBP"])
def test_jpeg_and_webp_accepted(fmt: str):
    data = make_image(64, 48, fmt)
    gen, seen = generator(lambda body: ok(data), Budget(5))
    assert gen.generate(BRIEF, REFS, ASPECT).data == data
    assert len(seen) == 1


def test_svg_or_garbage_counts_as_failure():
    primary = iter([ok(SVG), ok(b"not an image")])

    def respond(body: dict[str, Any]) -> httpx.Response:
        return next(primary) if body["model"] == PRIMARY_MODEL else ok(PNG)

    gen, _ = generator(respond, Budget(5))
    assert gen.generate(BRIEF, REFS, ASPECT).model == FALLBACK_MODEL


def test_empty_data_counts_as_failure():
    def respond(body: dict[str, Any]) -> httpx.Response:
        if body["model"] == PRIMARY_MODEL:
            return httpx.Response(200, json={"data": []})
        return ok(PNG)

    gen, _ = generator(respond, Budget(5))
    assert gen.generate(BRIEF, REFS, ASPECT).model == FALLBACK_MODEL


def test_all_fail_raises_round_failed():
    budget = Budget(10)
    gen, _ = generator(lambda body: httpx.Response(502), budget)
    with pytest.raises(RoundFailed):
        gen.generate(BRIEF, REFS, ASPECT)
    assert budget.remaining == 6


def test_budget_exceeded_propagates():
    gen, seen = generator(lambda body: ok(PNG), Budget(0))
    with pytest.raises(BudgetExceeded):
        gen.generate(BRIEF, REFS, ASPECT)
    assert seen == []


def error(status: int, metadata: dict[str, Any] | None = None) -> httpx.Response:
    body: dict[str, Any] = {"code": status, "message": "refused"}
    if metadata is not None:
        body["metadata"] = metadata
    return httpx.Response(status, json={"error": body})


@pytest.mark.parametrize(
    "response",
    [
        httpx.Response(401, text="no credits"),
        httpx.Response(402, text="no credits"),
        httpx.Response(403, text="forbidden"),
        error(403, {"error_type": "permission_denied"}),
        error(403, {"limit_source": "openrouter_key_limit", "limit_usd": 1, "spend_usd": 1}),
    ],
)
def test_account_errors_stop_the_run(response: httpx.Response):
    budget = Budget(5)
    gen, seen = generator(lambda body: response, budget)
    with pytest.raises(ForgerUnavailable, match=str(response.status_code)):
        gen.generate(BRIEF, REFS, ASPECT)
    assert len(seen) == 1
    assert budget.remaining == 4


# OpenRouter also answers 403 when one prompt is flagged or refused; other prompts still work.
@pytest.mark.parametrize(
    "metadata",
    [
        {"reasons": ["violence"], "flagged_input": "A battle scene", "provider_name": "x"},
        {"error_type": "content_policy_violation", "provider_name": "x"},
        {"error_type": "refusal", "provider_name": "x"},
    ],
)
def test_a_flagged_prompt_fails_the_round_not_the_run(metadata: dict[str, Any]):
    budget = Budget(5)
    gen, seen = generator(lambda body: error(403, metadata), budget)
    with pytest.raises(RoundFailed):
        gen.generate(BRIEF, REFS, ASPECT)
    assert len(seen) == 4


def test_failure_reason_is_logged_without_the_key(caplog: pytest.LogCaptureFixture):
    responses = iter([httpx.Response(500, text="upstream exploded"), ok(PNG)])
    gen, _ = generator(lambda body: next(responses), Budget(5))
    with caplog.at_level(logging.WARNING):
        gen.generate(BRIEF, REFS, ASPECT)
    assert "500" in caplog.text
    assert "upstream exploded" in caplog.text
    assert "sk-test" not in caplog.text


def test_null_payload_is_a_failed_attempt():
    responses = iter([httpx.Response(200, json={"data": [{"b64_json": None}]}), ok(PNG)])
    gen, seen = generator(lambda body: next(responses), Budget(5))
    assert gen.generate(BRIEF, REFS, ASPECT).data == PNG
    assert len(seen) == 2


def test_cost_is_logged(caplog: pytest.LogCaptureFixture):
    def costed(body: dict[str, Any]) -> httpx.Response:
        response = ok(PNG)
        payload = response.json() | {"usage": {"cost": 0.0042}}
        return httpx.Response(200, json=payload)

    gen, _ = generator(costed, Budget(5))
    with caplog.at_level(logging.INFO):
        gen.generate(BRIEF, REFS, ASPECT)
    assert "0.0042" in caplog.text
