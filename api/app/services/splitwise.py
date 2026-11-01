"""Parses a Splitwise "Export as spreadsheet" CSV into the user's share of
each expense, and checks that the export is settled.

The file has one column per person after Date/Description/Category/Cost/
Currency. Each of those holds that person's *net* balance change for the row
(paid minus owed), not their share, so the share is derived from it. The
Category column is only used to spot settlement rows; categorization itself
is done by Laya, not Splitwise.
"""

from __future__ import annotations

import csv
import hashlib
import io
import re
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import date
from decimal import Decimal, InvalidOperation

REQUIRED_COLUMNS = ("date", "description", "category", "cost", "currency")
SUPPORTED_CURRENCY = "INR"
_CENT = Decimal("0.01")
# Splitwise's settle-up description, e.g. "Parijat S. paid Shalin C."
_PAID_RE = re.compile(r"^\S.*\s+paid\s+\S.*$", re.IGNORECASE)
_HAS_DIGIT_RE = re.compile(r"\S*\d\S*")
_NON_WORD_RE = re.compile(r"[^\w]+")


class SplitwiseCsvError(ValueError):
    pass


@dataclass(frozen=True)
class ParsedRow:
    fingerprint: str
    date: str
    description: str
    amount: float
    cost: float


@dataclass(frozen=True)
class SkippedRow:
    line: int
    description: str
    reason: str


@dataclass(frozen=True)
class Settlement:
    line: int
    date: str
    description: str
    amount: float
    currency: str


@dataclass(frozen=True)
class Balance:
    member: str
    currency: str
    amount: float  # positive: is owed money; negative: owes money


@dataclass(frozen=True)
class ParsedCsv:
    members: list[str]
    member_name: str | None
    rows: list[ParsedRow]
    skipped: list[SkippedRow]
    settlements: list[Settlement]
    unsettled: list[Balance]

    @property
    def settled(self) -> bool:
        return not self.unsettled


def unsettled_message(unsettled: list[Balance]) -> str:
    owing = [b for b in unsettled if b.amount < 0] or unsettled
    parts = [f"{b.member} owes {b.currency} {abs(b.amount):,.2f}" for b in owing]
    return (
        f"This export isn't settled yet: {'; '.join(parts)}. "
        "Settle up in Splitwise, export again and upload the new file."
    )


def memory_key(description: str) -> str:
    """Key for the category memory. The same purchase recurs with a different
    date or number in it ("Grocery Ratnadeep 22/08", "... 6/9"), so tokens
    with a digit are dropped. Empty means there is nothing worth remembering."""
    text = _HAS_DIGIT_RE.sub(" ", description.lower())
    return " ".join(_NON_WORD_RE.sub(" ", text).split())


def _is_blank(cells: list[str]) -> bool:
    return not any(c.strip() for c in cells)


def _valid_iso_date(value: str) -> bool:
    if len(value) != 10:
        return False
    try:
        date.fromisoformat(value)
    except ValueError:
        return False
    return True


def _is_settlement(category: str, description: str) -> bool:
    if category.lower() == "payment":
        return True
    return not category and bool(_PAID_RE.match(description))


def _to_decimal(value: str) -> Decimal:
    """Parses a number; blank means zero. Raises InvalidOperation for junk or non-finite values."""
    number = Decimal(value or "0")
    if not number.is_finite():
        raise InvalidOperation(value)
    return number


def _fingerprint(date_: str, description: str, cost: Decimal, currency: str, occurrence: int) -> str:
    normalised = " ".join(description.lower().split())
    key = "|".join((date_, normalised, f"{cost:.2f}", currency, str(occurrence)))
    return hashlib.sha256(key.encode("utf8")).hexdigest()


