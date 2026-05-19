// pdf-worker: PDF rendering for invoice, quote, purchase_order documents.
//
//   POST /pdf/render    body { template, data } -> 501 (v1 stub)
//   GET  /pdf/templates                          -> list of available templates
//
// v1 ships a stub that returns 501 PDF_NOT_YET_AVAILABLE. The constitution's
// no-banned-dependency rule prevents us from pulling a headless-Chrome
// renderer or a heavyweight PDF library without operator approval. A
// follow-up Wave will land pdfkit (BSD, no Chrome) and replace the stub.

import { route, type Route } from '../_shared/route.ts';
import { parseBody } from '../_shared/handler-helpers.ts';
import { ApiError, ok, fromApiError } from '../_shared/responses.ts';
import { requireCaller } from '../_shared/tenant.ts';
import { hasCrossCuttingCap } from '../_shared/capabilities/cross_cutting.ts';
import { z } from 'zod';

const BUNDLE = 'pdf-worker';

const TEMPLATES = [
  { id: 'invoice', label: 'Invoice', entity_type: 'invoice' },
  { id: 'quote', label: 'Quote', entity_type: 'quote' },
  { id: 'purchase_order', label: 'Purchase order', entity_type: 'purchase_order' },
] as const;

const RenderRequestSchema = z.object({
  template: z.enum(['invoice', 'quote', 'purchase_order']),
  data: z.record(z.unknown()),
});

const listTemplates: Route = {
  method: 'GET',
  path: '/pdf/templates',
  async handler({ req }) {
    const caller = requireCaller(req);
    if (!hasCrossCuttingCap(caller.role, 'pdf.document.render')) {
      throw new ApiError('FORBIDDEN', 403, 'caller lacks capability: pdf.document.render');
    }
    return ok({ items: TEMPLATES });
  },
};

const render: Route = {
  method: 'POST',
  path: '/pdf/render',
  async handler({ req }) {
    const caller = requireCaller(req);
    if (!hasCrossCuttingCap(caller.role, 'pdf.document.render')) {
      throw new ApiError('FORBIDDEN', 403, 'caller lacks capability: pdf.document.render');
    }
    const _body = await parseBody(req, RenderRequestSchema);
    // v1 stub. The dependency ban list excludes a Chrome-based renderer and
    // the operator has not yet approved a JS PDF library; rather than ship
    // unapproved code we return 501 so the SPA can surface a clear "PDF not
    // yet available" message.
    return fromApiError(
      new ApiError('PDF_NOT_YET_AVAILABLE', 501, 'PDF rendering is not yet available in this build.'),
    );
  },
};

Deno.serve((req) => route(req, [listTemplates, render], { bundle: BUNDLE }));

export { listTemplates, render, TEMPLATES };
