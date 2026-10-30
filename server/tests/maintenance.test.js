import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, describe, test } from 'node:test';
import { freshDb } from './helpers/db.js';

process.env.NODE_ENV = 'test';
process.env.MONGO_URI = 'mongodb://127.0.0.1:27017/sims_test_maintenance';
process.env.SCHEDULER_ENABLED = 'false';

const { default: bcrypt } = await import('bcryptjs');
const { default: mongoose } = await import('mongoose');
const { createApp } = await import('../src/app.js');
const models = await import('../src/models/index.js');
const { generateDue } = await import('../src/modules/maintenance/maintenance.service.js');

const DAY = 86_400_000;
let server;
let base;
const tokens = {};
const w = {};
let seq = 0;

async function call(method, path, { token = tokens.manager, body } = {}) {
  const res = await fetch(base + path, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}
const machine = (extra = {}) => models.Machine.create({ name: `Mach ${++seq}`, code: `MC-${seq}`, status: 'running', ...extra });
const wo = async (extra = {}) => (await call('POST', '/api/maintenance/work-orders', {
  body: { machine: String((await machine())._id), title: `Fix thing ${++seq}`, ...extra },
})).body.data;
const move = (o, status, opts = {}) => call('PATCH', `/api/maintenance/work-orders/${o._id}/status`, { body: { status }, ...opts });

before(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  await freshDb(mongoose);
  const passwordHash = await bcrypt.hash('Password@123', 4);
  const users = await models.User.create([
    { name: 'Manager', email: 'm@t.io', passwordHash, role: 'manager' },
    { name: 'Worker One', email: 'w1@t.io', passwordHash, role: 'worker' },
    { name: 'Worker Two', email: 'w2@t.io', passwordHash, role: 'worker' },
  ]);
  const workers = await models.Worker.create([
    { user: users[1]._id, employeeId: 'E-1' },
    { user: users[2]._id, employeeId: 'E-2' },
  ]);
  w.one = String(workers[0]._id);
  w.two = String(workers[1]._id);
  server = http.createServer(createApp());
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
  for (const [k, email] of [['manager', 'm@t.io'], ['worker', 'w1@t.io'], ['worker2', 'w2@t.io']]) {
    tokens[k] = (await call('POST', '/api/auth/login', { token: null, body: { email, password: 'Password@123' } })).body.data.accessToken;
  }
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  server.closeAllConnections?.();
  server.close();
});

