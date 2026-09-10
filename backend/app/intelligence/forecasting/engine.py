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
