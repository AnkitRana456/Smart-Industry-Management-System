import mongoose from 'mongoose';

const { Schema, model } = mongoose;
const ref = (name, extra = {}) => ({ type: Schema.Types.ObjectId, ref: name, ...extra });
const opts = { timestamps: true };

export const Supplier = model('Supplier', new Schema({
  name: { type: String, required: true, trim: true, unique: true },
  contactName: String,
  email: { type: String, trim: true, lowercase: true },
  phone: String,
  leadTimeDays: { type: Number, min: 0, max: 365, default: 7 },
  notes: String,
  active: { type: Boolean, default: true },
}, opts));

export const PurchaseOrder = model('PurchaseOrder', new Schema({
  poNo: { type: String, required: true, unique: true },
  // Optional on a draft the system created; a manager must pick one before approving.
  supplier: ref('Supplier'),
  lines: [{
    _id: false,
    item: ref('InventoryItem', { required: true }),
    qty: { type: Number, required: true, min: 1 },
    unitCost: { type: Number, min: 0, default: 0 },
  }],
  status: { type: String, enum: ['draft', 'approved', 'received', 'cancelled'], default: 'draft', index: true },
  createdFromAlert: { type: Boolean, default: false },
  notes: String,
  createdBy: ref('User'),
  approvedBy: ref('User'),
  approvedAt: Date,
  receivedAt: Date,
}, opts));
