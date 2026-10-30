import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import AttendanceHeatmap from './AttendanceHeatmap';

const report = {
  days: 3, attendancePct: 50, keys: ['2026-10-27', '2026-10-28', '2026-10-29'],
  series: [],
  rows: [{ workerId: 'w1', employeeId: 'E-1', name: 'Asha', days: { '2026-10-27': 'present', '2026-10-28': 'absent', '2026-10-29': 'none' } as const }],
};

describe('AttendanceHeatmap', () => {
  it('gives every day a text label, not just a colour', () => {
    render(<AttendanceHeatmap report={report as never} />);
    expect(screen.getByRole('img', { name: /Asha, .*27.*: Present/ })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Asha, .*28.*: Absent/ })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /29.*: No one checked in/ })).toBeInTheDocument();
  });

  it('says so when there are no active workers', () => {
    render(<AttendanceHeatmap report={{ ...report, rows: [] } as never} />);
    expect(screen.getByText('No active workers.')).toBeInTheDocument();
  });
});
