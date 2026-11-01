export type MachineStatus = 'running' | 'idle' | 'maintenance' | 'offline';
export type Risk = 'LOW' | 'MEDIUM' | 'HIGH' | 'INSUFFICIENT_DATA';

export interface Machine {
  _id: string;
  name: string;
  code: string;
  type?: string;
  status: MachineStatus;
  runHours: number;
  toolWearMin?: number;
  temperatureC?: number;
  vibrationMms?: number;
  lastServiceAt?: string;
  nextServiceDue?: string;
  healthScore?: number;
  riskLevel: Risk;
  lastAssessedAt?: string;
  mlRisk?: MlBand;
  mlProbability?: number;
  mlScoredAt?: string;
}

export type MlBand = 'Low' | 'Medium' | 'High';

export interface MlFactor { feature: string; label: string; value: number; unit: string; effect: number; direction: 'raises' | 'lowers' }

export interface MlPrediction {
  predictionId: string;
  machineId: string;
  risk: MlBand;
  probability: number;
  topFactors: MlFactor[];
  warnings: string[];
  modelVersion: string;
  dataSource: string;
  predictedAt: string;
  reused?: boolean;
}

export interface SensorRisk {
  risk: 'Low' | 'Medium' | 'High';
  probability: number;
  inputs: { rpm: number; torqueNm: number; toolWearMin: number };
  torqueIsDerived: boolean;
  readingAt: string;
  warnings: string[];
  modelVersion: string;
  dataSource: string;
}
export interface MlStatus {
  sensor?: { modelVersion: string; dataSource: string; metrics?: { rocAuc: number; brier: number; references: { alwaysPredictBaseRateBrier: number; toolWearAloneRocAuc: number } }; limitations: string[] } | null;
  enabled: boolean;
  reachable: boolean;
  modelLoaded?: boolean;
  modelVersion?: string;
  algorithm?: string;
  dataSource?: string;
  trainedAt?: string;
  metrics?: { rocAuc: number; brier: number; baseRate: number; references: { generatorCeilingRocAuc: number } };
  bands?: { mediumFrom: number; highFrom: number };
  limitations?: string[];
}

export interface MachineLog {
  _id: string;
  fromStatus?: string;
  toStatus?: string;
  startedAt: string;
  endedAt?: string;
  durationMins?: number;
  reason?: string;
}

export interface DowntimeRow { machineId: string; code: string; name: string; downtimeMins: number; events: number }

export interface InventoryItem {
  _id: string;
  sku: string;
  name: string;
  quantity: number;
  unit: string;
  reorderThreshold: number;
  supplier?: string;
  unitCost?: number;
  supplierRef?: string;
}

export interface Alert {
  _id: string;
  type: string;
  severity: 'info' | 'warning' | 'critical';
  source: string;
  message: string;
  status: 'open' | 'acknowledged' | 'resolved';
  createdAt: string;
}

export interface Shift { _id: string; name: string; startTime: string; endTime: string }

export interface Worker {
  _id: string;
  employeeId: string;
  department?: string;
  skills: string[];
  status: 'active' | 'on_leave' | 'terminated';
  user: { _id: string; name: string; email: string };
  shift?: Shift;
}

export interface AttendanceRecord {
  _id: string;
  date: string;
  checkIn?: string;
  checkOut?: string;
  status: 'present' | 'absent' | 'late';
  worker: { _id: string; employeeId: string; department?: string; user: { name: string } };
}

export interface AttendanceSummary { date: string; total: number; present: number; late: number; absent: number }

export type TaskStatus = 'todo' | 'in_progress' | 'done';

export interface Task {
  _id: string;
  title: string;
  status: TaskStatus;
  dueAt?: string;
  assignedTo?: { _id: string; employeeId: string; user: { name: string } };
  machine?: { _id: string; code: string; name: string };
  order?: { _id: string; orderNo: string; product: string };
}

export type OrderStatus = 'pending' | 'in_progress' | 'completed';

export interface Order {
  _id: string;
  orderNo: string;
  product: string;
  quantity: number;
  producedQty: number;
  progress: number;
  status: OrderStatus;
  dueDate?: string;
  bottleneckFlag: boolean;
  machines: { _id: string; code: string; name: string; status: MachineStatus }[];
  materials: { item: { _id: string; sku: string; name: string; unit: string; quantity: number }; qtyPerUnit: number }[];
  materialsConsumed: boolean;
}

