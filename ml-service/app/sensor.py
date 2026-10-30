"""Sensor model: failure risk from rpm, torque and tool wear, trained on the public AI4I 2020 dataset.

AI4I 2020 (Matzka, UCI Machine Learning Repository, CC BY 4.0) holds 10,000 machine runs with a
failure label. It is itself a synthetic dataset, built to mimic real failure modes (tool wear,
overstrain, power failure, heat dissipation), so it is better physics than our own generator but
is still not records from this plant.

Only inputs SIMS telemetry can supply are used: rpm, torque (derived from power and rpm) and tool
wear. Temperature and product type are left out on purpose: the plant's temperature scale differs
from the dataset's, and feeding a number the model never saw in that range would only extrapolate.

    python -m app.sensor                  downloads the dataset if needed, trains, saves the model
    python -m app.sensor --csv path.csv   trains from a local copy
"""
import argparse
import csv
import hashlib
import json
import urllib.request
import zipfile
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path

import joblib
import numpy as np
import sklearn
from pydantic import BaseModel, ConfigDict, Field
from sklearn.calibration import CalibratedClassifierCV
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.metrics import average_precision_score, brier_score_loss, roc_auc_score
from sklearn.model_selection import train_test_split

from . import config
from .train import _band_table, _calibration_table, band_for

DATA_URL = "https://archive.ics.uci.edu/static/public/601/ai4i+2020+predictive+maintenance+dataset.zip"
DATA_DIR = config.ROOT / "data"
SENSOR_MODEL_PATH = config.ARTIFACT_DIR / "sensor_model.joblib"
SENSOR_METADATA_PATH = config.ARTIFACT_DIR / "sensor_metadata.json"

INPUTS = [("rpm", "Rotational speed", "rpm"), ("torqueNm", "Torque", "Nm"), ("toolWearMin", "Tool wear", "min")]
INPUT_NAMES = [n for n, _, _ in INPUTS]
LABELS = {n: (label, unit) for n, label, unit in INPUTS}
TOP_FACTORS = 3

SENSOR_LIMITATIONS = [
    "Trained on the public AI4I 2020 dataset, which is itself synthetic. It is not this plant's failure history.",
    "Uses only rpm, torque and tool wear. Overheating failures, which depend on temperature differences, are mostly invisible to it.",
    "Torque is derived from electrical power and rpm, so it is an approximation of the dataset's measured torque.",
    "Use it as one extra signal next to inspection history and the manufacturer's guidance, never as the sole basis for a safety-critical decision.",
]


class SensorRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    rpm: float = Field(gt=0, le=100_000)
    torqueNm: float = Field(ge=0, le=100_000)
    toolWearMin: float = Field(ge=0, le=100_000)

    def as_row(self) -> list[float]:
        return [getattr(self, n) for n in INPUT_NAMES]


def expand(rows: np.ndarray) -> np.ndarray:
    """Adds the two quantities the failure rules depend on: mechanical power and wear x torque."""
    rpm, torque, wear = rows[:, 0], rows[:, 1], rows[:, 2]
    return np.column_stack([rpm, torque, wear, torque * rpm * 2 * np.pi / 60, torque * wear])


def download(dest: Path = DATA_DIR / "ai4i2020.csv") -> Path:
    if dest.exists():
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(DATA_URL, timeout=60) as r:  # noqa: S310 - fixed https URL
        z = zipfile.ZipFile(BytesIO(r.read()))
    dest.write_bytes(z.read("ai4i2020.csv"))
    return dest


def load_ai4i(path: Path) -> tuple[np.ndarray, np.ndarray]:
    with open(path, encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f))
    if not rows:
        raise ValueError("The dataset file has no rows.")
    X = np.array([[float(r["Rotational speed [rpm]"]), float(r["Torque [Nm]"]), float(r["Tool wear [min]"])] for r in rows])
    y = np.array([int(r["Machine failure"]) for r in rows])
    return X, y


