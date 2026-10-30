import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Supplier } from '../lib/types';
import { input } from './ui';

export function useSuppliers() {
  return useQuery({
    queryKey: ['suppliers'],
    queryFn: async () => (await api.get<{ data: Supplier[] }>('/suppliers')).data.data,
  });
}

/** Active suppliers; a supplier that has since been deactivated stays selectable so an old record still displays. */
export default function SupplierSelect({ id, value, onChange, empty = 'None' }: { id: string; value: string; onChange: (v: string) => void; empty?: string }) {
  const suppliers = useSuppliers();
  return (
    <select id={id} className={input} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{empty}</option>
      {suppliers.data?.filter((s) => s.active || s._id === value).map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}
    </select>
  );
}
