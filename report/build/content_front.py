from framework import FIG, H1, H2, H3, OL, P, RAW, SP, TABLE, UL, ROOT, img_uri

TITLE = 'Smart Industrial Management System'
SUBTITLE = 'A Web-Based Centralized Platform for Machine, Worker, Production & Inventory Management'
FULL_TITLE = f'{TITLE}: {SUBTITLE}'
MEMBERS = [('Rakesh Gupta', '16014812723'), ('Ankit Rana', '15514812723'), ('Aditya Jaiswal', '15614812723')]
LOGO = ROOT + r'\assets\mait_logo.png'

cover = RAW(f"""
<div class="cover">
  <div style="position:absolute;left:0;right:0;top:29pt">
    <div style="font-size:24pt;font-weight:bold;line-height:41pt">{TITLE}</div>
    <div style="font-size:16pt;font-weight:bold;line-height:23pt;margin:0 46pt">{SUBTITLE}</div>
    <div style="font-size:24pt;font-weight:bold;line-height:41pt;margin-top:8pt">(ES-451 : Minor Project)</div>
  </div>
  <div style="position:absolute;left:0;right:0;top:206pt;line-height:19pt">
    <div style="font-size:12pt">Submitted in partial fulfillment of the requirement</div>
    <div style="font-size:12pt">for the award of the degree of</div>
    <div style="font-size:16pt;font-weight:bold;margin-top:6pt;line-height:26pt">Bachelor of Technology</div>
    <div style="font-size:12pt">in</div>
    <div style="font-size:14pt;font-weight:bold;line-height:28pt">Computer Science &amp; Technology</div>
  </div>
  <div style="position:absolute;left:0;right:0;top:324pt;line-height:25pt">
    <div style="font-size:12pt">Submitted By</div>
    {''.join(f'<div style="font-size:12pt;font-weight:bold">{n} ({e})</div>' for n, e in MEMBERS)}
  </div>
  <div style="position:absolute;left:0;right:0;top:432pt;line-height:25pt">
    <div style="font-size:12pt">Under the supervision of</div>
    <div style="font-size:12pt;font-weight:bold">Dr. Garima</div>
    <div style="font-size:12pt;font-weight:bold">Professor (CST)</div>
  </div>
  <img src="{img_uri(LOGO)}" style="position:absolute;left:50%;margin-left:-47pt;top:524pt;width:94pt">
  <div style="position:absolute;left:0;right:0;top:640pt;line-height:29pt">
    <div style="font-size:16pt;font-weight:bold">COMPUTER SCIENCE AND TECHNOLOGY</div>
    <div style="font-size:16pt;font-weight:bold">MAHARAJA AGRASEN INSTITUTE OF TECHNOLOGY</div>
    <div style="font-size:14pt;font-weight:bold">ROHINI SEC-22, NEW DELHI &ndash; 110086</div>
    <div style="font-size:16pt;font-weight:bold">Dec 2026</div>
  </div>
</div>
""")

names_row = ''.join(f'<div style="text-align:left">({n})<br>{e}</div>' for n, e in MEMBERS)

declaration = [
    H1('Declaration', toc=False, cls='center'),
    SP(14),
    P(f'This is to certify that the material embodied in this Minor Project titled “{FULL_TITLE}” being submitted in the partial fulfillment of the requirements for the award of the degree of Bachelor of Technology in Computer Science and Technology is based on our original work. It is further certified that this Minor Project work has not been submitted in full or in part to this university or any other university for the award of any other degree or diploma. Our indebtedness to other works has been duly acknowledged at the relevant places.'),
    RAW(f'<div class="sig">{names_row}</div>'),
]

certificate = [
    H1('Certificate', toc=False, cls='center'),
    SP(14),
    P(f'In this Minor Project titled “**{FULL_TITLE}**”. This is to certify that the work embodied, being submitted in the partial fulfillment of the requirements for the award of the degree of Bachelor of Technology in Computer Science and Technology, is original and has been carried out under my supervision by,'),
    P('**' + ', '.join(f'{n} (Enrollment no. {e})' for n, e in MEMBERS) + '** under my supervision and guidance.'),
    SP(8),
    P('It is further certified that this Minor Project work has not been submitted in full or in part to this university or any other university for the award of any other degree or diploma to the best of my knowledge and belief.'),
    SP(70),
    P('**(Dr. Garima)**'),
    P('**Professor (CST)**'),
    SP(60),
    P('**(Dr. Pooja Gupta)**'),
    P('**HOD (CST)**'),
    P('**Maharaja Agrasen Institute of Technology**'),
]