describe('Work orders', () => {
  test('staff create them with sequential numbers; workers cannot', async () => {
    const a = await wo();
    const b = await wo({ priority: 'urgent' });
    assert.match(a.woNo, /^WO-\d+$/);
    assert.equal(Number(b.woNo.slice(3)), Number(a.woNo.slice(3)) + 1);
    assert.equal(b.priority, 'urgent');
    const denied = await call('POST', '/api/maintenance/work-orders', { token: tokens.worker, body: { machine: String(new mongoose.Types.ObjectId()), title: 'Nope' } });
    assert.equal(denied.status, 403);
    assert.equal((await call('POST', '/api/maintenance/work-orders', { body: { machine: String(new mongoose.Types.ObjectId()), title: 'Ghost machine' } })).status, 400);
  });

  test('status only moves forward and finished orders are closed to edits', async () => {
    const o = await wo();
    assert.equal((await move(o, 'done')).status, 409, 'cannot skip in_progress');
    const started = await move(o, 'in_progress');
    assert.equal(started.status, 200);
    assert.ok(started.body.data.startedAt);
    const done = await move(o, 'done', { body: { status: 'done', resolution: 'Replaced belt' } });
    assert.equal(done.body.data.status, 'done');
    assert.equal(done.body.data.resolution, 'Replaced belt');
    assert.ok(done.body.data.completedAt);
    assert.equal((await move(o, 'in_progress')).status, 409);
    assert.equal((await call('PATCH', `/api/maintenance/work-orders/${o._id}`, { body: { priority: 'low' } })).status, 409);
  });

  test('workers see and move only the orders assigned to them, and cannot cancel', async () => {
    const mine = await wo({ assignedTo: w.one });
    const theirs = await wo({ assignedTo: w.two });
    const list = await call('GET', '/api/maintenance/work-orders?limit=100', { token: tokens.worker });
    const ids = list.body.data.items.map((x) => x._id);
    assert.ok(ids.includes(mine._id));
    assert.ok(!ids.includes(theirs._id));
    assert.equal((await move(theirs, 'in_progress', { token: tokens.worker })).status, 403);
    assert.equal((await move(mine, 'in_progress', { token: tokens.worker })).status, 200);
    assert.equal((await move(mine, 'cancelled', { token: tokens.worker })).status, 403);
  });

  test('notes are stamped with the author and visible on the order', async () => {
    const o = await wo({ assignedTo: w.one });
    const r = await call('POST', `/api/maintenance/work-orders/${o._id}/notes`, { token: tokens.worker, body: { text: 'Part is on order' } });
    assert.equal(r.status, 201);
    assert.deepEqual([r.body.data.notes[0].by, r.body.data.notes[0].text], ['Worker One', 'Part is on order']);
    const other = await call('POST', `/api/maintenance/work-orders/${o._id}/notes`, { token: tokens.worker2, body: { text: 'Not mine' } });
    assert.equal(other.status, 403);
  });

  test('overdue is flagged only for open work and can be filtered', async () => {
    const late = await wo({ dueAt: new Date(Date.now() - 2 * DAY).toISOString() });
    const fine = await wo({ dueAt: new Date(Date.now() + 5 * DAY).toISOString() });
    const res = await call('GET', '/api/maintenance/work-orders?overdue=true&limit=100');
    const ids = res.body.data.items.map((x) => x._id);
    assert.ok(ids.includes(late._id) && !ids.includes(fine._id));
    assert.equal(res.body.data.items.find((x) => x._id === late._id).overdue, true);
  });

  test('an offline machine opens one corrective order, not one per trip', async () => {
    const m = await machine();
    const off = () => call('PATCH', `/api/machines/${m._id}/status`, { body: { status: 'offline', reason: 'Sensor fault' } });
    const back = () => call('PATCH', `/api/machines/${m._id}/status`, { body: { status: 'running' } });
    assert.equal((await off()).status, 200);
    await back();
    await off();
    const orders = await models.WorkOrder.find({ machine: m._id, source: 'downtime' }).lean();
    assert.equal(orders.length, 1);
    assert.equal(orders[0].type, 'corrective');
    assert.match(orders[0].title, /Sensor fault/);
  });
});

describe('Recurring schedules', () => {
  const schedule = async (m, extra = {}) => (await call('POST', '/api/maintenance/schedules', {
    body: { machine: String(m._id), title: 'Monthly lubrication', everyDays: 30, nextDueAt: new Date(Date.now() + DAY).toISOString(), ...extra },
  })).body.data;

  test('a schedule that is due soon gets one preventive order, however often the job runs', async () => {
    const m = await machine();
    const s = await schedule(m);
    assert.equal((await generateDue()).created >= 1, true);
    assert.equal((await generateDue()).created, 0);
    const orders = await models.WorkOrder.find({ schedule: s._id }).lean();
    assert.equal(orders.length, 1);
    assert.deepEqual([orders[0].type, orders[0].source], ['preventive', 'schedule']);
    assert.equal(String((await models.MaintenanceSchedule.findById(s._id).lean()).openWorkOrder), String(orders[0]._id));
  });

  test('a schedule far in the future is left alone', async () => {
    const s = await schedule(await machine(), { nextDueAt: new Date(Date.now() + 20 * DAY).toISOString() });
    await generateDue();
    assert.equal(await models.WorkOrder.countDocuments({ schedule: s._id }), 0);
  });

  test('finishing the order records the service and rolls the schedule forward', async () => {
    const m = await machine();
    const s = await schedule(m, { everyDays: 14 });
    await generateDue();
    const order = await models.WorkOrder.findOne({ schedule: s._id }).lean();
    await move(order, 'in_progress');
    const before = Date.now();
    assert.equal((await move(order, 'done')).status, 200);
    const sch = await models.MaintenanceSchedule.findById(s._id).lean();
    assert.equal(sch.openWorkOrder, undefined);
    assert.ok(Math.abs(new Date(sch.nextDueAt) - (before + 14 * DAY)) < 60_000);
    const mm = await models.Machine.findById(m._id).lean();
    assert.ok(mm.lastServiceAt);
    assert.equal(new Date(mm.nextServiceDue).getTime(), new Date(sch.nextDueAt).getTime());
    await generateDue();
    assert.equal(await models.WorkOrder.countDocuments({ schedule: s._id }), 1, 'the next one is not due yet');
  });

  test('cancelling the order lets the schedule generate another', async () => {
    const s = await schedule(await machine());
    await generateDue();
    const order = await models.WorkOrder.findOne({ schedule: s._id }).lean();
    assert.equal((await move(order, 'cancelled')).status, 200);
    await generateDue();
    assert.equal(await models.WorkOrder.countDocuments({ schedule: s._id }), 2);
  });

  test('schedules are managed by staff only and validated', async () => {
    const m = await machine();
    const body = { machine: String(m._id), title: 'Check', everyDays: 7, nextDueAt: new Date().toISOString() };
    assert.equal((await call('POST', '/api/maintenance/schedules', { token: tokens.worker, body })).status, 403);
    assert.equal((await call('POST', '/api/maintenance/schedules', { body: { ...body, everyDays: 0 } })).status, 400);
  });
});

