import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import type { Machine } from '../lib/types';

/** Renders with fresh query state and a router. Retries are off so failures show up immediately. */
export function renderWithApp(ui: ReactElement, { route = '/' }: { route?: string } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

export const machine = (over: Partial<Machine> = {}): Machine => ({
  _id: 'm1', name: 'Packaging A', code: 'M-110', type: 'Packaging', status: 'running', runHours: 2960,
  toolWearMin: 222, temperatureC: 82, vibrationMms: 4.35, riskLevel: 'INSUFFICIENT_DATA', ...over,
});

/** Shape of a successful API reply: the app unwraps `data.data`. */
export const ok = <T,>(data: T) => ({ data: { success: true, data, message: 'OK', errors: null } });

export function apiError(status: number, message: string) {
  return Object.assign(new Error(message), { isAxiosError: true, response: { status, data: { success: false, data: null, message, errors: null } } });
}
