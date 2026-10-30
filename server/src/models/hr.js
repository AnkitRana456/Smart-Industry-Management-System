import mongoose from 'mongoose';

const { Schema, model } = mongoose;
const ref = (name, extra = {}) => ({ type: Schema.Types.ObjectId, ref: name, ...extra });
const opts = { timestamps: true };

export const LeaveRequest = model('LeaveRequest', new Schema({
  worker: ref('Worker', { required: true, index: true }),
  // Factory-timezone day keys (YYYY-MM-DD), both inclusive, so they compare as plain strings.
  from: { type: String, required: true },
  to: { type: String, required: true },
  reason: { type: String, trim: true, maxlength: 300 },
  status: { type: String, enum: ['pending', 'approved', 'rejected', 'cancelled'], default: 'pending', index: true },
  reviewedBy: ref('User'),
  reviewedAt: Date,
  reviewNote: { type: String, trim: true, maxlength: 300 },
}, opts));

const notification = new Schema({
  user: ref('User', { required: true }),
  kind: { type: String, default: 'info' },
  tone: { type: String, enum: ['info', 'success', 'warning', 'critical'], default: 'info' },
  title: { type: String, required: true },
  body: String,
  link: String,
  readAt: Date,
}, opts);
notification.index({ user: 1, createdAt: -1 });
export const Notification = model('Notification', notification);
