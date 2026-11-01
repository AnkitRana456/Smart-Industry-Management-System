// Tiny helpers for hand-laid-out SVG diagrams (use case and activity), styled like the Mermaid ones.
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
export const FONT = "font-family=\"Times New Roman, serif\"";

export function text(x, y, lines, { size = 15, anchor = 'middle', bold = false, fill = '#111' } = {}) {
  const ls = Array.isArray(lines) ? lines : [lines];
  const y0 = y - ((ls.length - 1) * size * 1.2) / 2 + size * 0.34;
  return ls.map((l, i) => `<text x="${x}" y="${(y0 + i * size * 1.2).toFixed(1)}" text-anchor="${anchor}" font-size="${size}" ${bold ? 'font-weight="bold"' : ''} fill="${fill}" ${FONT}>${esc(l)}</text>`).join('');
}
export const rect = (x, y, w, h, lines, o = {}) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${o.rx ?? 3}" fill="${o.fill ?? '#fff'}" stroke="${o.stroke ?? '#1f2937'}" stroke-width="${o.sw ?? 1.6}"/>${lines ? text(x + w / 2, y + h / 2, lines, { size: o.size, bold: o.bold }) : ''}`;
export const ellipse = (cx, cy, rx, ry, lines, o = {}) =>
  `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${o.fill ?? '#fff'}" stroke="#1f2937" stroke-width="1.6"/>${text(cx, cy, lines, { size: o.size, bold: o.bold })}`;
export const diamond = (cx, cy, w, h, lines, o = {}) =>
  `<polygon points="${cx},${cy - h / 2} ${cx + w / 2},${cy} ${cx},${cy + h / 2} ${cx - w / 2},${cy}" fill="${o.fill ?? '#fff'}" stroke="#1f2937" stroke-width="1.6"/>${text(cx, cy, lines, { size: o.size, bold: o.bold })}`;
export const pill = (cx, cy, w, h, lines, o = {}) => rect(cx - w / 2, cy - h / 2, w, h, lines, { ...o, rx: h / 2 });
export const line = (pts, o = {}) => {
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x},${y}`).join(' ');
  return `<path d="${d}" fill="none" stroke="${o.stroke ?? '#1f2937'}" stroke-width="${o.sw ?? 1.5}" ${o.dash ? 'stroke-dasharray="6 4"' : ''} ${o.arrow === false ? '' : 'marker-end="url(#arr)"'}/>`;
};
export const label = (x, y, s, o = {}) => `<rect x="${x - (o.w ?? 18)}" y="${y - 10}" width="${(o.w ?? 18) * 2}" height="18" fill="#fff"/>${text(x, y, s, { size: 13, ...o })}`;

export function svg(w, h, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><defs>
<marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#1f2937"/></marker></defs>
<rect width="${w}" height="${h}" fill="#fff"/>${body}</svg>`;
}

export function actor(cx, top, name) {
  const y = top;
  return `<g stroke="#111" stroke-width="2" fill="none"><circle cx="${cx}" cy="${y + 10}" r="10" fill="#fff"/><path d="M${cx},${y + 20} V${y + 52} M${cx - 18},${y + 32} H${cx + 18} M${cx},${y + 52} L${cx - 14},${y + 74} M${cx},${y + 52} L${cx + 14},${y + 74}"/></g>${text(cx, y + 92, name, { size: 16, bold: true })}`;
}

