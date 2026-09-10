"""Daily demand forecasts with calendar coverage and temporal validation."""

from __future__ import annotations

import calendar
import warnings
from datetime import date, timedelta
from typing import Any

import numpy as np
import pandas as pd
from statsmodels.tsa.holtwinters import ExponentialSmoothing

VERSION = "smartdine-demand-v1"
VALIDATION_DAYS = 28
VALIDATION_FOLDS = 3


def month_shift(value: date, months: int) -> date:
    index = value.year * 12 + value.month - 1 + months
    return date(index // 12, index % 12 + 1, 1)


def _naive(values: np.ndarray, steps: int) -> np.ndarray:
    return np.maximum(np.resize(values[-7:], steps), 0)


def _predict(method: str, values: np.ndarray, steps: int) -> np.ndarray:
    if method == "weekly_seasonal_naive":
        return _naive(values, steps)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        fitted = ExponentialSmoothing(
            values, trend="add", damped_trend=True, seasonal="add",
            seasonal_periods=7, initialization_method="estimated",
        ).fit(optimized=True, remove_bias=False)
    prediction = np.maximum(np.asarray(fitted.forecast(steps), dtype=float), 0)
    if not np.isfinite(prediction).all():
        raise ValueError("Non-finite ETS forecast")
    return prediction


def _validation(values: np.ndarray, method: str) -> tuple[dict[str, Any], np.ndarray]:
    residuals = []
    actuals = []
    folds = []
    for remaining in (84, 56, 28):
        cutoff = len(values) - remaining
        actual = values[cutoff:cutoff + VALIDATION_DAYS]
        predicted = _predict(method, values[:cutoff], VALIDATION_DAYS)
        residuals.extend(actual - predicted)
        actuals.extend(actual)
        folds.append({"training_days": cutoff, "holdout_days": VALIDATION_DAYS})
    errors = np.asarray(residuals)
    denominator = float(np.sum(np.abs(actuals)))
    metrics = {
        "mae": float(np.mean(np.abs(errors))),
        "wape": float(np.sum(np.abs(errors)) / denominator) if denominator else None,
        "wape_unit": "ratio", "validation_folds": folds,
    }
    return metrics, errors


def monthly_interval(
    daily_prediction: np.ndarray, residuals: np.ndarray, offset: int,
    days: int, seed: int = 42, samples: int = 2000,
) -> dict[str, Any] | None:
    """Bootstrap entire monthly totals, retaining within-week residual dependence."""
    if len(residuals) < 28 or not np.isfinite(residuals).all():
        return None
    rng = np.random.default_rng(seed)
    blocks = np.array([residuals[i:i + 7] for i in range(len(residuals) - 6)])
    count = (len(daily_prediction) + 6) // 7
    indices = rng.integers(0, len(blocks), size=(samples, count))
    paths = blocks[indices].reshape(samples, -1)[:, :len(daily_prediction)]
    simulated = np.maximum(daily_prediction[None, :] + paths, 0)
    totals = simulated[:, offset:offset + days].sum(axis=1)
    lower, upper = np.quantile(totals, [0.1, 0.9])
    return {
        "level": 0.8, "lower": float(lower), "upper": float(upper),
        "method": "weekly_residual_block_bootstrap", "samples": samples,
        "interpretation": "Estimated prediction interval; empirical coverage is not guaranteed.",
    }


def forecast_item(menu_item_id: str, rows: list[dict[str, Any]], as_of: date) -> dict[str, Any]:
    """Use six complete calendar months; optionally extend through contiguous closed days."""
    first_month = month_shift(as_of, -6)
    current_month = as_of.replace(day=1)
    complete_end = current_month - timedelta(days=1)
    target_start = month_shift(as_of, 1)
    target_days = calendar.monthrange(target_start.year, target_start.month)[1]
    target_end = target_start + timedelta(days=target_days - 1)
    base = {
        "menu_item_id": str(menu_item_id), "model_version": VERSION,
        "target_start": target_start.isoformat(), "target_end": target_end.isoformat(),
        "as_of": as_of.isoformat(), "timezone": "Asia/Karachi",
    }
    mapping: dict[date, float] = {}
    for row in rows:
        day = date.fromisoformat(str(row["day"]))
        if day in mapping:
            raise ValueError("Duplicate daily observations")
        quantity = float(row["quantity"])
        if quantity < 0 or not np.isfinite(quantity):
            raise ValueError("Demand quantity must be nonnegative and finite")
        if row.get("covered", True):
            mapping[day] = quantity
    expected = [stamp.date() for stamp in pd.date_range(first_month, complete_end, freq="D")]
    missing = [day.isoformat() for day in expected if day not in mapping]
    if missing:
        return {
            **base, "status": "insufficient_history", "required_complete_months": 6,
            "required_start": first_month.isoformat(), "required_end": complete_end.isoformat(),
            "missing_days": len(missing), "first_missing_day": missing[0],
        }
    cutoff = complete_end
    while cutoff + timedelta(days=1) < as_of and cutoff + timedelta(days=1) in mapping:
        cutoff += timedelta(days=1)
        expected.append(cutoff)
    values = np.asarray([mapping[day] for day in expected], dtype=float)
    naive_metrics, naive_residuals = _validation(values, "weekly_seasonal_naive")
    method, metrics, residuals = "weekly_seasonal_naive", naive_metrics, naive_residuals
    candidates = [{"model": method, **naive_metrics}]
    try:
        ets_metrics, ets_residuals = _validation(values, "damped_weekly_ets")
        candidates.append({"model": "damped_weekly_ets", **ets_metrics})
        if ets_metrics["mae"] < naive_metrics["mae"] - 1e-9:
            method, metrics, residuals = "damped_weekly_ets", ets_metrics, ets_residuals
    except (ValueError, ArithmeticError, np.linalg.LinAlgError):
        candidates.append({"model": "damped_weekly_ets", "status": "fit_failed"})
    horizon = (target_end - cutoff).days
    try:
        prediction = _predict(method, values, horizon)
    except (ValueError, ArithmeticError, np.linalg.LinAlgError):
        method, metrics, residuals = "weekly_seasonal_naive", naive_metrics, naive_residuals
        prediction = _naive(values, horizon)
    offset = (target_start - cutoff).days - 1
    target = prediction[offset:offset + target_days]
    interval = monthly_interval(prediction, residuals, offset, target_days)
    return {
        **base, "status": "completed", "model": method,
        "training_start": first_month.isoformat(), "training_end": cutoff.isoformat(),
        "training_days": len(values), "source_coverage": "verified_complete_days",
        "monthly_quantity": float(target.sum()), "prediction_interval": interval,
        "uncertainty_status": "estimated" if interval else "insufficient_evidence",
        "metrics": metrics, "candidates": candidates,
        "parameters": {"seasonal_periods": 7, "trend": "add", "damped_trend": True}
        if method == "damped_weekly_ets" else {"seasonal_periods": 7},
        "daily": [
            {"day": (target_start + timedelta(days=i)).isoformat(), "quantity": float(value)}
            for i, value in enumerate(target)
        ],
    }
