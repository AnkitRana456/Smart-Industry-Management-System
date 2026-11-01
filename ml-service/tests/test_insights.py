import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.insights import AnomalyRequest, ForecastRequest, Reading, detect_anomalies, forecast
from app.main import create_app


def normal(n, seed=0):
    rng = np.random.default_rng(seed)
    return [Reading(temperatureC=float(60 + rng.normal(0, 1.5)), vibrationMms=float(2 + rng.normal(0, 0.2)),
                    rpm=float(1800 + rng.normal(0, 30)), powerKw=float(7 + rng.normal(0, 0.3))) for _ in range(n)]


def test_a_spike_is_flagged_and_normal_readings_mostly_are_not():
    recent = normal(8, seed=9) + [Reading(temperatureC=95, vibrationMms=6.5, rpm=1800, powerKw=7)]
    r = detect_anomalies(AnomalyRequest(history=normal(300), recent=recent))
    assert r["points"][-1]["anomalous"] is True
    assert r["points"][-1]["score"] > 0.5
    assert r["points"][-1]["mostUnusual"]["feature"] in ("temperatureC", "vibrationMms")
    assert sum(p["anomalous"] for p in r["points"][:-1]) <= 1
    assert r["flagged"] == sum(p["anomalous"] for p in r["points"])


def test_a_spike_far_outside_anything_seen_is_still_flagged():
    # An Isolation Forest alone scores this like the edge of the normal range; the z-score rule catches it.
    r = detect_anomalies(AnomalyRequest(history=normal(80), recent=[Reading(temperatureC=96, vibrationMms=2, rpm=1800, powerKw=7)]))
    assert r["points"][0]["anomalous"] is True
    assert r["points"][0]["mostUnusual"]["deviation"] > 20 and r["points"][0]["score"] == 1.0


def test_the_most_unusual_feature_is_named_with_its_typical_value():
    r = detect_anomalies(AnomalyRequest(history=normal(200), recent=[Reading(temperatureC=60, vibrationMms=2, rpm=1800, powerKw=14)]))
    m = r["points"][0]["mostUnusual"]
    assert m["feature"] == "powerKw" and m["deviation"] > 5 and 6 < m["typical"] < 8


def test_a_sensor_that_never_moves_does_not_flag_everything():
    flat = [Reading(temperatureC=60, vibrationMms=2, rpm=1800, powerKw=7)] * 60
    r = detect_anomalies(AnomalyRequest(history=flat, recent=[Reading(temperatureC=60, vibrationMms=2, rpm=1800, powerKw=7)]))
    assert r["flagged"] == 0


def test_too_little_history_is_refused_by_validation():
    with pytest.raises(Exception):
        AnomalyRequest(history=normal(5), recent=normal(1))


def test_forecast_follows_a_rising_trend_and_gives_a_range():
    f = forecast(ForecastRequest(series=[10 + i for i in range(20)], horizon=5))
    assert f["trendPerDay"] == pytest.approx(1.0, abs=0.15)
    assert f["forecast"][0]["expected"] > 28
    assert all(p["low"] <= p["expected"] <= p["high"] for p in f["forecast"])
    assert f["confidence"] == "ok"


def test_days_until_stockout_matches_simple_arithmetic_and_has_a_window():
    f = forecast(ForecastRequest(series=[10.0] * 14, horizon=30, level=95))
    assert f["expectedDays"] == pytest.approx(9.5, abs=0.2)
    assert f["earliestDays"] <= f["expectedDays"] <= f["latestDays"]
    assert f["withinHorizon"] is True and f["usesLevel"] is True


def test_stock_that_will_not_run_out_inside_the_horizon_says_so():
    f = forecast(ForecastRequest(series=[1.0] * 14, horizon=10, level=500))
    assert f["expectedDays"] is None and f["withinHorizon"] is False


def test_an_order_target_is_projected_the_same_way():
    f = forecast(ForecastRequest(series=[20.0] * 10, horizon=30, target=100))
    assert f["expectedDays"] == pytest.approx(5.0, abs=0.2) and f["usesLevel"] is False


def test_nothing_left_means_zero_days_and_forecasts_never_go_negative():
    assert forecast(ForecastRequest(series=[5.0] * 10, level=0))["expectedDays"] == 0.0
    f = forecast(ForecastRequest(series=[10, 8, 6, 4, 2, 1, 0, 0], horizon=20))
    assert all(p["expected"] >= 0 and p["low"] >= 0 for p in f["forecast"])


def test_sparse_or_noisy_history_is_marked_low_confidence():
    assert forecast(ForecastRequest(series=[0, 0, 0, 0, 0, 0, 40]))["confidence"] == "low"


@pytest.fixture()
def client():
    return TestClient(create_app(api_key="k"))


H = {"X-API-Key": "k"}


def test_http_contract_validation_and_key(client):
    assert client.post("/forecast", json={"series": [1] * 10}).status_code == 401
    assert client.post("/forecast", json={"series": [1] * 10, "level": 20}, headers=H).status_code == 200
    for bad in ({"series": [1, 2, 3]}, {"series": [1] * 10, "horizon": 0}, {"series": [-1] * 10}, {"series": [1] * 10, "level": -5}, {"series": ["x"] * 10}, {"series": [1] * 10, "x": 1}):
        assert client.post("/forecast", json=bad, headers=H).status_code == 422
    row = {"temperatureC": 60, "vibrationMms": 2, "rpm": 1800, "powerKw": 7}
    ok = client.post("/anomaly", json={"history": [row] * 40, "recent": [row]}, headers=H)
    assert ok.status_code == 200 and ok.json()["historyPoints"] == 40
    assert client.post("/anomaly", json={"history": [row] * 5, "recent": [row]}, headers=H).status_code == 422
    assert client.post("/anomaly", json={"history": [{**row, "vibrationMms": -1}] * 40, "recent": [row]}, headers=H).status_code == 422