// ---- Use case diagram ----
export function useCaseDiagram() {
  const W = 1000;
  const H = 760;
  let b = `<rect x="215" y="14" width="570" height="732" rx="6" fill="#f8fafc" stroke="#6b7280" stroke-width="1.5"/>`;
  b += text(500, 36, 'Smart Industrial Management System', { size: 17, bold: true });
  const cases = [
    ['signin', 'Sign in and manage own session'], ['dash', 'View live dashboard and KPIs'], ['users', 'Manage users and audit trail'],
    ['mach', 'Monitor machines, change status'], ['work', 'Manage workers, shifts and leave'], ['prod', 'Plan and track production orders'],
    ['inv', 'Control inventory and purchasing'], ['maint', 'Schedule and track maintenance'], ['anal', 'View analytics and reports'],
    ['ai', 'Ask the AI analyst'], ['ml', 'Run risk and anomaly checks'], ['own', 'Check in/out, update own tasks'],
    ['qa', 'Log quality checks, handover notes'], ['alert', 'Receive alerts and notifications'],
  ];
  const pos = {};
  cases.forEach(([k, t], i) => { const y = 78 + i * 49; pos[k] = y; b += ellipse(500, y, 150, 21, t, { size: 14 }); });
  const fan = (ax, ay, keys, side) => keys.map((k) => `<path d="M${ax},${ay} L${side === 'L' ? 350 : 650},${pos[k]}" stroke="#1f2937" stroke-width="1.2" fill="none"/>`).join('');
  b += fan(112, 190, ['signin', 'dash', 'users', 'mach', 'alert'], 'L');
  b += fan(112, 520, ['signin', 'dash', 'mach', 'work', 'prod', 'inv', 'maint', 'anal', 'ai', 'ml', 'alert'], 'L');
  b += fan(888, 430, ['signin', 'dash', 'own', 'qa', 'alert'], 'R');
  b += actor(90, 120, 'Admin') + actor(90, 450, 'Manager') + actor(910, 360, 'Worker');
  return { width: W, svg: svg(W, H, b) };
}

// ---- Activity diagram (swimlanes) ----
export function activityDiagram() {
  const W = 1000;
  const H = 790;
  const lanes = [['Manager (browser)', 10, 240], ['Express API', 250, 250], ['Service layer and database', 500, 300], ['Connected clients', 800, 190]];
  let b = '';
  lanes.forEach(([name, x0, w], i) => {
    b += `<rect x="${x0}" y="10" width="${w}" height="${H - 20}" fill="${i % 2 ? '#f8fafc' : '#fff'}" stroke="#6b7280" stroke-width="1.3"/>`;
    b += `<rect x="${x0}" y="10" width="${w}" height="30" fill="#e5e7eb" stroke="#6b7280" stroke-width="1.3"/>` + text(x0 + w / 2, 25, name, { size: 15, bold: true });
  });
  const m = 130, a = 375, s = 650, c = 895;
  b += `<circle cx="${m}" cy="56" r="8" fill="#111"/>`;
  b += rect(m - 100, 72, 200, 42, ['Select a new status', 'for a machine'], { size: 14 });
  b += line([[m, 64], [m, 72]]);
  b += line([[m + 100, 93], [a, 93], [a, 112]]);
  b += diamond(a, 145, 200, 66, ['Valid JWT and', 'manager or admin?'], { size: 13 });
  b += rect(m - 100, 124, 200, 42, ['Show error', '(401 or 403)'], { size: 14, fill: '#fef2f2' });
  b += line([[a - 100, 145], [m + 100, 145]]); b += label(a - 122, 133, 'No', { w: 13 });
  b += line([[a, 178], [a, 210]]); b += label(a + 18, 194, 'Yes', { w: 16 });
  b += diamond(a, 245, 210, 66, ['Body valid and', 'status changed?'], { size: 13 });
  b += rect(m - 100, 222, 200, 46, ['Show error', '(400 or 409)'], { size: 14, fill: '#fef2f2' });
  b += line([[a - 105, 245], [m + 100, 245]]); b += label(a - 128, 233, 'No', { w: 13 });
  b += line([[a, 278], [a, 322], [s, 322], [s, 340]]); b += label(a + 18, 300, 'Yes', { w: 16 });
  b += rect(s - 118, 340, 236, 46, ['Close open downtime log,', 'record its duration'], { size: 14 });
  b += line([[s, 386], [s, 412]]);
  b += rect(s - 118, 412, 236, 46, ['Open a new log and', 'update the machine'], { size: 14 });
  b += line([[s, 458], [s, 487]]);
  b += diamond(s, 520, 220, 66, ['New status', 'is offline?'], { size: 13 });
  b += line([[s, 553], [s, 590]]); b += label(s + 18, 571, 'Yes', { w: 16 });
  b += rect(s - 118, 590, 236, 46, ['Raise critical alert and open', 'corrective work order'], { size: 14 });
  b += line([[s - 110, 520], [s - 138, 520], [s - 138, 683], [s - 118, 683]]); b += label(s - 138, 600, 'No', { w: 13 });
  b += line([[s, 636], [s, 660]]);
  b += rect(s - 118, 660, 236, 46, ['Resolve earlier alert if any,', 'refresh bottleneck flags'], { size: 14 });
  b += line([[s + 118, 683], [c - 90, 683]]);
  b += rect(c - 90, 653, 180, 60, ['Receive machine event,', 'refresh cached data,', 'show a toast'], { size: 13 });
  b += line([[c, 713], [c, 738]]);
  b += `<circle cx="${c}" cy="750" r="11" fill="#fff" stroke="#111" stroke-width="2"/><circle cx="${c}" cy="750" r="6" fill="#111"/>`;
  return { width: W, svg: svg(W, H, b) };
}

