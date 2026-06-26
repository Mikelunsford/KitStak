import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { itemsKeys } from '@/lib/queryKeys/items';
import {
  listItems, getItem, createItem, updateItem,
} from '@/lib/services/itemsService';
import type { Item } from '@/lib/types/sales';

export function useItemsList() {
  return useQuery({ queryKey: itemsKeys.list(), queryFn: () => listItems() });
}

export function useItem(id: string | undefined) {
  return useQuery({
    queryKey: id ? itemsKeys.byId(id) : ['sales', 'items', 'byId', '__none__'],
    queryFn: () => getItem(id as string),
    enabled: !!id,
  });
}

export function useCreateItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Partial<Item>) => createItem(payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: itemsKeys.all });
    },
  });
}

export function useUpdateItem(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Partial<Item>) => updateItem(id, payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: itemsKeys.byId(id) });
      void qc.invalidateQueries({ queryKey: itemsKeys.all });
    },
  });
}
