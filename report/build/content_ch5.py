from framework import FIG, FIGTEXT, H1, H2, H3, P, SP, TABLE, UL, OL, ROOT

S = ROOT + r'\assets\shots'
C = ROOT + r'\assets\code'

chapter5 = [
    # ---- p: overview + auth ----
    [
        H1('Chapter 5: Implementation'),
        H2('5.1 Implementation Overview'),
        P('SIMS is implemented as three programs that run side by side: the **API server** (Node.js with Express, Mongoose and Socket.io, default port 5000), the **web client** (React with TypeScript, built with Vite) and the **ML service** (Python with FastAPI). They are started independently; the client talks to the API through a development proxy or a configured API address, and the API talks to the ML service over HTTP with a timeout. The seed script fills a development database with ten machines, four workers, eight inventory items and a few orders so that every screen has data on first run, and refuses to run against a non-local database unless explicitly confirmed.'),
        P('The server code is split into one folder per module (access, machines, workers, attendance, production, inventory, alerts, analytics, maintenance, purchasing, telemetry, leave, notifications, planning, insights, simulator, AI and ML). A simulator, available to administrators, advances machine status, readings and order output on a timer through the same service functions used by real requests; it was used to generate the data seen in the screenshots in this chapter.'),
        H2('5.2 Authentication and Role-Based Access'),
        P('Sign-in verifies the password hash with bcrypt and returns a 15-minute access token (JWT) in the response body and a seven-day refresh token in an httpOnly cookie; the refresh token is rotated on every use and only its hash is stored. On every request the middleware verifies the token and then looks up the user’s current role and active flag (cached for a few seconds), so deactivating an account or changing a role takes effect immediately and a token issued before a password reset is refused. The `authorize` guard is added to each route that is restricted, and the same check runs when a Socket.io connection is made.'),
        FIG(C + r'\code-auth.png', 'Figure 5.1: JWT authentication middleware and role guard (server/src/middleware/auth.js)', width=4.1, kind='fig'),
        P('Workers receive further, data-level restrictions inside the services: for example a worker can list only the work orders and orders connected to their own tasks, and can change only the status of tasks assigned to them. These rules are covered by tests that sign in as each role and assert the status code for each protected route.', cls='tight'),
    ],
    # ---- p: login + dashboard ----
    [
        H2('5.3 Screenshots of the Application'),
        P('All screenshots were taken from the running application against a database filled by the seed script and the simulator; none are mock-ups.', cls='tight'),
        H3('5.3.1 Sign-in and dashboard'),
        FIG(S + r'\01-login.jpg', 'Figure 5.2: Sign-in page (demo accounts are pre-filled only in development builds)', width=4.7, kind='shot'),
        FIG(S + r'\02-dashboard-light.jpg', 'Figure 5.3: Manager dashboard – KPI tiles, live machine floor and open alerts', width=6.2, kind='shot'),
        P('The dashboard shows six KPI tiles, the status of every machine as colour-coded tiles, and the open alerts. The colour of the first tile depends on how many machines are running. Everything refreshes from live events; a dark theme is also available from the toggle in the top bar.', cls='tight'),
    ],
    # ---- p: machines ----
    [
        H3('5.3.2 Machine monitoring'),
        FIG(S + r'\04-machines.jpg', 'Figure 5.4: Machines – status, AI risk, ML model band, health score and next service; detail panel with anomaly check', width=4.0, kind='shot'),
        FIGTEXT(S + r'\05-machine-risk.jpg', 'Figure 5.5: Risk panel of a machine', [
            P('The panel under the sensor chart shows two independent signals. The **statistical risk model** reports a band (here Medium, 20%) with the factors that raised or lowered it, and warns when an input lies outside the range the model was trained on. The **sensor model** gives a second opinion from rpm, torque and tool wear and states that it is trained on a public dataset.', cls='tight'),
            P('Both are labelled as estimates; neither raises an alert on its own authority beyond the stated policy: a High band raises one warning, and a Low band clears it.', cls='tight'),
        ], width=2.15),
    ],
    # ---- p: workers + production ----
    [
        H3('5.3.3 Worker management'),
        FIG(S + r'\07-attendance.jpg', 'Figure 5.6: Workers – 30-day attendance heatmap and the day’s attendance table', width=4.7, kind='shot'),
        P('Each square is one worker on one day: green for present, orange for late, red for absent, purple for approved leave and grey for a day nobody checked in (the plant was closed). Closed days are therefore not counted against anyone.', cls='tight'),
        H3('5.3.4 Production tracking'),
        FIG(S + r'\08-production.jpg', 'Figure 5.7: Production – kanban board with a bottleneck flag and projected finish for each order', width=4.7, kind='shot'),
    ],
    # ---- p: inventory + order form ----
    [
        H3('5.3.5 Inventory control and order feasibility'),
        FIG(S + r'\10-inventory.jpg', 'Figure 5.8: Inventory – stock bars against reorder levels, days of cover forecast and CSV tools', width=5.5, kind='shot'),
        FIGTEXT(S + r'\09-order-form.jpg', 'Figure 5.9: New production order with the feasibility check', [
            P('Creating an order shows a deterministic check, “Can we take this order?”, that compares the bill of materials with stock, the chosen machines with their status, and the day’s attendance. In this capture it reports that no worker has checked in yet and lists the materials needed against what is on hand.', cls='tight'),
            P('The check does not promise a delivery date because production rates are not modelled; the screen says so.', cls='tight'),
        ], width=3.1),
    ],
    # ---- p: code (status, socket) ----
    [
        H2('5.4 Source Code of Some Modules'),
        P('The excerpts below are taken from the project source; line numbers are those of the source files, and the token signing key is shown as a placeholder.', cls='tight'),
        H3('5.4.1 Machine status change and real-time events'),
        P('`changeStatus` is the heart of machine monitoring. It refuses a change to the same status, closes the open downtime log with its duration, opens a new one, saves the machine and then emits the event to all clients and to the machine’s own room. Going offline raises a critical alert and opens a corrective work order; coming back resolves the alert.', cls='tight'),
        FIG(C + r'\code-status.png', 'Figure 5.10: Machine status service (server/src/modules/machines/machine.service.js)', width=5.7),
        H3('5.4.2 Socket.io handshake and rooms'),
        FIG(C + r'\code-socket.png', 'Figure 5.11: Authenticated socket connection, rooms and the emit helper (server/src/sockets/index.js)', width=5.7),
    ],
    # ---- p: code (stock, order, ml) ----
    [
        H3('5.4.3 Atomic stock transaction'),
        P('The quantity guard is part of the update filter, so two simultaneous stock-outs cannot both succeed when only one is covered by the stock.', cls='tight'),
        FIG(C + r'\code-stock.png', 'Figure 5.12: Guarded stock update (server/src/modules/inventory/inventory.service.js)', width=5.7),
        H3('5.4.4 Production order state machine'),
        FIG(C + r'\code-order.png', 'Figure 5.13: Allowed order transitions and the start-order checks (server/src/modules/production/order.service.js)', width=5.7),
        H3('5.4.5 Machine-learning integration'),
        FIG(C + r'\code-ml.png', 'Figure 5.14: Building features and scoring through the ML service (server/src/modules/ml/ml.service.js)', width=5.7),
    ],
    # ---- p: AI grounding + live ----
    [
        H3('5.4.6 Grounding check for AI answers'),
        P('The language model is never trusted with figures. After it writes an answer, every number in the text is compared with the numbers present in the evidence that was supplied; a mismatch triggers a retry and then a fallback to the plain figures.', cls='tight'),
        FIG(C + r'\code-grounding.png', 'Figure 5.15: Detecting numbers that are not in the evidence (server/src/modules/ai/analyst.service.js)', width=5.7),
        H3('5.4.7 Client live updates'),
        FIG(C + r'\code-live.png', 'Figure 5.16: Socket events that refresh the client cache (client/src/hooks/useLiveUpdates.ts)', width=5.7),
        H2('5.5 AI/ML Integration Summary'),
        TABLE('Table 5.1: AI and ML features, where they appear and what they use', ['Feature', 'Where it appears', 'Data used'], [
            ['Failure-risk band and probability', 'Machines page; Medium and High raise or clear one alert', 'Run hours, days since service, downtime count, tool wear, temperature, vibration'],
            ['Sensor-model second opinion', 'Machines page (on demand)', 'Newest rpm, power-derived torque, tool wear'],
            ['Anomaly check', 'Machines page (on demand)', 'A machine’s own last seven days of telemetry'],
            ['Days of cover; projected order finish', 'Inventory, Production, Dashboard', '30 days of stock use; 14 days of logged output'],
            ['Natural-language analyst; weekly summary; alert explanations', 'AI Analyst, Alerts', 'Figures retrieved by fixed queries; never raw collections'],
        ], widths=[30, 32, 38], size=9.5),
    ],
]
