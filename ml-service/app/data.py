"""Synthetic training data.

There are no real failure records for this plant, so the model learns from a simulated one.
Machines accumulate wear between services; wear drives vibration and heat; the chance of a
failure in the next 30 days rises with all of them. The label is *sampled* from that chance
and an unobserved noise term is added, so no model can reach a perfect score.

Everything is seeded, so the same seed always produces the same dataset.
"""
import numpy as np

from .features import FEATURE_NAMES

TARGET_BASE_RATE = 0.10


def _sigmoid(z: np.ndarray) -> np.ndarray:
    return 1.0 / (1.0 + np.exp(-z))


def _signal(x: dict[str, np.ndarray]) -> np.ndarray:
    """The part of the failure risk that depends on what the model can observe."""
    return (
        0.010 * x["toolWearMin"]
        + 0.40 * x["vibrationMms"]
        + 0.040 * np.maximum(x["temperatureC"] - 75.0, 0.0)
        + 0.004 * x["daysSinceService"]
        + 0.220 * x["downtimeCount30d"]
        + 0.00005 * x["runHours"]
        + 0.0006 * x["toolWearMin"] * x["vibrationMms"]
    )


def _intercept_for(signal_plus_noise: np.ndarray, target: float) -> float:
    """Bisection for the intercept that gives the requested average failure probability."""
    lo, hi = -30.0, 10.0
    for _ in range(80):
        mid = (lo + hi) / 2
        if _sigmoid(signal_plus_noise + mid).mean() > target:
            hi = mid
        else:
            lo = mid
    return (lo + hi) / 2


def generate(n: int, seed: int):
    """Returns (X, y, signal_probability).

    signal_probability uses only the observable signal, with no noise. It is the best any model
    could do from these six inputs, which makes it a useful ceiling to compare against.
    """
    rng = np.random.default_rng(seed)
    run_hours = rng.gamma(2.0, 1500.0, n).clip(0, 20_000)
    days_since = rng.gamma(2.0, 35.0, n).clip(0, 365)
    downtime = rng.poisson(1.0 + days_since / 120.0, n).clip(0, 30).astype(float)
    tool_wear = (0.9 * days_since + rng.gamma(2.0, 25.0, n)).clip(0, 400)
    vibration = (0.8 + tool_wear / 120.0 + rng.gamma(2.0, 0.45, n)).clip(0.1, 15)
    temperature = (50.0 + 4.0 * vibration + rng.normal(0, 6.0, n)).clip(20, 140)

    cols = {
        "runHours": run_hours, "daysSinceService": days_since, "downtimeCount30d": downtime,
        "toolWearMin": tool_wear, "temperatureC": temperature, "vibrationMms": vibration,
    }
    signal = _signal(cols)
    noise = rng.normal(0, 0.5, n)
    intercept = _intercept_for(signal + noise, TARGET_BASE_RATE)

    p_true = _sigmoid(signal + noise + intercept)
    y = (rng.random(n) < p_true).astype(int)
    p_signal = _sigmoid(signal + intercept)
    X = np.column_stack([cols[name] for name in FEATURE_NAMES])
    return X, y, p_signal
