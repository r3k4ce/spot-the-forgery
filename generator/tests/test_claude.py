import base64
import json
import random
from collections.abc import Callable
from typing import Any

import anthropic
import httpx2
import pytest
from imaging import make_image

from spot_the_forgery.claude import ClaudeBriefWriter, ClaudeJudge
from spot_the_forgery.models import Brief, Candidate, Group, Painting, Pick, RoundFailed


def message(payload: Any, stop_reason: str = "end_turn") -> dict[str, Any]:
    text = payload if isinstance(payload, str) else json.dumps(payload)
    return {
        "id": "msg_1",
        "type": "message",
        "role": "assistant",
        "model": "claude-haiku-5-5",
        "content": [{"type": "text", "text": text}],
        "stop_reason": stop_reason,
        "stop_sequence": None,
        "usage": {"input_tokens": 1, "output_tokens": 1},
    }


def client_for(
    respond: Callable[[dict[str, Any]], dict[str, Any]],
) -> tuple[anthropic.Anthropic, list[dict[str, Any]]]:
    seen: list[dict[str, Any]] = []

    def handler(request: httpx2.Request) -> httpx2.Response:
        body = json.loads(request.content)
        seen.append(body)
        return httpx2.Response(200, json=respond(body))

    http = httpx2.Client(transport=httpx2.MockTransport(handler))
    return anthropic.Anthropic(api_key="test", http_client=http, max_retries=0), seen


def blocks(body: dict[str, Any]) -> list[dict[str, Any]]:
    return body["messages"][0]["content"]


def all_text(body: dict[str, Any]) -> str:
    return "\n".join(b["text"] for b in blocks(body) if b["type"] == "text")


PAINTING = Painting(id=1, title="T", date="1860", image_url="u", page_url="p")
GROUP = Group(key="artist:1", kind="artist", label="Frederic Edwin Church", paintings=())
PICK = Pick(group=GROUP, shown=(PAINTING,) * 3, references=(PAINTING,) * 2, spares=())
REFS = [make_image(30, 20, "JPEG"), make_image(30, 20, "PNG")]


def test_brief_parses_and_sends_images():
    reply = {"prompt": "A river at dusk...", "aspect_ratio": "3:2", "forbidden": ["electric light"]}
    client, seen = client_for(lambda body: message(reply))
    brief = ClaudeBriefWriter(client).write(PICK, REFS)
    assert brief == Brief(
        prompt="A river at dusk...", aspect_ratio="3:2", forbidden=("electric light",)
    )
    body = seen[0]
    assert body["model"] == "claude-haiku-5-5"
    images = [b for b in blocks(body) if b["type"] == "image"]
    assert [i["source"]["media_type"] for i in images] == ["image/jpeg", "image/png"]
    assert base64.b64decode(images[1]["source"]["data"]) == REFS[1]
    assert "Frederic Edwin Church" in all_text(body)


def test_brief_refusal_raises():
    client, _ = client_for(lambda body: message("I can't help with that.", "refusal"))
    with pytest.raises(RoundFailed):
        ClaudeBriefWriter(client).write(PICK, REFS)


def test_invalid_output_raises_round_failed():
    reply = {"prompt": "x", "aspect_ratio": "7:5", "forbidden": []}
    client, _ = client_for(lambda body: message(reply))
    with pytest.raises(RoundFailed):
        ClaudeBriefWriter(client).write(PICK, REFS)


def test_api_errors_propagate():
    def handler(request: httpx2.Request) -> httpx2.Response:
        return httpx2.Response(400, json={"type": "error", "error": {"type": "x", "message": "m"}})

    http = httpx2.Client(transport=httpx2.MockTransport(handler))
    client = anthropic.Anthropic(api_key="test", http_client=http, max_retries=0)
    with pytest.raises(anthropic.APIStatusError):
        ClaudeBriefWriter(client).write(PICK, REFS)


SHOWN = [make_image(40, 30, "JPEG") for _ in range(3)]
CANDIDATES = [Candidate(data=make_image(20 + i, 20, "PNG"), model="m") for i in range(3)]


def scores_by_identity(body: dict[str, Any]) -> dict[str, Any]:
    """Score each presented candidate by its *original* position: original k scores k + 2."""
    original = {base64.b64encode(c.data).decode(): k for k, c in enumerate(CANDIDATES)}
    content = blocks(body)
    scores = []
    for i, block in enumerate(content):
        if block["type"] == "text" and block["text"].startswith("Candidate "):
            number = int(block["text"].split()[1])
            k = original[content[i + 1]["source"]["data"]]
            scores.append({"index": number, "convincing": k + 2, "tells": f"orig{k}"})
    return message({"scores": scores})


def test_judge_maps_shuffled_order_back():
    client, _ = client_for(scores_by_identity)
    verdicts = ClaudeJudge(client, rng=random.Random(0)).judge(SHOWN, CANDIDATES)
    assert [v.convincing for v in verdicts] == [2, 3, 4]
    assert [v.tells for v in verdicts] == ["orig0", "orig1", "orig2"]


def test_judge_actually_shuffles():
    orders = set()
    for seed in range(6):
        client, seen = client_for(scores_by_identity)
        ClaudeJudge(client, rng=random.Random(seed)).judge(SHOWN, CANDIDATES)
        orders.add(tuple(b["source"]["data"] for b in blocks(seen[0]) if b["type"] == "image"))
    assert len(orders) > 1


@pytest.mark.parametrize(
    "scores",
    [
        [{"index": 1, "convincing": 5, "tells": "a"}, {"index": 2, "convincing": 5, "tells": "b"}],
        [
            {"index": 1, "convincing": 5, "tells": "a"},
            {"index": 1, "convincing": 6, "tells": "b"},
            {"index": 3, "convincing": 7, "tells": "c"},
        ],
    ],
)
def test_judge_incomplete_scores_raises(scores):
    client, _ = client_for(lambda body: message({"scores": scores}))
    with pytest.raises(RoundFailed):
        ClaudeJudge(client).judge(SHOWN, CANDIDATES)


def test_judge_marks_real_paintings():
    client, seen = client_for(scores_by_identity)
    ClaudeJudge(client, rng=random.Random(0)).judge(SHOWN, CANDIDATES)
    labels = [b["text"] for b in blocks(seen[0]) if b["type"] == "text"]
    assert [lbl for lbl in labels if lbl.startswith("Real painting")] == [
        "Real painting A",
        "Real painting B",
        "Real painting C",
    ]
    assert [lbl for lbl in labels if lbl.startswith("Candidate")] == [
        "Candidate 1",
        "Candidate 2",
        "Candidate 3",
    ]


def test_judge_notes_stand_alone_for_the_player():
    """The player sees one fake beside the real paintings, never the other candidates."""
    client, seen = client_for(scores_by_identity)
    ClaudeJudge(client, rng=random.Random(0)).judge(SHOWN, CANDIDATES)
    system = seen[0]["system"]
    system = system if isinstance(system, str) else " ".join(b["text"] for b in system)
    assert "compare it only with the real paintings" in system
    assert "never mention the other candidates" in system
