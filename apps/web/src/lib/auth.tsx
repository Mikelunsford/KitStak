/**
 * Thin re-export shim. The canonical AuthContext now lives at
 * `@/auth/AuthContext`. This file is kept only for legacy import paths
 * during the Wave 1 refactor and will be deleted once all callers have
 * been moved. New code should import from `@/auth/AuthContext` directly.
 */

export {
  AuthProvider,
  useAuth,
  useAuthOptional,
  type AuthState,
} from '@/auth/AuthContext';
