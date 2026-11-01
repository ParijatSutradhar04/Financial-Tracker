"""Turns expense descriptions + the user's categories into one Laya `choice`
question and maps the answers back. Kept free of any `laya` import so it can
be tested with a fake agent.

Each category is {"name", "description"}. Laya scores a description against
each category's criterion, so a short plain description ("cabs, autos,
metro, bus") works far better than the bare name (docs/categories.md)."""

from __future__ import annotations

QUESTION_ID = "category"


def _criterion(category: dict) -> str:
    return (category.get("description") or "").strip() or f"Spending on {category['name'].lower()}"


def build_questions(categories: list[dict]) -> dict:
    return {
        QUESTION_ID: {
            "type": "choice",
            "instructions": "Which spending category does this personal expense belong to?",
            "criteria": {c["name"]: _criterion(c) for c in categories},
        }
    }


def classify(agent, descriptions: list[str], categories: list[dict], batch_size: int = 32) -> list[dict]:
    if not descriptions:
        return []

    allowed = {c["name"] for c in categories}
    results = agent.predict_batch(
        [{"body": d} for d in descriptions],
        build_questions(categories),
        batch_size=batch_size,
        sort_by_length=True,
    )

    out: list[dict] = []
    for result in results:
        answer = result["answers"][QUESTION_ID]
        label = answer["choice"]
        if label not in allowed:
            raise ValueError(f"Model returned {label!r}, which is not one of the categories")
        out.append({"category": label, "confidence": float(answer["answer_confidence"])})
    return out
