import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import { brandingKeys } from '@/lib/queryKeys/branding';
import { settingsKeys } from '@/lib/queryKeys/settings';
import {
  deleteSetting,
  getBrandingRow,
  getNumberingSequence,
  listNumberingSequences,
  listSettingGroup,
  listSettings,
  patchBranding,
  resetNumberingSequence,
  upsertSetting,
  type BrandingPatch,
} from '@/lib/services/settingsService';
import type {
  NumberingResetRequest,
  SettingUpsertRequest,
} from '@/lib/types/identity';

/** GET /settings-api/settings. */
export function useSettings(opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: settingsKeys.list,
    queryFn: listSettings,
    staleTime: 30_000,
    enabled: opts.enabled ?? false,
  });
}

/** GET /settings-api/settings/:group. */
export function useSettingGroup(
  group: string,
  opts: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: settingsKeys.group(group),
    queryFn: () => listSettingGroup(group),
    staleTime: 30_000,
    enabled: (opts.enabled ?? false) && group.length > 0,
  });
}

/** PUT /settings-api/settings. */
export function useUpsertSetting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: SettingUpsertRequest) => upsertSetting(payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: settingsKeys.all });
    },
  });
}

/** DELETE /settings-api/settings/:group/:key. */
export function useDeleteSetting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { group: string; key: string }) =>
      deleteSetting(vars.group, vars.key),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: settingsKeys.all });
    },
  });
}

/** GET /settings-api/branding. */
export function useBrandingAdmin(opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: settingsKeys.branding,
    queryFn: getBrandingRow,
    staleTime: 30_000,
    enabled: opts.enabled ?? false,
  });
}

/** PUT /settings-api/branding. */
export function usePatchBranding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: BrandingPatch) => patchBranding(patch),
    onSuccess: () => {
      // Refresh the admin form's own read.
      void qc.invalidateQueries({ queryKey: settingsKeys.branding });
      // And the live-shell read (BrandingProvider / Topbar) which is keyed
      // separately under ['tenants','branding']; without this the chrome keeps
      // the stale logo and colours until a full reload.
      void qc.invalidateQueries({ queryKey: brandingKeys.all });
    },
  });
}

/** GET /settings-api/numbering. */
export function useNumberingSequences(opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: settingsKeys.numbering,
    queryFn: listNumberingSequences,
    staleTime: 30_000,
    enabled: opts.enabled ?? false,
  });
}

/** GET /settings-api/numbering/:doc_type. */
export function useNumberingSequence(
  docType: string,
  opts: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: settingsKeys.numberingOne(docType),
    queryFn: () => getNumberingSequence(docType),
    staleTime: 30_000,
    enabled: (opts.enabled ?? false) && docType.length > 0,
  });
}

/** POST /settings-api/numbering/reset. */
export function useResetNumbering() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: NumberingResetRequest) =>
      resetNumberingSequence(payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: settingsKeys.numbering });
    },
  });
}