acknowledgement = [
    H1('Acknowledgement', toc=False, cls='center'),
    SP(8),
    P('We express our sincere gratitude to our project guide, Dr. Garima, Professor (CST), for her valuable guidance, constructive feedback and constant encouragement throughout the planning and development of this minor project. Her suggestions helped us organise a large problem into well-defined modules, keep the scope realistic, and present the work honestly, separating what is implemented from what is proposed.'),
    P('We are thankful to Dr. Pooja Gupta, Head of the Department, Computer Science and Technology, and to Maharaja Agrasen Institute of Technology for providing the academic environment, laboratory facilities and resources needed to complete this work. We also thank all the faculty members of the CST department for their cooperation and support.'),
    P('We acknowledge the authors and maintainers of the open-source tools on which the system is built, in particular the documentation of React, Node.js, Express, MongoDB, Mongoose, Socket.io, Recharts, Tailwind CSS, FastAPI and scikit-learn, as well as the creators of the public AI4I 2020 predictive maintenance dataset, which we used to test our machine-learning approach on data we did not generate ourselves.'),
    P('Finally, we thank our peers, families and friends for their motivation, patience and support throughout the project.'),
]

abstract = [
    H1('Abstract', toc=False, cls='center'),
    SP(4),
    P('Small and medium industrial units often run their machines, workers, production orders and stock on registers, spreadsheets and disconnected tools. A delay recorded in one place is invisible in another, maintenance is reactive, and managers cannot see the state of the whole floor without walking it. The Smart Industrial Management System (SIMS) is a web-based platform that brings these four areas into one real-time application with role-based access for administrators, managers and workers.'),
    P('SIMS is built as a React and TypeScript client, a Node.js and Express REST API with Socket.io for live updates, MongoDB for storage, and a separate Python FastAPI service for machine learning. Machine status changes write downtime logs and raise alerts; production orders follow a validated state machine and consume materials atomically; stock movements are guarded so quantities never go negative and low stock drafts a purchase order that only a manager can approve. A dashboard and analytics pages present downtime, output, stock, attendance, reliability and OEE figures calculated by the backend.'),
    P('The intelligence layer has two parts. A machine-learning service scores failure risk, checks telemetry for anomalies and forecasts stock cover and order completion. An LLM-based layer lets a manager ask operational questions in plain English: the application selects fixed, allow-listed database queries, passes only the retrieved figures to the language model, and rejects any answer whose numbers are not present in that evidence.'),
    P('The report documents the problem, requirements, design and implementation, and reports measured results only: 438 automated tests pass (269 server, 113 client, 56 ML service), API responses had a median of 3.9 to 7.0 ms on a local machine, and live updates reached a second client in a median of 7.8 ms. The risk model is trained on synthetic data and is not presented as validated on real failures.'),
    P('**Keywords:** Industrial Management, Predictive Maintenance, Real-Time Dashboard, Socket.io, MERN, Role-Based Access Control, Machine Learning, LLM-Based Insights, Inventory Control.'),
]

