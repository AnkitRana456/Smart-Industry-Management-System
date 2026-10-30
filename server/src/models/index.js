import mongoose from 'mongoose';

const { Schema, model } = mongoose;
const ref = (name, extra = {}) => ({ type: Schema.Types.ObjectId, ref: name, ...extra });
const opts = { timestamps: true };

export const User = model('User', new Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true, select: false },
  role: { type: String, enum: ['admin', 'manager', 'worker'], default: 'worker' },
  isActive: { type: Boolean, default: true },
  refreshTokenHash: { type: String, select: false },
  // Access tokens issued before this moment are refused. Set when a password is reset.
  tokensValidFrom: Date,
  // Account lockout: too many wrong passwords in a row pause sign-in for a while.
  failedLogins: { type: Number, default: 0 },
  lockedUntil: Date,
  // A password-reset link stores only the hash of its token, and it expires.
  resetTokenHash: { type: String, select: false },
  resetTokenExpires: { type: Date, select: false },
}, opts));

export const Shift = model('Shift', new Schema({
  name: { type: String, required: true },
  startTime: { type: String, required: true },
  endTime: { type: String, required: true },
}, opts));

export const Worker = model('Worker', new Schema({
  user: ref('User', { required: true }),
  employeeId: { type: String, required: true, unique: true },
  department: String,
  skills: [String],
  shift: ref('Shift'),
  status: { type: String, enum: ['active', 'on_leave', 'terminated'], default: 'active' },
}, opts));

const attendance = new Schema({
  worker: ref('Worker', { required: true }),
  date: { type: String, required: true },
  checkIn: Date,
  checkOut: Date,
  status: { type: String, enum: ['present', 'absent', 'late'], default: 'present' },
}, opts);
attendance.index({ worker: 1, date: 1 }, { unique: true });
export const Attendance = model('Attendance', attendance);

export const Task = model('Task', new Schema({
  title: { type: String, required: true },
  assignedTo: ref('Worker'),
  machine: ref('Machine'),
  order: ref('ProductionOrder'),
  status: { type: String, enum: ['todo', 'in_progress', 'done'], default: 'todo' },
  dueAt: Date,
}, opts));

const machine = new Schema({
  name: { type: String, required: true },
  code: { type: String, required: true, unique: true },
  type: String,
  status: { type: String, enum: ['running', 'idle', 'maintenance', 'offline'], default: 'idle', index: true },
  runHours: { type: Number, default: 0 },
  toolWearMin: Number,
  temperatureC: Number,
  vibrationMms: Number,
  lastServiceAt: Date,
  nextServiceDue: Date,
  lastReadingAt: Date,
  riskLevel: { type: String, enum: ['LOW', 'MEDIUM', 'HIGH', 'INSUFFICIENT_DATA'], default: 'INSUFFICIENT_DATA' },
  lastAssessedAt: Date,
  // Output of the trained statistical model. Kept apart from the Gemini assessment in riskLevel.
  mlRisk: { type: String, enum: ['Low', 'Medium', 'High'] },
  mlProbability: Number,
  mlScoredAt: Date,
  // 0 to 100 from the weighted score in telemetry.service; refreshed whenever a reading arrives.
  healthScore: Number,
}, opts);
export const Machine = model('Machine', machine);

const machineLog = new Schema({
  machine: ref('Machine', { required: true }),
  eventType: { type: String, default: 'status_change' },
  fromStatus: String,
  toStatus: String,
  startedAt: { type: Date, required: true },
  endedAt: Date,
  durationMins: Number,
  reason: String,
}, opts);
machineLog.index({ machine: 1, startedAt: -1 });
export const MachineLog = model('MachineLog', machineLog);

export const ProductionOrder = model('ProductionOrder', new Schema({
  orderNo: { type: String, required: true, unique: true },
  product: { type: String, required: true },
  quantity: { type: Number, required: true, min: 1 },
  producedQty: { type: Number, default: 0 },
  status: { type: String, enum: ['pending', 'in_progress', 'completed'], default: 'pending', index: true },
  machines: [ref('Machine')],
  // Stock the order uses, per unit produced. Consumed in full when the order starts.
  materials: [{ _id: false, item: ref('InventoryItem', { required: true }), qtyPerUnit: { type: Number, required: true, min: 0.0001 } }],
  materialsConsumed: { type: Boolean, default: false },
  dueDate: Date,
  startedAt: Date,
  progress: { type: Number, default: 0, min: 0, max: 100 },
  bottleneckFlag: { type: Boolean, default: false },
}, opts));

