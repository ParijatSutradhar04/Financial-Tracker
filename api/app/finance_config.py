"""Accounts, credit cards, and spend categories, read from finance.config.json.

Mirrors server/src/finance-config.ts. Accounts and cards can still be
provisioned from here (scripts/provision.py), though the app can also create
them directly now (POST /api/accounts). Categories are seeded from here once,
into the `categories` table (services/categories.py:provision_categories) —
after that, the table is the runtime source of truth, not this file.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .config import settings

_COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")


class ConfiguredAccount(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    name: str = Field(min_length=1, max_length=100)
    kind: Literal["bank", "credit_card"]
    role: Optional[Literal["primary", "salary"]] = None
    currency: str = Field(default="INR", min_length=3, max_length=3)
    opening_balance: float = Field(default=0, alias="openingBalance")


class ConfiguredCategory(BaseModel):
    name: str = Field(min_length=1, max_length=50)
    icon: str = Field(min_length=1)
    color: str

    @model_validator(mode="after")
    def _check_color(self) -> "ConfiguredCategory":
        if not _COLOR_RE.match(self.color):
            raise ValueError("Expected a #rrggbb colour")
        return self


class FinanceConfig(BaseModel):
    accounts: list[ConfiguredAccount] = Field(min_length=1)
    categories: list[ConfiguredCategory] = Field(min_length=1)

    @model_validator(mode="after")
    def _check_uniqueness_and_roles(self) -> "FinanceConfig":
        account_names = [a.name.lower() for a in self.accounts]
        if len(set(account_names)) != len(account_names):
            raise ValueError("Account names must be unique")

        category_names = [c.name.lower() for c in self.categories]
        if len(set(category_names)) != len(category_names):
            raise ValueError("Category names must be unique")

        # A role picks out the account a fixed button acts on, so a second
        # claimant would make Add Salary or Transfer ambiguous.
        for role in ("primary", "salary"):
            holders = [a for a in self.accounts if a.role == role]
            if len(holders) > 1:
                raise ValueError(f"Only one account may have role '{role}', found {len(holders)}")
            if any(a.kind != "bank" for a in holders):
                raise ValueError(f"The '{role}' account must be a bank account")

        return self


DEFAULT_PATH = Path(__file__).resolve().parent.parent / "config" / "finance.config.json"


def _load() -> FinanceConfig:
    path = Path(settings.finance_config_path) if settings.finance_config_path else DEFAULT_PATH
    try:
        raw = json.loads(path.read_text(encoding="utf8"))
    except OSError as err:
        raise RuntimeError(f"Could not read {path}: {err}") from err
    except json.JSONDecodeError as err:
        raise RuntimeError(f"Could not read {path}: {err}") from err

    try:
        return FinanceConfig.model_validate(raw)
    except Exception as err:
        raise RuntimeError(f"{path} is not valid:\n  {err}") from err


# Parsed once at import. A malformed config should stop the process rather
# than surface as a confusing failure on the first request that happens to
# need it.
finance_config = _load()

_roles_by_name: dict[str, str] = {
    a.name.lower(): a.role for a in finance_config.accounts if a.role
}


def role_for_account_name(name: str) -> Optional[str]:
    return _roles_by_name.get(name.lower())


def account_by_role(role: Literal["primary", "salary"]) -> Optional[ConfiguredAccount]:
    return next((a for a in finance_config.accounts if a.role == role), None)
