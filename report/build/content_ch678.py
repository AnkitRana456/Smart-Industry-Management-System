from framework import FIG, FIGTEXT, H1, H2, H3, P, SP, TABLE, UL, OL, RAW, ROOT

C = ROOT + r'\assets\code'

chapter6 = [
    [
        H1('Chapter 6: Testing and Results'),
        H2('6.1 Testing Methodology'),
        P('Testing was done at three levels. **Unit tests** cover pure rules such as the state machine, the health score, the feature builder, grounding and forecasts. **Integration tests** start the real Express application against an in-memory MongoDB and call the REST API with each role, so validation, authorisation, side effects and the response envelope are tested together. **Service tests** for the ML service call the FastAPI application through its test client and check that models load, inputs are validated and outputs are in range. The AI layer is tested with a stub in place of the language model so that tests are repeatable; its quality is measured separately (Section 6.4).', cls='tight'),
        H2('6.2 Automated Test Results'),
        P('All suites were run on 1 November 2026. Every test passed; the counts below are taken from the test runners, not estimated.', cls='tight'),
        TABLE('Table 6.1: Automated tests by area', ['Suite', 'Area covered', 'Tests', 'Passed'], [
            ['Server', 'Authentication, lockout, password reset, users, configuration, API documentation', '47', '47'],
            ['Server', 'Machines, maintenance, telemetry, simulator', '29', '29'],
            ['Server', 'Workers, attendance, leave, tasks', '26', '26'],
            ['Server', 'Production, bill of materials, inventory, purchasing', '30', '30'],
            ['Server', 'Analytics', '11', '11'],
            ['Server', 'ML integration and insights', '38', '38'],
            ['Server', 'Language-model layer: analyst, assessment, explanation, limits, evaluation harness', '88', '88'],
            ['Client', '13 files: CSV tools, formatting, stores, components, guards', '113', '113'],
            ['ML service', 'Risk model, sensor model, anomaly and forecasts (3 files)', '56', '56'],
            ['**Total**', '', '**438**', '**438**'],
        ], widths=[14, 62, 12, 12], size=9.5),
        FIGTEXT(C + r'\term-purchasing.png', 'Figure 6.1: Test runner output (purchasing)', [
            P('The figure shows the real output of the purchasing suite. Besides the rules of purchase orders (receiving stock, partial receipts, cancellation) it asserts that a worker cannot reach the routes and that invalid bodies are rejected with field-level errors.', cls='tight'),
            P('The pytest output below it shows the twelve tests of the insights endpoints of the ML service.', cls='tight'),
            FIG(C + r'\term-pytest.png', 'Figure 6.2: pytest output (ML insights)', width=3.05, kind='fig'),
        ], width=3.2),
    ],
    [
        H2('6.3 Sample Test Cases'),
        TABLE('Table 6.2: Selected functional test cases', ['ID', 'Scenario', 'Expected result', 'Result'], [
            ['TC-01', 'Sign in with a wrong password five times', 'Account is locked; the sixth attempt is refused even with the right password', 'Pass'],
            ['TC-02', 'Worker calls a manager-only route', 'HTTP 403 and no data change', 'Pass'],
            ['TC-03', 'Change a machine to the status it already has', 'HTTP 400, no new downtime log', 'Pass'],
            ['TC-04', 'Set a machine offline, then running again', 'Critical alert and work order opened, then alert resolved; downtime duration recorded', 'Pass'],
            ['TC-05', 'Stock-out larger than the quantity on hand', 'HTTP 400, quantity unchanged', 'Pass'],
            ['TC-06', 'Start an order with insufficient materials', 'Order stays pending; shortage is listed', 'Pass'],
            ['TC-07', 'Move an order from completed back to pending', 'Rejected by the state machine', 'Pass'],
            ['TC-08', 'Receive a purchase order partly, then fully', 'Stock increases by each receipt; status changes partial → received', 'Pass'],
            ['TC-09', 'Analyst answer contains a number not in the evidence', 'Retry once, then the figures only are shown', 'Pass'],
            ['TC-10', 'ML service is stopped', 'Machines page loads; the model panel shows that the service is unavailable', 'Pass'],
        ], widths=[9, 33, 48, 10], size=9),
        H2('6.4 Measured Performance'),
        P('Response times were measured on the development machine with the API and the database on the same host, using 40 sequential requests for each endpoint after sign-in. The figures show the speed of the code on a small data set and are **not** a load test; production behaviour will differ.', cls='tight'),
        TABLE('Table 6.3: API response time, 40 requests each (milliseconds)', ['Endpoint', 'Median', '95th percentile', 'Maximum'], [
            ['GET /api/machines', '4.5', '7.4', '7.9'],
            ['GET /api/orders', '9.4', '11.6', '13.9'],
            ['GET /api/inventory', '3.9', '5.7', '6.6'],
            ['GET /api/analytics/overview', '7.0', '11.8', '12.4'],
            ['GET /api/analytics/downtime', '5.4', '9.7', '10.4'],
            ['GET /api/alerts', '4.7', '8.8', '15.4'],
        ], widths=[46, 18, 20, 16], size=10),
        P('For the real-time channel, 20 status changes were made through the API while a second connected client listened. All 20 events were delivered; the time from the request to the event arriving at the client had a median of 7.8 ms and a maximum of 13.3 ms.', cls='tight'),
    ],
    [
        H2('6.5 Evaluation of the ML and AI Components'),
        TABLE('Table 6.4: Held-out evaluation of the learned models', ['Model', 'Data', 'ROC-AUC', 'PR-AUC', 'Brier (base rate)'], [
            ['Risk model (logistic regression)', 'Synthetic, 18,000 training samples', '0.801', '0.428', '0.0707 (0.0881)'],
            ['Sensor model (gradient boosting)', 'Public AI4I 2020, 10,000 rows, 339 failures', '0.947', '0.591', '0.0192 (0.0328)'],
        ], widths=[27, 31, 12, 12, 18], size=9.5),
        UL([
            '**Risk model.** The ROC-AUC of 0.801 is almost equal to the 0.8015 ceiling of the generator that produced the data, so the model has learned what the data contains; it says little about real machines. The High band (probability ≥ 0.30) found 35% of the failures with 52% precision. Applied to the AI4I data, where only two of its inputs exist, it scored 0.662, the same as tool wear alone, which is why it is described as a demonstration of the pipeline.',
            '**Sensor model.** Tool wear alone gives 0.679 on the same split, so rpm and torque add real information. This model comes from a public data set of a milling process and is shown as a second opinion.',
            '**Language-model layer.** In a live evaluation of 42 analyst questions, 39 were answered (the others hit service limits); the correct tool was chosen in 29 of 29 questions that had a defined tool; the key figures matched an independently computed answer in 28 of 29; no answer contained forbidden content. For assessments, 6 scenarios were run three times each: all 18 outputs were valid in form and 15 were rated acceptable by the checks; after the fleet context was added to the prompt, all 14 that completed were acceptable (4 timed out).',
        ], ),
        H2('6.6 Security Checks'),
        UL([
            'Role guards were tested route by route: a worker receives HTTP 403 on manager-only routes, and an unauthenticated request receives HTTP 401.',
            'Five failed sign-ins lock the account for a period; the lock is covered by a test and cannot be bypassed by the correct password.',
            'Bodies are validated with schemas; invalid fields are rejected with field-level messages before any database access.',
        ]),
        H2('6.7 Frontend and Usability Checks'),
        P('Every page was opened in the light and dark themes at a 1440-pixel desktop width and at a narrow width to confirm that the menu collapses, tables scroll inside their container and dialogs can be closed with the keyboard. The dialog component traps focus, closes on Escape and labels its title for screen readers, and a console check found no errors or warnings while moving through all pages as a manager.', cls='tight'),
    ],
]

