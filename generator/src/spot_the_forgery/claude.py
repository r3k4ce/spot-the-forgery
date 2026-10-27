"""Claude writes each forgery brief and judges how convincing the candidates are."""

import base64
import random
from collections.abc import Sequence
from typing import Any, Literal

import anthropic
import pydantic

from spot_the_forgery.models import Brief, Candidate, Pick, RoundFailed, Verdict
from spot_the_forgery.normalize import sniff_media_type

DEFAULT_MODEL = "claude-haiku-5-5"
MAX_TOKENS = 8000
SUPPORTED_ASPECTS = ("1:1", "2:1", "16:9", "3:2", "4:3", "5:4", "4:5", "3:4", "2:3", "9:16", "1:2")

AspectRatio = Literal["1:1", "2:1", "16:9", "3:2", "4:3", "5:4", "4:5", "3:4", "2:3", "9:16", "1:2"]

BRIEF_SYSTEM = """You brief an art forger for a guessing game. You are shown genuine \
paintings from one group: either a single named artist, or anonymous works from one culture \
and period.

Describe ONE new painting that this group could plausibly have produced but that is not any of \
the paintings shown. Match the era, typical subject matter, composition habits, palette, \
brushwork, support (canvas, panel, silk, paper) and the condition of an old work (ageing, \
varnish, craquelure, fading). Write the description as a detailed image-generation prompt, \
written as a description of the physical painting, not as a photo of a gallery.

Choose the aspect ratio, from the allowed values, that is closest to typical works by this \
group. List anachronisms or giveaways the forger must avoid."""

JUDGE_SYSTEM = """You judge forgeries for a guessing game. The paintings labelled \
"Real painting" are genuine works from one group (one artist, or one culture and period). The \
paintings labelled "Candidate" are AI-generated forgeries of that group.

For every candidate, score from 1 to 10 how convincingly it would pass as a fourth genuine work \
in this set, where 10 means indistinguishable from the real paintings and 1 means obviously \
fake. Then write 2-3 sentences, in the voice of a museum curator speaking to the player, \
explaining what gives that candidate away. The player will see only that one candidate, shown \
beside the three real paintings, so compare it only with the real paintings and never mention \
the other candidates, how many there were, or how this one ranks among them. Use each \
candidate's number as its index."""


class BriefOut(pydantic.BaseModel):
    prompt: str
    aspect_ratio: AspectRatio
    forbidden: list[str]


class CandidateScore(pydantic.BaseModel):
    index: int
    convincing: int
    tells: str


class JudgeOut(pydantic.BaseModel):
    scores: list[CandidateScore]


def _image_block(data: bytes) -> dict[str, Any]:
    return {
        "type": "image",
        "source": {
            "type": "base64",
            "media_type": sniff_media_type(data),
            "data": base64.standard_b64encode(data).decode("ascii"),
        },
    }


def _text(text: str) -> dict[str, Any]:
    return {"type": "text", "text": text}


def _parse[T: pydantic.BaseModel](
    client: anthropic.Anthropic,
    model: str,
    system: str,
    content: list[dict[str, Any]],
    output: type[T],
) -> T:
    try:
        response = client.messages.parse(
            model=model,
            max_tokens=MAX_TOKENS,
            system=system,
            messages=[{"role": "user", "content": content}],  # type: ignore[list-item]
            output_format=output,
        )
    except pydantic.ValidationError as exc:
        raise RoundFailed(f"invalid structured output: {exc}") from exc
    if response.stop_reason == "refusal" or response.parsed_output is None:
        raise RoundFailed(f"no usable output (stop_reason={response.stop_reason})")
    return response.parsed_output


class ClaudeBriefWriter:
    def __init__(self, client: anthropic.Anthropic, model: str = DEFAULT_MODEL) -> None:
        self._client = client
        self._model = model

    def write(self, pick: Pick, reference_images: Sequence[bytes]) -> Brief:
        group = pick.group
        who = "the artist" if group.kind == "artist" else "anonymous painters of"
        content: list[dict[str, Any]] = [_text(f"Genuine paintings by {who} {group.label}:")]
        for painting, data in zip(pick.references, reference_images, strict=False):
            content.append(_text(f"{painting.title} ({painting.date})"))
            content.append(_image_block(data))
        content.append(_text(f"Allowed aspect ratios: {', '.join(SUPPORTED_ASPECTS)}."))
        out = _parse(self._client, self._model, BRIEF_SYSTEM, content, BriefOut)
        return Brief(
            prompt=out.prompt, aspect_ratio=out.aspect_ratio, forbidden=tuple(out.forbidden)
        )


class ClaudeJudge:
    def __init__(
        self,
        client: anthropic.Anthropic,
        model: str = DEFAULT_MODEL,
        rng: random.Random | None = None,
    ) -> None:
        self._client = client
        self._model = model
        self._rng = rng or random.Random()

    def judge(self, shown: Sequence[bytes], candidates: Sequence[Candidate]) -> list[Verdict]:
        order = list(range(len(candidates)))
        self._rng.shuffle(order)  # order[position] = original index

        content: list[dict[str, Any]] = []
        for letter, data in zip("ABC", shown, strict=False):
            content += [_text(f"Real painting {letter}"), _image_block(data)]
        for position, original in enumerate(order, start=1):
            content += [_text(f"Candidate {position}"), _image_block(candidates[original].data)]

        out = _parse(self._client, self._model, JUDGE_SYSTEM, content, JudgeOut)
        by_position = {s.index: s for s in out.scores}
        expected = set(range(1, len(candidates) + 1))
        if len(out.scores) != len(candidates) or set(by_position) != expected:
            raise RoundFailed("judge did not score every candidate exactly once")

        verdicts: list[Verdict | None] = [None] * len(candidates)
        for position, original in enumerate(order, start=1):
            score = by_position[position]
            verdicts[original] = Verdict(convincing=score.convincing, tells=score.tells)
        return [v for v in verdicts if v is not None]
