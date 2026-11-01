import csv
from decimal import Decimal

import pytest

from app.services.splitwise import (
    Balance,
    Settlement,
    SplitwiseCsvError,
    memory_key,
    parse_splitwise_csv,
    unsettled_message,
)

TODAY = "2026-10-03"
ME = "Parijat Sutradhar"
HEADER = "Date,Description,Category,Cost,Currency,Parijat Sutradhar,Asha Kumar"
ROWS = [
    "2026-09-01,Dinner at Toit ,Dining out,1200.00,INR,600.00,-600.00",  # I paid
    "2026-09-02,Cab to airport,Taxi,900.00,INR,-450.00,450.00",  # Asha paid
    '2026-09-03,"Garam masala, curd",Groceries,90.00,INR,90.00,-90.00',  # I paid all of it for Asha
    "2026-09-04,Movie tickets,Movies,500.00,INR,0.00,0.00",  # not involved
    "2026-09-05,Asha K. paid Parijat S.,Payment,240.00,INR,-240.00,240.00",  # settles the 240 Asha owed
]


def make_csv(rows=ROWS, total=True):
    """Lays rows out like a real export, with one Total balance row per currency."""
    sums: dict[str, list[Decimal]] = {}
    for cells in csv.reader(rows):
        per = sums.setdefault(cells[4], [Decimal(0), Decimal(0)])
        per[0] += Decimal(cells[5])
        per[1] += Decimal(cells[6])
    totals = [f"2026-10-03,Total balance, , ,{cur},{a:.2f},{b:.2f}" for cur, (a, b) in sums.items()] if total else []
    return "\n".join([HEADER, "", *rows, "", *totals]) + "\n"


SAMPLE = make_csv()  # settled: both balances are 0.00


def parse(text=SAMPLE, member=ME, today=TODAY):
    return parse_splitwise_csv(text, member, today)


def test_members_and_settlement_known_without_member():
    result = parse(member=None)
    assert result.members == ["Parijat Sutradhar", "Asha Kumar"]
    assert result.member_name is None
    assert result.rows == [] and result.skipped == []
    assert result.settled and len(result.settlements) == 1


def test_unknown_member_behaves_like_no_member():
    result = parse(member="Someone Else")
    assert result.member_name is None and result.rows == []


def test_share_when_i_paid_and_when_someone_else_paid():
    rows = parse().rows
    assert [(r.date, r.description, r.amount) for r in rows] == [
        ("2026-09-01", "Dinner at Toit", 600.0),  # trailing space stripped; paid 1200, net +600 -> share 600
        ("2026-09-02", "Cab to airport", 450.0),  # Asha paid, my net -450 -> share 450
    ]
    assert rows[0].cost == 1200.0


def test_settlement_rows_are_returned_separately_not_as_expenses():
    result = parse()
    assert result.settlements == [
        Settlement(line=7, date="2026-09-05", description="Asha K. paid Parijat S.", amount=240.0, currency="INR")
    ]
    assert all("paid" not in s.description for s in result.skipped)


def test_settlement_recognised_by_description_when_category_is_blank():
    rows = [*ROWS[:-1], "2026-09-05,Asha K. paid Parijat S.,,240.00,INR,-240.00,240.00"]
    result = parse(make_csv(rows))
    assert len(result.settlements) == 1 and len(result.rows) == 2


def test_rows_with_no_share_for_me_are_skipped_with_reasons():
    skipped = parse().skipped
    assert [(s.line, s.description, s.reason) for s in skipped] == [
        (5, "Garam masala, curd", "You paid the whole amount for others, so none of it is your expense"),
        (6, "Movie tickets", "Your balance didn't change, so you weren't part of this expense"),
    ]


def test_settled_export():
    result = parse()
    assert result.settled and result.unsettled == []


def test_unsettled_export_reports_who_owes():
    result = parse(make_csv(ROWS[:-1]))  # drop the settlement row
    assert not result.settled
    assert result.unsettled == [
        Balance(member="Parijat Sutradhar", currency="INR", amount=240.0),
        Balance(member="Asha Kumar", currency="INR", amount=-240.0),
    ]
    assert unsettled_message(result.unsettled) == (
        "This export isn't settled yet: Asha Kumar owes INR 240.00. "
        "Settle up in Splitwise, export again and upload the new file."
    )
    assert not parse(make_csv(ROWS[:-1]), member=None).settled


def test_unsettled_without_total_row_is_still_detected():
    assert not parse(make_csv(ROWS[:-1], total=False)).settled