chapter7 = [
    [
        H1('Chapter 7: Conclusion and Summary'),
        H2('7.1 Summary of Work'),
        P('This project designed and built SIMS, a centralised web platform that brings machines, workers, production and inventory into one system with live updates. The application tier exposes 132 documented API operations over 26 MongoDB collections; the client has role-specific pages for administrators, managers and workers; and a separate ML service and an LLM-based intelligence layer add prediction and natural-language insight. The code base holds about 5,900 lines on the server, 5,900 in the client and 800 in the ML service, tested by 438 automated tests.', cls='tight'),
        H2('7.2 Objectives Achieved'),
        UL([
            'A single dashboard with live machine status, KPIs and alerts that update without a page refresh.',
            'Machine monitoring with downtime logging, telemetry, health score, maintenance scheduling and reliability measures (MTBF and MTTR).',
            'Worker management with shifts, attendance, leave, tasks and handover notes, and a personal page for each worker.',
            'Production tracking with a controlled order life cycle, bill of materials, quality checks and an order feasibility check.',
            'Inventory control with atomic transactions, reorder alerts, valuation, suppliers and purchase orders.',
            'AI-powered operational insights whose figures are checked against the evidence, with machine-learning predictions that always state their data and limits.',
        ]),
        H2('7.3 Implemented and Proposed Features'),
        TABLE('Table 7.1: Status of the features proposed in the synopsis', ['Feature', 'Status'], [
            ['Dashboard, five modules, role-based access', 'Implemented and tested'],
            ['Real-time updates over Socket.io', 'Implemented; latency measured locally'],
            ['Failure-risk model and anomaly check', 'Implemented; trained on synthetic and public data only'],
            ['LLM-based analyst, summaries and alert explanations', 'Implemented; quality measured on a fixed question set'],
            ['Physical sensor integration, mobile application, hosted deployment', 'Not implemented (see Chapter 8)'],
        ], widths=[66, 34], size=10),
        H2('7.4 Learning Outcomes'),
        P('The team learned to model a real-time system with Socket.io rooms; to keep side effects in services so that every entry point behaves the same; to use atomic database operators for counters; to evaluate machine-learning models honestly, including an external check that lowered our own result; and to constrain a language model so that it can explain data but not invent it.', cls='tight'),
    ],
]

