// PR-6 / B5: extracted from ActivityCreatePage so the vitest unit test
// can exercise the pure validator without transitively loading the
// supabase singleton (`@/lib/supabase`) at module-load time. The page
// imports this and re-exports for any code that wants both alongside.
//
// Validates the `?entity_type=` URL parameter against the
// ActivityEntityType union and falls back to 'customer' when the value
// is missing or not a member of the enum.

import {
  ActivityEntityTypeSchema,
  type ActivityEntityType,
} from '@/lib/types/crm';

export function parseEntityTypeParam(raw: string | null): ActivityEntityType {
  if (!raw) return 'customer';
  const parsed = ActivityEntityTypeSchema.safeParse(raw);
  return parsed.success ? parsed.data : 'customer';
}
