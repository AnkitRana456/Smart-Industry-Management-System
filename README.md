# Smart Industrial Management System (SIMS)

A full-stack factory management app: machines, workforce, production orders, inventory, alerts and analytics, with live updates and two Gemini-powered features.

- **Frontend:** React 19, Vite, TypeScript, Tailwind CSS, React Query, Zustand, Recharts, Socket.io client
- **Backend:** Node.js, Express, MongoDB (Mongoose), Socket.io, Zod, JWT with refresh cookies
- **Risk model (optional):** Python, FastAPI, scikit-learn
- **AI:** Google Gemini (server-side only), used for a machine-condition assessment and an operations analyst

> **What the AI is and is not.** The machine assessment is a *preliminary, language-model-generated condition assessment* from recorded readings. It is not a trained predictive-maintenance classifier and it never reports a failure probability or time to failure. The analyst explains figures that the database has already calculated.

## Quick start

Requirements: Node 20+, MongoDB running locally (or an Atlas URI).

```bash
# 1. API
cd server
cp .env.example .env        # then edit secrets if you like
npm install
npm run seed                # demo data: 6 users, 10 machines, orders, stock, attendance
npm run dev                 # http://localhost:5000

# 2. Web app (second terminal)
cd client
npm install
npm run dev                 # http://localhost:5173
```

Demo logins (password `Password@123` for all): `admin@sims.local`, `manager@sims.local`, `worker@sims.local`.

API docs: <http://localhost:5000/api/docs> (Swagger UI), spec at `/api/openapi.json`, Postman collection in `server/docs/`.

## Turning the AI on

The app runs fully without a key. AI screens show a clear "not configured" message until you add one.

1. Create a key in Google AI Studio and put it in `server/.env` as `GEMINI_API_KEY`.
2. Run `npm run ai:models` in `server/` to list the model IDs your key can use.
3. Set `GEMINI_MODEL` to one of them and restart the API.

The model name is deliberately not defaulted, so it never silently points at a retired model. "Listed" does not mean "usable": on the key used for development, `gemini-2.5-flash` was listed but returned "no longer available to new users", and two others hung. Make one real call before choosing (the eval below does).

**Free-tier limits matter.** On the free tier each model has its own daily request quota (20 per day for the model first tried, which ran out during evaluation) plus a per-minute limit (5). The analyst makes two Gemini calls per question, so a free key supports only a handful of questions a day. Set `GEMINI_MAX_RPM` to your plan's per-minute limit and calls queue instead of failing; when a quota is hit the API answers 429 with a `Retry-After` header and a message such as "try again in about 21 hours". Enable billing, or rotate models, for anything beyond a demo.

Thinking is switched off by default (`GEMINI_THINKING_BUDGET=0`). With thinking models the hidden reasoning tokens count against the output limit and truncated replies mid-sentence until this was set; a reply that is still cut off is retried with twice the room.

## Roles

| Role | Can do |
|---|---|
| Admin | Everything, including users, audit log and the demo simulator |
| Manager | Machines, inventory, workers, production, alerts, analytics, AI. Reads the user list |
| Worker | "My day": check in/out, own tasks and attendance. Reads machines, stock and orders linked to their tasks |

Permissions are enforced on the server for every route, not just hidden in the UI.

## What is where

```
server/
  src/modules/        auth, users, machines, inventory, workers, attendance, tasks,
                      production, alerts, analytics, ai, simulator
  src/sockets/        authenticated Socket.io, rooms, emit helper
  src/middleware/     auth + RBAC, validation, rate limits, audit, error handler
  src/docs/openapi.js API description (drives Swagger UI and Postman)
  tests/              node:test suites (run against throwaway databases)
  evals/              AI evaluation datasets, fixture, oracle and runner
client/
  src/pages/          Dashboard, Machines, Workers (My day for workers), Production,
                      Inventory, Analytics, AI Analyst, Alerts, Users
render.yaml           Render blueprint (API + static site)
```

Layering is route, then service, then model. Services emit Socket.io events right after a successful database write, so REST calls, the seed script and the simulator all produce live updates.

## Key behaviours worth knowing

