import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { OrderProjection, StockCover } from '../lib/types';
import { useAuth } from '../store/auth';

/**
 * Forecasts come from the risk-model service. When it is off or down these queries just stay empty
 * (no retries, no error banners): every page works the same without them.
 */
const options = { retry: false, staleTime: 60_000, refetchOnWindowFocus: false } as const;

export function useStockCover() {
  const staff = useAuth((s) => s.user?.role !== 'worker');
  return useQuery({
    queryKey: ['insights', 'stock'], enabled: staff, ...options,
    queryFn: async () => (await api.get<{ data: StockCover[] }>('/insights/stock')).data.data,
  });
}

export function useOrderProjections() {
  const staff = useAuth((s) => s.user?.role !== 'worker');
  return useQuery({
    queryKey: ['insights', 'orders'], enabled: staff, ...options,
    queryFn: async () => (await api.get<{ data: OrderProjection[] }>('/insights/orders')).data.data,
  });
}
