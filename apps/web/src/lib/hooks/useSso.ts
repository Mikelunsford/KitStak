// SSO connection hooks. R-W13-AUTH-01. TanStack Query over ssoService.

import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import { ssoKeys } from '@/lib/queryKeys/sso';
import {
  createSsoConnection,
  deleteSsoConnection,
  listSsoConnections,
  updateSsoConnection,
  configureSamlMetadata,
  configureOidcMetadata,
  type CreateSsoConnectionInput,
  type UpdateSsoConnectionInput,
  type ConfigureSamlMetadataInput,
  type ConfigureOidcMetadataInput,
} from '@/lib/services/ssoService';

/** GET sso_connections (RLS-scoped to the active org). */
export function useSsoConnections(opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ssoKeys.list,
    queryFn: listSsoConnections,
    staleTime: 30_000,
    enabled: opts.enabled ?? false,
  });
}

export function useCreateSsoConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSsoConnectionInput) => createSsoConnection(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ssoKeys.all });
    },
  });
}

export function useUpdateSsoConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; patch: UpdateSsoConnectionInput }) =>
      updateSsoConnection(vars.id, vars.patch),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ssoKeys.all });
    },
  });
}

export function useDeleteSsoConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteSsoConnection(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ssoKeys.all });
    },
  });
}

// F-Wave13-SSO-HANDSHAKE-01: store IdP metadata through settings-api. Storing
// does not change the connection record, but the detail surface reflects the
// saved state, so invalidate the list for consistency.
export function useConfigureSamlMetadata() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ConfigureSamlMetadataInput) => configureSamlMetadata(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ssoKeys.all });
    },
  });
}

export function useConfigureOidcMetadata() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ConfigureOidcMetadataInput) => configureOidcMetadata(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ssoKeys.all });
    },
  });
}
