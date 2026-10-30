/**
 * OpenAPI description of the SIMS API. Routes are listed as one row each so the file
 * stays reviewable; tests/docs.test.js fails if a documented route does not exist.
 *
 * Row: [method, path, summary, who, tag, extras]
 *   who: 'public' | 'any' | 'staff' | 'admin' | 'worker'
 *   extras: { body: exampleObject, query: [[name, type, description]], note }
 */
const ENVELOPE = { $ref: '#/components/schemas/Envelope' };

const STAFF = 'admin, manager';
const WHO = {
  public: 'No authentication.',
  any: 'Any signed-in user.',
  staff: `Roles: ${STAFF}.`,
  admin: 'Role: admin.',
  worker: 'Role: worker (uses their own worker profile).',
};

const page = [['page', 'integer', 'Page number, default 1'], ['limit', 'integer', 'Page size, 1 to 100, default 20']];
const days = [['days', 'integer', 'Number of whole factory days, 1 to 90, default 7']];

const ROUTES = [
  ['post', '/auth/register', 'Create a user', 'admin', 'Auth', { body: { name: 'Priya Singh', email: 'priya@example.com', password: 'Password@123', role: 'worker' } }],
  ['post', '/auth/login', 'Sign in. Returns an access token and sets the refresh cookie', 'public', 'Auth', { body: { email: 'manager@sims.local', password: 'Password@123' } }],
  ['post', '/auth/refresh', 'Exchange the refresh cookie for a new access token', 'public', 'Auth', { note: 'Needs the httpOnly refreshToken cookie.' }],
  ['post', '/auth/logout', 'Sign out and revoke the refresh token', 'any', 'Auth'],
  ['get', '/auth/me', 'The signed-in user', 'any', 'Auth'],

  ['get', '/users', 'List users', 'staff', 'Users', { query: [...page, ['search', 'string', 'Name or email'], ['role', 'string', 'admin, manager or worker']] }],
  ['patch', '/users/{id}', 'Change a user\'s name, role or active flag', 'admin', 'Users', { body: { role: 'manager', isActive: true } }],
  ['post', '/users/{id}/reset-password', 'Set a new password and revoke sessions', 'admin', 'Users', { body: { password: 'NewPassword@456' } }],
  ['get', '/audit-logs', 'Who changed what (field names only, never values)', 'admin', 'Users', { query: [...page, ['resource', 'string', 'e.g. machines']] }],

  ['get', '/machines', 'List machines', 'any', 'Machines', { query: [...page, ['status', 'string', 'running, idle, maintenance or offline'], ['search', 'string', 'Name, code or type']] }],
  ['post', '/machines', 'Create a machine', 'staff', 'Machines', { body: { name: 'CNC Lathe D', code: 'M-111', type: 'CNC Lathe' } }],
  ['get', '/machines/downtime-summary', 'Downtime per machine over the last N days', 'any', 'Machines', { query: days }],
  ['get', '/machines/{id}', 'One machine', 'any', 'Machines'],
  ['patch', '/machines/{id}', 'Edit a machine', 'staff', 'Machines', { body: { runHours: 1250 } }],
  ['delete', '/machines/{id}', 'Delete a machine and its logs', 'staff', 'Machines'],
  ['patch', '/machines/{id}/status', 'Change status. Writes the downtime log, raises or resolves alerts, flags bottlenecks and emits a socket event', 'staff', 'Machines', { body: { status: 'offline', reason: 'Sensor fault' } }],
  ['get', '/machines/{id}/logs', 'Status history', 'any', 'Machines', { query: page }],

  ['get', '/inventory', 'List inventory', 'any', 'Inventory', { query: [...page, ['search', 'string', 'Name, SKU or supplier'], ['lowStock', 'string', 'true to show only items below their reorder level']] }],
  ['get', '/inventory/low-stock', 'Items below their reorder level', 'any', 'Inventory'],
  ['post', '/inventory', 'Create an item', 'staff', 'Inventory', { body: { sku: 'STL-009', name: 'Steel plate', quantity: 100, unit: 'kg', reorderThreshold: 40 } }],
  ['get', '/inventory/{id}', 'One item', 'any', 'Inventory'],
  ['patch', '/inventory/{id}', 'Edit item details (not quantity)', 'staff', 'Inventory', { body: { reorderThreshold: 60 } }],
  ['delete', '/inventory/{id}', 'Delete an item', 'staff', 'Inventory'],
  ['post', '/inventory/{id}/transactions', 'Stock in, out or adjust. Atomic: stock can never go negative', 'staff', 'Inventory', { body: { type: 'out', qty: 5 } }],
  ['get', '/inventory/{id}/transactions', 'Transaction history', 'any', 'Inventory', { query: page }],

  ['get', '/workers', 'List workers', 'staff', 'Workforce', { query: [...page, ['search', 'string', ''], ['status', 'string', 'active, on_leave or terminated'], ['department', 'string', '']] }],
  ['post', '/workers', 'Create a worker and their login', 'staff', 'Workforce', { body: { name: 'Ravi Kumar', email: 'ravi@example.com', password: 'Password@123', employeeId: 'EMP-200', department: 'Assembly', skills: ['welding'] } }],
  ['get', '/workers/me', 'The signed-in worker\'s own profile', 'any', 'Workforce'],
  ['get', '/workers/{id}', 'One worker', 'staff', 'Workforce'],
  ['patch', '/workers/{id}', 'Edit a worker', 'staff', 'Workforce', { body: { status: 'on_leave' } }],
  ['delete', '/workers/{id}', 'Deactivate a worker (history is kept)', 'staff', 'Workforce'],
  ['get', '/shifts', 'List shifts', 'any', 'Workforce'],
  ['post', '/shifts', 'Create a shift', 'staff', 'Workforce', { body: { name: 'Night', startTime: '22:00', endTime: '06:00' } }],
  ['patch', '/shifts/{id}', 'Edit a shift', 'staff', 'Workforce', { body: { endTime: '07:00' } }],
  ['delete', '/shifts/{id}', 'Delete a shift with no active workers', 'staff', 'Workforce'],
  ['post', '/attendance/check-in', 'Check in. Late after the shift start plus 15 minutes', 'worker', 'Workforce'],
  ['post', '/attendance/check-out', 'Check out', 'worker', 'Workforce'],
  ['get', '/attendance', 'Attendance for a day or range. Workers only ever see their own', 'any', 'Workforce', { query: [['date', 'string', 'YYYY-MM-DD, default today'], ['from', 'string', 'YYYY-MM-DD'], ['to', 'string', 'YYYY-MM-DD'], ['worker', 'string', 'Worker id (staff only)']] }],
  ['get', '/attendance/summary', 'Present, late and absent counts for a day', 'staff', 'Workforce', { query: [['date', 'string', 'YYYY-MM-DD']] }],
  ['get', '/tasks', 'List tasks. Workers only see their own', 'any', 'Workforce', { query: [...page, ['assignedTo', 'string', ''], ['status', 'string', 'todo, in_progress or done']] }],
  ['post', '/tasks', 'Create a task', 'staff', 'Workforce', { body: { title: 'Inspect first-off parts', assignedTo: '<workerId>' } }],
  ['patch', '/tasks/{id}', 'Edit a task', 'staff', 'Workforce', { body: { title: 'Updated title' } }],
  ['patch', '/tasks/{id}/status', 'Move a task. Workers may only change their own', 'any', 'Workforce', { body: { status: 'in_progress' } }],
  ['delete', '/tasks/{id}', 'Delete a task', 'staff', 'Workforce'],

  ['get', '/orders', 'List production orders. Workers only see orders linked to their tasks', 'any', 'Production', { query: [...page, ['status', 'string', 'pending, in_progress or completed'], ['bottleneck', 'string', 'true']] }],
  ['post', '/orders', 'Create an order, optionally with the materials it uses', 'staff', 'Production', { body: { product: 'Drive shaft', quantity: 300, machines: ['<machineId>'], materials: [{ item: '<inventoryItemId>', qtyPerUnit: 0.5 }], dueDate: '2026-11-10T00:00:00Z' } }],
  ['get', '/orders/{id}', 'One order', 'any', 'Production'],
  ['get', '/orders/{id}/output', 'Output entries logged against the order, newest first', 'staff', 'Production'],
  ['patch', '/orders/{id}', 'Edit an order that is not completed', 'staff', 'Production', { body: { quantity: 350 } }],
  ['patch', '/orders/{id}/status', 'Move forward only: pending, in_progress, completed. Starting needs every machine available and takes all materials from stock in one all-or-nothing step (409 names any shortage)', 'staff', 'Production', { body: { status: 'in_progress' } }],
  ['patch', '/orders/{id}/progress', 'Record total units produced so far', 'staff', 'Production', { body: { producedQty: 120 } }],
  ['delete', '/orders/{id}', 'Delete an order that is not in progress', 'staff', 'Production'],

  ['get', '/alerts', 'List alerts', 'any', 'Alerts', { query: [...page, ['status', 'string', 'open, acknowledged or resolved'], ['severity', 'string', 'info, warning or critical']] }],
  ['patch', '/alerts/{id}/acknowledge', 'Acknowledge an alert', 'staff', 'Alerts'],
  ['patch', '/alerts/{id}/resolve', 'Resolve an alert', 'staff', 'Alerts'],

  ['get', '/analytics/overview', 'KPIs for the dashboard', 'staff', 'Analytics'],
  ['get', '/analytics/downtime', 'Downtime per day, machine and reason; optional machine id limits it to one machine', 'staff', 'Analytics', { query: [...days, ['machine', 'string', 'Machine id']] }],
  ['get', '/suppliers', 'List suppliers', 'staff', 'Purchasing'],
  ['post', '/suppliers', 'Create a supplier', 'staff', 'Purchasing', { body: { name: 'Hindalco', leadTimeDays: 5, email: 'sales@example.com' } }],
  ['patch', '/suppliers/{id}', 'Edit a supplier', 'staff', 'Purchasing', { body: { leadTimeDays: 3 } }],
  ['delete', '/suppliers/{id}', 'Delete a supplier (refused while it has open purchase orders)', 'staff', 'Purchasing'],
  ['get', '/purchase-orders', 'List purchase orders', 'staff', 'Purchasing', { query: [...page, ['status', 'string', 'draft, approved, received or cancelled']] }],
  ['post', '/purchase-orders', 'Create a draft purchase order', 'staff', 'Purchasing', { body: { supplier: '<supplierId>', lines: [{ item: '<itemId>', qty: 100, unitCost: 12.5 }] } }],
  ['post', '/purchase-orders/draft-from-low-stock', 'Draft orders for every item under its reorder level (also happens automatically when a low-stock alert is raised)', 'staff', 'Purchasing'],
  ['get', '/purchase-orders/{id}', 'One purchase order with its total', 'staff', 'Purchasing'],
  ['patch', '/purchase-orders/{id}', 'Edit a draft', 'staff', 'Purchasing', { body: { supplier: '<supplierId>' } }],
  ['patch', '/purchase-orders/{id}/approve', 'Approve a draft. Needs a supplier and at least one line. Always a person, never automatic', 'staff', 'Purchasing'],
  ['patch', '/purchase-orders/{id}/receive', 'Receive an approved order: posts a stock-in transaction for every line', 'staff', 'Purchasing'],
  ['patch', '/purchase-orders/{id}/cancel', 'Cancel a draft or approved order', 'staff', 'Purchasing'],
  ['get', '/inventory/valuation', 'Stock value at unit cost', 'staff', 'Inventory'],
  ['post', '/inventory/import', 'Import up to 500 rows by SKU (creates new items, updates existing ones). Rows fail independently', 'staff', 'Inventory', { body: { rows: [{ sku: 'BLT-004', name: 'Hex bolt M8', quantity: 1800, unit: 'pcs', reorderThreshold: 500, unitCost: 2.5 }] } }],
  ['post', '/auth/forgot-password', 'Ask for a password reset link. Always answers the same, whether or not the email has an account', 'public', 'Auth', { body: { email: 'worker@sims.local' } }],
  ['post', '/auth/reset-password', 'Set a new password with the token from the emailed link (single use, 30 minutes). Ends all existing sessions', 'public', 'Auth', { body: { token: '<64 hex characters>', password: 'NewPassword@123' } }],
  ['get', '/analytics/downtime-pareto', 'Downtime by reason with cumulative share', 'staff', 'Analytics', { query: days }],
  ['get', '/analytics/oee', 'Availability and quality; performance and combined OEE are reported as null because output per machine is not recorded', 'staff', 'Analytics', { query: days }],
  ['get', '/bom', 'Bills of materials', 'any', 'Production'],
  ['post', '/bom', 'Define what one unit of a product takes from stock. New orders for that product copy it', 'staff', 'Production', { body: { product: 'Drive shaft', items: [{ item: '<itemId>', qtyPerUnit: 0.5 }] } }],
  ['patch', '/bom/{id}', 'Replace the items of a bill of materials', 'staff', 'Production', { body: { items: [{ item: '<itemId>', qtyPerUnit: 0.6 }] } }],
  ['delete', '/bom/{id}', 'Delete a bill of materials', 'staff', 'Production'],
  ['post', '/quality-checks', 'Log an inspection (inspected, defects, scrap) against an order that has started. Workers only for orders linked to their tasks', 'any', 'Production', { body: { order: '<orderId>', stage: 'Final inspection', inspectedQty: 50, defectCount: 2, scrapQty: 1 } }],
  ['get', '/quality-checks/order/{orderId}', 'Checks and totals for one order', 'any', 'Production'],
  ['post', '/production/feasibility', 'Can we take this order? Checks stock via the BOM, machine status and today\'s attendance. Deterministic; does not model rates', 'staff', 'Production', { body: { product: 'Drive shaft', quantity: 500 } }],
  ['get', '/leave', 'Leave requests. Workers see their own', 'any', 'Leave', { query: [...page, ['status', 'string', 'pending, approved, rejected or cancelled']] }],
  ['post', '/leave', 'Request leave (workers for themselves; staff can pass a worker id)', 'any', 'Leave', { body: { from: '2026-11-10', to: '2026-11-12', reason: 'Family event' } }],
  ['patch', '/leave/{id}/review', 'Approve or reject a pending request', 'staff', 'Leave', { body: { status: 'approved', note: 'Enjoy' } }],
  ['patch', '/leave/{id}/cancel', 'Withdraw a pending request', 'any', 'Leave'],
  ['get', '/notifications', 'Your notifications and unread count', 'any', 'Notifications'],
  ['patch', '/notifications/read-all', 'Mark all of your notifications read', 'any', 'Notifications'],
  ['patch', '/notifications/{id}/read', 'Mark one of your notifications read', 'any', 'Notifications'],
  ['post', '/telemetry', 'Record a sensor reading. Updates the machine, raises or clears threshold alerts and refreshes the health score', 'staff', 'Telemetry', { body: { machine: '<machineId>', temperatureC: 72.5, vibrationMms: 3.1, rpm: 1800, powerKw: 7.4 } }],
  ['get', '/machines/{id}/telemetry', 'Recent sensor readings, oldest first', 'any', 'Telemetry', { query: [['hours', 'integer', '1 to 168, default 2'], ['limit', 'integer', 'Up to 1000, default 300']] }],
  ['get', '/machines/{id}/health-score', 'Health score 0 to 100 with every deduction explained', 'any', 'Telemetry'],
  ['post', '/machines/{id}/sensor-risk', 'Second-opinion risk from the sensor model (trained on the public AI4I dataset) using the newest rpm, power-derived torque and tool wear. Computed on demand; stored nowhere and raises no alerts', 'staff', 'Risk model'],
  ['get', '/analytics/reliability', 'MTBF, MTTR, failures and availability per machine', 'staff', 'Analytics', { query: days }],
  ['get', '/maintenance/work-orders', 'List maintenance work orders. Workers only see those assigned to them', 'any', 'Maintenance', { query: [...page, ['status', 'string', 'open, in_progress, done or cancelled'], ['machine', 'string', 'Machine id'], ['type', 'string', 'preventive, corrective or inspection'], ['overdue', 'string', 'true']] }],
  ['post', '/maintenance/work-orders', 'Create a work order', 'staff', 'Maintenance', { body: { machine: '<machineId>', title: 'Replace spindle bearing', type: 'corrective', priority: 'high' } }],
  ['get', '/maintenance/work-orders/{id}', 'One work order with its notes', 'any', 'Maintenance'],
  ['patch', '/maintenance/work-orders/{id}', 'Edit an open work order', 'staff', 'Maintenance', { body: { priority: 'urgent' } }],
  ['patch', '/maintenance/work-orders/{id}/status', 'open to in_progress or cancelled, in_progress to done or cancelled. Finishing planned work updates the machine service dates and any recurring schedule', 'any', 'Maintenance', { body: { status: 'done', resolution: 'Bearing replaced and tested' } }],
  ['post', '/maintenance/work-orders/{id}/notes', 'Add a note to a work order', 'any', 'Maintenance', { body: { text: 'Waiting for the part' } }],
  ['delete', '/maintenance/work-orders/{id}', 'Delete a work order', 'staff', 'Maintenance'],
  ['get', '/maintenance/summary', 'Open, in-progress, overdue and urgent work order counts', 'staff', 'Maintenance'],
  ['get', '/maintenance/schedules', 'Recurring maintenance schedules', 'staff', 'Maintenance'],
  ['post', '/maintenance/schedules', 'Create a recurring schedule', 'staff', 'Maintenance', { body: { machine: '<machineId>', title: 'Monthly lubrication', everyDays: 30, nextDueAt: '2026-11-15T00:00:00Z' } }],
  ['patch', '/maintenance/schedules/{id}', 'Edit a schedule', 'staff', 'Maintenance', { body: { everyDays: 14 } }],
  ['delete', '/maintenance/schedules/{id}', 'Delete a schedule', 'staff', 'Maintenance'],
  ['post', '/maintenance/schedules/run-due', 'Open work orders for schedules due within three days (also runs daily)', 'staff', 'Maintenance'],
  ['get', '/handover', 'Shift handover notes, open ones by default', 'any', 'Handover', { query: [...page, ['resolved', 'string', 'true to see closed notes']] }],
  ['post', '/handover', 'Leave a note for the next shift', 'any', 'Handover', { body: { text: 'Press C leaking oil, keep an eye on it', priority: 'important' } }],
  ['patch', '/handover/{id}/resolve', 'Close a note (authors close their own, managers any)', 'any', 'Handover'],
  ['delete', '/handover/{id}', 'Delete a note', 'staff', 'Handover'],
  ['get', '/analytics/worker-attendance', 'Per-day counts and a per-worker grid (present, late, absent, pending, none)', 'staff', 'Analytics', { query: days }],
  ['get', '/analytics/production-output', 'Units produced per day and product', 'staff', 'Analytics', { query: days }],
  ['get', '/analytics/stock-trends', 'Stock movement and end-of-day levels', 'staff', 'Analytics', { query: [...days, ['item', 'string', 'Inventory item id']] }],

  ['post', '/machines/{machineId}/assess-risk', 'Gemini condition assessment. Readings come from the database, never the request', 'staff', 'AI', { body: { includeMaintenanceHistory: true, forceNewAssessment: false }, note: 'Returns 503 until GEMINI_API_KEY and GEMINI_MODEL are set. A repeat within 15 minutes returns the saved assessment with reused: true.' }],
  ['get', '/machines/{machineId}/assessments', 'Saved assessments, newest first', 'staff', 'AI', { query: [['limit', 'integer', '1 to 50'], ['cursor', 'string', 'nextCursor from the previous page']] }],
  ['get', '/ai/status', 'Whether the AI provider is configured', 'staff', 'AI'],
  ['post', '/ai/explain-alert/{id}', 'Plain-language explanation of one alert from the machine, reading and work-order facts around it. Numbers must come from that evidence; no predictions', 'staff', 'AI'],
  ['post', '/ai/ask', 'Ask the analyst a question about operations', 'staff', 'AI', { body: { question: 'Which machine had the most downtime this week?', timeRange: { preset: 'THIS_WEEK' } }, note: 'timeRange is { preset } (TODAY, YESTERDAY, THIS_WEEK, LAST_WEEK, THIS_MONTH, LAST_MONTH, LAST_7_DAYS, LAST_30_DAYS), or { startDate, endDate } as YYYY-MM-DD in the factory timezone (inclusive, at most 92 days), or { start, end } as ISO instants. Omitted means the last 7 days.' }],
  ['get', '/ai/weekly-summary', 'Weekly summary written from calculated figures, cached for 6 hours', 'staff', 'AI', { query: [['refresh', 'string', 'true to regenerate']] }],

  ['post', '/machines/{machineId}/ml-predict', 'Score a machine with the trained statistical model. Inputs come from the database', 'staff', 'Risk model', { note: 'Returns { risk: Low|Medium|High, probability, topFactors, warnings, modelVersion, dataSource }. 422 names any missing input; 503 when the model service is off or down (the rest of the API is unaffected). Trained on synthetic data: probabilities are calibrated inside that synthetic world only. High raises one warning alert per machine.' }],
  ['get', '/machines/{machineId}/ml-predictions', 'Saved model scores, newest first', 'staff', 'Risk model'],
  ['get', '/ml/status', 'Whether the model service is enabled and reachable, with its version, held-out metrics and limitations', 'staff', 'Risk model'],
  ['post', '/ml/rescore', 'Score every machine now (also runs hourly). Stops at the first outage', 'staff', 'Risk model'],

  ['get', '/simulate/status', 'Simulator state', 'admin', 'Simulator'],
  ['post', '/simulate/machine-events', 'Run one simulation step', 'admin', 'Simulator', { body: { events: 3 } }],
  ['post', '/simulate/start', 'Start a background simulation (stops itself after 30 minutes)', 'admin', 'Simulator', { body: { intervalSec: 5, events: 2 } }],
  ['post', '/simulate/stop', 'Stop the background simulation', 'admin', 'Simulator'],
];