chapter1 = [
    [
        H1('Chapter 1: Introduction'),
        H2('1.1 Background'),
        P('Industrial output depends on four things working together: machines that stay available, workers who are in the right place, production orders that move forward, and materials that are in stock when they are needed. Large manufacturers run enterprise platforms such as SAP, Oracle Manufacturing or Siemens Opcenter to coordinate these. Small and medium enterprises, which make up most of India’s manufacturing sector, rarely can: such platforms need licences, dedicated IT staff and long deployments. Many units therefore continue with paper registers and separate spreadsheets.'),
        P('The cost of this fragmentation is practical. A stoppage written in a production register is not seen by the stores clerk, who keeps ordering material on the old schedule. A machine can run past its service date because nothing flags it until it breaks mid-shift. A supervisor cannot tell whether today’s target will be met without walking the floor. Each gap is small, but together they push decisions to be late and reactive.'),
        H2('1.2 Introduction to Smart Industrial Management System'),
        P('The Smart Industrial Management System (SIMS) is a centralised, web-based platform that unifies machine monitoring, worker management, production tracking and inventory control behind one real-time dashboard. Every module shares the same data store and the same event stream, so a change made in one place, for example a machine going offline, immediately updates the alerts, the production bottleneck flags and every connected screen.'),
        P('SIMS adds an artificial-intelligence layer on top of this operational data. A separate machine-learning service estimates the risk of machine failure, detects unusual sensor readings and forecasts stock and order progress, while an LLM-based assistant answers questions such as “which machine had the most downtime this week?” in plain English using figures calculated by the backend.'),
        H2('1.3 Need for the Project'),
        UL([
            'Replace paper and spreadsheet records with one source of truth that every role can see in real time.',
            'Move maintenance from reactive repair to planned, data-informed action using downtime history, telemetry and risk scores.',
            'Keep inventory lean: detect low stock immediately, draft the reorder and keep a person in control of approving it.',
            'Give non-technical managers a way to ask questions of the data without building reports by hand.',
            'Enforce who may see and change what, with a record of every change, in a way that suits a single factory.',
        ]),
    ],
    [
        H2('1.4 Aim and Scope'),
        P('The aim is to design and build a working, tested prototype of a unified industrial management platform covering five modules: Machine Monitoring, Worker Management, Production Tracking, Inventory Management and an Analytics Dashboard, together with a machine-learning service and an LLM-based natural-language insights layer.'),
        P('The scope is a single-factory, single-tenant web application. Machine status and sensor values are simulated or entered manually because no physical IoT hardware is connected. The failure-risk model is trained on synthetic data to demonstrate the pipeline end to end; it is an additional signal and not a validated predictor of real failures. Native mobile applications, multi-factory scaling and fully autonomous AI decisions are outside the scope.'),
        H2('1.5 Existing System'),
        P('In the typical small industrial unit the existing system is a combination of handwritten registers, spreadsheets kept by different departments, and messaging apps. Data is updated late and entered more than once, so figures disagree between departments. There is no common alert path, no history of why a machine stopped, no automatic link between consumption and stock, and no single place where management can see key indicators. Enterprise platforms solve these problems but are too costly and heavy to deploy for most small units.'),
        H2('1.6 Proposed System'),
        P('SIMS proposes a lightweight, modular alternative. It exposes a REST API and a live event channel, stores all records in MongoDB, and presents them through a responsive React interface in light and dark themes. The system writes downtime and stock history automatically as a side effect of normal actions, raises alerts when thresholds are crossed, restricts every action by role, and offers machine-learning and LLM features as optional layers that fail soft: if the ML service or the language model is unavailable, the rest of the application keeps working.'),
        H2('1.7 Importance of Industrial Automation'),
        P('Industrial automation and Industry 4.0 aim to make production data available, trustworthy and actionable. Real-time visibility shortens the time between a problem occurring and someone acting on it; predictive maintenance reduces unplanned stoppages, which are the most expensive kind because they halt the whole downstream line; and accurate stock control lowers both over-ordering and stock-outs. Delivering these benefits through a web application running on ordinary hardware lowers the barrier for smaller units, which supports the UN Sustainable Development Goals 8 (decent work and economic growth), 9 (industry, innovation and infrastructure) and 12 (responsible consumption and production).'),
    ],
    [
        H2('1.8 Organisation of the Report'),
        P('This report is organised into eight chapters. **Chapter 1** introduces the background, the need for the project, its aim and scope, and the existing and proposed systems. **Chapter 2** states the problem, the core challenges, the objectives, the expected outcomes and the constraints. **Chapter 3** analyses the requirements, feasibility, technology stack, use cases and data flow. **Chapter 4** describes the architecture, modules, database design, activity flow and the AI/ML and real-time architecture. **Chapter 5** explains the implementation with screenshots of the running application and excerpts from the source code. **Chapter 6** presents the testing approach, test cases and measured results. **Chapter 7** summarises the work and the learning outcomes, and **Chapter 8** lists the limitations and the future scope. The bibliography follows.'),
        H3('Conventions used in this report'),
        P('Wherever the report states a number it is either a requirement of the project or a value measured on the actual implementation, and the way it was measured is given. Features are described as implemented only if they exist in the source code and are covered by tests or were exercised in the running application; anything that is planned but not built is listed in Chapter 8. The AI components are described by their function and data flow; the choice of language-model provider is deliberately not discussed because it is a configuration detail that does not change the design.'),
        H3('Project at a glance'),
        TABLE('Table 1.1: Size of the delivered implementation (measured from the source tree)', ['Item', 'Measured value'], [
            ['Server (Node.js and Express) source lines, excluding tests', '5,919'],
            ['Client (React and TypeScript) source lines, excluding tests', '5,943'],
            ['ML service (Python) source lines, excluding tests', '790'],
            ['Automated test code lines (server, client and ML service)', '5,869'],
            ['MongoDB collections defined', '26'],
            ['REST operations documented in the API specification', '132'],
            ['Automated tests (server / client / ML service)', '269 / 113 / 56'],
            ['User roles', 'Admin, Manager, Worker'],
        ], widths=[70, 30]),
    ],
]