- **Downtime:** changing a machine's status closes the previous log with its duration, opens a new one, raises or resolves alerts, re-checks production bottlenecks and emits `machine:statusChanged`.
- **Stock:** stock-outs use an atomic conditional update, so concurrent requests can never push stock below zero. Falling under a threshold raises one alert; restocking resolves it.
- **Orders:** `pending -> in_progress -> completed` only. Starting needs every assigned machine available. An in-progress order is a bottleneck if it is overdue or waits on a machine that is offline or in maintenance.
- **Materials:** an order can list the inventory it uses per unit. Starting it takes quantity x per-unit of every material in one all-or-nothing step. Each decrement is a guarded atomic update, so orders racing for limited stock can never overdraw it; if anything is short, nothing is taken, the order stays pending and the message names the shortage. Fractions round up. Transactions and low-stock alerts are recorded only after everything was secured.
- **Maintenance (CMMS):** work orders (corrective, preventive, inspection) move `open -> in_progress -> done` (or cancelled) and workers only see and move their own. A machine going offline opens one corrective order automatically (never a second while it is open). Recurring schedules open a preventive order three days before each job is due (daily job plus a "Check now" button); completing it sets the machine's last-service date and rolls the schedule and `nextServiceDue` forward.
- **Reliability:** `GET /api/analytics/reliability` reports failures, MTTR, MTBF and availability per machine. A failure is a trip to offline; planned maintenance is downtime but not a failure.
- **Handover:** shift notes for the next shift (important ones first), closed by their author or a manager.
- **Analyst:** two more allow-listed tools, `getMaintenanceWorkOrders` and `getReliability`. They are covered by unit tests but are not in the live eval question set, so their answer quality has not been measured.
- **Telemetry:** `POST /api/telemetry` (and the simulator) store readings (temperature, vibration, RPM, power; auto-expire after 7 days), update the machine, raise or clear one threshold alert per metric, and refresh a 0-100 health score whose every deduction is listed. Limits are plant-wide constants in `telemetry.service.js`.
- **Purchasing:** suppliers, and purchase orders `draft -> approved -> received`. Falling under a reorder level drafts one order per supplier automatically; only a person approves, and receiving posts the stock-in (a second click adds nothing). Inventory also has unit cost, stock valuation, CSV export and CSV import (rows fail independently).
- **Leave and notifications:** workers request leave, managers approve or reject, and approved leave shows as leave rather than absence in the attendance heatmap. Notifications are stored per user (bell survives reload and sign-out) and pushed live; critical alerts nobody acknowledges for 30 minutes are escalated once to admins.
- **Account safety:** five wrong passwords lock an account for 15 minutes; forgot/reset password uses a single-use, 30-minute token (only its hash is stored) and ends existing sessions.
- **BOM, quality, feasibility:** a bill of materials per product is copied into new orders; quality checks (inspected, defects, scrap) feed the quality figure; "Can we take this order?" is deterministic arithmetic over stock, machine status and today's attendance.
- **Analytics extras:** downtime Pareto and OEE. OEE shows availability and quality only; performance needs output per machine, which is not recorded, so no combined figure is invented.
- **AI:** "Explain" on an alert builds the facts around it (machine, limits, recent status changes, open work orders, purchase order) and has the model explain them, rejecting invented numbers and predictions. Unit-tested with a scripted provider; not part of the live eval.
- **Sensor model (second opinion):** `POST /api/machines/:id/sensor-risk` scores the newest telemetry (rpm, torque derived from power, tool wear) with a model trained on the public AI4I 2020 dataset: held-out ROC-AUC 0.947 against 0.662 for tool wear alone, and Brier 0.019 against 0.033 for always guessing the base rate. AI4I is itself synthetic and omits temperature here on purpose, so this measures the dataset, not this plant. It is computed on demand, stored nowhere and raises no alerts. Train it with `python -m app.sensor` (downloads the dataset into `ml-service/data/`).
- **Time:** all day, week and month boundaries use the factory timezone (`FACTORY_TIMEZONE`, default Asia/Kolkata). Weeks run Monday to Sunday.

## The two AI features

**Machine risk assessment** (`POST /api/machines/:id/assess-risk`)

- Readings come from MongoDB. Anything in the request body about readings is ignored.
- Evidence the model cites is replaced with the database's values; invented fields are dropped.
- Replies that give a probability, percentage chance or time to failure are rejected. One retry, then a 502 and nothing is saved.
- Fewer than two usable readings gives `INSUFFICIENT_DATA` without calling the model.
- Repeats within 15 minutes with unchanged data return the saved assessment; simultaneous identical requests share one call.
- Alert policy: HIGH raises one critical alert per machine (reused if unresolved); LOW resolves it; MEDIUM leaves alerts alone.

**AI Analyst** (`POST /api/ai/ask`, `GET /api/ai/weekly-summary`)

- The model picks from six fixed, allow-listed tools. It never writes queries, and tool filters are matched literally.
- Every figure shown comes from the database. The model's prose is checked: a number that is not in the evidence causes a retry, then a figures-only answer with a note.
- Stored text (names, reasons, summaries) is cleaned and labelled as data before it reaches the model. Attendance is identified by employee ID only.
- Unclear questions get a clarification, unrelated ones a refusal, and empty periods an explicit "no data" reply.
- The period is a preset (today, this week, last month, ...) or a date-picker range (`startDate`/`endDate`, factory timezone, up to 92 days).
- The weekly summary is also regenerated every Monday 07:00 factory time when AI is configured (`SCHEDULER_ENABLED=false` turns the scheduler off). A provider outage in that job is logged and never crashes the API.

