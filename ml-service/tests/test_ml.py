import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.data import generate
from app.features import FEATURE_NAMES
from app.main import create_app
from app.train import band_for, train

from .conftest import GOOD


# ---- synthetic data -------------------------------------------------------------------------

def test_generator_is_deterministic_and_shaped():
    a = generate(2000, seed=3)
    b = generate(2000, seed=3)
    assert all(np.array_equal(x, y) for x, y in zip(a, b))
    X, y, p = a
    assert X.shape == (2000, len(FEATURE_NAMES))
    assert set(np.unique(y)) <= {0, 1}
    assert ((p >= 0) & (p <= 1)).all()
    assert not np.array_equal(generate(2000, seed=4)[0], X)


def test_generator_has_a_realistic_base_rate_and_physical_ranges():
    X, y, _ = generate(20000, seed=1)
    assert 0.07 < y.mean() < 0.14
    lo, hi = X.min(axis=0), X.max(axis=0)
    assert (lo >= 0).all()
    assert hi[FEATURE_NAMES.index("toolWearMin")] <= 400
    assert hi[FEATURE_NAMES.index("vibrationMms")] <= 15
    assert lo[FEATURE_NAMES.index("temperatureC")] >= 20


def test_failures_become_more_common_as_wear_and_vibration_rise():
    X, y, _ = generate(30000, seed=2)
    wear = X[:, FEATURE_NAMES.index("toolWearMin")]
    vib = X[:, FEATURE_NAMES.index("vibrationMms")]
    assert y[wear > np.quantile(wear, 0.9)].mean() > 2 * y[wear < np.quantile(wear, 0.5)].mean()
    assert y[vib > np.quantile(vib, 0.9)].mean() > 2 * y[vib < np.quantile(vib, 0.5)].mean()


# ---- training and honest evaluation ----------------------------------------------------------

def test_training_reports_the_metrics_a_reviewer_needs(trained):
    _, meta = trained
    m = meta["metrics"]
    for key in ("rocAuc", "prAuc", "brier", "baseRate", "calibration", "bands", "highBand", "references"):
        assert key in m
    assert len(m["calibration"]) == 10
    assert {b["band"] for b in m["bands"]} == {"Low", "Medium", "High"}
    assert meta["dataSource"] == "synthetic"
    assert any("synthetic" in text.lower() for text in meta["limitations"])


def test_the_model_beats_guessing_and_stays_near_the_generator_ceiling(trained):
    m = trained[1]["metrics"]
    assert m["rocAuc"] > 0.72
    assert m["brier"] < m["references"]["alwaysPredictBaseRateBrier"]
    # The ceiling is the best score possible from these inputs; a model cannot honestly beat it by much.
    assert m["rocAuc"] <= m["references"]["generatorCeilingRocAuc"] + 0.03


def test_risk_bands_are_ordered_by_observed_failure_rate(trained):
    rates = {b["band"]: b["observedFailureRate"] for b in trained[1]["metrics"]["bands"] if b["n"] >= 20}
    assert rates["Low"] < rates["Medium"] < rates["High"]


def test_model_is_chosen_by_cross_validation_not_by_the_test_set(trained):
    sel = trained[1]["selection"]
    assert sel["chosen"] == min(sel["cvBrier"], key=sel["cvBrier"].get)
    assert "training split" in sel["method"]


def test_calibration_is_reasonable_in_the_synthetic_world(trained):
    bins = trained[1]["metrics"]["calibration"]
    weighted_gap = sum(abs(b["meanPredicted"] - b["observedRate"]) * b["n"] for b in bins) / sum(b["n"] for b in bins)
    assert weighted_gap < 0.03


def test_training_is_reproducible(tmp_path):
    a = train(n_samples=3000, seed=11, out_dir=tmp_path / "a")["metrics"]
    b = train(n_samples=3000, seed=11, out_dir=tmp_path / "b")["metrics"]
    assert a["rocAuc"] == b["rocAuc"] and a["brier"] == b["brier"]


def test_band_policy():
    assert [band_for(p) for p in (0.0, 0.099, 0.10, 0.29, 0.30, 0.99)] == ["Low", "Low", "Medium", "Medium", "High", "High"]


# ---- predictor -------------------------------------------------------------------------------

