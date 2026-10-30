# SIMS failure-risk service

A small FastAPI service that scores machines with a trained model. It is **optional**: SIMS works fully without it, and the AI/Gemini features are separate.

## What it is, honestly

- It estimates the chance of a failure in the next 30 days from six values SIMS already records: run hours, days since last service, downtime events in the last 30 days, tool wear, temperature and vibration.
- It is trained on **synthetic data** from a documented, seeded generator (`app/data.py`), because this project has no real failure records. Its probabilities are calibrated inside that synthetic world only.
- Held-out metrics measure agreement with the generator. They are not real-world accuracy. Training prints the generator's own best-possible score next to the model's, so it is obvious when a model has simply recovered the rules.
- The model type is chosen by 5-fold cross-validation on the training split. The held-out set is used once, to report.
- It is an extra signal. It does not replace inspection, manufacturer guidance, or the Gemini assessment, and should never be the sole basis for a safety-critical decision.

## Run it (Windows PowerShell or Git Bash)

```bash
cd ml-service
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements-dev.txt   # macOS/Linux: .venv/bin/python
.venv/Scripts/python -m app.train                              # about 15 seconds
.venv/Scripts/python -m uvicorn app.main:app --port 8000
.venv/Scripts/python -m pytest                                 # 27 tests
```

Then set `ML_SERVICE_URL=http://localhost:8000` in `server/.env`. Leave it empty to switch the feature off.

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Liveness and whether a model is loaded (no key needed) |
| GET | `/model` | Version, algorithm, selection scores, held-out metrics, calibration table, bands, limitations |
| POST | `/predict` | `{ runHours, daysSinceService, downtimeCount30d, toolWearMin, temperatureC, vibrationMms }` returns `{ risk, probability, topFactors, warnings, modelVersion, dataSource }` |

- `risk` is `Low` (below 10%), `Medium` (10% to 30%) or `High` (30% and above). Training reports the failure rate actually observed inside each band.
- `topFactors` shows which inputs push the score up or down compared with a typical machine.
- `warnings` flags any input outside the range the model was trained on, since the estimate is then an extrapolation.
- Impossible values (negative wear, `Infinity`, unknown fields) get a 422 that names the field and never echoes the value.
- Set `ML_API_KEY` to require an `X-API-Key` header on everything except `/health`.

## Files

```
app/data.py       synthetic generator (seeded, documented)
app/train.py      candidate comparison, calibration check, evaluation, saves artifacts/
app/predictor.py  loads the model, scores, explains, flags extrapolation
app/main.py       FastAPI app
tests/            pytest: generator, training honesty, predictor, HTTP behaviour
```

`artifacts/` is git-ignored and rebuilt by `python -m app.train` (the Render build does this).