export interface StockTx {
  _id: string;
  type: 'in' | 'out' | 'adjust';
  qty: number;
  createdAt: string;
  by?: { name: string };
}

export interface Overview {
  machines: { total: number; running: number; idle: number; maintenance: number; offline: number };
  risk: Record<Risk, number>;
  orders: { pending: number; in_progress: number; completed: number; bottlenecks: number };
  inventory: { items: number; lowStock: number };
  alerts: { open: number; critical: number; warning: number; info: number };
  attendance: AttendanceSummary;
  today: { downtimeMins: number; unitsProduced: number };
  generatedAt: string;
}

export interface DowntimeReport {
  days: number;
  totalMinutes: number;
  series: { date: string; minutes: number }[];
  byMachine: { machineId: string; code: string; name: string; minutes: number; events: number; availabilityPct: number }[];
  byReason: { reason: string; minutes: number; events: number }[];
}

export interface OutputReport {
  days: number;
  totalUnits: number;
  series: { date: string; units: number }[];
  byProduct: { product: string; units: number }[];
}

export interface StockReport {
  days: number;
  item: { id: string; sku: string; name: string; unit: string; quantity: number; reorderThreshold: number } | null;
  totalIn: number;
  totalOut: number;
  series: { date: string; in: number; out: number; level?: number }[];
}

export interface Assessment {
  assessmentId: string;
  machineId: string;
  riskLevel: Risk;
  assessmentSummary: string;
  observedConditions: string[];
  evidenceUsed: { field: string; value?: string | number; unit?: string }[];
  recommendedActions: string[];
  limitations: string[];
  modelId: string | null;
  promptVersion: string;
  assessedAt: string;
  alertId: string | null;
  reused?: boolean;
}

export interface KeyFigure { label: string; value: number; unit: string }

export interface AnalystAnswer {
  answer: string;
  reportingPeriod: { start: string; end: string; timezone: string };
  keyFigures: KeyFigure[];
  evidence: { source: string; recordCount: number; asOf: string }[];
  limitations: string[];
  needsClarification: boolean;
}

export interface WeeklySummary {
  reportingPeriod: { start: string; end: string; timezone: string };
  summary: string;
  highlights: string[];
  keyFigures: KeyFigure[];
  verified: boolean;
  generatedAt: string;
  cached: boolean;
}

export interface AppUser { id: string; name: string; email: string; role: 'admin' | 'manager' | 'worker'; isActive: boolean; createdAt: string }

export interface AuditEntry {
  _id: string;
  action: string;
  resource?: string;
  resourceId?: string;
  diff?: { fields?: string[] };
  createdAt: string;
  user?: { name: string; role: string };
}

export interface SimStatus { running: boolean; intervalSec: number; ticks: number; startedAt: string | null; stopsAt: string | null }

export interface Page<T> { items: T[]; page: number; limit: number; total: number; pages: number }

export type AttendanceCell = 'present' | 'late' | 'absent' | 'leave' | 'pending' | 'none';
export interface AttendanceReport {
  days: number;
  keys: string[];
  attendancePct: number | null;
  series: { date: string; present: number; late: number; absent: number }[];
  rows: { workerId: string; employeeId: string; name: string; days: Record<string, AttendanceCell> }[];
}

export type WoStatus = 'open' | 'in_progress' | 'done' | 'cancelled';
export type WoPriority = 'low' | 'medium' | 'high' | 'urgent';
export type WoType = 'preventive' | 'corrective' | 'inspection';
export interface WorkOrder {
  _id: string;
  woNo: string;
  title: string;
  description?: string;
  type: WoType;
  priority: WoPriority;
  status: WoStatus;
  source: 'manual' | 'schedule' | 'downtime';
  dueAt?: string;
  startedAt?: string;
  completedAt?: string;
  resolution?: string;
  overdue: boolean;
  machine: { _id: string; code: string; name: string; status: MachineStatus };
  assignedTo?: { _id: string; employeeId: string; user: { name: string } };
  notes: { by: string; text: string; at: string }[];
}
export interface WoSummary { open: number; inProgress: number; overdue: number; urgent: number }
export interface Schedule {
  _id: string;
  title: string;
  everyDays: number;
  nextDueAt: string;
  priority: WoPriority;
  active: boolean;
  lastDoneAt?: string;
  machine: { _id: string; code: string; name: string };
}
export interface ReliabilityReport {
  days: number;
  totalFailures: number;
  machines: { machineId: string; code: string; name: string; failures: number; downtimeMins: number; mttrMins: number | null; mtbfHours: number | null; availabilityPct: number }[];
}
export interface HandoverNote {
  _id: string;
  text: string;
  priority: 'info' | 'important';
  authorName?: string;
  author: string;
  resolved: boolean;
  createdAt: string;
  machine?: { _id: string; code: string; name: string };
}

