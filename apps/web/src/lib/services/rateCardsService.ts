// Service layer for rate-cards-api (ADR 0006 P1c). Pure API calls, no React.
// Every payload is parsed through the canon schema before it leaves, and every
// response is parsed on the way back, so a drift surfaces here, not deep in a
// component.

import { apiRequest } from '@/lib/apiClient';
import {
  RateCardSchema,
  RateCardLineSchema,
  RateCardCreateSchema,
  RateCardPatchSchema,
  RateCardLineCreateSchema,
  RateCardLinePatchSchema,
  type RateCard,
  type RateCardLine,
  type RateCardCreate,
  type RateCardPatch,
  type RateCardLineCreate,
  type RateCardLinePatch,
} from '@/lib/types/estimate';
import { z } from 'zod';

const BASE = '/rate-cards-api/rate-cards';

const ListEnvelope = z.object({
  items: z.array(RateCardSchema),
  next_cursor: z.string().nullable().optional(),
});

const CardWithLines = z.object({
  rate_card: RateCardSchema,
  lines: z.array(RateCardLineSchema),
});
export type RateCardWithLines = z.infer<typeof CardWithLines>;

export async function listRateCards(): Promise<RateCard[]> {
  const raw = await apiRequest<unknown>(BASE, { method: 'GET' });
  return ListEnvelope.parse(raw).items;
}

export async function getRateCard(id: string): Promise<RateCardWithLines> {
  const raw = await apiRequest<unknown>(`${BASE}/${id}`, { method: 'GET' });
  return CardWithLines.parse(raw);
}

export async function createRateCard(payload: RateCardCreate): Promise<RateCard> {
  const body = RateCardCreateSchema.parse(payload);
  const raw = await apiRequest<unknown>(BASE, { method: 'POST', body });
  return RateCardSchema.parse(raw);
}

export async function patchRateCard(id: string, payload: RateCardPatch): Promise<RateCard> {
  const body = RateCardPatchSchema.parse(payload);
  const raw = await apiRequest<unknown>(`${BASE}/${id}`, { method: 'PATCH', body });
  return RateCardSchema.parse(raw);
}

export async function listRateCardLines(cardId: string): Promise<RateCardLine[]> {
  const raw = await apiRequest<unknown>(`${BASE}/${cardId}/lines`, { method: 'GET' });
  return z.array(RateCardLineSchema).parse(raw);
}

export async function addRateCardLine(
  cardId: string,
  payload: RateCardLineCreate,
): Promise<RateCardLine> {
  const body = RateCardLineCreateSchema.parse(payload);
  const raw = await apiRequest<unknown>(`${BASE}/${cardId}/lines`, { method: 'POST', body });
  return RateCardLineSchema.parse(raw);
}

export async function patchRateCardLine(
  cardId: string,
  lineId: string,
  payload: RateCardLinePatch,
): Promise<RateCardLine> {
  const body = RateCardLinePatchSchema.parse(payload);
  const raw = await apiRequest<unknown>(`${BASE}/${cardId}/lines/${lineId}`, { method: 'PATCH', body });
  return RateCardLineSchema.parse(raw);
}

export async function deleteRateCardLine(cardId: string, lineId: string): Promise<void> {
  await apiRequest<unknown>(`${BASE}/${cardId}/lines/${lineId}`, { method: 'DELETE' });
}

// The org's active rate card plus its lines: the default card if one is flagged,
// else the first card. Returns null when the org has no card at all (the engine
// then prices every code at 0). Used by the wizard (read) and the editor.
export async function getActiveRateCard(): Promise<RateCardWithLines | null> {
  const cards = await listRateCards();
  const active = cards.find((c) => c.is_default) ?? cards[0];
  if (!active) return null;
  return getRateCard(active.id);
}
