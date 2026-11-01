"""Splitwise CSV import.

/preview parses the export, drops rows already imported, reuses the category
the user confirmed before for a repeat description, and asks the Laya
categorizer about the rest. It never writes. /import records the rows the
user confirmed and remembers their categories. /classifier-status lets the app wake the
Hugging Face Space as soon as the import modal opens.
"""

from __future__ import annotations

import logging
from typing import NamedTuple, Optional

from fastapi import APIRouter, status
from fastapi.responses import JSONResponse

from ..config import settings
from ..db import acquire
from ..db import transaction as db_transaction
from ..errors import bad_request
from ..schemas import (
    SPLITWISE_MAX_ROWS,
    AccountOut,
    ClassifierStatusOut,
    SplitwiseImportIn,
    SplitwiseImportOut,
    SplitwisePreviewIn,
    SplitwisePreviewOut,
    SplitwisePreviewRowOut,
    SplitwiseSettlementOut,
    SplitwiseSkippedOut,
)
from ..services import categorizer
from ..services.categories import list_categories
from ..services.dates import today_iso
from ..services.splitwise import SplitwiseCsvError, memory_key, parse_splitwise_csv, unsettled_message
from ..services.splitwise_import import already_imported, import_rows, recall_categories

logger = logging.getLogger("finance_api")
router = APIRouter()


class Suggestion(NamedTuple):
    category: str
    confidence: Optional[float]
    source: str  # "memory" or "laya"


@router.get("/classifier-status", response_model=ClassifierStatusOut)
async def classifier_status() -> ClassifierStatusOut:
    return ClassifierStatusOut(ready=await categorizer.is_ready())


@router.post("/preview", response_model=SplitwisePreviewOut)
async def preview(body: SplitwisePreviewIn) -> SplitwisePreviewOut:
    try:
        parsed = parse_splitwise_csv(body.csv, body.member_name, today_iso(settings.timezone))
    except SplitwiseCsvError as exc:
        raise bad_request(str(exc)) from exc

    # The user only imports after settling up. Checked before the member step
    # and before any DB or Laya call, so an unsettled file costs nothing.
    if not parsed.settled:
        raise bad_request(unsettled_message(parsed.unsettled))

    if len(parsed.rows) > SPLITWISE_MAX_ROWS:
        raise bad_request(
            f"The export has {len(parsed.rows)} expenses; import at most {SPLITWISE_MAX_ROWS} at a time"
        )

    async with acquire() as conn:
        imported = await already_imported(conn, [r.fingerprint for r in parsed.rows])
        # Laya scores against each category's description (docs/categories.md).
        choices = [
            {"name": c["name"], "description": c["description"]} for c in await list_categories(conn) if c["spendable"]
        ]
        fresh = [r for r in parsed.rows if r.fingerprint not in imported]
        keys = {r.fingerprint: memory_key(r.description) for r in fresh}
        remembered = await recall_categories(conn, sorted({k for k in keys.values() if k}))

    names = {c["name"] for c in choices}
    suggestions: dict[str, Suggestion] = {}
    # Rows Laya must see, grouped so each distinct description is asked once.
    # A row with an empty key can't be grouped, so it stands alone.
    ask: dict[str, list] = {}
    for r in fresh:
        category = remembered.get(keys[r.fingerprint])
        if category in names:  # only while it can still be picked
            suggestions[r.fingerprint] = Suggestion(category, None, "memory")
        else:
            ask.setdefault(keys[r.fingerprint] or r.fingerprint, []).append(r)

    classifier = "not_run"
    if ask and choices:
        try:
            results = await categorizer.classify([group[0].description for group in ask.values()], choices)
            for group, p in zip(ask.values(), results):
                for r in group:
                    suggestions[r.fingerprint] = Suggestion(p.category, p.confidence, "laya")
            classifier = "ok"
        except categorizer.CategorizerUnavailable as exc:
            logger.warning("Laya categorizer unavailable: %s", exc)
            classifier = "unavailable"

    return SplitwisePreviewOut(
        members=parsed.members,
        member_name=parsed.member_name,
        rows=[
            SplitwisePreviewRowOut(
                fingerprint=r.fingerprint,
                date=r.date,
                description=r.description,
                amount=r.amount,
                category=s.category if s else None,
                confidence=s.confidence if s else None,
                source=s.source if s else None,
                already_imported=r.fingerprint in imported,
            )
            for r in parsed.rows
            for s in [suggestions.get(r.fingerprint)]
        ],
        skipped=[SplitwiseSkippedOut(line=s.line, description=s.description, reason=s.reason) for s in parsed.skipped],
        settlements=[
            SplitwiseSettlementOut(line=s.line, date=s.date, description=s.description, amount=s.amount)
            for s in parsed.settlements
        ],
        classifier=classifier,
    )


@router.post("/import", status_code=status.HTTP_201_CREATED, response_model=SplitwiseImportOut)
async def import_expenses(body: SplitwiseImportIn) -> JSONResponse:
    async with db_transaction() as conn:
        result = await import_rows(conn, settings.timezone, body.account_id, body.rows)

    out = SplitwiseImportOut(
        imported=result["imported"],
        skipped_duplicates=result["skipped_duplicates"],
        account=AccountOut(**result["account"]),
    )
    return JSONResponse(status_code=status.HTTP_201_CREATED, content=out.model_dump(by_alias=True))
