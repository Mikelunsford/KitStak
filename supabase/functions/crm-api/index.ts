// crm-api entry point. Routes for customers, contacts, activities, leads,
// opportunities. Uses the shared route dispatcher; per-route capability
// checks and idempotency live in the handlers.
//
// BUNDLE GATE (cross-pillar OR predicate). Constitutional rule
// (CLAUDE.md / 00-canon): plugin bundle gates return 404 NOT_FOUND when the
// caller's org lacks the plugin. customers/contacts/leads/opportunities are
// CROSS-PILLAR: the 3PL, Manufacturing, and Co-Pack surfaces all read and
// write them (e.g. the CustomerPicker on quotes, invoices, sales orders, and
// the manufacturing run detail page). Gating on a single pillar flag would
// lock out a manufacturing-only or copack-only org that legitimately needs
// customers. The gate therefore passes when ANY of the three commerce pillar
// plugins is enabled, and returns 404 only when ALL are off. Closes
// F-Wave9-SALES-CONFIG-3PL-GATE-01.

import { routes } from './routes.ts';
import { serveBundleWithGate } from '../_shared/bundleGate.ts';
import { FEATURE_FLAGS } from '../_shared/constants.ts';

const BUNDLE = 'crm-api';

serveBundleWithGate({
  flagKeys: [
    FEATURE_FLAGS.PLUGINS_THREE_PL,
    FEATURE_FLAGS.PLUGINS_MANUFACTURING,
    FEATURE_FLAGS.PLUGINS_COPACK_ECOM,
  ],
  routes,
  bundle: BUNDLE,
});
