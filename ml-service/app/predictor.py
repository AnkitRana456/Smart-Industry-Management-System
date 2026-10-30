"""Loads the saved model and turns a feature row into a risk band, probability and explanation."""
import json
from pathlib import Path

import joblib
import numpy as np

from . import config
from .features import BY_NAME, FEATURE_NAMES, PredictRequest
from .train import band_for

TOP_FACTORS = 3


class Predictor:
    def __init__(self, bundle: dict, metadata: dict):
        self.model = bundle["model"]
        self.medians = np.asarray(bundle["medians"], dtype=float)
        self.lo = np.asarray(bundle["lo"], dtype=float)
        self.hi = np.asarray(bundle["hi"], dtype=float)
        self.version: str = bundle["version"]
        self.metadata = metadata

    @classmethod
    def load(cls, directory: Path | None = None) -> "Predictor":
        directory = Path(directory) if directory else config.ARTIFACT_DIR
        bundle = joblib.load(directory / "model.joblib")
        if bundle["features"] != FEATURE_NAMES:
            raise RuntimeError("Saved model was trained on different features. Retrain with `python -m app.train`.")
        metadata = json.loads((directory / "metadata.json").read_text(encoding="utf-8"))
        return cls(bundle, metadata)

    def predict(self, req: PredictRequest) -> dict:
        row = np.asarray(req.as_row(), dtype=float)
        # One batch: the real row, then the row with each feature swapped for its typical (median) value.
        # The drop in probability when a feature is made typical is how much that feature raises the risk.
        batch = np.vstack([row] + [np.where(np.arange(len(row)) == i, self.medians[i], row) for i in range(len(row))])
        probs = self.model.predict_proba(batch)[:, 1]
        p = float(np.clip(probs[0], 0.0005, 0.9995))
        effects = probs[0] - probs[1:]

        factors = []
        for i in np.argsort(-np.abs(effects))[:TOP_FACTORS]:
            f = BY_NAME[FEATURE_NAMES[i]]
            factors.append({
                "feature": f.name, "label": f.label, "value": round(float(row[i]), 2), "unit": f.unit,
                "effect": round(float(effects[i]), 4),
                "direction": "raises" if effects[i] > 0 else "lowers",
            })

        warnings = []
        for i, name in enumerate(FEATURE_NAMES):
            if row[i] < self.lo[i] or row[i] > self.hi[i]:
                f = BY_NAME[name]
                warnings.append(
                    f"{f.label} ({round(float(row[i]), 2)} {f.unit}) is outside the range the model was trained on "
                    f"({round(float(self.lo[i]), 1)} to {round(float(self.hi[i]), 1)} {f.unit}), so this estimate is an extrapolation."
                )

        return {
            "risk": band_for(p),
            "probability": round(p, 4),
            "bands": {"mediumFrom": config.MEDIUM_FROM, "highFrom": config.HIGH_FROM},
            "modelVersion": self.version,
            "dataSource": config.DATA_SOURCE,
            "topFactors": factors,
            "warnings": warnings,
        }
