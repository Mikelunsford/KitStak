import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { vendorsKeys } from '@/lib/queryKeys/vendors';
import {
  listVendors, getVendor, createVendor, updateVendor, deleteVendor,
  type Vendor,
} from '@/lib/services/vendorsService';

export function useVendorsList() {
  return useQuery({
    queryKey: vendorsKeys.list(),
    queryFn: () => listVendors(),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
}

export function useVendor(id: string | undefined) {
  return useQuery({
    queryKey: id ? vendorsKeys.detail(id) : ['vendors', 'vendors', 'detail', 'noop'],
    queryFn: () => getVendor(id as string),
    enabled: !!id,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
}

export function useCreateVendor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<Vendor>) => createVendor(input),
    onSuccess: () => { qc.invalidateQueries({ queryKey: vendorsKeys.all }); },
  });
}

export function useUpdateVendor(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<Vendor>) => updateVendor(id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: vendorsKeys.detail(id) });
      qc.invalidateQueries({ queryKey: vendorsKeys.list() });
    },
  });
}

export function useDeleteVendor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteVendor(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: vendorsKeys.all }); },
  });
}
