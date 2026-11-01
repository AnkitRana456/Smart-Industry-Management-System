// Diagram sources for the report. Each one is drawn from the implemented modules, routes and collections.
// `code` entries are Mermaid; `build` entries are hand-laid-out SVG (use case and activity diagrams).
import { activityDiagram, aiWorkflowDiagram, dfd2Diagram, erDiagram, useCaseDiagram } from './svgkit.mjs';

export const diagrams = {
  'fig-3-1-usecase': { build: useCaseDiagram },
  'fig-3-2-dfd0': {
    width: 1000,
    code: `flowchart LR
  E1[Admin and<br/>Manager]
  E2[Worker]
  E3[ML risk<br/>service]
  E4[LLM service]
  P((0<br/>Smart Industrial<br/>Management<br/>System))
  D[(MongoDB)]
  E1 -- commands, queries --> P
  P -- dashboards,<br/>alerts, answers --> E1
  E2 -- attendance,<br/>task updates --> P
  P -- own tasks,<br/>orders --> E2
  P -- feature vectors,<br/>readings --> E3
  E3 -- risk band, anomaly,<br/>forecast --> P
  P -- grounded<br/>evidence --> E4
  E4 -- drafted<br/>explanation --> P
  P <--> D`,
  },
  'fig-3-3-dfd1': {
    width: 1000,
    code: `flowchart TB
  U[Users]
  P1((1.0 Authenticate<br/>and authorise))
  P2((2.0 Machine<br/>monitoring))
  P3((3.0 Worker<br/>management))
  P4((4.0 Production<br/>tracking))
  P5((5.0 Inventory and<br/>purchasing))
  P6((6.0 Analytics<br/>and alerts))
  P7((7.0 AI insights))
  D1[(D1 Users)]
  D2[(D2 Machines,<br/>logs, telemetry)]
  D3[(D3 Workers, shifts,<br/>attendance, tasks)]
  D4[(D4 Orders, output,<br/>quality)]
  D5[(D5 Inventory,<br/>transactions, POs)]
  D6[(D6 Alerts,<br/>notifications)]
  U --> P1
  P1 <--> D1
  P1 --> P2
  P1 --> P3
  P1 --> P4
  P1 --> P5
  P2 <--> D2
  P3 <--> D3
  P4 <--> D4
  P5 <--> D5
  P2 --> P6
  P5 --> P6
  P4 --> P6
  P6 <--> D6
  P6 --> U
  P7 -. reads .-> D2
  P7 -. reads .-> D4
  P7 -. reads .-> D5
  U <--> P7`,
  },
  'fig-3-4-dfd2': { build: dfd2Diagram },
  'fig-4-1-architecture': {
    width: 1000,
    code: `flowchart LR
  subgraph CL[Client tier: React 19, TypeScript]
    direction TB
    UI[Pages, components<br/>Tailwind, Recharts]
    ST[react-query cache,<br/>zustand stores]
    SC[Socket.io client]
    UI --> ST
  end
  subgraph API[Application tier: Node.js, Express]
    direction TB
    MW[Security middleware<br/>helmet, CORS, rate limit,<br/>sanitising, Zod]
    AU[JWT authentication<br/>and role guards]
    MOD[Domain modules]
    SV[Services layer:<br/>write data, emit events]
    SIO[Socket.io server]
    JOB[Scheduled jobs<br/>node-cron]
    INT[Intelligence layer:<br/>planner, tools,<br/>grounding checks]
    MW --> AU --> MOD --> SV
    JOB --> SV
    SV --> SIO
    SV <--> INT
  end
  subgraph DT[Data and AI tiers]
    direction TB
    DB[(MongoDB<br/>Mongoose)]
    ML[Python FastAPI<br/>scikit-learn models]
    LLM[LLM service<br/>external]
  end
  ST -- REST, HTTPS --> MW
  SC <-- WebSocket --> SIO
  SV <--> DB
  SV -- REST --> ML
  INT -- evidence only --> LLM
  INT -- allow-listed tools --> DB`,
  },
  'fig-4-2-structure': {
    width: 1000,
    code: `flowchart TB
  R[Smart Industrial Management System]
  R --> A[Access control]
  R --> B[Machine monitoring]
  R --> C[Worker management]
  R --> D[Production tracking]
  R --> E[Inventory and purchasing]
  R --> F[Analytics and alerts]
  R --> G[AI and ML layer]
  A --> A1[Login, refresh<br/>Role guards<br/>Audit log]
  B --> B1[Status and<br/>downtime log<br/>Telemetry, health<br/>Work orders]
  C --> C1[Roster, shifts<br/>Attendance, leave<br/>Tasks, handover]
  D --> D1[Order state<br/>machine<br/>Bill of materials<br/>Quality checks]
  E --> E1[Atomic stock<br/>transactions<br/>Reorder alerts<br/>Suppliers, POs]
  F --> F1[KPI overview<br/>Downtime, output,<br/>stock charts<br/>Notifications]
  G --> G1[Risk and sensor<br/>models<br/>Anomaly, forecast<br/>AI analyst]`,
  },
  'fig-4-3-wbs': {
    width: 1000,
    code: `flowchart TB
  P[Project: Smart Industrial Management System]
  P --> W1[1 Requirements<br/>and design]
  P --> W2[2 Backend]
  P --> W3[3 Frontend]
  P --> W4[4 AI and ML]
  P --> W5[5 Testing]
  P --> W6[6 Documentation]
  W1 --> W11[1.1 Problem<br/>statement<br/>1.2 Requirements<br/>1.3 Architecture,<br/>ER, DFD]
  W2 --> W21[2.1 Models, seed<br/>2.2 Auth, RBAC<br/>2.3 REST modules<br/>2.4 Socket.io,<br/>scheduler]
  W3 --> W31[3.1 App shell,<br/>theme<br/>3.2 Module pages,<br/>charts<br/>3.3 Live updates]
  W4 --> W41[4.1 Risk and<br/>sensor models<br/>4.2 Anomaly,<br/>forecast<br/>4.3 LLM analyst]
  W5 --> W51[5.1 API and<br/>unit tests<br/>5.2 Evaluation<br/>harness<br/>5.3 Measurements]
  W6 --> W61[6.1 API docs,<br/>README<br/>6.2 Project<br/>report]`,
  },
  'fig-4-4-activity': { build: activityDiagram },
  'fig-4-5-er': { build: erDiagram },
  'fig-4-6-class': {
    width: 1000,
    code: `classDiagram
  direction LR
  class User {
    +name
    +email
    +role
    +login()
  }
  class Worker {
    +employeeId
    +status
    +checkIn()
    +checkOut()
  }
  class Machine {
    +code
    +status
    +riskLevel
    +healthScore
    +changeStatus()
  }
  class MachineLog {
    +toStatus
    +durationMins
    +reason
  }
  class ProductionOrder {
    +orderNo
    +quantity
    +status
    +setStatus()
  }
  class InventoryItem {
    +sku
    +quantity
    +reorderThreshold
    +addTransaction()
  }
  class Alert {
    +type
    +severity
    +status
    +create()
  }
  class WorkOrder {
    +woNo
    +priority
    +status
    +setStatus()
  }
  class PurchaseOrder {
    +poNo
    +status
    +approve()
    +receive()
  }
  User "1" --> "0..1" Worker
  Machine "1" --> "*" MachineLog
  Machine "1" --> "*" WorkOrder
  Machine "*" --> "*" ProductionOrder
  ProductionOrder "*" --> "*" InventoryItem
  InventoryItem "*" --> "*" PurchaseOrder
  Machine ..> Alert : raises
  InventoryItem ..> Alert : raises`,
  },
  'fig-4-7-ai': { build: aiWorkflowDiagram },
  'fig-4-8-sequence': {
    width: 1000,
    code: `sequenceDiagram
  autonumber
  participant A as Manager browser
  participant API as Express API
  participant SV as Service layer
  participant DB as MongoDB
  participant IO as Socket.io
  participant B as Worker browser
  A->>API: PATCH /machines/:id/status
  API->>API: authenticate, authorise, validate
  API->>SV: changeStatus()
  SV->>DB: close log, insert log, update machine
  DB-->>SV: saved
  SV->>IO: emit machine:statusChanged
  IO-->>A: event
  IO-->>B: event
  SV-->>API: updated machine
  API-->>A: 200 OK
  Note over A,B: Both pages refresh cached data and show a toast`,
  },
};
