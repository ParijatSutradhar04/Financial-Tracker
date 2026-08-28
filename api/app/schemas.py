"""Request/response models. Mirrors server/src/validation.ts (Zod) and the
shapes in src/api.ts, so the ported frontend needs no shape changes.

Every model is camelCase on the wire (matching the Express API) while using
snake_case field names internally, via a shared alias-generating base class.
"""

from __future__ import annotations

import math
import re
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from pydantic.alias_generators import to_camel

from .config import settings
from .finance_config import spend_category_names
from .services.dates import today_iso

_UUID_RE = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)
_ISO_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


class CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


# ---------------------------------------------------------------------------
# Shared field validators
# ---------------------------------------------------------------------------


def _validate_uuid(value: str) -> str:
    if not isinstance(value, str) or not _UUID_RE.match(value):
        raise ValueError("Expected an account id")
    return value


def _validate_iso_date(value: str) -> str:
    if not isinstance(value, str) or not _ISO_DATE_RE.match(value):
        raise ValueError("Expected a YYYY-MM-DD date")
    return value


def _validate_not_in_future(value: str) -> str:
    # The reconciliation trigger folds a transaction into the balance the
    # first time it sees it, so a transaction dated in the future would be
    # counted now and again once that date arrives.
    if value > today_iso(settings.timezone):
        raise ValueError("Date cannot be in the future")
    return value


def _validate_money(value: object) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError("Expected a number")
    amount = float(value)
    if not math.isfinite(amount):
        raise ValueError("Amount must be finite")
    # NUMERIC(12,2) tops out at 10^10; the original's "at most two decimal
    # places" check is float-comparison-based and effectively never rejects a
    # real input (Postgres rounds to 2dp on insert regardless), so only the
    # range check is meaningfully enforced here, matching real-world
    # behavior.
    if abs(amount) >= 1e10:
        raise ValueError("Amount is out of range")
    return amount


def _validate_positive_money(value: object) -> float:
    amount = _validate_money(value)
    if amount <= 0:
        raise ValueError("Amount must be greater than zero")
    return amount


def _validate_category(value: str) -> str:
    if value not in spend_category_names:
        raise ValueError(f"Category must be one of: {', '.join(spend_category_names)}")
    return value


def _validate_description(value: str, *, required: bool) -> str:
    trimmed = value.strip() if value else ""
    if required and not trimmed:
        raise ValueError("Description is required")
    if len(trimmed) > 500:
        raise ValueError("String should have at most 500 characters")
    return trimmed


# ---------------------------------------------------------------------------
# Response models
# ---------------------------------------------------------------------------


class AccountOut(CamelModel):
    id: str
    name: str
    kind: str
    role: Optional[str] = None
    currency: str
    balance: float
    outstanding: Optional[float] = None
    reconciled_at: str


class CategoryOut(CamelModel):
    name: str
    icon: str
    color: str
    spendable: bool
    hidden: bool


class ConfigOut(CamelModel):
    categories: list[CategoryOut]


class TransactionOut(CamelModel):
    id: str
    account_id: str
    account_name: str
    amount: float
    type: str
    category: str
    description: str
    date: str
    is_spend: bool
    created_at: str


class PaydayOut(CamelModel):
    date: str
    days_until: int
    last_salary_date: Optional[str] = None


class TransactionAccountOut(CamelModel):
    transaction: TransactionOut
    account: AccountOut


class SalaryOut(CamelModel):
    transaction: TransactionOut
    account: AccountOut
    payday: PaydayOut


class TransfersOut(CamelModel):
    transactions: list[TransactionOut]
    accounts: list[AccountOut]


class ReconcileOut(CamelModel):
    accounts: list[AccountOut]
    adjustments: list[TransactionOut]


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------


class CreateTransactionIn(CamelModel):
    account_id: str
    amount: float
    category: str
    description: str
    date: str

    @field_validator("account_id")
    @classmethod
    def _account_id(cls, v: str) -> str:
        return _validate_uuid(v)

    @field_validator("amount")
    @classmethod
    def _amount(cls, v: object) -> float:
        return _validate_positive_money(v)

    @field_validator("category")
    @classmethod
    def _category(cls, v: str) -> str:
        return _validate_category(v)

    @field_validator("description")
    @classmethod
    def _description(cls, v: str) -> str:
        return _validate_description(v, required=True)

    @field_validator("date")
    @classmethod
    def _date(cls, v: str) -> str:
        return _validate_not_in_future(_validate_iso_date(v))


class CreateSalaryIn(CamelModel):
    account_id: str
    amount: float
    description: Optional[str] = None
    date: str

    @field_validator("account_id")
    @classmethod
    def _account_id(cls, v: str) -> str:
        return _validate_uuid(v)

    @field_validator("amount")
    @classmethod
    def _amount(cls, v: object) -> float:
        return _validate_positive_money(v)

    @field_validator("description")
    @classmethod
    def _description(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        return _validate_description(v, required=False)

    @field_validator("date")
    @classmethod
    def _date(cls, v: str) -> str:
        return _validate_not_in_future(_validate_iso_date(v))


class CreateTransferIn(CamelModel):
    from_account_id: str
    to_account_id: str
    amount: float
    description: Optional[str] = None

    @field_validator("from_account_id", "to_account_id")
    @classmethod
    def _account_id(cls, v: str) -> str:
        return _validate_uuid(v)

    @field_validator("amount")
    @classmethod
    def _amount(cls, v: object) -> float:
        return _validate_positive_money(v)

    @field_validator("description")
    @classmethod
    def _description(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        return _validate_description(v, required=False)

    @model_validator(mode="after")
    def _distinct_accounts(self) -> "CreateTransferIn":
        if self.from_account_id == self.to_account_id:
            raise ValueError("Cannot transfer to the same account")
        return self


class ReconcileBalanceIn(CamelModel):
    account_id: str
    balance: float

    @field_validator("account_id")
    @classmethod
    def _account_id(cls, v: str) -> str:
        return _validate_uuid(v)

    @field_validator("balance")
    @classmethod
    def _balance(cls, v: object) -> float:
        return _validate_money(v)


class ReconcileIn(CamelModel):
    balances: list[ReconcileBalanceIn] = Field(min_length=1)

    @model_validator(mode="after")
    def _unique_accounts(self) -> "ReconcileIn":
        ids = [b.account_id for b in self.balances]
        if len(set(ids)) != len(ids):
            raise ValueError("Each account may only appear once")
        return self
