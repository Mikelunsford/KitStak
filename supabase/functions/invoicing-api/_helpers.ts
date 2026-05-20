// invoicing-api local helpers. The per-bundle requireFinanceCap shim was
// retired at F-Wave2-AGENT-A-05; handlers now import requireCap directly
// from _shared/handler-helpers.ts. BUNDLE remains here for idempotency
// route-keys.

export const BUNDLE = 'invoicing-api';
