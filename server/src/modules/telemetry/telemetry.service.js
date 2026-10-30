import { Machine, MachineLog, SensorReading } from '../../models/index.js';
import { emit } from '../../sockets/index.js';
import { ApiError } from '../../utils/ApiError.js';
import * as alerts from '../alerts/alert.service.js';

// Plant-wide limits. shortcut: one set for every machine type, move onto the machine record when types differ.
export const THRESHOLDS = {
  temperatureC: { warn: 85, crit: 100, label: 'Temperature', unit: '°C' },
  vibrationMms: { warn: 4.5, crit: 7.1, label: 'Vibration', unit: 'mm/s' },
};

const DAY = 86_400_000;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/** Which monitored readings are over a limit, with the severity of each. */
export function breaches(values) {
  return Object.entries(THRESHOLDS).flatMap(([field, t]) => {
    const v = values[field];
    if (!Number.isFinite(v)) return [];
    if (v >= t.crit) return [{ field, severity: 'critical', value: v, limit: t.crit, ...t }];
    if (v >= t.warn) return [{ field, severity: 'warning', value: v, limit: t.warn, ...t }];
    return [];
  });
}

/**
 * Simple weighted health score, 0 to 100 (100 = no concerns). Every deduction is returned with its
 * reason so the number can be explained, not just shown.
 */
export function computeHealth(machine, { downtimeMins7d = 0, now = new Date() } = {}) {
  const factors = [];
  const add = (label, penalty) => { if (penalty > 0) factors.push({ label, penalty: Math.round(penalty) }); };

  if (machine.status === 'offline') add('Currently offline', 20);
  add('AI assessment rates it HIGH risk', machine.riskLevel === 'HIGH' ? 25 : 0);
  add('AI assessment rates it MEDIUM risk', machine.riskLevel === 'MEDIUM' ? 10 : 0);
  add('Risk model rates it High', machine.mlRisk === 'High' ? 15 : 0);
  add('Risk model rates it Medium', machine.mlRisk === 'Medium' ? 5 : 0);
  if (machine.nextServiceDue && new Date(machine.nextServiceDue) < now) {
    add('Service is overdue', Math.min(20, 5 + (now - new Date(machine.nextServiceDue)) / DAY));
  }
  add('Downtime in the last 7 days', Math.min(20, (downtimeMins7d / 60) * 2));
  for (const b of breaches(machine)) add(`${b.label} ${b.severity === 'critical' ? 'above the critical limit' : 'above the warning limit'}`, b.severity === 'critical' ? 20 : 10);

  const score = clamp(100 - factors.reduce((n, f) => n + f.penalty, 0), 0, 100);
  return { score, factors };
}

async function downtimeMins7d(machineId, now = new Date()) {
  const since = new Date(now.getTime() - 7 * DAY);
  const [row] = await MachineLog.aggregate([
    { $match: { machine: machineId, toStatus: { $in: ['offline', 'maintenance'] }, startedAt: { $gte: since } } },
    { $group: { _id: null, mins: { $sum: { $ifNull: ['$durationMins', { $dateDiff: { startDate: '$startedAt', endDate: '$$NOW', unit: 'minute' } }] } } } },
  ]);
  return row?.mins ?? 0;
}

export async function health(machineId) {
  const machine = await Machine.findById(machineId).lean();
  if (!machine) throw ApiError.notFound('Machine not found');
  return { machineId: String(machine._id), thresholds: THRESHOLDS, ...computeHealth(machine, { downtimeMins7d: await downtimeMins7d(machine._id) }) };
}

/** Stores a reading, updates the machine's current values and raises or clears threshold alerts. */
export async function ingest(machineId, values, at = new Date()) {
  if (!(await Machine.exists({ _id: machineId }))) throw ApiError.notFound('Machine not found');
  const reading = await SensorReading.create({ machine: machineId, ...values, at });

  const set = { lastReadingAt: at };
  for (const f of ['temperatureC', 'vibrationMms']) if (Number.isFinite(values[f])) set[f] = values[f];
  let machine = await Machine.findByIdAndUpdate(machineId, set, { new: true }).lean();

  const hit = breaches(values);
  for (const [field, t] of Object.entries(THRESHOLDS)) {
    const type = `telemetry_${field}`;
    const b = hit.find((x) => x.field === field);
    if (b) {
      await alerts.create({
        type, severity: b.severity, source: 'telemetry', sourceId: machineId,
        message: `${machine.name} (${machine.code}): ${t.label.toLowerCase()} ${b.value} ${t.unit} is ${b.severity === 'critical' ? 'above the critical' : 'above the warning'} limit of ${b.limit} ${t.unit}.`,
      });
    } else if (Number.isFinite(values[field])) {
      await alerts.resolveFor(type, machineId);
    }
  }

  const { score } = computeHealth(machine, { downtimeMins7d: await downtimeMins7d(machine._id, at) });
  machine = await Machine.findByIdAndUpdate(machineId, { healthScore: score }, { new: true }).lean();

  const payload = {
    machineId: String(machineId), temperatureC: values.temperatureC, vibrationMms: values.vibrationMms,
    rpm: values.rpm, powerKw: values.powerKw, at: at.toISOString(), healthScore: score,
  };
  emit('telemetry:reading', payload, `machine:${machineId}`);
  emit('telemetry:reading', payload, 'room:staff');
  return { reading, healthScore: score };
}

export async function history(machineId, { hours, limit }) {
  if (!(await Machine.exists({ _id: machineId }))) throw ApiError.notFound('Machine not found');
  const since = new Date(Date.now() - hours * 3_600_000);
  const rows = await SensorReading.find({ machine: machineId, at: { $gte: since } }).sort({ at: -1 }).limit(limit).lean();
  return rows.reverse();
}
