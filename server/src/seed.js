import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { connectDb } from './config/db.js';
import { env } from './config/env.js';
import { seedRefusal } from './utils/seedGuard.js';
import { dayKey } from './utils/time.js';
import {
  Alert, Attendance, InventoryItem, Machine, MachineLog, ProductionOrder,
  OutputLog, Shift, StockTransaction, Task, User, Worker,
} from './models/index.js';

const DAY = 86_400_000;
const hoursAgo = (h) => new Date(Date.now() - h * 3_600_000);
const daysAgo = (d) => new Date(Date.now() - d * DAY);
const dateKey = (d) => dayKey(d);

// This script deletes the data it is about to replace. Never let it do that to a real database by accident.
const refusal = seedRefusal({ uri: env.mongoUri, nodeEnv: env.nodeEnv, confirm: process.env.SEED_CONFIRM });
if (refusal) {
  console.error(`Refusing to seed: ${refusal}
Seeding deletes all machines, workers, orders, stock, alerts and users in that database.
If you really mean it, run again with SEED_CONFIRM=yes.`);
  process.exit(1);
}

await connectDb();
await Promise.all([
  Alert, Attendance, InventoryItem, Machine, MachineLog, OutputLog, ProductionOrder, Shift, StockTransaction, Task, User, Worker,
].map((m) => m.deleteMany({})));

const passwordHash = await bcrypt.hash('Password@123', 10);

const [admin, manager, ...workerUsers] = await User.create([
  { name: 'Asha Admin', email: 'admin@sims.local', passwordHash, role: 'admin' },
  { name: 'Manoj Manager', email: 'manager@sims.local', passwordHash, role: 'manager' },
  { name: 'Wasim Worker', email: 'worker@sims.local', passwordHash, role: 'worker' },
  { name: 'Ravi Kumar', email: 'ravi@sims.local', passwordHash, role: 'worker' },
  { name: 'Priya Singh', email: 'priya@sims.local', passwordHash, role: 'worker' },
  { name: 'Deepak Rao', email: 'deepak@sims.local', passwordHash, role: 'worker' },
]);

const [morning, evening] = await Shift.create([
  { name: 'Morning', startTime: '06:00', endTime: '14:00' },
  { name: 'Evening', startTime: '14:00', endTime: '22:00' },
]);

const departments = ['Machining', 'Assembly', 'Quality', 'Packaging'];
const workers = await Worker.create(
  workerUsers.map((u, i) => ({
    user: u._id,
    employeeId: `EMP-${100 + i}`,
    department: departments[i % departments.length],
    skills: ['operation', i % 2 ? 'inspection' : 'maintenance'],
    shift: i % 2 ? evening._id : morning._id,
  })),
);

const types = ['CNC Lathe', 'Milling', 'Press', 'Welding', 'Packaging'];
const statuses = ['running', 'running', 'running', 'idle', 'maintenance', 'offline'];
const machines = await Machine.create(
  Array.from({ length: 10 }, (_, i) => ({
    name: `${types[i % types.length]} ${String.fromCharCode(65 + (i % 3))}`,
    code: `M-${101 + i}`,
    type: types[i % types.length],
    status: statuses[i % statuses.length],
    runHours: 800 + i * 240,
    toolWearMin: 60 + i * 18,
    temperatureC: 55 + i * 3,
    vibrationMms: Number((1.2 + i * 0.35).toFixed(2)),
    lastServiceAt: daysAgo(20 + i * 9),
    nextServiceDue: daysAgo(-(10 + i * 4)),
    lastReadingAt: hoursAgo(i % 4),
  })),
);

const logs = [];
machines.forEach((m, i) => {
  for (let d = 0; d < 7; d++) {
    if ((i + d) % 3 === 0) {
      const start = new Date(daysAgo(d).getTime() - (i + 1) * 3_600_000);
      const mins = 15 + ((i * 7 + d * 11) % 90);
      logs.push({
        machine: m._id, fromStatus: 'running', toStatus: 'offline', startedAt: start,
        endedAt: new Date(start.getTime() + mins * 60_000), durationMins: mins,
        reason: ['Tool change', 'Power fluctuation', 'Material shortage', 'Sensor fault'][(i + d) % 4],
      });
    }
  }
});
await MachineLog.create(logs);

const items = [
  ['STL-001', 'Steel sheet 2mm', 420, 'kg', 150, 'Tata Steel'],
  ['ALU-002', 'Aluminium rod 20mm', 90, 'kg', 120, 'Hindalco'],
  ['BRG-003', 'Ball bearing 6204', 260, 'pcs', 100, 'SKF India'],
  ['BLT-004', 'Hex bolt M8', 1800, 'pcs', 500, 'Fasteners Co'],
  ['OIL-005', 'Cutting fluid', 35, 'L', 40, 'Castrol'],
  ['PKG-006', 'Carton 40x30', 600, 'pcs', 200, 'PackWell'],
  ['WLD-007', 'Welding wire 1.2mm', 18, 'kg', 25, 'Esab'],
  ['PNT-008', 'Powder coat grey', 75, 'kg', 30, 'Asian Paints'],
].map(([sku, name, quantity, unit, reorderThreshold, supplier]) => ({ sku, name, quantity, unit, reorderThreshold, supplier }));
const inventory = await InventoryItem.create(items);

await Alert.create(
  inventory.filter((i) => i.quantity < i.reorderThreshold).map((i) => ({
    type: 'low_stock', severity: 'warning', source: 'inventory', sourceId: String(i._id),
    message: `${i.name} is below its reorder threshold (${i.quantity} ${i.unit} left).`,
  })),
);

