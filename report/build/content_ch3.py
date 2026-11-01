from framework import FIG, H1, H2, H3, P, SP, TABLE, UL, ROOT

D = ROOT + r'\assets\diagrams'

chapter3 = [
    # ---- page: functional requirements (1) ----
    [
        H1('Chapter 3: Analysis'),
        H2('3.1 Software Requirement Specifications'),
        P('The requirements were derived from the problem statement and refined module by module. They are grouped below as functional requirements, which describe what the system does, and non-functional requirements, which describe how well it must do it. Every requirement listed here has been implemented and is exercised by at least one automated test or by the running application.'),
        H3('3.1.1 Functional Requirements of the Project'),
        TABLE('Table 3.1: Functional requirements – access, machines and workers', ['ID', 'Requirement', 'Module'], [
            ['FR-01', 'Users sign in with e-mail and password; the server issues a short-lived access token (JWT) and a rotating refresh token kept in an httpOnly cookie.', 'Access'],
            ['FR-02', 'Every API route and socket connection enforces one of three roles (Admin, Manager, Worker); a deactivated account or a token issued before a password reset is refused.', 'Access'],
            ['FR-03', 'Admins create, edit, deactivate users and reset passwords; every create, update and delete is written to an audit log.', 'Access'],
            ['FR-04', 'Failed sign-ins lock an account for 15 minutes after five misses; a single-use, 30-minute link resets a forgotten password.', 'Access'],
            ['FR-05', 'Machines can be added, edited and removed; changing a status records a reason and closes and opens downtime logs automatically.', 'Machines'],
            ['FR-06', 'Telemetry (temperature, vibration, rpm, power) is stored, compared with warning and critical limits and summarised as a 0–100 health score with every deduction listed.', 'Machines'],
            ['FR-07', 'Maintenance work orders (corrective, preventive, inspection) follow a state machine; recurring schedules open preventive orders; an offline machine opens one corrective order.', 'Machines'],
            ['FR-08', 'Reliability figures (failures, MTTR, MTBF, availability) are calculated per machine from the status logs.', 'Machines'],
            ['FR-09', 'Workers and shifts are maintained; workers check in and out for themselves and are marked late after a grace period.', 'Workers'],
            ['FR-10', 'Leave requests are filed by workers and approved or rejected by managers; approved leave is not counted as absence.', 'Workers'],
            ['FR-11', 'Tasks are assigned to workers and moved through to-do, in-progress and done; shift handover notes are shared between shifts.', 'Workers'],
        ], widths=[8, 74, 18], size=9.5),
    ],
    # ---- page: functional requirements (2) + non-functional ----
    [
        TABLE('Table 3.2: Functional requirements – production, inventory, analytics, platform and AI', ['ID', 'Requirement', 'Module'], [
            ['FR-12', 'Production orders move only pending → in progress → completed; starting needs every assigned machine to be available.', 'Production'],
            ['FR-13', 'A bill of materials per product is copied into new orders; starting an order consumes all materials in one all-or-nothing step.', 'Production'],
            ['FR-14', 'Quality checks record inspected, defect and scrap counts; a feasibility check reports shortages before an order is accepted.', 'Production'],
            ['FR-15', 'An order is flagged as a bottleneck when it is overdue or waits on an unavailable machine.', 'Production'],
            ['FR-16', 'Stock movements (in, out, adjust) are atomic and can never take a quantity below zero; every movement is recorded.', 'Inventory'],
            ['FR-17', 'Falling below the reorder level raises one alert per item and drafts a purchase order; a manager approves it and receiving it restocks.', 'Inventory'],
            ['FR-18', 'Suppliers, stock valuation and CSV import and export are provided for inventory data.', 'Inventory'],
            ['FR-19', 'KPI overview, downtime, output, stock, attendance, Pareto, reliability and OEE views are calculated by the backend, with CSV and print export.', 'Analytics'],
            ['FR-20', 'Changes appear on every connected client without reload; notifications are stored per user and unacknowledged critical alerts are escalated.', 'Platform'],
            ['FR-21', 'The ML service scores failure risk with a probability and top factors, flags anomalous telemetry and forecasts stock cover and order finish dates.', 'AI/ML'],
            ['FR-22', 'A manager can ask a question in plain English and receive an answer built from database figures, with its sources shown; weekly summaries and alert explanations use the same grounding rules.', 'AI/ML'],
        ], widths=[8, 74, 18], size=9.5),
        H3('3.1.2 Non-functional Requirements of the Project'),
        TABLE('Table 3.3: Non-functional requirements', ['Attribute', 'Requirement and how it is met'], [
            ['Security', 'Hashed passwords, 15-minute access tokens, route-level role checks, request validation (Zod), input sanitising, rate limiting, security headers, audit log.'],
            ['Performance', 'Common list and dashboard endpoints respond in milliseconds on a development machine; measured values are given in Chapter 6.'],
            ['Reliability', 'The ML service and the language model are optional: if either is down the feature reports it and the rest of the application is unaffected.'],
            ['Data integrity', 'Stock and order changes use guarded atomic updates; duplicate alerts, reorder drafts and work orders are prevented.'],
            ['Usability', 'Responsive layout, light and dark themes, keyboard-accessible dialogs, toasts and a notification centre.'],
            ['Maintainability', 'Route → service → model layering, one folder per module, 438 automated tests.'],
            ['Scalability limit', 'Designed for one factory; no multi-tenant isolation or horizontal scaling of the socket layer.'],
        ], widths=[17, 83], size=9.5),
    ],
    # ---- page: permissions + feasibility ----
    [
        TABLE('Table 3.4: Role-based permissions implemented in the API', ['Resource', 'Admin', 'Manager', 'Worker'], [
            ['Users and audit log', 'Create, edit, deactivate, reset passwords; read audit log', 'Read user list', 'Own sign-in only'],
            ['Machines, telemetry', 'Full, including status change', 'Full, including status change', 'Read'],
            ['Maintenance work orders', 'Full', 'Full', 'Update status and notes of own assigned orders'],
            ['Workers, shifts, leave', 'Full', 'Full, approve leave', 'Own attendance, own leave requests'],
            ['Production orders, BOM', 'Full', 'Full', 'Read orders linked to own tasks; log quality checks for them'],
            ['Inventory, purchasing', 'Full, approve purchase orders', 'Full, approve purchase orders', 'Read inventory'],
            ['Analytics, AI analyst, ML', 'Full', 'Full', 'None'],
            ['Alerts, handover notes', 'Full', 'Full', 'Read alerts; write and close own handover notes'],
        ], widths=[22, 27, 24, 27], size=9.5),
        H2('3.2 Feasibility Study of the Project'),
        H3('3.2.1 Technical Feasibility'),
        P('Every technology needed is mature, documented and runs on an ordinary laptop: Node.js and MongoDB for the application, React for the interface, Socket.io for live updates, and Python with scikit-learn for the ML service. The riskiest parts, real-time propagation and trustworthy AI output, were prototyped early and are covered by tests; both proved feasible.'),
        H3('3.2.2 Economic Feasibility'),
        P('The stack is open source and there are no licence costs. Development used existing laptops, a local MongoDB instance and free tiers of hosting services. Running the language model has a usage cost, which the design limits by caching results, rate-limiting calls and making the feature optional. The report does not claim zero total cost: deployment, hosting and model usage would carry running costs.'),
        H3('3.2.3 Operational Feasibility'),
        P('Users only need a web browser. The interface follows common patterns (tables, a kanban board, forms) and role-based navigation shows each person only the pages they may use. Managers can adopt the AI features gradually because the core screens work without them.'),
        H3('3.2.4 Schedule Feasibility'),
        P('The work was planned as an eleven-week Agile cycle: requirements and design, database and backend, frontend, machine learning, real-time layer, AI integration, then testing and documentation, with a demonstrable increment at the end of each phase. This schedule was adequate for the five core modules plus the AI layer.'),
    ],
    # ---- page: hardware/software + stack ----
    [
        H2('3.3 Hardware and Software Requirements'),
        TABLE('Table 3.5: Development and runtime requirements', ['Item', 'Specification'], [
            ['Processor', 'Intel Core i5 (10th generation) or equivalent, or higher'],
            ['Memory', '8 GB minimum; 16 GB recommended when the ML service runs alongside the application'],
            ['Storage', '256 GB SSD'],
            ['Operating system', 'Windows 11 was used for development; any OS that runs Node.js 22 and Python 3 works'],
            ['Runtime software', 'Node.js 22, MongoDB 8, Python 3.13 with the packages in requirements.txt'],
            ['Client', 'A current browser (Chrome, Edge or Firefox); the app is installable as a progressive web app'],
            ['Network', 'Internet access only for the optional language-model feature and for cloud hosting'],
        ], widths=[22, 78], size=9.5),
        H2('3.4 Tools, Technologies and Platform Used'),
        TABLE('Table 3.6: Technology stack, checked against the source code', ['Layer', 'Technology', 'Purpose in SIMS'], [
            ['Frontend', 'React 19, TypeScript, Vite', 'Component-based single-page application with type-checked code'],
            ['', 'Tailwind CSS 4, Recharts', 'Styling with light and dark themes; all charts (the synopsis also listed Chart.js, which was not needed)'],
            ['', 'TanStack Query, Zustand, React Router', 'Server-state cache, small client stores (session, theme, toasts), role-based routes'],
            ['', 'socket.io-client', 'Live events that refresh cached data'],
            ['Backend', 'Node.js, Express 4', 'REST API with middleware, services and route modules'],
            ['', 'JWT (jsonwebtoken), bcryptjs', 'Access and refresh tokens, password hashing'],
            ['', 'Zod, helmet, express-rate-limit, mongo-sanitize', 'Validation, security headers, rate limits, input sanitising'],
            ['', 'Socket.io, node-cron, pino', 'Real-time channel, scheduled jobs, structured logging'],
            ['Database', 'MongoDB 8, Mongoose 8', 'Document storage for 26 collections with schemas and indexes'],
            ['AI / ML layer', 'Python, FastAPI, scikit-learn', 'Risk, sensor, anomaly and forecasting models served over REST'],
            ['', 'LLM-based intelligence integration', 'Natural-language question answering, summaries and explanations over backend-supplied evidence'],
            ['Tools', 'Git, Postman collection, Swagger UI', 'Version control, API testing (collection generated from the API spec), API documentation'],
            ['', 'node:test, Vitest, pytest', 'Automated testing of server, client and ML service'],
        ], widths=[13, 33, 54], size=9.5),
    ],
    # ---- page: integration + use case ----
    [
        H3('3.4.1 How the Technologies Work Together'),
        P('A user action in the React interface calls the Express API through an Axios client that attaches the access token. The API validates the request, checks the role and calls a service function. The service writes to MongoDB through Mongoose and, only after the write succeeds, emits a Socket.io event; the browser receives the event and tells TanStack Query to refetch the affected data, so every open screen updates without a reload. Scheduled jobs call the same service functions, so a nightly or hourly job triggers the same events as a manual action.'),
        P('For machine learning, the Node service assembles numeric features from the database and sends them to the FastAPI service, which returns a risk band, a probability and the factors that raised it; the result is stored and an alert policy decides whether to notify. For natural-language questions, the backend chooses fixed database queries, runs them, and sends only the retrieved figures to the language model, then verifies the reply before showing it. The same figures are shown beside the answer so the reader can check them.'),
        H2('3.5 Use Case Diagram'),
        FIG(D + r'\fig-3-1-usecase.png', 'Figure 3.1: Use case diagram of the Smart Industrial Management System', width=5.2),
        P('Admins and managers share most use cases; admins additionally manage users and the audit trail. Workers have a deliberately small set: signing in, viewing the dashboard data they may read, checking in and out, updating their own tasks, logging quality checks and handover notes, and receiving alerts.', cls='tight'),
    ],
    # ---- page: DFD 0 + 1 ----
    [
        H2('3.6 Data Flow Diagrams'),
        P('The level 0 diagram shows SIMS as one process exchanging data with four external parties and one data store. Users and the ML and language-model services never touch the database directly; every read and write passes through the application.', cls='tight'),
        FIG(D + r'\fig-3-2-dfd0.png', 'Figure 3.2: DFD Level 0 – context diagram', width=4.9),
        P('Level 1 breaks the system into seven processes and six data stores. Authentication guards the four operational modules, which feed analytics and alerts; the AI insights process only reads data.', cls='tight'),
        FIG(D + r'\fig-3-3-dfd1.png', 'Figure 3.3: DFD Level 1', width=5.4),
    ],
    # ---- page: DFD 2 + IPO ----
    [
        FIG(D + r'\fig-3-4-dfd2.png', 'Figure 3.4: DFD Level 2 – inventory and purchasing (process 5.0)', width=6.2),
        P('Level 2 expands process 5.0. A stock movement is recorded atomically, the reorder level is checked, a low-stock alert is raised once, and a purchase order is drafted. Only a manager can approve it; receiving the approved order posts a stock-in movement and closes the loop.', cls='tight'),
        H2('3.7 Input, Processing and Output Analysis'),
        TABLE('Table 3.7: Input, processing and output of the main modules', ['Module', 'Input', 'Processing', 'Output'], [
            ['Machines', 'Status change with reason; sensor readings', 'Close and open downtime log; compare with limits; compute health score', 'Updated status, alerts, work order, live event'],
            ['Workers', 'Check-in, leave request, task update', 'Late-grace rule, overlap check, role-owned updates', 'Attendance record, heatmap, notifications'],
            ['Production', 'New order, start, output quantity', 'State machine, material consumption, bottleneck check, feasibility', 'Kanban board, progress, projected finish'],
            ['Inventory', 'Stock in, out, adjust; CSV rows', 'Guarded atomic update; threshold check; PO drafting', 'Stock levels, alerts, draft purchase orders, valuation'],
            ['Analytics', 'Date range (7, 14, 30 days)', 'Aggregation pipelines in MongoDB', 'KPI tiles, charts, Pareto, OEE, CSV'],
            ['AI and ML', 'Question and period; numeric features', 'Fixed queries, model scoring, grounding check', 'Answer card with sources; risk band; forecast'],
        ], widths=[12, 25, 33, 30], size=9.5),
    ],
]
