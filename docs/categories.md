# Expense categories (reference for shipping)

Agreed on 2026-10-04. Not applied yet: the live categories are still the nine in
`api/config/finance.config.json`. Use this file when the category change ships.

Designed for a new grad living alone in a rented flat, away from home, with a
bike. Checked against the Splitwise export of 2026-08-19 to 2026-10-03: with
the current nine categories 63% of that spend could only go to "Others"; with
this set none of it does.

## Categories

The **Laya description** column is the exact text to pass to Laya as the
category's criteria. It is the wording that tested best. Keep it short and
plain, and do not add brand names (see "Rules for wording" below).

| Category | Laya description | Also covers (for humans, not for Laya) |
|---|---|---|
| Rent & Maintenance | rent, society maintenance, move-in charges, monthly furniture and appliance rental | Furlenco subscription (recurring, same amount monthly) |
| Utilities | electricity, cooking gas, water, internet, mobile recharge | LPG cylinder, Wi-Fi, Airtel/Jio recharge |
| Household | utensils, kitchen items, cleaning supplies, small appliances, home repairs and cleaning services, ironing | Mop, wiper, Odonil, induction, Urban Company cleaning, ironing |
| Domestic Help | salary for cook or maid | Cook, maid |
| Groceries | food and ingredients bought to cook at home | Ratnadeep, Bigbasket, Blinkit, Instamart, Zepto, vegetables, eggs, chicken |
| Eating Out | restaurants, food delivery, ready-to-eat food, snacks, sweets | Swiggy, Zomato, rotis bought ready, breakfast outside |
| Bike | motorbike fuel, servicing, repairs, parking, insurance | Petrol, bike service, helmet |
| Commute | cabs, autos, metro, bus | Uber, Ola, Rapido, metro card |
| Travel | trips out of town: flights, trains, buses, hotels | Trips home, IRCTC |
| Medical & Gym | gym, medicines, doctor, tests | Pharmacy, consultations, gym fees |
| Shopping & Personal Care | clothes, shoes, gadgets, haircut, toiletries | Amazon, Flipkart, Myntra, salon |
| Entertainment | movies, events, outings, streaming subscriptions | PVR, concerts, Netflix, Spotify |
| Family & Gifts | money sent home, gifts, festivals | Money to parents, birthday gifts |
| Others | anything that fits no other category | Fallback only |

## Rules for wording (learned from testing Laya)

Tested on 2026-10-04 with the real `convaiinnovations/laya` model on 54 unique
descriptions from the export plus 20 made-up ones for categories the export
doesn't cover. Correct answers were judged by hand, so treat these as indicative.

| What Laya was given | Export correct | Made-up correct | Wrong but confident (≥ 0.5), both sets |
|---|---|---|---|
| Current 9 categories, names only | 28 / 54 | not run | 21 (export only) |
| New 14, names only ("Spending on …") | 18 / 54 | 10 / 20 | not counted |
| New 14, descriptions with brand names | 23 / 54 | 13 / 20 | not counted |
| New 14, short plain descriptions | 30 / 54 | 15 / 20 | not counted |
| Same, with "Health & Fitness" renamed "Medical & Gym" | **39 / 54** | **16 / 20** | **4** |

1. **Category names steer the model hard.** "Health & Fitness" pulled
   vegetables, eggs, paneer and chicken towards it with near-certain
   confidence. Avoid names that describe a quality food or items can have
   ("health", "fresh", "essentials"). Prefer names that describe what is bought.
2. **Short, plain descriptions beat brand lists.** Adding brands made results
   worse. Brand knowledge belongs in the category memory (see the Splitwise
   import plan, "Category memory"), not in the description.
3. **Laya doesn't know local brands** such as Furlenco, Odonil or Ratnadeep.
   It got Furlenco wrong in every version. The category memory fixes these
   after the user confirms them once.
4. **Once the labels were right, the confidence became trustworthy.** Most
   wrong answers came back below 0.5, so the review screen's "Check this one"
   flag catches them.
5. Re-run a test like this after any change to the names or descriptions.

## Mapping from the current categories

Existing transactions store the category name, so these need to move when
the change ships.

| Current | New |
|---|---|
| Grocery | Groceries |
| Food | Eating Out |
| Rent | Rent & Maintenance |
| Electricity | Utilities |
| Gym | Medical & Gym |
| Outing | Entertainment |
| Local Travel | Commute |
| Travel | Travel |
| Others | Others, but re-check each row: many belong in Household, Utilities, Rent & Maintenance or Domestic Help |

## Config, ready to paste

For the `categories` array in `api/config/finance.config.json`. The
`description` field is added by the Splitwise import plan
(`docs/superpowers/plans/2026-10-03-splitwise-import.md`): Task 4 adds the
column, API field and app form; Tasks 1, 3 and 5 send it to Laya in place of
"Spending on …". Until that ships, the current config loader silently ignores the field.

```json
[
  { "name": "Rent & Maintenance", "icon": "🏠", "color": "#5b5cf6", "description": "rent, society maintenance, move-in charges, monthly furniture and appliance rental" },
  { "name": "Utilities", "icon": "⚡", "color": "#ff9f0a", "description": "electricity, cooking gas, water, internet, mobile recharge" },
  { "name": "Household", "icon": "🧹", "color": "#ac8e68", "description": "utensils, kitchen items, cleaning supplies, small appliances, home repairs and cleaning services, ironing" },
  { "name": "Domestic Help", "icon": "🧑‍🍳", "color": "#ff375f", "description": "salary for cook or maid" },
  { "name": "Groceries", "icon": "🛒", "color": "#30d158", "description": "food and ingredients bought to cook at home" },
  { "name": "Eating Out", "icon": "🍽️", "color": "#0a84ff", "description": "restaurants, food delivery, ready-to-eat food, snacks, sweets" },
  { "name": "Bike", "icon": "🏍️", "color": "#ff453a", "description": "motorbike fuel, servicing, repairs, parking, insurance" },
  { "name": "Commute", "icon": "🚕", "color": "#64d2ff", "description": "cabs, autos, metro, bus" },
  { "name": "Travel", "icon": "✈️", "color": "#5e5ce6", "description": "trips out of town: flights, trains, buses, hotels" },
  { "name": "Medical & Gym", "icon": "💊", "color": "#ff6b6b", "description": "gym, medicines, doctor, tests" },
  { "name": "Shopping & Personal Care", "icon": "🛍️", "color": "#ffd60a", "description": "clothes, shoes, gadgets, haircut, toiletries" },
  { "name": "Entertainment", "icon": "🎭", "color": "#bf5af2", "description": "movies, events, outings, streaming subscriptions" },
  { "name": "Family & Gifts", "icon": "🎁", "color": "#ff9fbf", "description": "money sent home, gifts, festivals" },
  { "name": "Others", "icon": "📦", "color": "#8e8e93", "description": "anything that fits no other category" }
]
```
