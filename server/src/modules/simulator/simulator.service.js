import { Machine, ProductionOrder } from '../../models/index.js';
import { emit } from '../../sockets/index.js';
import { logger } from '../../utils/logger.js';
import { changeStatus } from '../machines/machine.service.js';
import { ingest } from '../telemetry/telemetry.service.js';
import { setProgress } from '../production/order.service.js';

const OFFLINE_REASONS = ['Tool change', 'Power fluctuation', 'Material shortage', 'Sensor fault', 'Operator break'];
const MAX_RUN_MS = 30 * 60_000;

// Where a machine goes next, as [status, weight] pairs.
const TRANSITIONS = {
  running: [['idle', 4], ['offline', 4], ['maintenance', 2]],
  idle: [['running', 8], ['offline', 2]],
  offline: [['running', 7], ['maintenance', 3]],
  maintenance: [['running', 1]],
};

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const between = (rng, lo, hi) => lo + rng() * (hi - lo);

function weighted(pairs, rng) {
  const total = pairs.reduce((a, [, w]) => a + w, 0);
  let r = rng() * total;
  for (const [value, w] of pairs) if ((r -= w) <= 0) return value;
  return pairs[0][0];
}

/** Moves a machine's readings a little, the way live sensors would. Running machines wear and heat up. */
async function driftReadings(machine, rng) {
  const running = machine.status === 'running';
  const set = {
    lastReadingAt: new Date(),
    runHours: Math.round((machine.runHours + (running ? between(rng, 0.05, 0.4) : 0)) * 100) / 100,
    toolWearMin: Math.round(clamp((machine.toolWearMin ?? 0) + (running ? between(rng, 1, 5) : 0), 0, 400)),
    temperatureC: Math.round(clamp((machine.temperatureC ?? 60) + between(rng, running ? -1 : -3, running ? 3 : 1), 25, 130) * 10) / 10,
    vibrationMms: Math.round(clamp((machine.vibrationMms ?? 2) + between(rng, -0.25, running ? 0.4 : 0.1), 0.2, 12) * 100) / 100,
  };
  const updated = await Machine.findByIdAndUpdate(machine._id, set, { new: true }).lean();
  // Goes through the same path as a real sensor: stores the reading, checks limits, updates the health score.
  await ingest(machine._id, {
    temperatureC: set.temperatureC, vibrationMms: set.vibrationMms,
    rpm: running ? Math.round(between(rng, 1650, 1950)) : 0,
    powerKw: Math.round((running ? between(rng, 6, 9) : between(rng, 0.2, 0.6)) * 10) / 10,
  });
  emit('machine:updated', await Machine.findById(machine._id).lean(), 'room:all');
}

/**
 * One simulation step. Status changes go through changeStatus, so downtime logs, alerts,
 * bottleneck flags and socket events all behave exactly as they would for real changes.
 */
export async function tick({ events = 3 } = {}, rng = Math.random) {
  const machines = await Machine.find().lean();
  const changes = [];

  const shuffled = [...machines].sort(() => rng() - 0.5).slice(0, Math.min(events, machines.length));
  for (const m of shuffled) {
    const to = weighted(TRANSITIONS[m.status], rng);
    const reason = to === 'offline' ? OFFLINE_REASONS[Math.floor(rng() * OFFLINE_REASONS.length)] : undefined;
    await changeStatus(m._id, { status: to, reason });
    if (m.status === 'maintenance' && to === 'running') {
      // Finished maintenance resets wear and moves the service dates forward.
      await Machine.updateOne({ _id: m._id }, { toolWearMin: 0, lastServiceAt: new Date(), nextServiceDue: new Date(Date.now() + 30 * 86_400_000) });
    }
    changes.push({ code: m.code, from: m.status, to });
  }

  const fresh = await Machine.find().lean();
  await Promise.all(fresh.map((m) => driftReadings(m, rng)));

  // Output only advances while every machine an order depends on is running.
  const outputs = [];
  const orders = await ProductionOrder.find({ status: 'in_progress' }).populate('machines', 'status').lean();
  for (const o of orders) {
    if (!o.machines.length || o.machines.some((m) => m.status !== 'running')) continue;
    const next = Math.min(o.quantity - 1, o.producedQty + Math.round(between(rng, 5, 30)));
    if (next > o.producedQty) {
      await setProgress(o._id, next);
      outputs.push({ orderNo: o.orderNo, units: next - o.producedQty });
    }
  }

  return { changes, readingsUpdated: fresh.length, output: outputs };
}

let timer = null;
let startedAt = null;
let intervalSec = 5;
let ticks = 0;

export const status = () => ({ running: Boolean(timer), intervalSec, ticks, startedAt, stopsAt: timer ? new Date(startedAt.getTime() + MAX_RUN_MS) : null });

export function start({ intervalSec: every = 5, events = 2 } = {}) {
  stop();
  intervalSec = every;
  startedAt = new Date();
  ticks = 0;
  timer = setInterval(async () => {
    if (Date.now() - startedAt.getTime() > MAX_RUN_MS) return stop();
    try {
      await tick({ events });
      ticks += 1;
    } catch (err) {
      logger.error({ err }, 'Simulator tick failed');
    }
  }, every * 1000);
  timer.unref?.();
  return status();
}

export function stop() {
  if (timer) clearInterval(timer);
  timer = null;
  return status();
}
