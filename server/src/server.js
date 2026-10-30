import http from 'node:http';
import mongoose from 'mongoose';
import { connectDb } from './config/db.js';
import { assertProductionConfig, env } from './config/env.js';
import { createApp } from './app.js';
import { closeSockets, initSockets } from './sockets/index.js';
import { startScheduler } from './modules/ai/scheduler.js';
import { stop as stopSimulator } from './modules/simulator/simulator.service.js';
import { logger } from './utils/logger.js';

assertProductionConfig();
await connectDb();

const server = http.createServer(createApp());
initSockets(server);
const scheduled = startScheduler();
server.listen(env.port, () => logger.info(`SIMS API listening on :${env.port}`));

async function shutdown(signal) {
  logger.info(`${signal} received, shutting down`);
  stopSimulator();
  scheduled.forEach((t) => t.stop());
  setTimeout(() => process.exit(1), 10_000).unref();
  await closeSockets();
  await mongoose.disconnect();
  process.exit(0);
}
for (const s of ['SIGTERM', 'SIGINT']) process.on(s, () => shutdown(s));
