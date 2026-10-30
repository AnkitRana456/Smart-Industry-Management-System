import crypto from 'node:crypto';
import { Machine, MlPrediction, SensorReading } from '../../models/index.js';
import { emit } from '../../sockets/index.js';
import { ApiError } from '../../utils/ApiError.js';
import { logger } from '../../utils/logger.js';
import * as alerts from '../alerts/alert.service.js';
import { buildEvidence } from '../ai/assessment.service.js';
import * as client from './ml.client.js';

const REUSE_WINDOW_MS = 5 * 60_000;

/**
 * The six inputs come from records SIMS already keeps. Nothing is guessed: if any is missing the
 * machine simply cannot be scored yet, and the reply says which.
 */
export async function buildFeatures(machine) {
  const e = await buildEvidence(machine, { includeHistory: true });
  const features = {
    runHours: e.readings.runHours?.value,
    daysSinceService: e.service.daysSinceLastService?.value,
    downtimeCount30d: e.history?.downtimeEvents.value,
    toolWearMin: e.readings.toolWearMin?.value,
    temperatureC: e.readings.temperatureC?.value,
    vibrationMms: e.readings.vibrationMms?.value,
  };
  const missing = Object.entries(features).filter(([, v]) => v == null).map(([k]) => k);
  const warnings = e.readingsStale ? [`Readings are ${e.readingAgeHours} hours old, so this score reflects older conditions.`] : [];
  return { features, missing, warnings };
}

const hashOf = (f) => crypto.createHash('sha256').update(JSON.stringify(f)).digest('hex');

const toResponse = (p, extra = {}) => ({
  predictionId: String(p._id),
  machineId: String(p.machine),
  risk: p.risk,
  probability: p.probability,
  topFactors: p.topFactors,
  warnings: p.warnings,
  modelVersion: p.modelVersion,
  dataSource: p.dataSource,
  predictedAt: p.predictedAt,
  ...extra,
});

/** Policy: High raises one warning alert per machine (reused while unresolved); Low resolves it; Medium leaves alerts alone. */
async function applyAlertPolicy(machine, prediction) {
  if (prediction.risk === 'High') {
    await alerts.create({
      type: 'ml_risk', severity: 'warning', source: 'risk-model', sourceId: machine._id,
      message: `Risk model puts ${machine.name} (${machine.code}) in the High band (${Math.round(prediction.probability * 100)}% estimated). It is a statistical estimate trained on synthetic data, so treat it as a prompt to inspect, not a diagnosis.`,
    });
  } else if (prediction.risk === 'Low') {
    await alerts.resolveFor('ml_risk', machine._id);
  }
}

export async function score(machineId, { userId, source = 'manual', force = false } = {}) {
  const machine = await Machine.findById(machineId).lean();
  if (!machine) throw ApiError.notFound('Machine not found');

  const { features, missing, warnings: dataWarnings } = await buildFeatures(machine);
  if (missing.length) throw new ApiError(422, `This machine cannot be scored yet. Missing: ${missing.join(', ')}.`);

  const featuresHash = hashOf(features);
  if (!force) {
    const recent = await MlPrediction.findOne({ machine: machineId, featuresHash, predictedAt: { $gte: new Date(Date.now() - REUSE_WINDOW_MS) } }).sort({ _id: -1 }).lean();
    if (recent) return toResponse(recent, { reused: true });
  }

  const result = await client.predict(features);
  const saved = await MlPrediction.create({
    machine: machine._id, risk: result.risk, probability: result.probability, features, featuresHash,
    topFactors: result.topFactors, warnings: [...dataWarnings, ...result.warnings], modelVersion: result.modelVersion,
    dataSource: result.dataSource, source, createdBy: userId, predictedAt: new Date(),
  });

  await applyAlertPolicy(machine, result);
  const updated = await Machine.findByIdAndUpdate(machine._id, { mlRisk: result.risk, mlProbability: result.probability, mlScoredAt: saved.predictedAt }, { new: true }).lean();
  emit('machine:updated', updated, 'room:all');
  emit('ml:scored', { machineId: String(machine._id), risk: result.risk }, 'room:staff');
  return toResponse(saved, { reused: false });
}

const SENSOR_WINDOW_MS = 24 * 3_600_000;

/**
 * Second opinion from the sensor model (trained on the public AI4I dataset). It reads the newest
 * telemetry reading, so it is computed on demand, never stored, and never raises alerts: it is an
 * extra signal next to the main model, not a replacement for it.
 */
export async function scoreSensor(machineId) {
  const machine = await Machine.findById(machineId).lean();
  if (!machine) throw ApiError.notFound('Machine not found');
  const reading = await SensorReading.findOne({
    machine: machineId, at: { $gte: new Date(Date.now() - SENSOR_WINDOW_MS) }, rpm: { $gt: 0 }, powerKw: { $exists: true, $gte: 0 },
  }).sort({ at: -1 }).lean();
  if (!reading) throw new ApiError(422, 'No sensor reading with rpm and power from the last 24 hours. Send telemetry first, or start the simulator.');
  if (!Number.isFinite(machine.toolWearMin)) throw new ApiError(422, 'This machine has no tool wear recorded yet.');

  // Power (kW) = torque (Nm) x rpm / 9549, so torque follows from the two readings the plant records.
  const inputs = { rpm: reading.rpm, torqueNm: Math.round(((reading.powerKw * 9549.3) / reading.rpm) * 10) / 10, toolWearMin: machine.toolWearMin };
  const result = await client.predictSensor(inputs);
  return { machineId: String(machine._id), ...result, inputs, torqueIsDerived: true, readingAt: reading.at };
}

export async function history(machineId, { limit = 10 } = {}) {
  if (!(await Machine.exists({ _id: machineId }))) throw ApiError.notFound('Machine not found');
  const rows = await MlPrediction.find({ machine: machineId }).sort({ _id: -1 }).limit(limit).lean();
  return rows.map((r) => toResponse(r));
}

/** Re-scores every machine in turn. Stops at the first outage instead of logging one failure per machine. */
export async function scoreAll(source = 'scheduled') {
  const summary = { scored: 0, skipped: 0, failed: 0, unavailable: false };
  const machines = await Machine.find().select('_id').lean();
  for (const m of machines) {
    try {
      await score(m._id, { source, force: true });
      summary.scored += 1;
    } catch (err) {
      if (err.status === 422) summary.skipped += 1;
      else if (err.status === 503) { summary.unavailable = true; break; }
      else { summary.failed += 1; logger.warn({ message: err.message }, 'ML scoring failed for a machine'); }
    }
  }
  return summary;
}

export async function status() {
  if (!client.isEnabled()) return { enabled: false, reachable: false };
  try {
    const h = await client.health();
    if (!h.modelLoaded) return { enabled: true, reachable: true, modelLoaded: false };
    const meta = await client.modelInfo();
    const sensor = await client.sensorModelInfo().catch(() => null);
    return {
      enabled: true, reachable: true, modelLoaded: true, modelVersion: meta.modelVersion, algorithm: meta.algorithm,
      dataSource: meta.dataSource, trainedAt: meta.trainedAt, metrics: meta.metrics, bands: meta.bands, limitations: meta.limitations,
      features: meta.features,
      sensor: sensor && { modelVersion: sensor.modelVersion, dataSource: sensor.dataSource, metrics: sensor.metrics, limitations: sensor.limitations },
    };
  } catch (err) {
    return { enabled: true, reachable: false, message: err.message };
  }
}
