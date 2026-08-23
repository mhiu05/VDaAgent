"""Bounded forecasting registry and deterministic model adapters."""

from __future__ import annotations

import importlib.util
import math
import warnings
from dataclasses import asdict, dataclass
from statistics import NormalDist
from typing import Any, Literal

import numpy as np
import pandas as pd

ForecastAlgorithm = Literal[
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
]


class ForecastingError(ValueError):
    pass


@dataclass(frozen=True, slots=True)
class ForecastCapability:
    id: ForecastAlgorithm
    label: str
    family: str
    dependency: str | None = None
    min_history: int = 3
    seasonal: bool = False
    requires_future_exogenous: bool = False


CAPABILITIES: tuple[ForecastCapability, ...] = (
    ForecastCapability("naive", "Naive Forecast", "baseline", min_history=2),
    ForecastCapability("seasonal_naive", "Seasonal Naive", "baseline", min_history=4, seasonal=True),
    ForecastCapability("drift", "Drift Method", "baseline", min_history=3),
    ForecastCapability("moving_average", "Moving Average", "baseline", min_history=3),
    ForecastCapability("weighted_moving_average", "Weighted Moving Average", "baseline", min_history=3),
    ForecastCapability("ses", "Simple Exponential Smoothing (SES)", "exponential_smoothing", "statsmodels", 4),
    ForecastCapability("holt_linear", "Holt’s Linear Trend", "exponential_smoothing", "statsmodels", 5),
    ForecastCapability("holt_winters", "Holt-Winters", "exponential_smoothing", "statsmodels", 8, True),
    ForecastCapability("ets", "ETS (Error-Trend-Seasonality)", "exponential_smoothing", "statsmodels", 8, True),
    ForecastCapability("arima", "ARIMA", "arima", "statsmodels", 8),
    ForecastCapability("sarima", "SARIMA", "arima", "statsmodels", 12, True),
    ForecastCapability("auto_arima", "Auto-ARIMA", "arima", "statsmodels", 10),
    ForecastCapability("structural_time_series", "Structural Time Series", "state_space", "statsmodels", 8, True),
    ForecastCapability("local_level", "Local Level Model", "state_space", "statsmodels", 5),
    ForecastCapability("local_linear_trend", "Local Linear Trend", "state_space", "statsmodels", 6),
    ForecastCapability("kalman_filter", "Kalman Filter", "state_space", "statsmodels", 5),
    ForecastCapability("dynamic_linear_model", "Dynamic Linear Model", "state_space", "statsmodels", 8),
    ForecastCapability("unobserved_components", "Unobserved Components Model", "state_space", "statsmodels", 8, True),
    ForecastCapability("prophet", "Prophet", "decomposable", "prophet", 12, True),
    ForecastCapability("neuralprophet", "NeuralProphet", "decomposable", "neuralprophet", 16, True),
    ForecastCapability("linear_regression", "Linear Regression", "machine_learning", "sklearn", 8),
    ForecastCapability("ridge", "Ridge Regression", "machine_learning", "sklearn", 8),
    ForecastCapability("lasso", "Lasso", "machine_learning", "sklearn", 8),
    ForecastCapability("random_forest", "Random Forest", "machine_learning", "sklearn", 12),
    ForecastCapability("extra_trees", "Extra Trees", "machine_learning", "sklearn", 12),
    ForecastCapability("xgboost", "XGBoost", "machine_learning", "xgboost", 12),
    ForecastCapability("lightgbm", "LightGBM", "machine_learning", "lightgbm", 12),
    ForecastCapability("catboost", "CatBoost", "machine_learning", "catboost", 12),
)
CAPABILITY_BY_ID = {item.id: item for item in CAPABILITIES}


def _dependency_available(name: str | None) -> bool:
    return name is None or importlib.util.find_spec(name) is not None


