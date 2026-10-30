"""Failure-risk microservice for SIMS.

    uvicorn app.main:app --port 8000

Set ML_API_KEY to require an `X-API-Key` header on everything except /health.
"""
import hmac
import logging
import os
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from . import config
from .features import PredictRequest
from .predictor import Predictor
from .sensor import SensorPredictor, SensorRequest

log = logging.getLogger("sims-ml")


def create_app(predictor: Predictor | None = None, api_key: str | None = None, sensor: SensorPredictor | None = None) -> FastAPI:
    key = api_key if api_key is not None else os.environ.get("ML_API_KEY") or None

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if predictor is None:
            try:
                app.state.predictor = Predictor.load()
                log.info("Loaded model %s", app.state.predictor.version)
            except FileNotFoundError:
                app.state.predictor = None
                log.error("No trained model found in %s. Run `python -m app.train`.", config.ARTIFACT_DIR)
        if sensor is None:
            try:
                app.state.sensor = SensorPredictor.load()
                log.info("Loaded sensor model %s", app.state.sensor.version)
            except FileNotFoundError:
                app.state.sensor = None
                log.warning("No sensor model found. Run `python -m app.sensor` to train it from AI4I 2020.")
        yield

    app = FastAPI(title="SIMS failure-risk service", version="1.0.0", lifespan=lifespan)
    # Set up front so the app is usable whether or not the server runs lifespan events.
    app.state.predictor = predictor
    app.state.sensor = sensor

    @app.exception_handler(RequestValidationError)
    async def invalid_input(_request, exc: RequestValidationError):
        # The default handler echoes the rejected value back, which cannot be encoded for inf/NaN and crashes.
        errors = [{"field": ".".join(str(part) for part in e["loc"][1:]), "message": e["msg"]} for e in exc.errors()]
        return JSONResponse(status_code=422, content={"detail": "Invalid input", "errors": errors})

    def require_key(x_api_key: str | None = Header(default=None)) -> None:
        if key and not (x_api_key and hmac.compare_digest(x_api_key, key)):
            raise HTTPException(status_code=401, detail="Missing or invalid API key")

    def loaded() -> Predictor:
        p = app.state.predictor
        if p is None:
            raise HTTPException(status_code=503, detail="Model not loaded. Train it with `python -m app.train`.")
        return p

    @app.get("/health")
    def health():
        p = app.state.predictor
        s = app.state.sensor
        return {
            "status": "ok" if p else "degraded", "modelLoaded": bool(p), "modelVersion": p.version if p else None,
            "sensorModelLoaded": bool(s), "sensorModelVersion": s.version if s else None,
        }

    @app.get("/model", dependencies=[Depends(require_key)])
    def model_info():
        return loaded().metadata

    @app.post("/predict", dependencies=[Depends(require_key)])
    def predict(body: PredictRequest):
        return loaded().predict(body)

    def loaded_sensor() -> SensorPredictor:
        s = app.state.sensor
        if s is None:
            raise HTTPException(status_code=503, detail="Sensor model not loaded. Train it with `python -m app.sensor`.")
        return s

    @app.get("/sensor-model", dependencies=[Depends(require_key)])
    def sensor_model_info():
        return loaded_sensor().metadata

    @app.post("/predict-sensor", dependencies=[Depends(require_key)])
    def predict_sensor(body: SensorRequest):
        return loaded_sensor().predict(body)

    return app


app = create_app()