def train_sensor(csv_path: Path | None = None, seed: int = 0, out_dir: Path | None = None) -> dict:
    out_dir = Path(out_dir) if out_dir else config.ARTIFACT_DIR
    path = Path(csv_path) if csv_path else download()
    X, y = load_ai4i(path)
    data_hash = hashlib.sha256(path.read_bytes()).hexdigest()[:8]

    X_tr, X_te, y_tr, y_te = train_test_split(X, y, test_size=0.25, stratify=y, random_state=seed)
    model = CalibratedClassifierCV(
        HistGradientBoostingClassifier(max_depth=4, learning_rate=0.05, max_iter=200, random_state=seed), method="isotonic", cv=3,
    ).fit(expand(X_tr), y_tr)
    p = model.predict_proba(expand(X_te))[:, 1]
    high = p >= config.HIGH_FROM
    metrics = {
        "testSamples": int(len(y_te)), "baseRate": round(float(y_te.mean()), 4),
        "rocAuc": round(float(roc_auc_score(y_te, p)), 4), "prAuc": round(float(average_precision_score(y_te, p)), 4),
        "brier": round(float(brier_score_loss(y_te, p)), 4),
        "highBand": {
            "threshold": config.HIGH_FROM,
            "recall": round(float((high & (y_te == 1)).sum() / max(1, (y_te == 1).sum())), 4),
            "precision": round(float((high & (y_te == 1)).sum() / max(1, high.sum())), 4),
            "flaggedShare": round(float(high.mean()), 4),
        },
        "calibration": _calibration_table(y_te, p),
        "bands": _band_table(y_te, p),
        "references": {
            "alwaysPredictBaseRateBrier": round(float(brier_score_loss(y_te, np.full_like(p, y_tr.mean(), dtype=float))), 4),
            "toolWearAloneRocAuc": round(float(roc_auc_score(y_te, X_te[:, 2])), 4),
        },
    }
    medians, lo, hi = np.median(X_tr, axis=0), X_tr.min(axis=0), X_tr.max(axis=0)
    version = f"sensor-hgb-{data_hash}"
    metadata = {
        "modelVersion": version, "trainedAt": datetime.now(timezone.utc).isoformat(), "algorithm": "calibrated-gradient-boosting",
        "dataSource": "AI4I 2020 (UCI), public and synthetic", "datasetRows": int(len(y)), "datasetFailures": int(y.sum()),
        "sklearnVersion": sklearn.__version__, "seed": seed,
        "features": [{"name": n, "label": label, "unit": unit, "trainingRange": [round(float(lo[i]), 2), round(float(hi[i]), 2)]} for i, (n, label, unit) in enumerate(INPUTS)],
        "bands": {"mediumFrom": config.MEDIUM_FROM, "highFrom": config.HIGH_FROM},
        "metrics": metrics, "limitations": SENSOR_LIMITATIONS,
    }
    out_dir.mkdir(parents=True, exist_ok=True)
    joblib.dump({"model": model, "medians": medians, "lo": lo, "hi": hi, "version": version}, out_dir / "sensor_model.joblib")
    (out_dir / "sensor_metadata.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    return metadata


class SensorPredictor:
    def __init__(self, bundle: dict, metadata: dict):
        self.model = bundle["model"]
        self.medians, self.lo, self.hi = (np.asarray(bundle[k], dtype=float) for k in ("medians", "lo", "hi"))
        self.version: str = bundle["version"]
        self.metadata = metadata

    @classmethod
    def load(cls, directory: Path | None = None) -> "SensorPredictor":
        directory = Path(directory) if directory else config.ARTIFACT_DIR
        bundle = joblib.load(directory / "sensor_model.joblib")
        return cls(bundle, json.loads((directory / "sensor_metadata.json").read_text(encoding="utf-8")))

    def predict(self, req: SensorRequest) -> dict:
        row = np.asarray(req.as_row(), dtype=float)
        batch = np.vstack([row] + [np.where(np.arange(3) == i, self.medians[i], row) for i in range(3)])
        probs = self.model.predict_proba(expand(batch))[:, 1]
        p = float(np.clip(probs[0], 0.0005, 0.9995))
        effects = probs[0] - probs[1:]
        factors = [
            {"feature": INPUT_NAMES[i], "label": LABELS[INPUT_NAMES[i]][0], "value": round(float(row[i]), 2), "unit": LABELS[INPUT_NAMES[i]][1],
             "effect": round(float(effects[i]), 4), "direction": "raises" if effects[i] > 0 else "lowers"}
            for i in np.argsort(-np.abs(effects))[:TOP_FACTORS]
        ]
        warnings = [
            f"{LABELS[n][0]} ({round(float(row[i]), 2)} {LABELS[n][1]}) is outside the range the model was trained on "
            f"({round(float(self.lo[i]), 1)} to {round(float(self.hi[i]), 1)} {LABELS[n][1]}), so this estimate is an extrapolation."
            for i, n in enumerate(INPUT_NAMES) if row[i] < self.lo[i] or row[i] > self.hi[i]
        ]
        return {
            "risk": band_for(p), "probability": round(p, 4), "modelVersion": self.version, "dataSource": self.metadata["dataSource"],
            "topFactors": factors, "warnings": warnings,
        }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--csv", type=Path, help="local copy of ai4i2020.csv (downloaded from UCI when omitted)")
    meta = train_sensor(ap.parse_args().csv)
    m = meta["metrics"]
    print(f"{meta['modelVersion']}: ROC-AUC {m['rocAuc']}, PR-AUC {m['prAuc']}, Brier {m['brier']} (base-rate Brier {m['references']['alwaysPredictBaseRateBrier']}) on {m['testSamples']} held-out rows")


if __name__ == "__main__":
    main()