// ---- AI and ML workflow (two horizontal lanes) ----
export function aiWorkflowDiagram() {
  const W = 1000;
  const H = 470;
  let b = '';
  const lane = (y, h, title) => `<rect x="10" y="${y}" width="980" height="${h}" rx="6" fill="#f8fafc" stroke="#6b7280" stroke-width="1.3"/>${text(500, y + 17, title, { size: 15, bold: true })}`;
  b += lane(10, 235, 'AI-assisted query path (natural-language insights)');
  const bw = 118, gap = 22, x0 = 22, y0 = 70, bh = 76;
  const step = [
    ['1 Manager asks', 'in plain English'], ['2 Validate input,', 'role, rate limit'], ['3 Planner picks', 'allow-listed tools', 'and a period'], ['4 Tools run fixed', 'database queries,', 'compute figures'],
    ['5 LLM drafts a', 'short answer from', 'the evidence only'],
  ];
  step.forEach((t, i) => { b += rect(x0 + i * (bw + gap), y0, bw, bh, t, { size: 13 }); if (i) b += line([[x0 + i * (bw + gap) - gap, y0 + bh / 2], [x0 + i * (bw + gap), y0 + bh / 2]]); });
  const dx = x0 + 5 * (bw + gap) + 60;
  b += line([[x0 + 4 * (bw + gap) + bw, y0 + bh / 2], [dx - 62, y0 + bh / 2]]);
  b += diamond(dx, y0 + bh / 2, 124, 96, ['6 Every number', 'in the evidence?'], { size: 12 });
  const ax = dx + 62 + 22;
  b += line([[dx + 62, y0 + bh / 2], [ax, y0 + bh / 2]]); b += label(dx + 67, y0 + bh / 2 - 14, 'Yes', { w: 14 });
  b += rect(ax, y0, 118 - 30 + 30, bh, ['7 Answer card', 'with sources', 'on the dashboard'], { size: 13 });
  b += rect(dx - 72, y0 + 118, 144, 50, ['Retry once, else', 'show figures only'], { size: 12, fill: '#fff7ed' });
  b += line([[dx, y0 + bh / 2 + 48], [dx, y0 + 118]]); b += label(dx + 16, y0 + 100, 'No', { w: 13 });
  b += line([[dx + 72, y0 + 143], [ax + 59, y0 + 143], [ax + 59, y0 + bh]]);
  b += text(300, y0 + 150, 'Figures always come from the database; the LLM only phrases them.', { size: 13 });
  b += lane(260, 200, 'Machine learning path (risk, anomaly, forecast)');
  const ml = [['Machine readings,', 'service history,', 'downtime, telemetry'], ['Python FastAPI service:', 'risk model, sensor model,', 'anomaly, forecast'], ['Band, probability', 'and top contributing', 'factors'], ['Alert policy and', 'dashboard badges', '(Low, Medium, High)']];
  const mw = 205, mg = 40, mx = 30, my = 320;
  ml.forEach((t, i) => { b += rect(mx + i * (mw + mg), my, mw, 76, t, { size: 14 }); if (i) b += line([[mx + i * (mw + mg) - mg, my + 38], [mx + i * (mw + mg), my + 38]]); });
  b += text(500, 436, 'Both paths read the same MongoDB data; the ML service sees only numeric features.', { size: 13 });
  return { width: W, svg: svg(W, H, b) };
}

