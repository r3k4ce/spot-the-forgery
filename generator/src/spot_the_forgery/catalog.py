"""Cleveland Museum of Art open-access paintings, grouped into puzzle groups."""

import json
import logging
from collections import defaultdict
from collections.abc import Iterable, Mapping, Sequence
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

import httpx

from spot_the_forgery.models import Group, GroupKind, Painting

log = logging.getLogger(__name__)

API_URL = "https://openaccess-api.clevelandart.org/api/artworks/"
PAGE_SIZE = 1000
MIN_GROUP_SIZE = 4
FIELDS = "id,title,creation_date,creation_date_earliest,creators,culture,images,url"


def fetch_records(client: httpx.Client) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    skip = 0
    while True:
        params = {
            "type": "Painting",
            "has_image": 1,
            "cc0": 1,
            "limit": PAGE_SIZE,
            "skip": skip,
            "fields": FIELDS,
        }
        response = client.get(API_URL, params=params)
        response.raise_for_status()
        body = response.json()
        page = body["data"]
        records.extend(page)
        skip += PAGE_SIZE
        if not page or skip >= body["info"]["total"]:
            return records


def _artist_label(description: str) -> str:
    return description.split(" (", 1)[0].strip()


def _century(earliest: object) -> str:
    if isinstance(earliest, int) and earliest > 0:
        return str((earliest // 100) * 100)
    return "unknown"


def _group_of(record: Mapping[str, Any]) -> tuple[str, GroupKind, str] | None:
    creators = record.get("creators") or []
    if creators:
        creator = creators[0]
        label = _artist_label(creator.get("description") or "")
        if not label or label.lower().startswith(("anonymous", "unknown")):
            return None
        return f"artist:{creator['id']}", "artist", label
    cultures = record.get("culture") or []
    if not cultures or not cultures[0]:
        return None
    culture = cultures[0]
    return f"culture:{culture}|{_century(record.get('creation_date_earliest'))}", "culture", culture


def _painting(record: Mapping[str, Any]) -> Painting | None:
    image_url = ((record.get("images") or {}).get("web") or {}).get("url")
    if not image_url:
        return None
    return Painting(
        id=int(record["id"]),
        title=record.get("title") or "Untitled",
        date=record.get("creation_date") or "",
        image_url=image_url,
        page_url=record.get("url") or "",
    )


def build_groups(records: Iterable[Mapping[str, Any]]) -> list[Group]:
    members: dict[str, list[Painting]] = defaultdict(list)
    meta: dict[str, tuple[GroupKind, str]] = {}
    for record in records:
        group = _group_of(record)
        painting = _painting(record)
        if group is None or painting is None:
            continue
        key, kind, label = group
        members[key].append(painting)
        meta[key] = (kind, label)
    return [
        Group(key=key, kind=meta[key][0], label=meta[key][1], paintings=tuple(members[key]))
        for key in sorted(members)
        if len(members[key]) >= MIN_GROUP_SIZE
    ]


def save_catalog(groups: Sequence[Group], path: Path, fetched_at: datetime) -> None:
    data = {
        "fetchedAt": fetched_at.isoformat(),
        "groups": [
            {
                "key": g.key,
                "kind": g.kind,
                "label": g.label,
                "paintings": [vars(p) for p in g.paintings],
            }
            for g in groups
        ],
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    tmp.replace(path)


def load_catalog(path: Path) -> tuple[list[Group], datetime]:
    data = json.loads(path.read_text(encoding="utf-8"))
    groups = [
        Group(
            key=g["key"],
            kind=g["kind"],
            label=g["label"],
            paintings=tuple(Painting(**p) for p in g["paintings"]),
        )
        for g in data["groups"]
    ]
    return groups, datetime.fromisoformat(data["fetchedAt"])


def _download_groups(client: httpx.Client) -> list[Group]:
    groups = build_groups(fetch_records(client))
    if not groups:
        # The museum has not stopped lending paintings: an empty answer is an outage.
        raise ValueError("the museum API returned no usable paintings")
    return groups


def refresh_if_stale(
    path: Path, client: httpx.Client, now: datetime, max_age: timedelta = timedelta(days=7)
) -> list[Group]:
    cached = load_catalog(path) if path.exists() else None
    if cached is not None and now - cached[1] < max_age:
        return cached[0]
    try:
        groups = _download_groups(client)
    except (httpx.HTTPError, ValueError, KeyError, TypeError) as exc:
        if cached is None:
            raise
        log.warning("catalog refresh failed (%s); using the cached copy", exc)
        return cached[0]
    save_catalog(groups, path, now)
    return groups