## The trained risk model (optional)

A separate Python service (`ml-service/`, FastAPI and scikit-learn) scores each machine from six recorded values: run hours, days since service, downtime events in 30 days, tool wear, temperature and vibration. It sits next to the Gemini assessment and never replaces it. The two are shown separately: the **AI risk** column is Gemini, the **Model** column is the trained model.

**What it is, honestly.** It is trained on **synthetic data** from a documented, seeded generator, because there are no real failure records for this plant. Its probabilities are calibrated inside that synthetic world only. Held-out metrics measure agreement with the generator (ROC-AUC 0.80 against a best-possible 0.80, which means it recovered the rules); they are not real-world accuracy, and the app says so wherever a score is shown. The model type (logistic regression vs a calibrated random forest) is chosen by cross-validation on the training split. Inputs outside the training range are flagged as extrapolation.

```bash
cd ml-service && python -m venv .venv && .venv/Scripts/python -m pip install -r requirements-dev.txt
.venv/Scripts/python -m app.train                                      # trains and prints held-out metrics
.venv/Scripts/python -m uvicorn app.main:app --port 8000
```

Set `ML_SERVICE_URL=http://localhost:8000` in `server/.env` (leave it empty to switch the feature off; optionally set `ML_API_KEY` on both sides). Behaviour:

- `POST /api/machines/:id/ml-predict` scores one machine; inputs come from the database. A machine with a missing input is reported as not scoreable rather than guessed.
- Every machine is re-scored hourly, and `POST /api/ml/rescore` does it on demand. The job stops at the first outage.
- A High band raises one warning alert per machine (reused while unresolved); Low resolves it.
- If the service is down, slow, or returns something unexpected, the API answers 503 or 502 with a safe message, saves nothing, and every other feature keeps working.

See `ml-service/README.md` for the model, its API and its limitations.

## Testing

```bash
cd server
npm test              # 179 tests; needs local MongoDB, no Gemini key or Python service
npm run eval:mock     # AI evaluation harness against a scripted stand-in
npm run eval:live     # same datasets against real Gemini (needs the key)

cd ../client && npm test                             # 107 UI tests (Vitest, Testing Library)
cd ../ml-service && .venv/Scripts/python -m pytest   # 27 tests for the trained model service
```

`.github/workflows/ci.yml` runs all three suites, the mock evaluation, the linter and the production build on every push.

Tests use a scripted fake provider, so every AI failure path (invalid JSON, timeouts, rate limits, forbidden claims, ungrounded numbers, duplicate requests) is covered without spending tokens.

**Evaluation set** (`server/evals/`): 42 analyst questions with expected figures computed by an independent oracle that queries the raw collections, plus 6 fixed assessment scenarios (normal, elevated, severe, missing, stale, contradictory) run 3 times each. Reports are written to `server/evals/reports/`.

Report these honestly: they measure schema validity, agreement with expert-defined acceptable levels, run-to-run consistency, numeric correctness against the database and refusal behaviour. They are **not** accuracy, recall or F1 for a trained model, and should not be presented as such. Mock-mode results only prove the harness works.

### Live results (29 Oct 2026, `gemini-3.1-flash-lite`, free tier, thinking off)