describe('Reliability', () => {
  test('counts offline trips as failures and reports MTTR, MTBF and availability', async () => {
    await freshDb(mongoose);
    const passwordHash = await bcrypt.hash('Password@123', 4);
    await models.User.create({ name: 'Manager', email: 'm@t.io', passwordHash, role: 'manager' });
    tokens.manager = (await call('POST', '/api/auth/login', { token: null, body: { email: 'm@t.io', password: 'Password@123' } })).body.data.accessToken;
    const a = await machine();
    const b = await machine();
    const at = (d) => new Date(Date.now() - d * DAY);
    await models.MachineLog.create([
      { machine: a._id, toStatus: 'offline', startedAt: at(2), endedAt: at(2), durationMins: 60 },
      { machine: a._id, toStatus: 'offline', startedAt: at(1), endedAt: at(1), durationMins: 120 },
      { machine: a._id, toStatus: 'maintenance', startedAt: at(1), endedAt: at(1), durationMins: 30 },
      { machine: a._id, toStatus: 'offline', startedAt: at(20), endedAt: at(20), durationMins: 999 },
    ]);
    const { status, body } = await call('GET', '/api/analytics/reliability?days=7');
    assert.equal(status, 200);
    const ra = body.data.machines.find((m) => m.machineId === String(a._id));
    const rb = body.data.machines.find((m) => m.machineId === String(b._id));
    assert.deepEqual([ra.failures, ra.downtimeMins, ra.mttrMins], [2, 210, 90], 'maintenance is downtime but not a failure; old events are outside the window');
    assert.equal(ra.mtbfHours, Math.round(((7 * 1440 - 210) / 2 / 60) * 10) / 10);
    assert.equal(ra.availabilityPct, Math.round((1 - 210 / (7 * 1440)) * 1000) / 10);
    assert.deepEqual([rb.failures, rb.mttrMins, rb.mtbfHours, rb.availabilityPct], [0, null, null, 100]);
    assert.equal(body.data.machines[0].machineId, String(a._id), 'most failures first');
    assert.equal(body.data.totalFailures, 2);
  });
});