def forecast_algorithm_catalog() -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for capability in CAPABILITIES:
        dependency_ready = _dependency_available(capability.dependency)
        available = dependency_ready and not capability.requires_future_exogenous
        reason = None
        if capability.requires_future_exogenous:
            reason = "Cần contract cho giá trị biến ngoại sinh trong kỳ dự báo."
        elif not dependency_ready:
            reason = f"Chưa cài dependency tùy chọn: {capability.dependency}."
        result.append({**asdict(capability), "available": available, "unavailable_reason": reason})
    return result


def available_forecast_algorithms() -> set[str]:
    return {str(item["id"]) for item in forecast_algorithm_catalog() if item["available"]}


def _future_index(last: pd.Timestamp, horizon: int, grain: str) -> pd.DatetimeIndex:
    offsets = {
        "day": pd.DateOffset(days=1),
        "week": pd.DateOffset(weeks=1),
        "month": pd.DateOffset(months=1),
        "quarter": pd.DateOffset(months=3),
        "year": pd.DateOffset(years=1),
    }
    offset = offsets.get(grain)
    if offset is None:
        raise ForecastingError("Forecast chỉ hỗ trợ grain ngày/tuần/tháng/quý/năm.")
    return pd.DatetimeIndex([last + offset * step for step in range(1, horizon + 1)])


def _baseline(values: np.ndarray, algorithm: str, horizon: int, season_length: int) -> np.ndarray:
    if algorithm == "naive":
        return np.repeat(values[-1], horizon)
    if algorithm == "seasonal_naive":
        season = values[-season_length:]
        return np.resize(season, horizon)
    if algorithm == "drift":
        slope = (values[-1] - values[0]) / max(len(values) - 1, 1)
        return np.array([values[-1] + slope * step for step in range(1, horizon + 1)])
    window = min(max(2, season_length), len(values))
    recent = values[-window:]
    if algorithm == "moving_average":
        return np.repeat(float(np.mean(recent)), horizon)
    weights = np.arange(1, len(recent) + 1, dtype=float)
    return np.repeat(float(np.average(recent, weights=weights)), horizon)


def _statsmodels_forecast(values: np.ndarray, algorithm: str, horizon: int, season_length: int) -> np.ndarray:
    if algorithm == "ses":
        from statsmodels.tsa.holtwinters import SimpleExpSmoothing

        fitted = SimpleExpSmoothing(values, initialization_method="estimated").fit(optimized=True)
    elif algorithm == "holt_linear":
        from statsmodels.tsa.holtwinters import Holt

        fitted = Holt(values, initialization_method="estimated", damped_trend=True).fit(optimized=True)
    elif algorithm == "holt_winters":
        from statsmodels.tsa.holtwinters import ExponentialSmoothing

        fitted = ExponentialSmoothing(values, trend="add", seasonal="add", seasonal_periods=season_length, initialization_method="estimated").fit(optimized=True)
    elif algorithm == "ets":
        from statsmodels.tsa.exponential_smoothing.ets import ETSModel

        fitted = ETSModel(values, error="add", trend="add", seasonal="add", seasonal_periods=season_length).fit(disp=False)
    elif algorithm in {"arima", "auto_arima"}:
        from statsmodels.tsa.arima.model import ARIMA

        orders = [(1, 1, 1)]
        if algorithm == "auto_arima":
            orders = [(p, d, q) for d in (0, 1) for p in range(3) for q in range(3) if p + q > 0]
        fitted = None
        best_aic = math.inf
        for order in orders:
            try:
                candidate = ARIMA(values, order=order).fit()
                if float(candidate.aic) < best_aic:
                    fitted, best_aic = candidate, float(candidate.aic)
            except (ValueError, np.linalg.LinAlgError):
                continue
        if fitted is None:
            raise ForecastingError("Không tìm được cấu hình ARIMA hội tụ.")
    elif algorithm in {"sarima"}:
        from statsmodels.tsa.statespace.sarimax import SARIMAX

        fitted = SARIMAX(values, order=(1, 1, 1), seasonal_order=(1, 1, 1, season_length), enforce_stationarity=False, enforce_invertibility=False).fit(disp=False)
    else:
        from statsmodels.tsa.statespace.structural import UnobservedComponents

        settings: dict[str, Any] = {"level": True}
        if algorithm in {"local_linear_trend", "dynamic_linear_model", "structural_time_series", "unobserved_components"}:
            settings["trend"] = True
        if algorithm in {"structural_time_series", "unobserved_components"}:
            settings["seasonal"] = season_length
        if algorithm == "kalman_filter":
            settings["stochastic_level"] = True
        fitted = UnobservedComponents(values, **settings).fit(disp=False)
    return np.asarray(fitted.forecast(horizon), dtype=float)


