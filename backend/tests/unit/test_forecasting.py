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