// ---- DFD level 2 for process 5.0 ----
export function dfd2Diagram() {
  const W = 1000;
  const H = 440;
  let b = '';
  const proc = (cx, cy, id, t) => ellipse(cx, cy, 88, 40, [id, ...t], { size: 13 });
  const store = (x, y, w, t) => `<path d="M${x},${y} H${x + w} M${x},${y + 44} H${x + w}" stroke="#1f2937" stroke-width="1.6" fill="none"/>${text(x + w / 2, y + 22, t, { size: 13 })}`;
  const ent = (x, y, t) => rect(x, y, 120, 44, t, { size: 14 });
  b += ent(20, 60, ['Worker']) + ent(20, 200, ['Manager']);
  b += proc(300, 82, '5.1', ['Record stock', 'movement']);
  b += proc(520, 82, '5.2', ['Check reorder', 'level']);
  b += proc(740, 82, '5.3', ['Raise low-stock', 'alert']);
  b += proc(740, 222, '5.4', ['Draft purchase', 'order']);
  b += proc(520, 222, '5.5', ['Approve and', 'receive order']);
  b += store(250, 330, 200, ['D5 Inventory and', 'transactions']);
  b += store(640, 330, 200, ['D6 Alerts and D7', 'purchase orders']);
  b += line([[140, 82], [212, 82]]); b += label(176, 70, 'issue', { w: 22 });
  b += line([[140, 222], [432, 222]]); b += label(230, 210, 'approve', { w: 28 });
  b += line([[388, 82], [432, 82]]);
  b += line([[608, 82], [652, 82]]); b += label(630, 70, 'low', { w: 14 });
  b += line([[740, 122], [740, 182]]);
  b += line([[652, 222], [608, 222]]); b += label(630, 204, 'PO', { w: 12 });
  b += line([[470, 190], [345, 114]]); b += label(432, 138, 'stock in', { w: 28 });
  b += line([[300, 122], [300, 330]], { dash: true });
  b += line([[740, 262], [740, 330]], { dash: true });
  b += line([[828, 82], [910, 82], [910, 352], [840, 352]], { dash: true });
  b += text(500, 410, 'Dashed arrows: reads and writes of the data stores', { size: 13 });
  return { width: W, svg: svg(W, H, b) };
}

