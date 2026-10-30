"""Train, evaluate and save the failure-risk model.

    python -m app.train                 full run (about 24,000 synthetic machine-months)
    python -m app.train --samples 4000  quick run

Writes artifacts/model.joblib and artifacts/metadata.json.
"""
import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import sklearn
from sklearn.calibration import CalibratedClassifierCV
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.inspection import permutation_importance
from sklearn.metrics import average_precision_score, brier_score_loss, roc_auc_score
from sklearn.model_selection import StratifiedKFold, cross_val_score, train_test_split
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from . import config
from .data import generate
from .features import FEATURE_NAMES, FEATURES

DEFAULT_SAMPLES = 24_000
DEFAULT_SEED = 42


def band_for(p: float) -> str:
    return "High" if p >= config.HIGH_FROM else "Medium" if p >= config.MEDIUM_FROM else "Low"


def _calibration_table(y: np.ndarray, p: np.ndarray, bins: int = 10) -> list[dict]:
    """Equal-count bins of predicted probability against the failure rate actually seen in them."""
    order = np.argsort(p)
    rows = []
    for chunk in np.array_split(order, bins):
        rows.append({
            "n": int(len(chunk)),
            "meanPredicted": round(float(p[chunk].mean()), 4),
            "observedRate": round(float(y[chunk].mean()), 4),
        })
    return rows


def _band_table(y: np.ndarray, p: np.ndarray) -> list[dict]:
    out = []
    for name in ("Low", "Medium", "High"):
        mask = np.array([band_for(v) == name for v in p])
        out.append({
            "band": name, "n": int(mask.sum()),
            "observedFailureRate": round(float(y[mask].mean()), 4) if mask.any() else None,
        })
    return out


def train(n_samples: int = DEFAULT_SAMPLES, seed: int = DEFAULT_SEED, out_dir: Path | None = None) -> dict:
    out_dir = Path(out_dir) if out_dir else config.ARTIFACT_DIR
    X, y, p_signal = generate(n_samples, seed)
    data_hash = hashlib.sha256(X.tobytes() + y.tobytes()).hexdigest()[:8]

    X_tr, X_te, y_tr, y_te, _, ps_te = train_test_split(X, y, p_signal, test_size=0.25, stratify=y, random_state=seed)

    candidates = {
        "logistic-regression": make_pipeline(StandardScaler(), LogisticRegression(max_iter=1000)),
        "random-forest-calibrated": CalibratedClassifierCV(
            RandomForestClassifier(n_estimators=150, min_samples_leaf=25, n_jobs=-1, random_state=seed), method="isotonic", cv=3),
    }
    # Choose on the training split only (5-fold Brier score), so the held-out set is only ever used to report.
    folds = StratifiedKFold(n_splits=5, shuffle=True, random_state=seed)
    cv_brier = {name: float(-cross_val_score(est, X_tr, y_tr, cv=folds, scoring="neg_brier_score").mean()) for name, est in candidates.items()}
    chosen = min(cv_brier, key=cv_brier.get)
    other = next(n for n in candidates if n != chosen)
    model = candidates[chosen].fit(X_tr, y_tr)
    runner_up = candidates[other].fit(X_tr, y_tr)

    p = model.predict_proba(X_te)[:, 1]
    p_other = runner_up.predict_proba(X_te)[:, 1]
    base_rate = float(y_te.mean())
    high = p >= config.HIGH_FROM

    metrics = {
        "testSamples": int(len(y_te)),
        "baseRate": round(base_rate, 4),
        "rocAuc": round(float(roc_auc_score(y_te, p)), 4),
        "prAuc": round(float(average_precision_score(y_te, p)), 4),
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
            "alwaysPredictBaseRateBrier": round(float(brier_score_loss(y_te, np.full_like(p, y_tr.mean()))), 4),
            "otherCandidate": other,
            "otherCandidateRocAuc": round(float(roc_auc_score(y_te, p_other)), 4),
            "otherCandidateBrier": round(float(brier_score_loss(y_te, p_other)), 4),
            "generatorCeilingRocAuc": round(float(roc_auc_score(y_te, ps_te)), 4),
        },
    }

    perm = permutation_importance(model, X_te, y_te, scoring="roc_auc", n_repeats=5, random_state=seed)
    drops = np.maximum(perm.importances_mean, 0)
    importances = drops / drops.sum() if drops.sum() > 0 else drops
    medians = np.median(X_tr, axis=0)
    lo, hi = X_tr.min(axis=0), X_tr.max(axis=0)

    version = f"{chosen}-{data_hash}"
    metadata = {
        "modelVersion": version,
        "trainedAt": datetime.now(timezone.utc).isoformat(),
        "dataSource": config.DATA_SOURCE,
        "algorithm": chosen,
        "selection": {"method": "5-fold cross-validated Brier score on the training split", "cvBrier": {k: round(v, 5) for k, v in cv_brier.items()}, "chosen": chosen},
        "seed": seed,
        "trainSamples": int(len(y_tr)),
        "sklearnVersion": sklearn.__version__,
        "features": [
            {"name": f.name, "label": f.label, "unit": f.unit,
             "trainingRange": [round(float(lo[i]), 2), round(float(hi[i]), 2)], "importance": round(float(importances[i]), 4)}
            for i, f in enumerate(FEATURES)
        ],
        "bands": {"mediumFrom": config.MEDIUM_FROM, "highFrom": config.HIGH_FROM},
        "metrics": metrics,
        "limitations": config.LIMITATIONS,
    }

    out_dir.mkdir(parents=True, exist_ok=True)
    joblib.dump({
        "model": model, "features": FEATURE_NAMES, "medians": medians, "lo": lo, "hi": hi, "version": version,
    }, out_dir / "model.joblib")
    (out_dir / "metadata.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    return metadata


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--samples", type=int, default=DEFAULT_SAMPLES)
    ap.add_argument("--seed", type=int, default=DEFAULT_SEED)
    args = ap.parse_args()
    meta = train(args.samples, args.seed)
    m = meta["metrics"]
    r = m["references"]
    print(f"Trained {meta['modelVersion']} on {meta['trainSamples']} synthetic samples ({meta['dataSource']}).")
    print(f"Chosen by cross-validation: {meta['algorithm']}  (CV Brier {meta['selection']['cvBrier']})")
    print(f"Held-out ROC-AUC {m['rocAuc']} ({r['otherCandidate']} {r['otherCandidateRocAuc']}, generator ceiling {r['generatorCeilingRocAuc']})")
    print(f"PR-AUC {m['prAuc']}  Brier {m['brier']} (base-rate-only {r['alwaysPredictBaseRateBrier']})  base rate {m['baseRate']}")
    h = m["highBand"]
    print(f"High band (>= {h['threshold']}): recall {h['recall']}, precision {h['precision']}, flags {h['flaggedShare']:.1%} of machines")
    for b in m["bands"]:
        print(f"  {b['band']:<6} n={b['n']:<5} observed failure rate {b['observedFailureRate']}")
    print("These are results on held-out SYNTHETIC data. They do not measure real-world accuracy.")


if __name__ == "__main__":
    main()
