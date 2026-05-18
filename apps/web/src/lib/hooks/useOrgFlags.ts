import { useFlags } from './useFlags';

/**
 * useOrgFlags. wraps useFlags() and reduces the OrgFeatureFlag[] response to a
 * Record<string, boolean> keyed by flag_key. The Sidebar (and any future
 * pillar-bundle gate) treats the absence of a key as "off", so the simple
 * Object.fromEntries shape is enough.
 *
 * Closes F-Wave2-API-03 (replaces the Wave 1 stub).
 */
export function useOrgFlags(opts: { enabled?: boolean } = {}): {
  data: Record<string, boolean>;
  isLoading: boolean;
} {
  const query = useFlags({ enabled: opts.enabled ?? true });
  const flags = query.data ?? [];
  const data = Object.fromEntries(
    flags.map((f) => [f.flag_key, f.is_enabled]),
  );
  return { data, isLoading: query.isLoading };
}
