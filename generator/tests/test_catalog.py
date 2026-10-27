from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import pytest

from spot_the_forgery import catalog
from spot_the_forgery.catalog import (
    build_groups,
    fetch_records,
    load_catalog,
    refresh_if_stale,
    save_catalog,
)
from spot_the_forgery.models import Painting

CHURCH = "Frederic Edwin Church (American, 1826–1900)"
EDO = "Japan, Edo period (1615–1868)"


def rec(
    id: int,
    creator: tuple[int, str] | None = None,
    culture: Any = None,
    earliest: Any = 1700,
    title: str | None = None,
) -> dict[str, Any]:
    return {
        "id": id,
        "title": title or f"Work {id}",
        "creation_date": "c. 1700",
        "creation_date_earliest": earliest,
        "creators": [{"id": creator[0], "description": creator[1]}] if creator else [],
        "culture": culture,
        "images": {"web": {"url": f"https://cdn.test/{id}_web.jpg", "width": "", "height": ""}},
        "url": f"https://clevelandart.org/art/{id}",
    }


def by_key(records: list[dict[str, Any]]) -> dict[str, Any]:
    return {g.key: g for g in build_groups(records)}


def test_artist_grouping_and_label():
    groups = by_key([rec(i, (2697, CHURCH)) for i in range(4)])
    group = groups["artist:2697"]
    assert group.kind == "artist"
    assert group.label == "Frederic Edwin Church"
    assert len(group.paintings) == 4


def test_label_without_parenthesis():
    groups = by_key([rec(i, (7, "Hokusai")) for i in range(4)])
    assert groups["artist:7"].label == "Hokusai"


def test_culture_grouping():
    groups = by_key([rec(i, culture=[EDO], earliest=1620 + i * 20) for i in range(4)])
    group = groups[f"culture:{EDO}|1600"]
    assert group.kind == "culture"
    assert group.label == EDO


def test_culture_missing_or_bad_year_skipped():
    records = [rec(i, culture=None) for i in range(4)]
    records += [rec(10 + i, culture=[]) for i in range(4)]
    records += [rec(20 + i, culture=[EDO], earliest=None if i % 2 else -50) for i in range(4)]
    groups = by_key(records)
    assert list(groups) == [f"culture:{EDO}|unknown"]


def test_min_group_size_and_anonymous():
    records = [rec(i, (1, "Small Painter")) for i in range(3)]
    records += [rec(10 + i, (2, "Anonymous")) for i in range(4)]
    records += [rec(20 + i, (3, "Unknown artist (Flemish)")) for i in range(4)]
    assert build_groups(records) == []


def test_painting_fields():
    records = [rec(141639, (2697, CHURCH), title="Twilight in the Wilderness")]
    records[0]["creation_date"] = "1860"
    records += [rec(i, (2697, CHURCH)) for i in range(3)]
    paintings = {p.id: p for p in by_key(records)["artist:2697"].paintings}
    assert paintings[141639] == Painting(
        id=141639,
        title="Twilight in the Wilderness",
        date="1860",
        image_url="https://cdn.test/141639_web.jpg",
        page_url="https://clevelandart.org/art/141639",
    )


def test_fetch_records_paginates(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(catalog, "PAGE_SIZE", 2)
    records = [rec(i, (1, "A")) for i in range(3)]
    skips: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        params = request.url.params
        skips.append(params["skip"])
        assert params["limit"] == "2"
        assert params["cc0"] == "1" and params["type"] == "Painting"
        skip = int(params["skip"])
        return httpx.Response(200, json={"info": {"total": 3}, "data": records[skip : skip + 2]})

    client = httpx.Client(transport=httpx.MockTransport(handler))
    assert fetch_records(client) == records
    assert skips == ["0", "2"]


def _groups():
    return build_groups([rec(i, (2697, CHURCH)) for i in range(4)])


def _failing_client(status: int | None = None) -> httpx.Client:
    def handler(request: httpx.Request) -> httpx.Response:
        if status is None:
            raise AssertionError("network must not be called")
        return httpx.Response(status)

    return httpx.Client(transport=httpx.MockTransport(handler))


NOW = datetime(2026, 10, 26, 12, tzinfo=UTC)


def test_save_load_round_trip(tmp_path):
    path = tmp_path / "catalog.json"
    save_catalog(_groups(), path, NOW)
    assert load_catalog(path) == (_groups(), NOW)


def test_refresh_uses_fresh_cache_without_network(tmp_path):
    path = tmp_path / "catalog.json"
    save_catalog(_groups(), path, NOW - timedelta(days=2))
    assert refresh_if_stale(path, _failing_client(), NOW) == _groups()


def test_refresh_falls_back_to_stale_cache_on_error(tmp_path):
    path = tmp_path / "catalog.json"
    save_catalog(_groups(), path, NOW - timedelta(days=8))
    assert refresh_if_stale(path, _failing_client(503), NOW) == _groups()


def test_refresh_without_cache_raises(tmp_path):
    with pytest.raises(httpx.HTTPStatusError):
        refresh_if_stale(tmp_path / "catalog.json", _failing_client(503), NOW)


def test_refresh_fetches_and_saves_when_stale(tmp_path):
    path = tmp_path / "catalog.json"
    records = [rec(i, (2697, CHURCH)) for i in range(4)]

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"info": {"total": 4}, "data": records})

    client = httpx.Client(transport=httpx.MockTransport(handler))
    assert refresh_if_stale(path, client, NOW) == _groups()
    assert load_catalog(path) == (_groups(), NOW)


@pytest.mark.parametrize(
    "response",
    [
        httpx.Response(200, text="<html>Down for maintenance</html>"),
        httpx.Response(200, json={"unexpected": True}),
        # An outage that answers "no paintings" must not wipe the cached catalog.
        httpx.Response(200, json={"info": {"total": 0}, "data": []}),
    ],
)
def test_refresh_keeps_stale_cache_on_garbled_or_empty_response(tmp_path, response: httpx.Response):
    path = tmp_path / "catalog.json"
    stale = NOW - timedelta(days=8)
    save_catalog(_groups(), path, stale)
    client = httpx.Client(transport=httpx.MockTransport(lambda request: response))
    assert refresh_if_stale(path, client, NOW) == _groups()
    assert load_catalog(path) == (_groups(), stale)
