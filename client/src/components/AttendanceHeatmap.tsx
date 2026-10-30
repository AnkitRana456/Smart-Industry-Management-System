import type { AttendanceCell, AttendanceReport } from '../lib/types';
import { fmtDay } from './charts';

const CELL: Record<AttendanceCell, { cls: string; label: string }> = {
  present: { cls: 'bg-green', label: 'Present' },
  late: { cls: 'bg-amber', label: 'Late' },
  absent: { cls: 'bg-red', label: 'Absent' },
  leave: { cls: 'bg-purple', label: 'On approved leave' },
  pending: { cls: 'border border-dashed border-muted', label: 'Not in yet' },
  none: { cls: 'bg-surface-2', label: 'No one checked in (closed)' },
};

/** One row per worker, one square per day. Colour is never the only signal: every cell has a text label. */
export default function AttendanceHeatmap({ report }: { report: AttendanceReport }) {
  if (!report.rows.length) return <p className="py-8 text-center text-sm text-muted">No active workers.</p>;
  return (
    <div>
      <div className="overflow-x-auto">
        <table className="border-separate border-spacing-1 text-xs" aria-label="Attendance by worker and day">
          <thead>
            <tr>
              <th className="sticky left-0 bg-surface pr-3 text-left font-medium text-muted">Worker</th>
              {report.keys.map((k, i) => (
                <th key={k} className="w-5 min-w-5 text-center font-normal text-[10px] text-muted">
                  {i % Math.ceil(report.keys.length / 10) === 0 ? fmtDay(k).split(' ')[1] : ''}
                  <span className="sr-only">{fmtDay(k)}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {report.rows.map((r) => (
              <tr key={r.workerId}>
                <th scope="row" className="sticky left-0 whitespace-nowrap bg-surface pr-3 text-left font-medium">
                  {r.name} <span className="font-mono text-[10px] font-normal text-muted">{r.employeeId}</span>
                </th>
                {report.keys.map((k) => {
                  const c = CELL[r.days[k]];
                  return (
                    <td key={k} title={`${r.name}, ${fmtDay(k)}: ${c.label}`} className="p-0">
                      <span className={`block size-5 rounded ${c.cls}`} role="img" aria-label={`${r.name}, ${fmtDay(k)}: ${c.label}`} />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
        {(Object.keys(CELL) as AttendanceCell[]).map((k) => (
          <li key={k} className="inline-flex items-center gap-1.5"><span className={`size-3 rounded ${CELL[k].cls}`} />{CELL[k].label}</li>
        ))}
      </ul>
    </div>
  );
}
