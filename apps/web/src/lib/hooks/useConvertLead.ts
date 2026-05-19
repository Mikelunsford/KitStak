import { useMutation, useQueryClient } from '@tanstack/react-query';

import { auditLogKeys } from '@/lib/queryKeys/auditLog';
import { customersKeys } from '@/lib/queryKeys/customers';
import { leadsKeys } from '@/lib/queryKeys/leads';
import { opportunitiesKeys } from '@/lib/queryKeys/opportunities';
import { convertLead } from '@/lib/services/leadsService';
import type { LeadConvert } from '@/lib/types/crm';

export function useConvertLead(leadId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: LeadConvert) => convertLead(leadId, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: leadsKeys.all });
      void qc.invalidateQueries({ queryKey: customersKeys.all });
      void qc.invalidateQueries({ queryKey: opportunitiesKeys.all });
      // F-Wave7-AUDIT-CACHE-SWEEP-01: convert drives a lead state transition
      // (new -> qualified -> converted) that writes an audit row; invalidate
      // the source lead's timeline so the operator returning to the lead
      // detail page sees the new entry.
      void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity('lead', leadId) });
    },
  });
}