**Machine assessment**, 6 scenarios x 3 repeats: 18/18 returned valid, schema-conforming output; 15/18 landed in the acceptable set; all 6 scenarios gave the same level on every repeat. Normal, severe, missing, stale and contradictory data were all handled as expected (stale and contradictory data correctly came back `INSUFFICIENT_DATA`). The one disagreement: the "elevated wear and vibration" scenario (tool wear 190 min, vibration 3.8 mm/s) was rated LOW three times where we expected MEDIUM or HIGH. The model has no reference ranges for the machine, so it cannot know 3.8 mm/s is high; so prompt `maintenance-v2` adds a fleet block (the machine's percentile among other machines of its type, else the whole plant; needs 3+ peers). Full re-run on `maintenance-v2`: 14/18 calls returned a result and all 14 were in the acceptable set; the other 4 were 503 timeouts/unavailable from the free tier (not wrong answers). Elevated is now MEDIUM (2/2 answered), and every scenario was consistent across the repeats that answered. The elevated scenario is the one the change was tuned on, so treat that gain as indicative. These figures describe agreement with expert-defined expectations and consistency, not predictive accuracy.

**Analyst**, 42 questions: 3 timed out at the provider (25 s limit); of the 39 answered, tool choice was correct 29/29, key figures matched the independent oracle 28/29, behaviour (answer, clarify, refuse, no data) was right 38/39, and no response contained forbidden text. Two real defects were found and fixed: a filter of "gear units" silently produced "0 units" (now reported as "no product matches" with the known products), and "how many items do we track?" was wrongly sent for clarification.

**Not measured:** latency in the report includes time queued behind the rate limit, so it is not model speed (typical single-call time was about 2 to 5 seconds); `gemini-3.5-flash` could not be evaluated after its daily quota ran out.

## Live demo

1. Sign in as admin. On the dashboard click **Start live** (or **Step**). Machines flip status, downtime logs are written, alerts and toasts appear, the bell fills up and charts move.
2. Open **Machines**, pick one, open its AI assessment, run it, and show the saved history and the alert if it rates HIGH.
3. Open **AI Analyst** and ask: *Which machine had the most downtime?*, *Which items are below their reorder level?*, *Which machines are rated high risk?* Then generate the weekly summary.
4. Show **Analytics** CSV export and the **Users** audit log.
5. Sign in as a worker on a phone-sized window: check in, update a task.

## Deployment (Render + MongoDB Atlas)

1. Create an Atlas cluster, a dedicated database user, and allow Render's outbound IPs (or `0.0.0.0/0` for a student project).
2. Push the repo and create a Render Blueprint from `render.yaml`.
3. Set `MONGO_URI`, `CLIENT_URL` (the static site URL), `GEMINI_API_KEY`, `GEMINI_MODEL` on the API; set `VITE_API_URL` (the API URL) on the static site.
4. The API refuses to start in production with default or short JWT secrets. The simulator is off in production unless `ALLOW_SIMULATOR=true`.
5. Free instances sleep: open both URLs a minute before a demo. To load demo data into Atlas, run the seed from your machine with `MONGO_URI` set and `SEED_CONFIRM=yes` (PowerShell: `$env:SEED_CONFIRM='yes'`). The seed **deletes** machines, workers, orders, stock, alerts and users, so it refuses to run against any non-local database, or in production, without that confirmation.

Environment variables: `MONGO_URI`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `CLIENT_URL` (comma-separated for several origins), `FACTORY_TIMEZONE`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_TIMEOUT_MS`, `AI_RATE_LIMIT_PER_MIN`, `ALLOW_SIMULATOR`, `SCHEDULER_ENABLED`. Real values are never committed; `.env` is git-ignored.

## Security notes

Account changes apply at once: the role and active flag are read from the database (cached for at most 30 seconds, and cleared immediately when an admin changes the account), so deactivating or demoting someone cuts off their existing token and closes their live sockets, and a password reset ends sessions started before it. If you run several API instances, a change can take up to 30 seconds to reach the others. Helmet, CORS allow-list, rate limits (stricter on `/auth` and `/ai`), request sanitising, Zod validation on every route, bcrypt hashing, 15-minute access tokens with rotating httpOnly refresh cookies, role checks on every route and socket room, an audit log that stores field names but never values, and logs that redact credentials. The Gemini key never reaches the browser.

## Known limitations

- Email: there is no SMTP client yet. Password-reset links are written to the server log (never in production), so reset works end to end only in development until a mail transport is added in `utils/mailer.js`.
- The v2 roadmap asks for a TypeScript backend and shared schema package; the backend is JavaScript with Zod validation, and that rewrite was not done.
- Not built from the v2 roadmap: anomaly detection, Docker Compose, QR codes, command palette, i18n, Gantt view, saved AI chat history, PDF reports (browser print to PDF exists), shift swaps, overtime tracking.

- Gemini results below come from one run per scenario set on a free-tier key and one model, so they show the pipeline works and where it is weak, not a statistically meaningful score. After the first run I fixed the failures it exposed (analyst prompt, unmatched product filters), so the numbers for those fixes are not an independent test; rerun `npm run eval:live` for a clean result.
- The trained risk model learns from synthetic data only. Treat its probabilities as a demonstration of the pipeline, not as validated predictions, until it is retrained on real failure records. A linear model also responds weakly to extreme temperatures; the extrapolation warning exists for that.
- Materials are consumed when an order starts. Deleting an order does not return materials it already used, and quantity and materials are locked once an order has started.
- The simulator generates plausible activity; it is not real sensor data.
- Custom date ranges use the factory timezone only.

## Suggested wording for the report or synopsis

"The system includes a Gemini-powered machine-condition risk assessment, a preliminary language-model assessment of recorded operating readings that classifies a machine as low, medium, high or insufficient data and cites the evidence it used. It is not a trained predictive-maintenance model and does not estimate failure probability or time to failure. A second feature, an AI Industrial Analyst, answers operational questions from figures calculated by the database and explains them in plain language."
