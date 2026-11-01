import pytest

from classifier import build_questions, classify


class FakeAgent:
    """Mimics laya's agent.predict_batch result shape."""

    def __init__(self, answers):
        self.answers = answers
        self.calls = []

    def predict_batch(self, states, questions, batch_size, sort_by_length):
        self.calls.append((states, questions, batch_size, sort_by_length))
        return [
            {"answers": {"category": {"choice": choice, "answer_confidence": conf}}}
            for choice, conf in self.answers[: len(states)]
        ]


CATS = [
    {"name": "Eating Out", "description": "restaurants, food delivery, snacks"},
    {"name": "Travel", "description": ""},
]


def test_build_questions_uses_descriptions_as_criteria():
    q = build_questions(CATS)
    assert q["category"]["type"] == "choice"
    assert list(q["category"]["criteria"].keys()) == ["Eating Out", "Travel"]
    assert q["category"]["criteria"]["Eating Out"] == "restaurants, food delivery, snacks"
    assert q["category"]["criteria"]["Travel"] == "Spending on travel"  # no description: fall back to the name


def test_classify_maps_results_in_order():
    agent = FakeAgent([("Eating Out", 0.91), ("Travel", 0.42)])
    out = classify(agent, ["Dinner at Toit", "Cab to airport"], CATS)
    assert out == [
        {"category": "Eating Out", "confidence": 0.91},
        {"category": "Travel", "confidence": 0.42},
    ]
    states, _, batch_size, sort_by_length = agent.calls[0]
    assert states == [{"body": "Dinner at Toit"}, {"body": "Cab to airport"}]
    assert batch_size == 32 and sort_by_length is True


def test_classify_empty_input_skips_model():
    agent = FakeAgent([])
    assert classify(agent, [], CATS) == []
    assert agent.calls == []


def test_classify_rejects_label_outside_categories():
    agent = FakeAgent([("Groceries", 0.9)])
    with pytest.raises(ValueError, match="Groceries"):
        classify(agent, ["Milk"], CATS)
