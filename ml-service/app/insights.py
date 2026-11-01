"""Two more learned features, both fitted on the data sent with each request (no stored model):

* anomaly detection: an Isolation Forest learns what "normal" looks like for one machine from its own
  recent sensor history, then scores the newest readings against it;
* forecasting: a trend model over a daily series (stock used per day, units made per day) projects the
  next days, and says when a stock level would run out or a target would be reached, with a range.

They describe patterns in the numbers supplied. They do not know why something changed.
"""
import numpy as np
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sklearn.ensemble import IsolationForest
from sklearn.linear_model import Ridge

FEATURES = ["temperatureC", "vibrationMms", "rpm", "powerKw"]
MIN_HISTORY = 30
MAX_HISTORY = 5000
MIN_SERIES = 7
Z_LIMIT = 6.0  # robust standard deviations from the machine's typical value


class Reading(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    temperatureC: float = Field(ge=-50, le=1500)
    vibrationMms: float = Field(ge=0, le=200)
    rpm: float = Field(ge=0, le=100_000)
    powerKw: float = Field(ge=0, le=10_000)

    def row(self) -> list[float]:
        return [getattr(self, f) for f in FEATURES]


class AnomalyRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    history: list[Reading] = Field(min_length=MIN_HISTORY, max_length=MAX_HISTORY)
    recent: list[Reading] = Field(min_length=1, max_length=200)


def detect_anomalies(req: AnomalyRequest, seed: int = 0) -> dict:
    hist = np.array([r.row() for r in req.history], dtype=float)
    recent = np.array([r.row() for r in req.recent], dtype=float)
    center = np.median(hist, axis=0)
    # Median absolute deviation, floored so a sensor that never moves does not make every change look huge.
    spread = np.maximum(np.median(np.abs(hist - center), axis=0) * 1.4826, np.maximum(np.abs(center) * 0.01, 1e-3))

    forest = IsolationForest(n_estimators=200, contamination="auto", random_state=seed).fit((hist - center) / spread)
    # score_samples is higher for normal points; flip and squash so 0 is typical and 1 is very unusual.
    raw = -forest.score_samples((recent - center) / spread)
    baseline = -forest.score_samples((hist - center) / spread)
    cut = float(np.quantile(baseline, 0.99))
    points = []
    for i, row in enumerate(recent):
        z = (row - center) / spread
        j = int(np.argmax(np.abs(z)))
        biggest = float(abs(z[j]))
        # A forest scores a value far beyond anything it has seen like the most extreme value it has seen,
        # so a spike well outside the learned range needs the plain robust z-score as a second opinion.
        forest_score = float(np.clip((raw[i] - 0.4) / 0.4, 0, 1))
        points.append({
            "anomalous": bool(raw[i] > cut or biggest >= Z_LIMIT),
            "score": round(max(forest_score, float(np.clip((biggest - 3) / 9, 0, 1))), 3),
            "mostUnusual": {"feature": FEATURES[j], "value": round(float(row[j]), 2), "typical": round(float(center[j]), 2), "deviation": round(float(z[j]), 1)},
        })
    return {
        "historyPoints": int(len(hist)),
        "flagged": sum(p["anomalous"] for p in points),
        "points": points,
        "baseline": {f: round(float(center[i]), 2) for i, f in enumerate(FEATURES)},
    }


class ForecastRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    series: list[float] = Field(min_length=MIN_SERIES, max_length=366)
    horizon: int = Field(default=14, ge=1, le=60)
    # Use one of these: how much is left to use up (stock), or how much is left to make (an order).
    level: float | None = Field(default=None, ge=0, le=1e9)
    target: float | None = Field(default=None, ge=0, le=1e9)

    @field_validator("series")
    @classmethod
    def non_negative(cls, v: list[float]) -> list[float]:
        if any(x < 0 for x in v):
            raise ValueError("daily amounts cannot be negative")
        return v


def _days_to_reach(amount: float, daily: np.ndarray, limit: int) -> float | None:
    """Days until the running total of `daily` reaches `amount`, linearly inside a day; None if not within `limit`."""
    if amount <= 0:
        return 0.0
    total = np.cumsum(daily)
    hit = np.nonzero(total >= amount)[0]
    if hit.size == 0:
        return None
    i = int(hit[0])
    before = total[i - 1] if i else 0.0
    return round(float(i + (amount - before) / max(daily[i], 1e-9)), 1)


def forecast(req: ForecastRequest) -> dict:
    y = np.asarray(req.series, dtype=float)
    n = len(y)
    x = np.arange(n, dtype=float).reshape(-1, 1)
    # Newer days count more; Ridge keeps the slope sensible on short, noisy series.
    weights = np.linspace(0.5, 1.0, n)
    model = Ridge(alpha=1.0).fit(x, y, sample_weight=weights)
    fitted = model.predict(x)
    resid = float(np.sqrt(np.average((y - fitted) ** 2, weights=weights)))

    ahead = np.arange(n, n + req.horizon, dtype=float).reshape(-1, 1)
    mid = np.maximum(model.predict(ahead), 0.0)
    low, high = np.maximum(mid - 1.28 * resid, 0.0), mid + 1.28 * resid

    out = {
        "daysOfHistory": n,
        "averagePerDay": round(float(y.mean()), 2),
        "recentPerDay": round(float(y[-7:].mean()), 2),
        "trendPerDay": round(float(model.coef_[0]), 3),
        "forecast": [{"day": i + 1, "expected": round(float(mid[i]), 2), "low": round(float(low[i]), 2), "high": round(float(high[i]), 2)} for i in range(req.horizon)],
        "noise": round(resid, 2),
    }
    amount = req.level if req.level is not None else req.target
    if amount is not None:
        # Fast use-up is the high rate, slow use-up the low rate: that gives an early and a late estimate.
        out["expectedDays"] = _days_to_reach(amount, mid, req.horizon)
        out["earliestDays"] = _days_to_reach(amount, high, req.horizon)
        out["latestDays"] = _days_to_reach(amount, low, req.horizon)
        out["withinHorizon"] = out["expectedDays"] is not None
        out["usesLevel"] = req.level is not None
    # A near-flat or sparse series is weak evidence: say so instead of sounding sure.
    out["confidence"] = "low" if (y > 0).sum() < 4 or resid > max(y.mean(), 1e-6) else "ok"
    return out