chapter8 = [
    [
        H1('Chapter 8: Limitations and Future Scope'),
        H2('8.1 Limitations'),
        UL([
            '**Synthetic risk-model data.** The failure-risk model is trained on generated data. Its accuracy on real machines is unknown until labelled history from a plant is available.',
            '**No real sensors.** Telemetry is produced by a simulator or entered through the API; there is no connection to PLCs or industrial protocols such as OPC UA or MQTT.',
            '**Not deployed or load-tested.** The system has been run only in development. A deployment description exists, but no hosted instance, concurrency or long-run test was performed.',
            '**Single plant, single language.** There is no multi-tenant or multi-site support, and the interface is in English only.',
            '**No production rates.** Orders carry quantities and due dates but not cycle times, so the feasibility check cannot promise a delivery date.',
            '**AI service limits.** The language-model features depend on an external service; under rate limits or outages the interface shows that insight is unavailable rather than a guess.',
        ]),
        H2('8.2 Privacy and Ethical Considerations'),
        P('The intelligence layer receives only figures that the application has already calculated; names, passwords, tokens and raw records are not sent to the language model. Predictions are always shown as estimates with their data source, and no model can approve a purchase, change a status or edit a record. Decisions therefore remain with the people who use the system.', cls='tight'),
        H2('8.3 Future Scope'),
        UL([
            'Connect machines through MQTT or OPC UA gateways and retrain the risk model on real labelled failures.',
            'Add mobile applications or a progressive web app with push notifications for supervisors.',
            'Add shift-wise production planning, energy monitoring and quality charts (SPC).',
            'Add multi-plant support, per-plant roles and scheduled report e-mails.',
            'Containerise the three programs and add monitoring, backups and a continuous-integration pipeline for hosted deployment.',
        ]),
    ],
]

BIB = [
    '[1] MongoDB Inc., “MongoDB Manual – Data Modeling and Aggregation,” https://www.mongodb.com/docs/manual/.',
    '[2] OpenJS Foundation, “Express – Node.js web application framework,” https://expressjs.com/.',
    '[3] Meta Platforms Inc., “React Documentation,” https://react.dev/.',
    '[4] Socket.IO, “Socket.IO Documentation,” https://socket.io/docs/v4/.',
    '[5] Mongoose, “Mongoose Documentation,” https://mongoosejs.com/docs/.',
    '[6] S. Ramírez, “FastAPI Documentation,” https://fastapi.tiangolo.com/.',
    '[7] F. Pedregosa et al., “Scikit-learn: Machine Learning in Python,” Journal of Machine Learning Research, vol. 12, pp. 2825–2830, 2011.',
    '[8] S. Matzka, “Explainable Artificial Intelligence for Predictive Maintenance Applications,” in Proc. 3rd Int. Conf. on Artificial Intelligence for Industries (AI4I), 2020. Data set: UCI Machine Learning Repository, “AI4I 2020 Predictive Maintenance Dataset.”',
    '[9] F. T. Liu, K. M. Ting and Z.-H. Zhou, “Isolation Forest,” in Proc. IEEE Int. Conf. on Data Mining (ICDM), 2008, pp. 413–422.',
    '[10] Zod, “Zod – TypeScript-first schema validation,” https://zod.dev/.',
    '[11] OWASP Foundation, “OWASP Top Ten Web Application Security Risks,” https://owasp.org/www-project-top-ten/.',
    '[12] M. Jones, J. Bradley and N. Sakimura, “JSON Web Token (JWT),” RFC 7519, IETF, 2015.',
    '[13] TanStack, “TanStack Query Documentation,” https://tanstack.com/query/latest.',
    '[14] Recharts, “Recharts – a composable charting library for React,” https://recharts.org/.',
    '[15] R. S. Pressman and B. R. Maxim, Software Engineering: A Practitioner’s Approach, 9th ed., McGraw-Hill, 2020.',
]

bibliography = [
    [
        H1('Bibliography'),
        SP(4),
        RAW(''.join(f'<div class="ref">{__import__("html").escape(r)}</div>' for r in BIB)),
    ],
]
