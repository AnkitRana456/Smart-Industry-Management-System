from framework import FIG, FIGTEXT, H1, H2, H3, P, SP, TABLE, UL, OL, ROOT

D = ROOT + r'\assets\diagrams'

chapter4 = [
    # ---- p: architecture ----
    [
        H1('Chapter 4: Design and Architecture'),
        H2('4.1 Overall System Architecture'),
        P('SIMS follows a four-tier design. The **client tier** is a React single-page application. The **application tier** is a Node.js and Express server that owns validation, authorisation, business rules and the real-time channel. The **data tier** is MongoDB, accessed only through Mongoose models. The **AI and ML tier** consists of a separate Python FastAPI service for the learned models and an external language-model service that is reached only by the intelligence layer of the application tier.'),
        FIG(D + r'\fig-4-1-architecture.png', 'Figure 4.1: Overall system architecture', width=7.1),
        H3('Request lifecycle'),
        OL([
            'The browser sends a REST request with the access token; security middleware applies headers, CORS, rate limits and input sanitising.',
            'The authentication middleware verifies the token and reads the user’s current role and active flag, so a role change or deactivation takes effect within seconds.',
            'The route validates the body with a Zod schema and checks the role; the handler calls a service function.',
            'The service reads and writes MongoDB, then emits Socket.io events and, where needed, calls the ML service or the intelligence layer.',
            'The reply uses one envelope, `{ success, data, message, errors }`, so the client handles every response the same way.',
        ]),
        H3('Design principles'),
        UL([
            '**Services own side effects.** Events, alerts and notifications are produced by services after a successful write, never by route handlers, so REST calls, scheduled jobs and the simulator all behave identically.',
            '**AI is optional and bounded.** The ML service and the language model sit behind timeouts and fall back to a clear message; neither can write to the database on its own.',
        ]),
    ],
    # ---- p: structure chart + WBS + modules ----
    [
        H2('4.2 Structure Chart and Work Breakdown Structure'),
        P('The structure chart decomposes the system into seven functional areas, each with three main functions. The work breakdown structure shows how the project effort was divided into six work packages.', cls='tight'),
        FIG(D + r'\fig-4-2-structure.png', 'Figure 4.2: Structure chart', width=7.1),
        FIG(D + r'\fig-4-3-wbs.png', 'Figure 4.3: Work breakdown structure', width=7.1),
        H2('4.3 Explanation of Modules'),
        TABLE('Table 4.1: Major modules, their responsibilities and main endpoints', ['Module', 'Responsibility', 'Main endpoints'], [
            ['Access', 'Sign-in, token refresh, lockout, password reset, user administration, audit log', '/auth, /users, /audit-logs'],
            ['Machines', 'Registry, status and downtime logs, telemetry, health score, work orders, schedules', '/machines, /telemetry, /maintenance'],
            ['Workers', 'Roster, shifts, attendance, leave, tasks, handover notes', '/workers, /attendance, /leave, /tasks, /handover'],
            ['Production', 'Orders, state machine, output, BOM, quality checks, feasibility', '/orders, /bom, /quality-checks, /production'],
            ['Inventory', 'Items, atomic transactions, valuation, import, suppliers, purchase orders', '/inventory, /suppliers, /purchase-orders'],
            ['Analytics and alerts', 'KPI aggregation, charts, alerts, notifications, escalation', '/analytics, /alerts, /notifications'],
            ['AI and ML', 'Risk and sensor models, anomaly, forecasts, analyst, summaries', '/ml, /insights, /ai, /machines/:id/…'],
        ], widths=[17, 53, 30], size=9.5),
    ],
    # ---- p: frontend/backend + class ----
    [
        H2('4.4 Frontend Architecture'),
        P('The client is organised by function: `pages` (one per route, loaded on demand so the chart library is downloaded only when a chart page opens), `components` (shared interface pieces such as the application shell, dialogs, charts and the notification bell), `hooks` (the live-update hook), `store` (Zustand stores for the session, theme and toasts) and `lib` (the API client with silent token refresh, CSV helpers and shared types). Server data is cached by TanStack Query; the live-update hook listens to Socket.io events and invalidates the matching cache keys, which is how a change on one machine reaches every open screen. Navigation is built from the signed-in role, and routes meant for staff redirect workers to their own page.'),
        H2('4.5 Backend Architecture'),
        P('The server is arranged as `routes → services → models` inside one folder per module. Routes only validate, authorise and delegate; services hold the business rules and are the only code that emits events; models define schemas and indexes. Cross-cutting concerns live in middleware: authentication with a short cache of each user’s role, role guards, validation, rate limiting, audit logging and one error handler that turns every failure into the common response envelope. Four scheduled jobs run inside the process: hourly risk scoring, a daily check that opens preventive work orders, a ten-minute escalation of unacknowledged critical alerts, and a weekly summary.'),
        H2('4.6 Class Diagram'),
        FIGTEXT(D + r'\fig-4-6-class.png', 'Figure 4.4: Class diagram of the main domain entities', [
            P('JavaScript has no class declarations here, so the diagram models each Mongoose schema as a class and each service function that changes it as an operation.', cls='tight'),
            P('**Machine** is the centre: it owns its status history (MachineLog) and its work orders, is assigned to production orders, and raises alerts. **ProductionOrder** consumes **InventoryItem** quantities when it starts. **InventoryItem** raises a low-stock alert and, through reorder drafting, appears on **PurchaseOrder** lines.', cls='tight'),
            P('**User** owns the login; a **Worker** profile is linked to a user only for the Worker role. Cardinalities follow the references stored in the schemas.', cls='tight'),
        ], width=3.5),
    ],
    # ---- p: activity + sequence ----
    [
        H2('4.7 Flow Chart and Activity Diagram'),
        P('The swim-lane diagram follows one of the most important actions in the system: changing a machine’s status. Errors are caught before any write; once the change is accepted, the service closes the old downtime log, opens a new one and emits one event that every client receives.', cls='tight'),
        FIG(D + r'\fig-4-4-activity.png', 'Figure 4.5: Activity diagram – changing a machine status', width=4.7),
        H2('4.8 Real-Time Communication Architecture'),
        P('Clients connect over WebSocket with the access token in the handshake, which is validated with the same rules as the REST API. Each connection joins rooms by role (`room:all`, `room:staff`), by user (`user:<id>`, used for personal notifications) and optionally by machine (`machine:<id>`).', cls='tight'),
        FIG(D + r'\fig-4-8-sequence.png', 'Figure 4.6: Sequence of a live status update from a manager to a worker’s screen', width=6.4),
    ],
    # ---- p: database ----
    [
        H2('4.9 Database Design'),
        P('MongoDB stores 26 collections. References between documents use ObjectIds and are populated by Mongoose when a view needs them; counters that must stay correct under concurrency, such as stock quantity, are updated with atomic operators rather than read-modify-write. Indexes support the common queries: machine status, machine log by machine and time, unique worker-and-date for attendance, order status and due date, alert status and time, and notification by user.', cls='tight'),
        FIG(D + r'\fig-4-5-er.png', 'Figure 4.7: Entity relationship diagram (main collections and their key fields)', width=6.7),
        TABLE('Table 4.2: The 26 collections grouped by area', ['Area', 'Collections'], [
            ['Access', 'User, AuditLog'],
            ['Machines and maintenance', 'Machine, MachineLog, SensorReading (expires after 7 days), WorkOrder, MaintenanceSchedule, HandoverNote'],
            ['Workforce', 'Worker, Shift, Attendance, Task, LeaveRequest'],
            ['Production', 'ProductionOrder, OutputLog, BOM, QualityCheck'],
            ['Inventory and purchasing', 'InventoryItem, StockTransaction, Supplier, PurchaseOrder'],
            ['Alerts and AI', 'Alert, Notification, MachineAssessment, MlPrediction, AiReport'],
        ], widths=[24, 76], size=9.5),
    ],
    # ---- p: AI/ML ----
    [
        H2('4.10 AI/ML Architecture'),
        P('The intelligence of SIMS has two paths that share the same database but are otherwise independent: an LLM-based path for natural-language insight and a machine-learning path for numeric prediction.', cls='tight'),
        FIG(D + r'\fig-4-7-ai.png', 'Figure 4.8: AI/ML workflow – query path and machine-learning path', width=5.2),
        H3('LLM-based intelligence layer'),
        OL([
            'The manager types a question and chooses a period; the request is validated, role-checked and rate-limited.',
            'A query planner chooses up to three tools from a fixed allow-list (machine status, downtime, production, inventory, attendance, saved assessments, work orders, reliability, stock and order forecasts). It cannot name a collection or write a query.',
            'Each tool runs a fixed database query and returns bounded, already-calculated key figures.',
            'Only those figures are sent to the language model, which writes a short answer. Text from the database is treated as data, never as instructions.',
            'Every number in the answer must appear in the evidence. If not, the call is retried once, and then only the figures are shown.',
        ]),
        H3('Machine-learning service'),
        UL([
            '**Risk model:** logistic regression chosen by cross-validation over a calibrated random forest; six inputs (run hours, days since service, downtime events, tool wear, temperature, vibration); trained on synthetic data and labelled as such everywhere it is shown.',
            '**Sensor model:** gradient boosting trained on the public AI4I 2020 dataset using rpm, torque (derived from power) and tool wear.',
            '**Anomaly and forecast:** an Isolation Forest with a robust z-score learns each machine’s own recent telemetry; a trend model forecasts daily stock use and order output with an early and a late estimate.',
        ]),
    ],
]
