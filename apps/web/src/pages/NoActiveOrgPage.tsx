import { useNavigate } from 'react-router-dom';

import { Logo } from '@/components/ui/Logo';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/auth/AuthContext';

/**
 * NoActiveOrgPage. Hard-error surface for the NO_ACTIVE_ORG state.
 *
 * F-Wave9-COWORK-SMOKE-03. The Edge dispatcher returns
 * `401 NO_ACTIVE_ORG` when the JWT decodes but carries no
 * `kitstak_org_id` claim. The SPA used to silently render an empty
 * dashboard for the same condition, leaving the operator with no
 * indication that anything was wrong. This page is the SPA-side
 * fail-safe: any authenticated session without the claim lands here
 * with a clear message and a Sign Out button.
 *
 * SMOKE-02 (migration 0069) is the upstream fix; this page covers
 * legacy users, dev poking, or JWT desync mid-session.
 *
 * Sign Out clears the Supabase session and routes the caller to
 * /signin so they can re-authenticate (which on success triggers the
 * provision_organization trigger and stamps a fresh claim).
 *
 * Copy is direct: no em dashes, no double hyphens, no emojis.
 */
export function NoActiveOrgPage() {
  const { signOut } = useAuth();
  const navigate = useNavigate();

  async function onSignOut() {
    await signOut();
    navigate('/signin', { replace: true });
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-bg px-6">
      <div className="w-full max-w-md flex flex-col gap-8">
        <header className="flex justify-center">
          <Logo size="default" />
        </header>

        <section className="bg-bg-2 border border-line p-10 flex flex-col gap-6">
          <h1 className="text-4xl font-display tracking-wide text-ink">
            NO ACTIVE WORKSPACE
          </h1>
          <p className="font-sans text-ink-dim">
            Your account is not linked to an active workspace. Sign out and
            back in to refresh your session. If this persists, contact your
            workspace administrator.
          </p>
          <Button onClick={onSignOut} className="self-start">
            Sign Out
          </Button>
        </section>
      </div>
    </main>
  );
}
