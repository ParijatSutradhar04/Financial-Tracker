"""Private HF Space: Laya (English checkpoint) behind a JSON API plus a small
Gradio page for trying descriptions by hand. Gradio and FastAPI share one
server on port 7860, which is what Gradio-SDK Spaces expose."""

from __future__ import annotations

import gradio as gr
import laya
import uvicorn
from fastapi import FastAPI
from pydantic import BaseModel, Field

from classifier import classify

# Downloaded on first boot, then served from the Space's cache.
agent = laya.load("convaiinnovations/laya")

api = FastAPI()


class CategoryChoice(BaseModel):
    name: str = Field(min_length=1, max_length=50)
    description: str = Field(default="", max_length=200)


class ClassifyIn(BaseModel):
    descriptions: list[str] = Field(min_length=1, max_length=64)
    categories: list[CategoryChoice] = Field(min_length=1, max_length=50)


@api.get("/healthz")
def healthz() -> dict:
    return {"status": "ok"}


# Plain `def` so FastAPI runs the CPU-bound model call in its threadpool.
@api.post("/classify")
def classify_route(body: ClassifyIn) -> dict:
    descriptions = [d.strip()[:500] for d in body.descriptions]
    return {"results": classify(agent, descriptions, [c.model_dump() for c in body.categories])}


def try_it(description: str, categories: str) -> str:
    # One category per line, as "Name: description" or just "Name".
    cats = []
    for line in categories.splitlines():
        name, _, desc = line.partition(":")
        if name.strip():
            cats.append({"name": name.strip(), "description": desc.strip()})
    if not description.strip() or not cats:
        return "Enter a description and at least one category."
    [result] = classify(agent, [description], cats)
    return f"{result['category']} (confidence {result['confidence']:.2f})"


demo = gr.Interface(
    fn=try_it,
    inputs=[
        gr.Textbox(label="Expense description", value="Dinner at Toit"),
        gr.Textbox(
            label="Categories (one per line, Name: description)",
            lines=4,
            value=(
                "Groceries: food and ingredients bought to cook at home\n"
                "Eating Out: restaurants, food delivery, ready-to-eat food, snacks, sweets\n"
                "Commute: cabs, autos, metro, bus\n"
                "Shopping & Personal Care: clothes, shoes, gadgets, haircut, toiletries"
            ),
        ),
    ],
    outputs=gr.Textbox(label="Prediction"),
    title="Laya categorizer",
)

app = gr.mount_gradio_app(api, demo, path="/")

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=7860)
