import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { Play, Square, Zap } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import type { SimStatus } from '../lib/types';
import { btn } from './ui';
import { useToasts } from '../store/toast';

/** Admin-only demo control. It disappears if the server has the simulator disabled (production). */
export default function SimulatorControl() {
  const qc = useQueryClient();
  const push = useToasts((s) => s.push);
  const status = useQuery({
    queryKey: ['sim', 'status'],
    queryFn: async () => (await api.get<{ data: SimStatus }>('/simulate/status')).data.data,
    refetchInterval: (q) => (q.state.data?.running ? 5000 : false),
    retry: false,
  });
  const done = () => qc.invalidateQueries({ queryKey: ['sim'] });
  const fail = (e: unknown) => push({ tone: 'warning', title: 'Simulator', body: errorMessage(e) });
  const start = useMutation({ mutationFn: () => api.post('/simulate/start', { intervalSec: 5, events: 2 }), onSuccess: done, onError: fail });
  const stop = useMutation({ mutationFn: () => api.post('/simulate/stop'), onSuccess: done, onError: fail });
  const once = useMutation({ mutationFn: () => api.post('/simulate/machine-events', { events: 3 }), onError: fail });

  if (status.isError && axios.isAxiosError(status.error) && [403, 401].includes(status.error.response?.status ?? 0)) return null;
  const running = status.data?.running;

  return (
    <div className="flex items-center gap-2 rounded-xl border border-line bg-surface px-2.5 py-1.5" role="group" aria-label="Demo simulator">
      <span className="hidden text-[11px] font-medium uppercase tracking-wider text-muted sm:inline">Demo</span>
      <button className={`${btn.ghost} flex items-center gap-1 !px-2.5 !py-1 text-xs`} disabled={once.isPending} onClick={() => once.mutate()} title="Change a few machine statuses now"><Zap size={12} />Step</button>
      {running ? (
        <button className={`${btn.ghost} flex items-center gap-1 !px-2.5 !py-1 text-xs text-red`} disabled={stop.isPending} onClick={() => stop.mutate()}><Square size={12} />Stop live</button>
      ) : (
        <button className={`${btn.primary} flex items-center gap-1 !px-2.5 !py-1 text-xs`} disabled={start.isPending} onClick={() => start.mutate()}><Play size={12} />Start live</button>
      )}
      {running && <span className="flex items-center gap-1.5 font-mono text-[10px] text-green"><span className="size-1.5 animate-pulse rounded-full bg-green" />{status.data?.ticks} steps</span>}
    </div>
  );
}