const bodySchema = (example) => ({
  type: 'object',
  example,
  properties: Object.fromEntries(Object.entries(example).map(([k, v]) => [k, { type: Array.isArray(v) ? 'array' : typeof v === 'object' ? 'object' : typeof v }])),
});

function operation([method, path, summary, who, tag, extras = {}]) {
  const secured = who !== 'public';
  const op = {
    tags: [tag],
    summary,
    description: [WHO[who], extras.note].filter(Boolean).join(' '),
    ...(secured && { security: [{ bearerAuth: [] }] }),
    parameters: [
      ...(path.match(/\{(\w+)\}/g) ?? []).map((p) => ({ name: p.slice(1, -1), in: 'path', required: true, schema: { type: 'string' } })),
      ...(extras.query ?? []).map(([name, type, description]) => ({ name, in: 'query', schema: { type }, ...(description && { description }) })),
    ],
    responses: {
      200: { description: 'OK', content: { 'application/json': { schema: ENVELOPE } } },
      ...(method === 'post' && { 201: { description: 'Created', content: { 'application/json': { schema: ENVELOPE } } } }),
      400: { description: 'Validation failed' },
      ...(secured && { 401: { description: 'Missing or invalid access token' } }),
      ...(who !== 'public' && who !== 'any' && { 403: { description: 'Role not permitted' } }),
      ...(path.includes('{') && { 404: { description: 'Not found' } }),
      ...(path.startsWith('/ai') || path.includes('assess') ? { 429: { description: 'Rate limited' }, 502: { description: 'The AI returned an unusable response' }, 503: { description: 'AI not configured or unavailable' } } : {}),
    },
  };
  if (extras.body) op.requestBody = { required: true, content: { 'application/json': { schema: bodySchema(extras.body) } } };
  return op;
}