// ---- ER diagram (entity boxes with their key fields) ----
export function erDiagram() {
  const W = 1060;
  const H = 690;
  const BW = 180, BH = 118;
  const E = {
    USER: [0, 0, ['email', 'passwordHash', 'role', 'isActive']],
    WORKER: [1, 0, ['employeeId', 'department', 'shift (ref)', 'status']],
    SHIFT: [2, 0, ['name', 'startTime', 'endTime']],
    ALERT: [3, 0, ['type', 'severity', 'status', 'sourceId']],
    TASK: [0, 1, ['title', 'assignedTo (ref)', 'order (ref)', 'status']],
    ATTENDANCE: [1, 1, ['worker (ref)', 'date', 'checkIn', 'status']],
    MACHINE: [2, 1, ['code', 'status', 'riskLevel', 'healthScore', 'toolWearMin']],
    WORK_ORDER: [3, 1, ['woNo', 'machine (ref)', 'type', 'priority', 'status']],
    PRODUCTION_ORDER: [1, 2, ['orderNo', 'quantity', 'status', 'bottleneckFlag']],
    MACHINE_LOG: [2, 2, ['machine (ref)', 'toStatus', 'durationMins', 'reason']],
    STOCK_TRANSACTION: [0, 3, ['item (ref)', 'type', 'qty', 'order (ref)']],
    INVENTORY_ITEM: [1, 3, ['sku', 'quantity', 'reorderThreshold', 'unitCost']],
    PURCHASE_ORDER: [2, 3, ['poNo', 'supplier (ref)', 'lines', 'status']],
    SUPPLIER: [3, 3, ['name', 'leadTimeDays', 'active']],
  };
  const box = {};
  let b = '';
  for (const [name, [c, r, fields]] of Object.entries(E)) {
    const x = 20 + c * 280, y = 20 + r * 175;
    box[name] = { x, y, cx: x + BW / 2, cy: y + BH / 2 };
    b += rect(x, y, BW, BH, null);
    b += `<rect x="${x}" y="${y}" width="${BW}" height="26" fill="#e5e7eb" stroke="#1f2937" stroke-width="1.6"/>${text(x + BW / 2, y + 13, name, { size: 14, bold: true })}`;
    fields.forEach((f, i) => { b += text(x + 10, y + 42 + i * 17, f, { size: 13, anchor: 'start' }); });
  }
  const edge = (from, to) => {
    const A = box[from], B = box[to];
    const hit = (bx, ox) => { // where the centre-to-centre line leaves box bx
      const dx = ox.cx - bx.cx, dy = ox.cy - bx.cy;
      const t = Math.min(dx ? (BW / 2) / Math.abs(dx) : Infinity, dy ? (BH / 2) / Math.abs(dy) : Infinity);
      return [bx.cx + dx * t, bx.cy + dy * t];
    };
    return [hit(A, B), hit(B, A)];
  };
  const rel = (a, b2, ca, cb, mid) => {
    const [p, q] = edge(a, b2);
    const near = (pt, from, label) => { const t = 0.16; return text(pt[0] + (from[0] - pt[0]) * t * -1 + 0, pt[1] + 0, '', {}) + label; };
    void near;
    const tag = (pt, other, s) => { const dx = other[0] - pt[0], dy = other[1] - pt[1]; const d = Math.hypot(dx, dy) || 1; return label(pt[0] + (dx / d) * 18, pt[1] + (dy / d) * 14, s, { w: Math.max(12, s.length * 4.4) }); };
    let out = `<path d="M${p[0]},${p[1]} L${q[0]},${q[1]}" stroke="#1f2937" stroke-width="1.4" fill="none"/>`;
    out += tag(p, q, ca) + tag(q, p, cb);
    if (mid) out += label((p[0] + q[0]) / 2, (p[1] + q[1]) / 2, mid, { w: Math.max(14, mid.length * 3.6) });
    return out;
  };
  let lines = '';
  lines += rel('USER', 'WORKER', '1', '0..1', 'is');
  lines += rel('WORKER', 'SHIFT', 'N', '1', 'works');
  lines += rel('WORKER', 'ATTENDANCE', '1', 'N', 'records');
  lines += rel('WORKER', 'TASK', '1', 'N', 'assigned');
  lines += rel('TASK', 'PRODUCTION_ORDER', 'N', '1', 'for');
  lines += rel('MACHINE', 'MACHINE_LOG', '1', 'N', 'history');
  lines += rel('MACHINE', 'WORK_ORDER', '1', 'N', 'needs');
  lines += rel('MACHINE', 'ALERT', '1', 'N', 'raises');
  lines += rel('MACHINE', 'PRODUCTION_ORDER', 'N', 'M', 'used by');
  lines += rel('PRODUCTION_ORDER', 'INVENTORY_ITEM', 'N', 'M', 'consumes');
  lines += rel('INVENTORY_ITEM', 'STOCK_TRANSACTION', '1', 'N', 'moves');
  lines += rel('INVENTORY_ITEM', 'PURCHASE_ORDER', 'N', 'M', 'lines');
  lines += rel('PURCHASE_ORDER', 'SUPPLIER', 'N', '1', 'from');
  return { width: W, svg: svg(W, H, lines + b) };
}