def parse_splitwise_csv(text: str, member_name: str | None, today: str) -> ParsedCsv:
    lines = list(csv.reader(io.StringIO(text.lstrip("\ufeff"))))

    header_index = next((i for i, cells in enumerate(lines) if not _is_blank(cells)), None)
    if header_index is None:
        raise SplitwiseCsvError("The file is empty")

    header = [c.strip() for c in lines[header_index]]
    if tuple(h.lower() for h in header[:5]) != REQUIRED_COLUMNS:
        raise SplitwiseCsvError(
            "This doesn't look like a Splitwise export: expected the columns "
            "Date, Description, Category, Cost, Currency"
        )

    members = [h for h in header[5:] if h]
    if not members:
        raise SplitwiseCsvError("The export has no people columns, so your share can't be worked out")
    member_cols = {m: header.index(m) for m in members}
    if member_name not in member_cols:
        member_name = None

    rows: list[ParsedRow] = []
    skipped: list[SkippedRow] = []
    settlements: list[Settlement] = []
    balances: defaultdict[str, defaultdict[str, Decimal]] = defaultdict(lambda: defaultdict(Decimal))
    totals: dict[str, dict[str, Decimal]] = {}
    occurrences: Counter[tuple] = Counter()

    # csv line numbers are 1-based and the header is line header_index + 1.
    for line_no, raw in enumerate(lines[header_index + 1 :], start=header_index + 2):
        if _is_blank(raw):
            continue
        cells = [c.strip() for c in raw] + [""] * max(0, len(header) - len(raw))
        date_s, description, category, cost_s, currency = cells[:5]
        currency = currency.upper()

        try:
            row_balances = {m: _to_decimal(cells[col]) for m, col in member_cols.items()}
        except InvalidOperation as exc:
            raise SplitwiseCsvError(
                f"Line {line_no} has a balance that isn't a number, so I can't check whether the export is settled"
            ) from exc

        if description.lower() == "total balance":
            totals[currency] = row_balances
            continue
        for m, value in row_balances.items():
            balances[currency][m] += value

        if _is_settlement(category, description):
            try:
                amount = float(_to_decimal(cost_s))
            except InvalidOperation:
                amount = 0.0
            settlements.append(
                Settlement(line=line_no, date=date_s, description=description, amount=amount, currency=currency)
            )
            continue
        if member_name is None:
            continue

        def skip(reason: str) -> None:
            skipped.append(SkippedRow(line=line_no, description=description or "(no description)", reason=reason))

        if not _valid_iso_date(date_s):
            skip(f"Unrecognised date '{date_s}' (expected YYYY-MM-DD)")
            continue
        if date_s > today:
            skip("Dated in the future")
            continue
        if currency != SUPPORTED_CURRENCY:
            skip(f"Currency {currency or '(blank)'} is not supported")
            continue
        if not description:
            skip("Missing description")
            continue
        try:
            cost = _to_decimal(cost_s)
        except InvalidOperation:
            skip("Amount is not a number")
            continue

        net = row_balances[member_name]
        if net == 0:
            skip("Your balance didn't change, so you weren't part of this expense")
            continue
        # net < 0: someone else paid and my share is what I now owe.
        # net > 0: I paid; my share is the cost minus what the others owe me
        # (assumes I was the only payer).
        share = (-net if net < 0 else cost - net).quantize(_CENT)
        if share == 0:
            skip("You paid the whole amount for others, so none of it is your expense")
            continue
        if share < 0:
            skip("Your balance change is bigger than the cost; check this expense in Splitwise")
            continue

        description = description[:500]
        key = (date_s, " ".join(description.lower().split()), f"{cost:.2f}", currency)
        occurrences[key] += 1

        rows.append(
            ParsedRow(
                fingerprint=_fingerprint(date_s, description, cost, currency, occurrences[key]),
                date=date_s,
                description=description,
                amount=float(share),
                cost=float(cost),
            )
        )

    for currency, total in totals.items():
        if any(total[m].quantize(_CENT) != balances[currency][m].quantize(_CENT) for m in members):
            raise SplitwiseCsvError(
                "The Total balance row doesn't match the rows above it. "
                "Export again from Splitwise and upload the file without editing it."
            )

    unsettled = [
        Balance(member=m, currency=currency, amount=float(balances[currency][m].quantize(_CENT)))
        for currency in sorted(balances)
        for m in members
        if balances[currency][m].quantize(_CENT) != 0
    ]

    return ParsedCsv(
        members=members,
        member_name=member_name,
        rows=rows,
        skipped=skipped,
        settlements=settlements,
        unsettled=unsettled,
    )