chapter2 = [
    [
        H1('Chapter 2: Problem Statement'),
        H2('2.1 Problem Definition'),
        P('Industries face significant difficulty in managing their four operational pillars – machines, workers, production and inventory – efficiently. Most small and medium units depend on manual, paper-based or fragmented digital systems that operate in silos, with no single system talking to another. Real-time, unified visibility across the shop floor is therefore almost impossible, which leads to resource wastage, production delays, unplanned machine downtime and poor inventory control.'),
        P('The problem is to design and build one connected, role-aware platform that records these four areas in a single database, keeps every user’s view current without manual refresh, and adds machine learning and natural-language insight so that decisions become proactive rather than reactive.'),
        H2('2.2 Core Challenges'),
        TABLE('Table 2.1: Core challenges and how SIMS responds to each', ['Challenge', 'Description', 'Response in SIMS'], [
            ['Resource wastage', 'Labour, material and machine time are allocated from memory rather than current data.', 'Shared data for workers, machines and stock; feasibility check before an order is accepted.'],
            ['Production delays', 'Separate registers hide bottlenecks until a deadline is at risk.', 'Order state machine, bottleneck flags, projected finish dates against due dates.'],
            ['Machine downtime', 'Maintenance is reactive, so stoppages are unplanned and costly.', 'Downtime logs, health score, risk model, anomaly check, preventive schedules and work orders.'],
            ['Inventory mismatch', 'Paper stock is updated late, causing over-ordering or surprise shortages.', 'Atomic stock transactions, reorder alerts, auto-drafted purchase orders, days-of-cover forecast.'],
            ['Lack of visibility', 'No single place shows machine health, attendance, orders and stock together.', 'Live dashboard, analytics charts, notifications and a natural-language assistant.'],
        ], widths=[17, 40, 43], size=9),
        H2('2.3 Objectives'),
        UL([
            'To build one web platform that integrates machine monitoring, worker management, production tracking and inventory control.',
            'To provide real-time dashboards and automated alerts so that management monitors operational health from one place.',
            'To reduce unplanned downtime through a predictive-maintenance module driven by a machine-learning model.',
            'To make operational data accessible to non-technical managers through an LLM-based natural-language insights layer.',
            'To maintain lean inventory through live stock tracking and reorder triggers that keep a person in control.',
            'To implement secure role-based access for Admin, Manager and Worker, enforced on the backend.',
        ]),
    ],
    [
        H2('2.4 Expected Outcomes'),
        TABLE('Table 2.2: Measurable targets set for the prototype and what the implementation shows', ['Target (from the synopsis)', 'Outcome in the implementation'], [
            ['One logged-in session shows live machine status, attendance, orders and stock without reload.', 'Achieved: the dashboard subscribes to Socket.io events and refreshes cached data (Chapter 5).'],
            ['A status change on one client reaches another within 2–3 seconds.', 'Measured: median 7.8 ms, 95th percentile 13.3 ms over 20 trials on a local machine (Chapter 6).'],
            ['The ML service returns a Low/Medium/High risk classification for a machine.', 'Achieved: risk band, probability and top contributing factors, shown on the Machines page.'],
            ['A manager can ask a plain-English question and receive a grounded answer.', 'Achieved: answers are built from fixed queries and checked against the evidence before display.'],
            ['Stock below a threshold raises a reorder alert.', 'Achieved: one alert per item, plus a draft purchase order.'],
            ['Three roles see different views, enforced by JWT claims.', 'Achieved: roles are checked on every API route and socket connection.'],
        ], widths=[48, 52]),
        H2('2.5 Project Scope'),
        TABLE('Table 2.3: In scope and out of scope', ['In scope (this project)', 'Out of scope (future work)'], [
            ['Web dashboard for the five modules', 'Native mobile application'],
            ['Simulated or manually entered machine status and readings', 'Physical IoT sensor integration on real machines'],
            ['Failure-risk model on synthetic and public datasets', 'Production-grade model validated on proprietary plant data'],
            ['Single-factory, single-tenant deployment', 'Multi-factory, multi-tenant SaaS'],
            ['Three fixed roles with route-level permissions', 'Per-module custom permission editor'],
            ['LLM answers grounded in live application data', 'Fully autonomous AI decisions such as auto-approving purchases'],
        ], widths=[50, 50]),
        H2('2.6 Challenges and Constraints'),
        UL([
            '**Data realism:** no real failure history was available, so the risk model uses synthetic data; a public dataset was used for an external check, and its limits are stated in Chapters 6 and 8.',
            '**Consistency across modules:** the same event, such as a machine stopping, must update logs, alerts, orders and screens together; this is why every module writes through a service layer that emits events after the database write.',
            '**Trust in AI output:** a language model can state invented numbers, so the design never lets it calculate or look up figures, and it verifies every number in its answer against the evidence.',
            '**Graceful failure:** the ML service and the language model are external dependencies, so every AI feature degrades to a clear message instead of failing the application.',
            '**Time:** the work was planned over eleven weeks with a working increment at the end of each phase.',
        ]),
    ],
]
