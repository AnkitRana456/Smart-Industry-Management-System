import mongoose from 'mongoose';

const { Schema, model } = mongoose;
const ref = (name, extra = {}) => ({ type: Schema.Types.ObjectId, ref: name, ...extra });
const opts = { timestamps: true };

// Bill of materials: what one unit of a product takes from stock. Orders copy it when they carry no materials of their own.
export const BOM = model('BOM', new Schema({
  product: { type: String, required: true, trim: true, unique: true },
  items: [{ _id: false, item: ref('InventoryItem', { required: true }), qtyPerUnit: { type: Number, required: true, min: 0.0001 } }],
}, opts));

export const QualityCheck = model('QualityCheck', new Schema({
  order: ref('ProductionOrder', { required: true, index: true }),
  stage: { type: String, required: true, trim: true, maxlength: 60 },
  inspectedQty: { type: Number, required: true, min: 1 },
  defectCount: { type: Number, default: 0, min: 0 },
  scrapQty: { type: Number, default: 0, min: 0 },
  notes: { type: String, trim: true, maxlength: 300 },
  checkedBy: ref('User'),
}, opts));