def _lag_matrix(values: np.ndarray, lags: int) -> tuple[np.ndarray, np.ndarray]:
    x = np.asarray([values[index - lags : index] for index in range(lags, len(values))])
    y = values[lags:]
    return x, y


def _ml_forecast(values: np.ndarray, algorithm: str, horizon: int, season_length: int) -> np.ndarray:
    lags = min(max(3, season_length), max(3, len(values) // 3), 24)
    if len(values) <= lags:
        raise ForecastingError("Chuỗi chưa đủ lịch sử để tạo lag features.")
    if algorithm == "linear_regression":
        from sklearn.linear_model import LinearRegression

        model: Any = LinearRegression()
    elif algorithm == "ridge":
        from sklearn.linear_model import Ridge

        model = Ridge(alpha=1.0)
    elif algorithm == "lasso":
        from sklearn.linear_model import Lasso

        model = Lasso(alpha=0.01, max_iter=5000)
    elif algorithm == "random_forest":
        from sklearn.ensemble import RandomForestRegressor

        model = RandomForestRegressor(n_estimators=160, max_depth=8, random_state=42, n_jobs=1)
    elif algorithm == "extra_trees":
        from sklearn.ensemble import ExtraTreesRegressor

        model = ExtraTreesRegressor(n_estimators=160, max_depth=8, random_state=42, n_jobs=1)
    elif algorithm == "xgboost":
        from xgboost import XGBRegressor

        model = XGBRegressor(n_estimators=160, max_depth=5, learning_rate=0.05, random_state=42, n_jobs=1)
    elif algorithm == "lightgbm":
        from lightgbm import LGBMRegressor

        model = LGBMRegressor(n_estimators=160, max_depth=6, learning_rate=0.05, random_state=42, n_jobs=1, verbosity=-1)
    else:
        from catboost import CatBoostRegressor

        model = CatBoostRegressor(iterations=160, depth=6, learning_rate=0.05, random_seed=42, verbose=False, thread_count=1)
    x, y = _lag_matrix(values, lags)
    model.fit(x, y)
    history = list(values)
    forecast: list[float] = []
    for _ in range(horizon):
        prediction = float(model.predict(np.asarray(history[-lags:]).reshape(1, -1))[0])
        forecast.append(prediction)
        history.append(prediction)
    return np.asarray(forecast)


def _prophet_forecast(timestamps: pd.DatetimeIndex, values: np.ndarray, horizon: int, grain: str) -> np.ndarray:
    from prophet import Prophet

    future_index = _future_index(timestamps[-1], horizon, grain)
    model = Prophet(daily_seasonality=False, weekly_seasonality="auto", yearly_seasonality="auto")
    model.fit(pd.DataFrame({"ds": timestamps, "y": values}))
    return model.predict(pd.DataFrame({"ds": future_index}))["yhat"].to_numpy(dtype=float)


def _neural_prophet_forecast(timestamps: pd.DatetimeIndex, values: np.ndarray, horizon: int, grain: str) -> np.ndarray:
    from neuralprophet import NeuralProphet

    frame = pd.DataFrame({"ds": timestamps, "y": values})
    model = NeuralProphet(epochs=50, n_forecasts=1, n_lags=min(12, max(3, len(values) // 3)))
    model.fit(frame, freq={"day": "D", "week": "W", "month": "MS", "quarter": "QS", "year": "YS"}[grain], progress=None)
    future = model.make_future_dataframe(frame, periods=horizon, n_historic_predictions=False)
    predicted = model.predict(future)
    return predicted["yhat1"].tail(horizon).to_numpy(dtype=float)


def forecast_series(
    timestamps: list[Any],
    raw_values: list[Any],
    *,
    algorithm: str,
    horizon: int,
    season_length: int,
    confidence_level: float,
    time_grain: str,
) -> dict[str, Any]:
    capability = CAPABILITY_BY_ID.get(algorithm)  # type: ignore[arg-type]
    if not capability:
        raise ForecastingError("Thuật toán forecast không nằm trong allow-list.")
    catalog_entry = next(item for item in forecast_algorithm_catalog() if item["id"] == algorithm)
    if not catalog_entry["available"]:
        raise ForecastingError(str(catalog_entry["unavailable_reason"]))
    series = pd.DataFrame({"timestamp": pd.to_datetime(timestamps, errors="coerce"), "value": pd.to_numeric(raw_values, errors="coerce")}).dropna().sort_values("timestamp")
    series = series.drop_duplicates("timestamp", keep="last")
    values = series["value"].to_numpy(dtype=float)
    if len(values) < capability.min_history:
        raise ForecastingError(f"{capability.label} cần ít nhất {capability.min_history} kỳ dữ liệu hợp lệ.")
    if capability.seasonal and len(values) < season_length * 2:
        raise ForecastingError(f"{capability.label} cần ít nhất hai chu kỳ ({season_length * 2} kỳ).")
    if not 1 <= horizon <= 60 or not 2 <= season_length <= 365:
        raise ForecastingError("Horizon hoặc season_length vượt giới hạn.")

    try:
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            if algorithm in {"naive", "seasonal_naive", "drift", "moving_average", "weighted_moving_average"}:
                predicted = _baseline(values, algorithm, horizon, season_length)
            elif capability.dependency == "statsmodels":
                predicted = _statsmodels_forecast(values, algorithm, horizon, season_length)
            elif capability.dependency == "sklearn" or algorithm in {"xgboost", "lightgbm", "catboost"}:
                predicted = _ml_forecast(values, algorithm, horizon, season_length)
            elif algorithm == "prophet":
                predicted = _prophet_forecast(pd.DatetimeIndex(series["timestamp"]), values, horizon, time_grain)
            else:
                predicted = _neural_prophet_forecast(pd.DatetimeIndex(series["timestamp"]), values, horizon, time_grain)
    except ForecastingError:
        raise
    except Exception as exc:  # noqa: BLE001 - adapter failures must fail closed
        raise ForecastingError(
            f"{capability.label} không thể fit ổn định trên chuỗi hiện tại."
        ) from exc
    model_warnings = list(dict.fromkeys(str(item.message)[:300] for item in caught))[:5]
    if len(predicted) != horizon or not np.all(np.isfinite(predicted)):
        raise ForecastingError("Model không trả về đủ giá trị dự báo hữu hạn.")

    fitted_baseline = np.repeat(float(np.mean(values[-min(season_length, len(values)) :])), len(values))
    residual_std = float(np.std(values - fitted_baseline, ddof=1)) if len(values) > 2 else 0.0
    z_score = NormalDist().inv_cdf((1 + confidence_level) / 2)
    steps = np.sqrt(np.arange(1, horizon + 1, dtype=float))
    margin = z_score * residual_std * steps
    future = _future_index(pd.Timestamp(series["timestamp"].iloc[-1]), horizon, time_grain)
    return {
        "timestamps": [item.isoformat() for item in future],
        "forecast": [float(item) for item in predicted],
        "lower": [float(item) for item in predicted - margin],
        "upper": [float(item) for item in predicted + margin],
        "history_timestamps": [pd.Timestamp(item).isoformat() for item in series["timestamp"]],
        "history_values": [float(item) for item in values],
        "algorithm": algorithm,
        "confidence_level": confidence_level,
        "warnings": model_warnings,
    }


__all__ = [
    "CAPABILITIES",
    "ForecastAlgorithm",
    "ForecastingError",
    "available_forecast_algorithms",
    "forecast_algorithm_catalog",
    "forecast_series",
]
