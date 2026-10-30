import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const reading = new Schema({
  machine: { type: Schema.Types.ObjectId, ref: 'Machine', required: true },
  temperatureC: Number,
  vibrationMms: Number,
  rpm: Number,
  powerKw: Number,
  at: { type: Date, default: Date.now },
});
reading.index({ machine: 1, at: -1 });
// Readings are only useful while recent; the database drops them after a week so storage stays bounded.
reading.index({ at: 1 }, { expireAfterSeconds: 7 * 24 * 3600 });
export const SensorReading = model('SensorReading', reading);
