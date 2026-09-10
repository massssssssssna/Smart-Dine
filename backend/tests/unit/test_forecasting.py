from datetime import date, timedelta

import numpy as np
import pytest

from app.intelligence.forecasting.engine import forecast_item, monthly_interval, month_shift
from app.modules.forecasts.service import parse_history
from app.core.exceptions import AppError

ITEM = "00000000-0000-4000-8000-000000000001"


def history(as_of=date(2026, 9, 8), fn=lambda i: [12, 14, 15, 15, 25, 30, 18][i % 7]):
    first = month_shift(as_of, -6)
    days = (as_of.replace(day=1) - first).days
    return [{"day": (first + timedelta(days=i)).isoformat(), "quantity": fn(i), "covered": True} for i in range(days)]


def test_next_calendar_month_and_exact_weekly_baseline():
    result = forecast_item(ITEM, history(), date(2026, 9, 8))
    assert result["status"] == "completed"
    assert result["model"] == "weekly_seasonal_naive"
    assert result["target_start"] == "2026-10-01"
    assert result["target_end"] == "2026-10-31"
    assert result["training_start"] == "2026-03-01"
    assert result["training_end"] == "2026-08-31"
    assert len(result["daily"]) == 31
    assert result["metrics"]["mae"] == 0
    assert result["monthly_quantity"] == pytest.approx(sum(row["quantity"] for row in result["daily"]))
    assert result["prediction_interval"]["lower"] == result["prediction_interval"]["upper"]


def test_missing_day_is_not_treated_as_zero():
    rows = history()
    rows.pop(50)
    result = forecast_item(ITEM, rows, date(2026, 9, 8))
    assert result["status"] == "insufficient_history"
    assert result["missing_days"] == 1
    assert "monthly_quantity" not in result


def test_zero_history_has_undefined_wape_and_nonnegative_forecast():
    result = forecast_item(ITEM, history(fn=lambda i: 0), date(2026, 9, 8))
    assert result["metrics"]["wape"] is None
    assert result["monthly_quantity"] == 0
    assert result["prediction_interval"]["lower"] == 0


def test_validation_is_chronological_and_uses_three_holdouts():
    result = forecast_item(ITEM, history(fn=lambda i: 15 + i // 7), date(2026, 9, 8))
    folds = result["metrics"]["validation_folds"]
    assert [row["holdout_days"] for row in folds] == [28, 28, 28]
    assert [row["training_days"] for row in folds] == [100, 128, 156]
    assert result["model"] == "damped_weekly_ets"


def test_bootstrap_aggregates_paths_and_is_reproducible():
    residuals = np.tile([-4, -4, -4, 1, 1, 5, 5], 12)
    estimate = monthly_interval(np.full(62, 20.0), residuals, 31, 31)
    assert estimate == monthly_interval(np.full(62, 20.0), residuals, 31, 31)
    assert estimate["level"] == 0.8
    assert estimate["lower"] < estimate["upper"]
    assert monthly_interval(np.full(31, 20.0), np.zeros(10), 0, 31) is None


def test_future_rows_cannot_leak_into_training():
    rows = history()
    expected = forecast_item(ITEM, rows, date(2026, 9, 8))
    rows.append({"day": "2026-10-01", "quantity": 999999})
    actual = forecast_item(ITEM, rows, date(2026, 9, 8))
    assert actual == expected


def test_csv_preserves_explicit_zero_and_deduplicates_identical_rows():
    text = f"day,menu_item_id,quantity,day_status\n2026-01-01,{ITEM},0,closed\n2026-01-01,{ITEM},0,closed\n"
    assert parse_history(text) == [{"day": "2026-01-01", "menu_item_id": ITEM, "quantity": 0, "day_status": "closed"}]


@pytest.mark.parametrize("rows", [
    f"2026-01-01,{ITEM},0,complete\n2026-01-01,{ITEM},2,complete",
    f"2026-01-01,{ITEM},1,closed",
    f"2026-01-01,{ITEM},-1,complete",
    "2026-01-01,not-a-uuid,1,complete",
])
def test_csv_rejects_conflicts_and_invalid_values(rows):
    with pytest.raises(AppError):
        parse_history("day,menu_item_id,quantity,day_status\n" + rows)
