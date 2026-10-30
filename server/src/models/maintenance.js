import mongoose from 'mongoose';

const { Schema, model } = mongoose;
const ref = (name, extra = {}) => ({ type: Schema.Types.ObjectId, ref: name, ...extra });
const opts = { timestamps: true };
const PRIORITY = ['low', 'medium', 'high', 'urgent'];

export const WorkOrder = model('WorkOrder', new Schema({
  woNo: { type: String, required: true, unique: true },
  machine: ref('Machine', { required: true, index: true }),
  title: { type: String, required: true, trim: true },
  description: String,
  type: { type: String, enum: ['preventive', 'corrective', 'inspection'], default: 'corrective' },
  priority: { type: String, enum: PRIORITY, default: 'medium' },
  status: { type: String, enum: ['open', 'in_progress', 'done', 'cancelled'], default: 'open', index: true },
  assignedTo: ref('Worker'),
  dueAt: Date,
  startedAt: Date,
  completedAt: Date,
  resolution: String,
  // Where it came from: a person, a recurring schedule, or the machine going offline.
  source: { type: String, enum: ['manual', 'schedule', 'downtime'], default: 'manual' },
  schedule: ref('MaintenanceSchedule'),
  notes: [{ _id: false, by: String, text: String, at: { type: Date, default: Date.now } }],
}, opts));

export const MaintenanceSchedule = model('MaintenanceSchedule', new Schema({
  machine: ref('Machine', { required: true, index: true }),
  title: { type: String, required: true, trim: true },
  everyDays: { type: Number, required: true, min: 1, max: 730 },
  nextDueAt: { type: Date, required: true },
  priority: { type: String, enum: PRIORITY, default: 'medium' },
  active: { type: Boolean, default: true },
  lastDoneAt: Date,
  // Set while a generated work order is still open, so the scheduler never creates a second one.
  openWorkOrder: ref('WorkOrder'),
}, opts));

export const HandoverNote = model('HandoverNote', new Schema({
  text: { type: String, required: true, trim: true, maxlength: 500 },
  priority: { type: String, enum: ['info', 'important'], default: 'info' },
  machine: ref('Machine'),
  author: ref('User', { required: true }),
  authorName: String,
  resolved: { type: Boolean, default: false, index: true },
  resolvedAt: Date,
}, opts));