def test_negative_zero_total_counts_as_settled():
    text = SAMPLE.replace("Total balance, , ,INR,0.00,0.00", "Total balance, , ,INR,-0.00,0.00")
    assert parse(text).settled


def test_total_row_that_does_not_add_up_is_rejected():
    text = SAMPLE.replace("Total balance, , ,INR,0.00,0.00", "Total balance, , ,INR,-10.00,10.00")
    with pytest.raises(SplitwiseCsvError, match="Total balance"):
        parse(text)


def test_unreadable_balance_is_an_error():
    text = SAMPLE.replace("INR,-450.00,450.00", "INR,-450.00,abc")
    with pytest.raises(SplitwiseCsvError, match="isn't a number"):
        parse(text)


def test_bom_is_tolerated():
    assert len(parse("\ufeff" + SAMPLE).rows) == 2


def test_non_iso_date_is_skipped():
    text = SAMPLE.replace("2026-09-01,Dinner", "01/09/2026,Dinner")
    result = parse(text)
    assert [r.description for r in result.rows] == ["Cab to airport"]
    assert result.skipped[0].reason == "Unrecognised date '01/09/2026' (expected YYYY-MM-DD)"


def test_future_date_and_other_currency_skipped():
    rows = [ROWS[0].replace("2026-09-01", "2026-12-01"), ROWS[1].replace(",INR,", ",USD,"), *ROWS[2:]]
    reasons = [s.reason for s in parse(make_csv(rows)).skipped]
    assert "Dated in the future" in reasons
    assert "Currency USD is not supported" in reasons


def test_bad_cost_skipped():
    rows = [ROWS[0].replace("1200.00", "abc"), *ROWS[1:]]
    assert parse(make_csv(rows)).skipped[0].reason == "Amount is not a number"


def test_not_a_splitwise_file():
    with pytest.raises(SplitwiseCsvError, match="doesn't look like a Splitwise export"):
        parse("Txn Date,Narration,Amount\n2026-09-01,UPI,100\n")


def test_empty_file():
    with pytest.raises(SplitwiseCsvError, match="empty"):
        parse("\n\n")


def test_no_member_columns():
    with pytest.raises(SplitwiseCsvError, match="no people"):
        parse("Date,Description,Category,Cost,Currency\n", member=None)


def test_identical_rows_get_distinct_fingerprints():
    coffee = "2026-09-06,Coffee,Dining out,200.00,INR,-100.00,100.00"
    rows = parse(make_csv([*ROWS, coffee, coffee])).rows
    coffees = [r for r in rows if r.description == "Coffee"]
    assert len(coffees) == 2
    assert coffees[0].fingerprint != coffees[1].fingerprint


def test_fingerprint_stable_across_files():
    a = {r.description: r.fingerprint for r in parse().rows}
    # A later export with an extra row and different whitespace/case in a description.
    snack = "2026-09-06,Snacks,Dining out,100.00,INR,-50.00,50.00"
    later = make_csv([ROWS[0].replace("Dinner at Toit ", "dinner  at TOIT"), *ROWS[1:], snack])
    b = {r.description.lower(): r.fingerprint for r in parse(later).rows}
    assert b["dinner  at toit"] == a["Dinner at Toit"]
    assert b["cab to airport"] == a["Cab to airport"]


def test_fingerprint_ignores_my_share():
    edited = make_csv([ROWS[0], ROWS[1].replace("-450.00,450.00", "-300.00,300.00"), *ROWS[2:]])
    before = {r.description: r.fingerprint for r in parse().rows}
    after = {r.description: r for r in parse(edited).rows}
    assert after["Cab to airport"].fingerprint == before["Cab to airport"]
    assert after["Cab to airport"].amount == 300.0


def test_memory_key_drops_dates_numbers_and_punctuation():
    # Real descriptions from the export, which repeat with a different date each time.
    assert memory_key("Grocery Ratnadeep 22/08") == "grocery ratnadeep"
    assert memory_key("  grocery  RATNADEEP 6/9 ") == "grocery ratnadeep"
    assert memory_key("Maintenance Sept26") == "maintenance"
    assert memory_key("Breakfast+ Ratnadeep 6/9") == "breakfast ratnadeep"
    assert memory_key("Garam Masala, Chole Masala and Curd") == "garam masala chole masala and curd"


def test_memory_key_empty_when_only_numbers():
    assert memory_key("22/08") == ""
    assert memory_key(" - ") == ""