const outputLog = new Schema({
  order: ref('ProductionOrder', { required: true }),
  product: { type: String, required: true },
  qty: { type: Number, required: true, min: 1 },
  at: { type: Date, default: Date.now },
}, opts);
outputLog.index({ at: -1 });
export const OutputLog = model('OutputLog', outputLog);

export const InventoryItem = model('InventoryItem', new Schema({
  sku: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  quantity: { type: Number, required: true, min: 0 },
  unit: { type: String, default: 'pcs' },
  reorderThreshold: { type: Number, default: 0 },
  supplier: String,
  // Cost per unit, used for stock valuation and to pre-fill purchase order lines.
  unitCost: { type: Number, min: 0 },
  supplierRef: ref('Supplier'),
}, opts));

export const StockTransaction = model('StockTransaction', new Schema({
  item: ref('InventoryItem', { required: true }),
  type: { type: String, enum: ['in', 'out', 'adjust'], required: true },
  qty: { type: Number, required: true },
  order: ref('ProductionOrder'),
  by: ref('User'),
}, opts));

const alert = new Schema({
  type: { type: String, required: true },
  severity: { type: String, enum: ['info', 'warning', 'critical'], default: 'warning' },
  source: { type: String, required: true },
  sourceId: String,
  message: { type: String, required: true },
  status: { type: String, enum: ['open', 'acknowledged', 'resolved'], default: 'open' },
  // Set once when a critical alert sat unacknowledged for too long and was escalated.
  escalatedAt: Date,
}, opts);
alert.index({ status: 1, createdAt: -1 });
export const Alert = model('Alert', alert);

export const MachineAssessment = model('MachineAssessment', new Schema({
  machine: ref('Machine', { required: true, index: true }),
  riskLevel: { type: String, enum: ['LOW', 'MEDIUM', 'HIGH', 'INSUFFICIENT_DATA'], required: true },
  assessmentSummary: String,
  observedConditions: [String],
  evidenceUsed: [{ _id: false, field: String, value: Schema.Types.Mixed, unit: String }],
  recommendedActions: [String],
  limitations: [String],
  inputSnapshot: Schema.Types.Mixed,
  inputHash: { type: String, index: true },
  source: { type: String, enum: ['gemini', 'rules'], default: 'gemini' },
  alert: ref('Alert'),
  modelId: String,
  promptVersion: String,
  createdBy: ref('User'),
  assessedAt: { type: Date, default: Date.now },
}, opts));

const mlPrediction = new Schema({
  machine: ref('Machine', { required: true, index: true }),
  risk: { type: String, enum: ['Low', 'Medium', 'High'], required: true },
  probability: { type: Number, required: true, min: 0, max: 1 },
  features: Schema.Types.Mixed,
  featuresHash: { type: String, index: true },
  topFactors: [{ _id: false, feature: String, label: String, value: Number, unit: String, effect: Number, direction: String }],
  warnings: [String],
  modelVersion: { type: String, required: true },
  dataSource: String,
  source: { type: String, enum: ['manual', 'scheduled'], default: 'manual' },
  createdBy: ref('User'),
  predictedAt: { type: Date, default: Date.now },
}, opts);
export const MlPrediction = model('MlPrediction', mlPrediction);

export const AiReport = model('AiReport', new Schema({
  type: { type: String, required: true },
  content: { type: String, required: true },
  period: { start: Date, end: Date },
  generatedAt: { type: Date, default: Date.now },
}, opts));

export const AuditLog = model('AuditLog', new Schema({
  user: ref('User'),
  action: { type: String, required: true },
  resource: String,
  resourceId: String,
  diff: Schema.Types.Mixed,
  ip: String,
}, opts));

export * from './maintenance.js';
export * from './telemetry.js';
export * from './purchasing.js';
export * from './hr.js';
export * from './quality.js';
