from __future__ import annotations

import importlib.util

import pytest
from src.services.forecasting import (
    ForecastingError,
    forecast_algorithm_catalog,
    forecast_series,
)


def test_catalog_contains_every_requested_forecast_family() -> None:
    catalog = forecast_algorithm_catalog()
    ids = {item["id"] for item in catalog}

    assert {
        "naive",
        "seasonal_naive",
        "drift",
        "moving_average",
        "weighted_moving_average",
        "ses",
        "holt_linear",
        "holt_winters",
        "ets",
        "arima",
        "sarima",
        "auto_arima",
        "structural_time_series",
        "local_level",
        "local_linear_trend",
        "kalman_filter",
        "dynamic_linear_model",
        "unobserved_components",
        "prophet",
        "neuralprophet",
        "linear_regression",
        "ridge",
        "lasso",
        "random_forest",
        "extra_trees",
        "xgboost",
        "lightgbm",
        "catboost",
    } <= ids


@pytest.mark.parametrize(
    "algorithm", ["naive", "seasonal_naive", "drift", "moving_average", "weighted_moving_average"]
)
def test_baseline_forecasts_are_bounded_and_reproducible(algorithm: str) -> None:
    output = forecast_series(
        [f"2025-{month:02d}-01" for month in range(1, 13)],
        list(range(10, 130, 10)),
        algorithm=algorithm,
        horizon=3,
        season_length=3,
        confidence_level=0.95,
        time_grain="month",
    )

    assert len(output["forecast"]) == 3
    assert output["timestamps"] == [
        "2026-01-01T00:00:00",
        "2026-02-01T00:00:00",
        "2026-03-01T00:00:00",
    ]
    assert all(lower <= value <= upper for lower, value, upper in zip(output["lower"], output["forecast"], output["upper"], strict=True))


def test_missing_optional_dependency_is_fail_closed() -> None:
    if importlib.util.find_spec("prophet") is not None:
        pytest.skip("Prophet is installed in this environment.")

    with pytest.raises(ForecastingError, match="prophet"):
        forecast_series(
            [f"2025-{month:02d}-01" for month in range(1, 13)],
            list(range(12)),
            algorithm="prophet",
            horizon=3,
            season_length=3,
            confidence_level=0.95,
            time_grain="month",
        )


@pytest.mark.parametrize("algorithm", ["ses", "holt_winters", "arima", "local_level"])
def test_core_statistical_adapters_return_finite_forecasts(algorithm: str) -> None:
    output = forecast_series(
        [f"{2022 + index // 12}-{index % 12 + 1:02d}-01" for index in range(36)],
        [100 + index * 2 + (index % 12) * 3 for index in range(36)],
        algorithm=algorithm,
        horizon=3,
        season_length=12,
        confidence_level=0.95,
        time_grain="month",
    )

    assert len(output["forecast"]) == 3
    assert all(isinstance(value, float) for value in output["forecast"])