describe('Handover notes', () => {
  test('anyone leaves a note, important ones come first, and closing follows ownership', async () => {
    await freshDb(mongoose);
    const passwordHash = await bcrypt.hash('Password@123', 4);
    const [mgr, wk, wk2] = await models.User.create([
      { name: 'Manager', email: 'm@t.io', passwordHash, role: 'manager' },
      { name: 'Worker One', email: 'w1@t.io', passwordHash, role: 'worker' },
      { name: 'Worker Two', email: 'w2@t.io', passwordHash, role: 'worker' },
    ]);
    assert.ok(mgr && wk && wk2);
    for (const [k, email] of [['manager', 'm@t.io'], ['worker', 'w1@t.io'], ['worker2', 'w2@t.io']]) {
      tokens[k] = (await call('POST', '/api/auth/login', { token: null, body: { email, password: 'Password@123' } })).body.data.accessToken;
    }
    const plain = await call('POST', '/api/handover', { token: tokens.worker, body: { text: 'Floor swept' } });
    const loud = await call('POST', '/api/handover', { token: tokens.worker, body: { text: 'Press C leaking oil', priority: 'important' } });
    assert.equal(plain.status, 201);
    assert.equal(plain.body.data.authorName, 'Worker One');

    const open = await call('GET', '/api/handover', { token: tokens.worker2 });
    assert.deepEqual(open.body.data.items.map((n) => n.text), ['Press C leaking oil', 'Floor swept']);

    assert.equal((await call('PATCH', `/api/handover/${loud.body.data._id}/resolve`, { token: tokens.worker2 })).status, 403);
    assert.equal((await call('PATCH', `/api/handover/${loud.body.data._id}/resolve`, { token: tokens.worker })).status, 200);
    assert.equal((await call('PATCH', `/api/handover/${plain.body.data._id}/resolve`, { token: tokens.manager })).status, 200);
    assert.equal((await call('GET', '/api/handover')).body.data.items.length, 0);
    assert.equal((await call('GET', '/api/handover?resolved=true')).body.data.items.length, 2);
    assert.equal((await call('POST', '/api/handover', { body: { text: 'x' } })).status, 400);
    assert.equal((await call('DELETE', `/api/handover/${plain.body.data._id}`, { token: tokens.worker })).status, 403);
  });
});

describe('Analyst tools for maintenance', () => {
  test('work-order figures come from the database and respect the machine filter', async () => {
    await freshDb(mongoose);
    const { runTool } = await import('../src/modules/ai/tools.js');
    const { rangeFromDays } = await import('../src/modules/analytics/analytics.service.js');
    const [a, b] = await Promise.all([machine(), machine()]);
    await models.WorkOrder.create([
      { woNo: 'WO-1', machine: a._id, title: 'Late job', status: 'open', priority: 'urgent', dueAt: new Date(Date.now() - DAY) },
      { woNo: 'WO-2', machine: a._id, title: 'Running job', status: 'in_progress' },
      { woNo: 'WO-3', machine: b._id, title: 'Other machine', status: 'open' },
      { woNo: 'WO-4', machine: a._id, title: 'Finished', status: 'done', completedAt: new Date() },
    ]);
    const all = await runTool({ name: 'getMaintenanceWorkOrders', args: {} }, rangeFromDays(7));
    const fig = (r, label) => r.keyFigures.find((f) => f.label === label).value;
    assert.deepEqual(['Open work orders', 'Work orders in progress', 'Overdue work orders', 'Urgent work orders', 'Work orders completed in the period'].map((l) => fig(all, l)), [2, 1, 1, 1, 1]);
    const one = await runTool({ name: 'getMaintenanceWorkOrders', args: { machineCode: a.code } }, rangeFromDays(7));
    assert.equal(fig(one, 'Open work orders'), 1);
    const none = await runTool({ name: 'getMaintenanceWorkOrders', args: { machineCode: 'NOPE' } }, rangeFromDays(7));
    assert.equal(fig(none, 'Open work orders'), 0);
  });

  test('reliability figures match the logs', async () => {
    const { runTool } = await import('../src/modules/ai/tools.js');
    const { rangeFromDays } = await import('../src/modules/analytics/analytics.service.js');
    const m = await machine();
    await models.MachineLog.create([
      { machine: m._id, toStatus: 'offline', startedAt: new Date(Date.now() - DAY), endedAt: new Date(), durationMins: 30 },
      { machine: m._id, toStatus: 'offline', startedAt: new Date(Date.now() - 2 * DAY), endedAt: new Date(), durationMins: 90 },
    ]);
    const r = await runTool({ name: 'getReliability', args: { machineCode: m.code } }, rangeFromDays(7));
    const f = Object.fromEntries(r.keyFigures.map((x) => [x.label, x.value]));
    assert.equal(f.Failures, 2);
    assert.equal(f['Mean time to repair'], 60);
    assert.equal(f['Mean time between failures'], Math.round(((7 * 1440 - 120) / 2 / 60) * 10) / 10);
  });
});
