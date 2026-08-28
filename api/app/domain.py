"""Categories the server owns, and the payday rule. Mirrors server/src/domain.ts."""

TRANSFER_CATEGORY = "Transfer"
ADJUSTMENT_CATEGORY = "Adjustment"
SALARY_CATEGORY = "Salary"

RESERVED_CATEGORIES: tuple[str, ...] = (
    TRANSFER_CATEGORY,
    ADJUSTMENT_CATEGORY,
    SALARY_CATEGORY,
)

# How the dashboard draws the reserved categories. Adjustments are hidden
# outright: they keep the stored balance and the ledger in agreement, which is
# bookkeeping rather than anything the user did.
RESERVED_CATEGORY_STYLES: list[dict] = [
    {"name": TRANSFER_CATEGORY, "icon": "🔁", "color": "#5b5cf6", "hidden": False},
    {"name": SALARY_CATEGORY, "icon": "💰", "color": "#30d158", "hidden": False},
    {"name": ADJUSTMENT_CATEGORY, "icon": "⚖️", "color": "#8e8e93", "hidden": True},
]

PAYDAY_DAY_OF_MONTH = 28
