const fs = require('fs');
const edit = (f, pairs) => {
  let s = fs.readFileSync(f, 'utf8');
  for (const [a, b] of pairs) {
    if (!s.includes(a)) throw new Error(`${f}: ${a}`);
    s = s.replace(a, () => b);
  }
  fs.writeFileSync(f, s);
};
edit('pages/Dashboard.tsx', [
  ["import { useQuery } from '@tanstack/react-query';", "import { useQuery } from '@tanstack/react-query';\nimport { Boxes, Cog, Factory, Package, Timer, Users, type LucideIcon } from 'lucide-react';"],
]);

edit('pages/Login.tsx', [
  ["import { Activity } from 'lucide-react';", "import { Activity, BellRing, Gauge, ShieldCheck } from 'lucide-react';"],
  [`    <div className="grid min-h-full place-items-center bg-bg p-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl border border-line bg-surface p-7 shadow-xl">`, `    <div className="grid min-h-full place-items-center p-4">
      <div className="grid w-full max-w-4xl overflow-hidden rounded-3xl border border-line bg-surface md:grid-cols-[1.05fr_1fr]" style={{ boxShadow: 'var(--shadow-pop)' }}>
        <aside className="relative hidden flex-col justify-between overflow-hidden bg-gradient-to-br from-amber/20 via-blue/15 to-purple/20 p-10 md:flex" aria-hidden>
          <div className="absolute -right-20 -top-20 size-72 rounded-full bg-amber/20 blur-3xl" />
          <div className="absolute -bottom-24 -left-16 size-72 rounded-full bg-blue/20 blur-3xl" />
          <div className="relative">
            <div className="mb-8 grid size-12 place-items-center rounded-2xl bg-gradient-to-br from-amber to-blue text-white shadow-lg shadow-amber/30"><Activity size={24} /></div>
            <h2 className="font-display text-3xl font-bold leading-tight">The whole floor,<br />in one calm view.</h2>
            <p className="mt-3 max-w-xs text-sm text-muted">Machines, people, stock and production, with live updates and plain-language insight.</p>
          </div>
          <ul className="relative flex flex-col gap-3 text-sm">
            {[[Gauge, 'Live machine health and downtime'], [BellRing, 'Alerts that reach the right person'], [ShieldCheck, 'Role-based access for every team']].map(([Icon, text]) => (
              <li key={text as string} className="flex items-center gap-3"><span className="grid size-8 place-items-center rounded-lg bg-surface/60 text-amber"><Icon size={16} /></span>{text as string}</li>
            ))}
          </ul>
        </aside>
      <form onSubmit={submit} className="w-full p-7 sm:p-10">`],
  ["        </p>\n      </form>\n    </div>", "        </p>\n      </form>\n      </div>\n    </div>"],
  ['<h1 className="font-display text-xl font-bold leading-tight">Sign in to SIMS</h1>', '<h1 className="font-display text-xl font-bold leading-tight">Sign in to SIMS</h1>'],
  ['<div className="mb-6 flex items-center gap-3">\n          <div className="grid size-10 place-items-center rounded-xl bg-gradient-to-br from-amber to-blue text-white">', '<div className="mb-6 flex items-center gap-3 md:hidden">\n          <div className="grid size-10 place-items-center rounded-xl bg-gradient-to-br from-amber to-blue text-white">'],
]);
console.log('ok');
