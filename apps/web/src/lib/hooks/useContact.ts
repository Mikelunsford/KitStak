import { useQuery } from '@tanstack/react-query';

import { contactsKeys } from '@/lib/queryKeys/contacts';
import { getContact } from '@/lib/services/contactsService';

export function useContact(id: string | undefined) {
  return useQuery({
    queryKey: id
      ? contactsKeys.detail(id)
      : ['crm', 'contacts', 'detail', 'noop'],
    queryFn: () => getContact(id as string),
    enabled: Boolean(id),
    staleTime: 30_000,
  });
}
