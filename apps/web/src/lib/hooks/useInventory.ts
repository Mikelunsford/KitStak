import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  warehousesKeys, stockLevelsKeys, stockMovementsKeys, bomItemsKeys,
} from '@/lib/queryKeys/inventory';
import {
  listWarehouses, getWarehouse, createWarehouse, updateWarehouse, deleteWarehouse,
  type Warehouse,
} from '@/lib/services/warehousesService';
import { listStockLevels } from '@/lib/services/stockLevelsService';
import { listStockMovements } from '@/lib/services/stockMovementsService';
import {
  listBomItems, createBomItem, updateBomItem, deleteBomItem,
  type BomItem,
} from '@/lib/services/bomItemsService';

const C = { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 as const };

export function useWarehousesList() {
  return useQuery({ queryKey: warehousesKeys.list(), queryFn: listWarehouses, ...C });
}

export function useWarehouse(id: string | undefined) {
  return useQuery({
    queryKey: id ? warehousesKeys.detail(id) : ['inventory', 'warehouses', 'detail', 'noop'],
    queryFn: () => getWarehouse(id as string),
    enabled: !!id,
    ...C,
  });
}

export function useCreateWarehouse() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<Warehouse>) => createWarehouse(input),
    onSuccess: () => { qc.invalidateQueries({ queryKey: warehousesKeys.all }); },
  });
}

export function useUpdateWarehouse(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<Warehouse>) => updateWarehouse(id, input),
    onSuccess: () => { qc.invalidateQueries({ queryKey: warehousesKeys.all }); },
  });
}

export function useDeleteWarehouse() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteWarehouse(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: warehousesKeys.all }); },
  });
}

export function useStockLevels(params: { warehouseId?: string; itemId?: string } = {}) {
  return useQuery({
    queryKey: stockLevelsKeys.list(params.warehouseId, params.itemId),
    queryFn: () => listStockLevels(params),
    ...C,
  });
}

export function useStockMovements(params: { warehouseId?: string; itemId?: string } = {}) {
  return useQuery({
    queryKey: stockMovementsKeys.list(params.warehouseId, params.itemId),
    queryFn: () => listStockMovements(params),
    ...C,
  });
}

export function useBomItemsList(parentItemId?: string) {
  return useQuery({
    queryKey: bomItemsKeys.list(parentItemId),
    queryFn: () => listBomItems(parentItemId),
    ...C,
  });
}

export function useCreateBomItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<BomItem>) => createBomItem(input),
    onSuccess: () => { qc.invalidateQueries({ queryKey: bomItemsKeys.all }); },
  });
}

export function useUpdateBomItem(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<BomItem>) => updateBomItem(id, input),
    onSuccess: () => { qc.invalidateQueries({ queryKey: bomItemsKeys.all }); },
  });
}

export function useDeleteBomItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteBomItem(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: bomItemsKeys.all }); },
  });
}
