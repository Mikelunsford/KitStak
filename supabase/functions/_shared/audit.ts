// Audit log: subsystem note (no edge-function writer helper).
//
// Kitstak's audit_log is NOT written from edge-function application code.
// Every audit row is produced inside the database by per-entity
// SECURITY DEFINER writer functions (state-change triggers, the
// kitstak_audit_state / kitstak_audit_created / audit_append_state_change
// helpers, and the org-membership writers). Those functions own the entire
// write path: they take a per-org advisory lock, read the current chain head
// via public.kitstak_audit_chain_head(org_id), build the canonical payload,
// compute prev_hash and payload_hash, and INSERT the row in one statement.
// See migration 0085 (F-Wave9-AUDIT-CHAIN-SAME-TXN-01) for the canonical
// definitions of the writers, the shared chain-head helper, and
// verify_audit_chain.
//
// Hash chain: prev_hash and payload_hash are computed by those DB writer
// functions, not by any application code. Same-transaction rows are ordered
// by the monotonic audit_log.seq column so the chain links in true insertion
// order. The application stays out of the hashing path so a handler bug
// cannot poison the chain.
//
// append-only / write authority: audit_log is service-role-write-only and
// append-only. Its RLS posture denies INSERT, UPDATE, and DELETE for the
// authenticated role; only the SECURITY DEFINER writer functions (running
// with service-role identity) insert rows, and no path updates or deletes
// them. Edge handlers therefore have no audit-write helper to call: moving a
// state machine emits the audit row automatically via the entity's trigger.
//
// This module intentionally exports nothing. It exists as the single place an
// edge-function author looks when wondering "where do I write audit rows?".
// The answer is: you do not. You change entity state and the database writes
// the audit row for you. If a genuinely trigger-less audit need ever appears,
// add a new SECURITY DEFINER DB function in a forward migration (so it shares
// kitstak_audit_chain_head and the hashing path) rather than writing
// audit_log rows from application code.

export {};