export interface SensorReading { _id: string; at: string; temperatureC?: number; vibrationMms?: number; rpm?: number; powerKw?: number }
export interface Health {
  score: number;
  factors: { label: string; penalty: number }[];
  thresholds: Record<'temperatureC' | 'vibrationMms', { warn: number; crit: number }>;
}

export interface Supplier { _id: string; name: string; contactName?: string; email?: string; phone?: string; leadTimeDays: number; notes?: string; active: boolean }
export type PoStatus = 'draft' | 'approved' | 'received' | 'cancelled';
export interface PurchaseOrder {
  _id: string;
  poNo: string;
  status: PoStatus;
  total: number;
  createdFromAlert: boolean;
  notes?: string;
  supplier?: { _id: string; name: string; leadTimeDays: number };
  lines: { item: { _id: string; sku: string; name: string; unit: string; quantity: number; reorderThreshold: number }; qty: number; unitCost: number }[];
  createdBy?: { name: string };
  approvedBy?: { name: string };
  approvedAt?: string;
  receivedAt?: string;
  createdAt: string;
}
export interface Valuation { totalValue: number; itemsWithoutCost: number }
export interface ImportResult { created: number; updated: number; errors: { row: number; sku: string; message: string }[] }

export type LeaveStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';
export interface LeaveRequest {
  _id: string;
  from: string;
  to: string;
  days: number;
  reason?: string;
  status: LeaveStatus;
  reviewNote?: string;
  worker: { _id: string; employeeId: string; user: { name: string } };
  reviewedBy?: { name: string };
}
export interface ServerNotification {
  _id: string;
  title: string;
  body?: string;
  tone: 'info' | 'success' | 'warning' | 'critical';
  kind: string;
  readAt?: string;
  createdAt: string;
}

export interface Bom { _id: string; product: string; items: { item: { _id: string; sku: string; name: string; unit: string }; qtyPerUnit: number }[] }
export interface QualityData {
  summary: { checks: number; inspected: number; defects: number; scrap: number };
  checks: { _id: string; stage: string; inspectedQty: number; defectCount: number; scrapQty: number; notes?: string; createdAt: string; checkedBy?: { name: string } }[];
}
export interface Feasibility {
  feasible: boolean;
  hasBom: boolean;
  problems: string[];
  note: string;
  materials: { sku: string; name: string; unit: string; needed: number; available: number; short: number; enough: boolean }[];
}
export interface ParetoReport { totalMinutes: number; reasons: { reason: string; minutes: number; events: number; cumulativePct: number }[] }
export interface OeeReport {
  availabilityPct: number | null;
  qualityPct: number | null;
  performancePct: null;
  oeePct: null;
  unitsProduced: number;
  scrapUnits: number;
  defectsFound: number;
  unitsInspected: number;
  note: string;
}

export interface AlertExplanation {
  explanation: string;
  possibleReasons: string[];
  suggestedChecks: string[];
  modelId: string;
  limitation: string;
}

export interface StockCover {
  itemId: string;
  sku: string;
  name: string;
  unit: string;
  quantity: number;
  enoughHistory: boolean;
  message?: string;
  usagePerDay?: number;
  daysOfCover?: number | null;
  earliestDays?: number | null;
  latestDays?: number | null;
  beyondHorizon?: boolean;
  runOutOn?: string | null;
  leadTimeDays?: number;
  suggestedOrderQty?: number;
  confidence?: 'ok' | 'low';
}
export interface OrderProjection {
  orderId: string;
  orderNo: string;
  product: string;
  remaining: number;
  dueDate: string | null;
  status: 'late' | 'on_track' | 'unknown' | 'done';
  message?: string;
  pacePerDay?: number;
  expectedFinish?: string | null;
  earliestFinish?: string | null;
  latestFinish?: string | null;
  beyondHorizon?: boolean;
  confidence?: 'ok' | 'low';
}
export interface AnomalyResult {
  historyPoints: number;
  flagged: number;
  note: string;
  points: { at: string; anomalous: boolean; score: number; mostUnusual: { feature: string; value: number; typical: number; deviation: number } }[];
}
