import csv

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.sensor import SensorPredictor, SensorRequest, expand, load_ai4i, train_sensor

HEADER = ["UDI", "Product ID", "Type", "Air temperature [K]", "Process temperature [K]", "Rotational speed [rpm]", "Torque [Nm]", "Tool wear [min]", "Machine failure"]


def write_dataset(path, n=4000, seed=0, bom=True):
    """A small file in the AI4I layout whose failures follow that dataset's published rules
    (tool wear, overstrain, power window), so a model can learn them without any download."""
    rng = np.random.default_rng(seed)
    rpm = rng.normal(1540, 170, n).clip(1170, 2880)
    torque = rng.normal(40, 10, n).clip(4, 76)
    wear = rng.integers(0, 254, n)
    power = torque * rpm * 2 * np.pi / 60
    fail = ((wear > 200) & (rng.random(n) < 0.35)) | (wear * torque > 11_000) | (power < 3500) | (power > 9000)
    with open(path, "w", encoding="utf-8-sig" if bom else "utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(HEADER)
        for i in range(n):
            w.writerow([i + 1, f"M{i}", "M", 300.0, 310.0, round(rpm[i]), round(torque[i], 1), wear[i], int(fail[i])])


@pytest.fixture(scope="module")
def trained_sensor(tmp_path_factory):
    d = tmp_path_factory.mktemp("sensor")
    write_dataset(d / "ai4i.csv")
    meta = train_sensor(d / "ai4i.csv", seed=3, out_dir=d)
    return d, meta


@pytest.fixture(scope="module")
def sensor(trained_sensor):
    return SensorPredictor.load(trained_sensor[0])


def req(rpm=1500, torque=40, wear=50):
    return SensorRequest(rpm=rpm, torqueNm=torque, toolWearMin=wear)


def test_loader_reads_a_bom_prefixed_file_and_refuses_an_empty_one(tmp_path):
    write_dataset(tmp_path / "a.csv", n=50)
    X, y = load_ai4i(tmp_path / "a.csv")
    assert X.shape == (50, 3) and set(np.unique(y)) <= {0, 1}
    (tmp_path / "empty.csv").write_text(",".join(HEADER) + "\n", encoding="utf-8")
    with pytest.raises(ValueError):
        load_ai4i(tmp_path / "empty.csv")


def test_expand_adds_power_and_wear_times_torque():
    out = expand(np.array([[1000.0, 10.0, 20.0]]))
    assert out.shape == (1, 5)
    assert out[0, 3] == pytest.approx(10 * 1000 * 2 * np.pi / 60)
    assert out[0, 4] == 200.0


def test_model_beats_the_base_rate_on_held_out_rows_and_reports_honestly(trained_sensor):
    m = trained_sensor[1]["metrics"]
    assert m["rocAuc"] > 0.85
    assert m["brier"] < m["references"]["alwaysPredictBaseRateBrier"]
    assert trained_sensor[1]["dataSource"].startswith("AI4I 2020")
    assert any("not this plant" in x for x in trained_sensor[1]["limitations"])


def test_more_wear_times_torque_means_more_risk_and_the_reason_is_named(sensor):
    easy, hard = sensor.predict(req(wear=20, torque=35)), sensor.predict(req(wear=240, torque=60))
    assert hard["probability"] > easy["probability"] + 0.2
    assert hard["risk"] in ("Medium", "High") and easy["risk"] == "Low"
    assert hard["topFactors"][0]["direction"] == "raises"
    assert {f["feature"] for f in hard["topFactors"]} <= {"rpm", "torqueNm", "toolWearMin"}


def test_values_outside_the_training_range_are_flagged_as_extrapolation(sensor):
    r = sensor.predict(req(rpm=9000))
    assert any("Rotational speed" in w and "extrapolation" in w for w in r["warnings"])
    assert sensor.predict(req())["warnings"] == []


def test_probability_is_always_a_valid_number(sensor):
    for r in (req(rpm=1, torque=0, wear=0), req(rpm=100_000, torque=100_000, wear=100_000)):
        p = sensor.predict(r)["probability"]
        assert 0 < p < 1


# ---- HTTP ------------------------------------------------------------------------------------

@pytest.fixture()
def client(sensor, predictor):
    return TestClient(create_app(predictor=predictor, sensor=sensor, api_key="secret"))


H = {"X-API-Key": "secret"}
OK = {"rpm": 1500, "torqueNm": 40, "toolWearMin": 120}


def test_predict_sensor_returns_the_documented_shape(client):
    r = client.post("/predict-sensor", json=OK, headers=H)
    assert r.status_code == 200
    body = r.json()
    assert set(body) == {"risk", "probability", "modelVersion", "dataSource", "topFactors", "warnings"}
    assert body["risk"] in ("Low", "Medium", "High")


@pytest.mark.parametrize("bad", [
    {**OK, "rpm": 0}, {**OK, "rpm": -5}, {**OK, "torqueNm": -1}, {**OK, "toolWearMin": 1e9},
    {**OK, "extra": 1}, {"rpm": 1500, "torqueNm": 40}, {**OK, "rpm": "fast"},
])
def test_invalid_input_is_rejected_without_echoing_it(client, bad):
    r = client.post("/predict-sensor", json=bad, headers=H)
    assert r.status_code == 422
    assert "fast" not in r.text


def test_non_finite_numbers_are_rejected_cleanly(client):
    r = client.post("/predict-sensor", content='{"rpm": 1500, "torqueNm": Infinity, "toolWearMin": 1}', headers={**H, "Content-Type": "application/json"})
    assert r.status_code == 422


def test_needs_the_api_key_but_health_does_not(client):
    assert client.post("/predict-sensor", json=OK).status_code == 401
    assert client.get("/sensor-model").status_code == 401
    h = client.get("/health").json()
    assert h["sensorModelLoaded"] is True and h["sensorModelVersion"].startswith("sensor-hgb-")


def test_a_missing_sensor_model_is_a_clear_503_and_the_main_model_still_works(predictor):
    c = TestClient(create_app(predictor=predictor, sensor=None))
    assert c.post("/predict-sensor", json=OK).status_code == 503
    assert c.get("/health").json()["sensorModelLoaded"] is False
    assert c.post("/predict", json={"runHours": 1500, "daysSinceService": 30, "downtimeCount30d": 1, "toolWearMin": 60, "temperatureC": 58, "vibrationMms": 1.8}).status_code == 200