def test_predictions_rise_with_the_things_that_wear_machines_out(predictor):
    from app.features import PredictRequest
    base = predictor.predict(PredictRequest(**GOOD))["probability"]
    worn = predictor.predict(PredictRequest(**{**GOOD, "toolWearMin": 300}))["probability"]
    shaky = predictor.predict(PredictRequest(**{**GOOD, "vibrationMms": 8}))["probability"]
    hot = predictor.predict(PredictRequest(**{**GOOD, "temperatureC": 110}))["probability"]
    assert worn > base and shaky > base and hot > base


def test_explanations_name_the_features_that_moved_the_score(predictor):
    from app.features import PredictRequest
    out = predictor.predict(PredictRequest(**{**GOOD, "toolWearMin": 320, "vibrationMms": 9}))
    top = [f["feature"] for f in out["topFactors"]]
    assert "toolWearMin" in top and "vibrationMms" in top
    assert all(f["direction"] == "raises" for f in out["topFactors"][:2])
    assert len(out["topFactors"]) == 3


def test_values_outside_the_training_range_are_flagged(predictor):
    from app.features import PredictRequest
    out = predictor.predict(PredictRequest(**{**GOOD, "temperatureC": 400}))
    assert any("temperature" in w.lower() and "extrapolation" in w for w in out["warnings"])
    assert predictor.predict(PredictRequest(**GOOD))["warnings"] == []


# ---- HTTP API --------------------------------------------------------------------------------

@pytest.fixture()
def client(predictor):
    return TestClient(create_app(predictor=predictor, api_key=""))


def test_health_and_model_endpoints(client):
    h = client.get("/health").json()
    assert h["status"] == "ok" and h["modelLoaded"] is True
    meta = client.get("/model").json()
    assert meta["dataSource"] == "synthetic" and meta["limitations"]


def test_predict_returns_the_documented_shape(client):
    r = client.post("/predict", json=GOOD)
    assert r.status_code == 200
    body = r.json()
    assert body["risk"] in {"Low", "Medium", "High"}
    assert 0 < body["probability"] < 1
    assert body["dataSource"] == "synthetic" and body["modelVersion"]
    assert {"feature", "label", "value", "unit", "effect", "direction"} <= set(body["topFactors"][0])


@pytest.mark.parametrize("patch", [
    {"toolWearMin": -1}, {"vibrationMms": 500}, {"temperatureC": 5000},
    {"unknownField": 1}, {"toolWearMin": "lots"}, {"runHours": None},
])
def test_impossible_or_malformed_input_is_rejected(client, patch):
    r = client.post("/predict", json={**GOOD, **patch})
    assert r.status_code == 422


@pytest.mark.parametrize("token", ["Infinity", "-Infinity", "NaN"])
def test_non_finite_numbers_on_the_wire_are_rejected(client, token):
    # The test client will not serialise these, so send the raw JSON a misbehaving caller could.
    raw = '{"runHours": %s, "daysSinceService": 30, "downtimeCount30d": 1, "toolWearMin": 60, "temperatureC": 58, "vibrationMms": 1.8}' % token
    r = client.post("/predict", content=raw, headers={"Content-Type": "application/json"})
    assert r.status_code == 422
    body = r.json()
    assert body["errors"][0]["field"] == "runHours"
    assert "input" not in body["errors"][0], "rejected values are not echoed back"


def test_missing_features_are_rejected_not_guessed(client):
    partial = {k: v for k, v in GOOD.items() if k != "vibrationMms"}
    assert client.post("/predict", json=partial).status_code == 422


def test_api_key_is_enforced_when_configured(predictor):
    c = TestClient(create_app(predictor=predictor, api_key="s3cret-key"))
    assert c.get("/health").status_code == 200
    assert c.post("/predict", json=GOOD).status_code == 401
    assert c.post("/predict", json=GOOD, headers={"X-API-Key": "wrong"}).status_code == 401
    assert c.post("/predict", json=GOOD, headers={"X-API-Key": "s3cret-key"}).status_code == 200
    assert c.get("/model").status_code == 401


def test_without_a_trained_model_the_service_degrades_clearly(tmp_path, monkeypatch):
    monkeypatch.setattr("app.config.ARTIFACT_DIR", tmp_path / "empty")
    with TestClient(create_app(api_key="")) as c:
        assert c.get("/health").json() == {"status": "degraded", "modelLoaded": False, "modelVersion": None, "sensorModelLoaded": False, "sensorModelVersion": None}
        r = c.post("/predict", json=GOOD)
        assert r.status_code == 503 and "Train it" in r.json()["detail"]