const stock = (sku) => inventory.find((i) => i.sku === sku)._id;
const uses = (sku, qtyPerUnit) => ({ item: stock(sku), qtyPerUnit });
await ProductionOrder.create([
  { orderNo: 'PO-2001', product: 'Gear housing', quantity: 500, producedQty: 500, status: 'completed', progress: 100, machines: [machines[0]._id], dueDate: daysAgo(3), materials: [uses('STL-001', 0.4)], materialsConsumed: true },
  { orderNo: 'PO-2002', product: 'Drive shaft', quantity: 300, producedQty: 180, status: 'in_progress', progress: 60, machines: [machines[1]._id, machines[2]._id], dueDate: daysAgo(-2), materials: [uses('ALU-002', 0.3)], materialsConsumed: true },
  { orderNo: 'PO-2003', product: 'Mounting bracket', quantity: 1200, producedQty: 300, status: 'in_progress', progress: 25, machines: [machines[5]._id], dueDate: daysAgo(1), bottleneckFlag: true, materials: [uses('BLT-004', 2)], materialsConsumed: true },
  // Pending orders whose materials will be taken when they start. PO-2004 leaves aluminium low, a good alert demo.
  { orderNo: 'PO-2004', product: 'Valve body', quantity: 150, status: 'pending', machines: [machines[3]._id], dueDate: daysAgo(-6), materials: [uses('ALU-002', 0.4), uses('BRG-003', 1)] },
  { orderNo: 'PO-2005', product: 'Flange plate', quantity: 800, status: 'pending', machines: [machines[4]._id], dueDate: daysAgo(-9), materials: [uses('STL-001', 0.3), uses('BLT-004', 2)] },
]);

// Output history: each order's produced quantity is split across the last 7 days.
const seededOrders = await ProductionOrder.find({ producedQty: { $gt: 0 } });
const outputLogs = [];
for (const o of seededOrders) {
  const weights = [0.08, 0.14, 0.12, 0.18, 0.16, 0.2, 0.12];
  let left = o.producedQty;
  weights.forEach((w, idx) => {
    const qty = idx === weights.length - 1 ? left : Math.round(o.producedQty * w);
    left -= qty;
    if (qty > 0) {
      const at = new Date(daysAgo(6 - idx).getTime() - 3 * 3_600_000);
      outputLogs.push({ order: o._id, product: o.product, qty, at });
    }
  });
}
await OutputLog.create(outputLogs);

// Stock history: small daily issues, topped up twice, so levels stay positive when rebuilt backwards.
const stockTx = [];
inventory.forEach((item) => {
  const daily = Math.max(1, Math.round(item.quantity * 0.03));
  for (let d = 9; d >= 0; d--) {
    const at = new Date(daysAgo(d).getTime() - 5 * 3_600_000);
    stockTx.push({ item: item._id, type: 'out', qty: daily, createdAt: at });
    if (d === 8 || d === 4) stockTx.push({ item: item._id, type: 'in', qty: daily * 4, createdAt: new Date(at.getTime() + 3_600_000) });
  }
});
await StockTransaction.create(stockTx);

const attendance = [];
workers.forEach((w, i) => {
  // The demo worker (index 0) stays un-checked-in today so check-in can be demonstrated.
  // 30 days of history so the heatmap has something to show; Sundays are a closed day and a few days are missed.
  for (let d = i === 0 ? 1 : 0; d < 30; d++) {
    const day = daysAgo(d);
    if (new Date(`${dateKey(day)}T00:00:00Z`).getUTCDay() === 0) continue;
    if (d > 0 && (i * 7 + d) % 11 === 0) continue;
    const checkIn = new Date(day); checkIn.setUTCHours(1, 0 + ((i + d) % 4) * 10, 0, 0);
    const checkOut = new Date(day); checkOut.setUTCHours(9, 0, 0, 0);
    attendance.push({
      worker: w._id, date: dateKey(day), checkIn, checkOut: d === 0 ? undefined : checkOut,
      status: (i + d) % 7 === 0 ? 'late' : 'present',
    });
  }
});
await Attendance.create(attendance);

const orders = await ProductionOrder.find().sort({ orderNo: 1 });
await Task.create([
  { title: 'Set up fixtures for drive shaft run', assignedTo: workers[0]._id, machine: machines[1]._id, order: orders[1]._id, status: 'in_progress', dueAt: daysAgo(-1) },
  { title: 'Inspect first-off parts, PO-2002', assignedTo: workers[0]._id, order: orders[1]._id, status: 'todo', dueAt: daysAgo(-1) },
  { title: 'Replace worn tool on M-103', assignedTo: workers[1]._id, machine: machines[2]._id, status: 'todo', dueAt: daysAgo(-2) },
  { title: 'Clear mounting bracket backlog', assignedTo: workers[2]._id, order: orders[2]._id, status: 'in_progress', dueAt: daysAgo(0) },
  { title: 'Calibrate welding fixtures', assignedTo: workers[3]._id, machine: machines[3]._id, status: 'done', dueAt: daysAgo(2) },
  { title: 'Count reorder-level stock', status: 'todo', dueAt: daysAgo(-3) },
]);

console.log('Seed complete.');
console.log(`Users: ${[admin, manager, ...workerUsers].length} | Machines: ${machines.length} | Inventory: ${inventory.length}`);
console.log('Login: admin@sims.local / manager@sims.local / worker@sims.local  (password: Password@123)');
await mongoose.disconnect();
