// Wave 12 / A3. Shared read hook for the spine job_types catalog. Used by the
// quote detail page's job-type control; the same query config the
// JobTemplateCreatePage uses inline. Read-only list, cached 30s.

import { useQuery } from '@tanstack/react-query';

import { jobTypesKeys } from '@/lib/queryKeys/jobTypes';
import { listJobTypes } from '@/lib/services/jobTypesService';

export function useJobTypes() {
  return useQuery({
    queryKey: jobTypesKeys.list(),
    queryFn: () => listJobTypes(),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
}