export const routes = ROUTES.map(([method, path]) => ({ method, path: `/api${path}` }));

export function buildSpec() {
  const paths = {};
  for (const row of ROUTES) {
    paths[row[1]] ??= {};
    paths[row[1]][row[0]] = operation(row);
  }
  paths['/../health'] = {
    servers: [{ url: '/' }],
    get: { tags: ['System'], summary: 'Liveness and database check', responses: { 200: { description: 'Healthy' }, 503: { description: 'Database unavailable' } } },
  };
  return {
    openapi: '3.0.3',
    info: {
      title: 'Smart Industrial Management System API',
      version: '1.0.0',
      description: [
        'Every response uses one envelope: `{ success, data, message, errors }`.',
        'Sign in with `POST /auth/login`, then send `Authorization: Bearer <accessToken>`. Access tokens last 15 minutes; refresh with the cookie.',
        'AI results are preliminary language-model assessments grounded in database records. They are not validated failure predictions.',
      ].join('\n\n'),
    },
    servers: [{ url: '/api' }],
    tags: ['Auth', 'Users', 'Machines', 'Inventory', 'Workforce', 'Production', 'Alerts', 'Analytics', 'AI', 'Risk model', 'Simulator', 'System'].map((name) => ({ name })),
    paths,
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
      schemas: {
        Envelope: {
          type: 'object',
          required: ['success', 'data', 'message', 'errors'],
          properties: {
            success: { type: 'boolean' }, data: { nullable: true }, message: { type: 'string' },
            errors: { nullable: true, type: 'array', items: { type: 'object', properties: { path: { type: 'string' }, message: { type: 'string' } } } },
          },
        },
      },
    },
  };
}
