"""Claude writes each forgery brief and judges how convincing the candidates are."""

import base64
import random
from collections.abc import Sequence

import anthropic
import pydantic
from anthropic.types import ImageBlockParam, TextBlockParam

from spot_the_forgery.models import Brief, Candidate, Pick, RoundFailed, Verdict
from spot_the_forgery.normalize import sniff_media_type

DEFAULT_MODEL = "claude-haiku-5-5"
MAX_TOKENS = 8000

Content = list[TextBlockParam | ImageBlockParam]

BRIEF_SYSTEM = """You brief an art forger for a guessing game. You are shown genuine \
paintings from one group: either a single named artist, or anonymous works from one culture \
and period.

Describe ONE new painting that this group could plausibly have produced but that is not any of \
the paintings shown. Match the era, typical subject matter, composition habits, palette, \
brushwork, support (canvas, panel, silk, paper) and the condition of an old work (ageing, \
varnish, craquelure, fading). Write the description as a detailed image-generation prompt, \
written as a description of the physical painting, not as a photo of a gallery.

List anachronisms or giveaways the forger must avoid."""

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
    forbidden: list[str]


class CandidateScore(pydantic.BaseModel):
    index: int
    convincing: int
    tells: str


class JudgeOut(pydantic.BaseModel):
    scores: list[CandidateScore]


def _image(data: bytes) -> ImageBlockParam:
    return {
        "type": "image",
        "source": {
            "type": "base64",
            "media_type": sniff_media_type(data),
            "data": base64.b64encode(data).decode("ascii"),
        },
    }


def _text(text: str) -> TextBlockParam:
    return {"type": "text", "text": text}


def _parse[T: pydantic.BaseModel](
    client: anthropic.Anthropic, model: str, system: str, content: Content, output: type[T]
) -> T:
    try:
        response = client.messages.parse(
            model=model,
            max_tokens=MAX_TOKENS,
            system=system,
            messages=[{"role": "user", "content": content}],
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
        content: Content = [_text(f"Genuine paintings by {who} {group.label}:")]
        for painting, data in zip(pick.references, reference_images, strict=True):
            content += [_text(f"{painting.title} ({painting.date})"), _image(data)]
        out = _parse(self._client, self._model, BRIEF_SYSTEM, content, BriefOut)
        return Brief(prompt=out.prompt, forbidden=tuple(out.forbidden))


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
        # Present the candidates in a random order, so any position bias in the judge
        # doesn't always land on the same candidate.
        order = list(range(len(candidates)))
        self._rng.shuffle(order)  # order[n - 1] is the candidate presented as number n
        number = {original: n for n, original in enumerate(order, start=1)}

        content: Content = []
        for letter, data in zip("ABC", shown, strict=False):
            content += [_text(f"Real painting {letter}"), _image(data)]
        for n, original in enumerate(order, start=1):
            content += [_text(f"Candidate {n}"), _image(candidates[original].data)]

        out = _parse(self._client, self._model, JUDGE_SYSTEM, content, JudgeOut)
        scores = {s.index: s for s in out.scores}
        if len(out.scores) != len(candidates) or set(scores) != set(number.values()):
            raise RoundFailed("judge did not score every candidate exactly once")
        return [
            Verdict(convincing=scores[number[i]].convincing, tells=scores[number[i]].tells)
            for i in range(len(candidates))
        ]
