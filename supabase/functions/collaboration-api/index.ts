// collaboration-api: attachments, comments, notifications, saved_views.
//
// Pattern A RLS. Service-role queries always include `org_id = caller.orgId`.
// Capability checks per route via requireCap. Idempotency required on POST,
// PATCH, DELETE per the constitution.

import { route, type Route } from '../_shared/route.ts';
import {
  admin,
  parseBody,
  parseLimit,
  paginate,
  parseUuidParam,
  respondWithIdempotency,
  requireCap,
} from '../_shared/handler-helpers.ts';
import { ApiError, ok, created, noContent } from '../_shared/responses.ts';
import { requireCaller } from '../_shared/tenant.ts';
import {
  AttachmentCreateSchema,
  CommentCreateSchema,
  SavedViewCreateSchema,
} from '../_shared/types/cross_cutting.ts';

const BUNDLE = 'collaboration-api';

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------
const listAttachments: Route = {
  method: 'GET',
  path: '/attachments',
  async handler({ req, url }) {
    const caller = requireCaller(req);
    requireCap(caller, 'attachments.attachment.read');

    const entityType = url.searchParams.get('entity_type');
    const entityId = url.searchParams.get('entity_id');
    if (!entityType || !entityId) {
      throw new ApiError(
        'VALIDATION_ERROR',
        422,
        'entity_type and entity_id are required',
      );
    }
    const limit = parseLimit(url);

    const { data, error } = await admin()
      .from('attachments')
      .select('*')
      .eq('org_id', caller.orgId)
      .eq('entity_type', entityType)
      .eq('entity_id', entityId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(limit + 1);
    if (error) {
      throw new ApiError('INTERNAL_ERROR', 500, error.message);
    }
    return ok(paginate(data ?? [], limit));
  },
};

const createAttachment: Route = {
  method: 'POST',
  path: '/attachments',
  async handler({ req }) {
    const caller = requireCaller(req);
    requireCap(caller, 'attachments.attachment.create');
    const body = await parseBody(req, AttachmentCreateSchema);

    return respondWithIdempotency(req, caller, BUNDLE, '/attachments', body, async () => {
      const { data, error } = await admin()
        .from('attachments')
        .insert({
          org_id: caller.orgId,
          entity_type: body.entity_type,
          entity_id: body.entity_id,
          storage_path: body.storage_path,
          file_name: body.file_name,
          content_type: body.content_type ?? null,
          size_bytes: body.size_bytes,
          uploaded_by: caller.userId,
          created_by: caller.userId,
          updated_by: caller.userId,
        })
        .select('*')
        .single();
      if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
      return created(data);
    });
  },
};

const deleteAttachment: Route = {
  method: 'DELETE',
  path: '/attachments/:id',
  async handler({ req, params }) {
    const caller = requireCaller(req);
    requireCap(caller, 'attachments.attachment.delete');
    parseUuidParam(params.id);

    return respondWithIdempotency(
      req,
      caller,
      BUNDLE,
      '/attachments/:id',
      null,
      async () => {
        const { error } = await admin()
          .from('attachments')
          .update({
            deleted_at: new Date().toISOString(),
            updated_by: caller.userId,
          })
          .eq('id', params.id)
          .eq('org_id', caller.orgId);
        if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
        return noContent();
      },
    );
  },
};

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------
const listComments: Route = {
  method: 'GET',
  path: '/comments',
  async handler({ req, url }) {
    const caller = requireCaller(req);
    requireCap(caller, 'comments.comment.read');

    const entityType = url.searchParams.get('entity_type');
    const entityId = url.searchParams.get('entity_id');
    if (!entityType || !entityId) {
      throw new ApiError(
        'VALIDATION_ERROR',
        422,
        'entity_type and entity_id are required',
      );
    }
    const limit = parseLimit(url);

    const { data, error } = await admin()
      .from('comments')
      .select('*')
      .eq('org_id', caller.orgId)
      .eq('entity_type', entityType)
      .eq('entity_id', entityId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(limit + 1);
    if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
    return ok(paginate(data ?? [], limit));
  },
};

const createComment: Route = {
  method: 'POST',
  path: '/comments',
  async handler({ req }) {
    const caller = requireCaller(req);
    requireCap(caller, 'comments.comment.create');
    const body = await parseBody(req, CommentCreateSchema);

    return respondWithIdempotency(req, caller, BUNDLE, '/comments', body, async () => {
      const { data, error } = await admin()
        .from('comments')
        .insert({
          org_id: caller.orgId,
          entity_type: body.entity_type,
          entity_id: body.entity_id,
          parent_id: body.parent_id ?? null,
          author_id: caller.userId,
          body: body.body,
          is_internal: body.is_internal,
          created_by: caller.userId,
          updated_by: caller.userId,
        })
        .select('*')
        .single();
      if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
      return created(data);
    });
  },
};

const deleteComment: Route = {
  method: 'DELETE',
  path: '/comments/:id',
  async handler({ req, params }) {
    const caller = requireCaller(req);
    requireCap(caller, 'comments.comment.delete');
    parseUuidParam(params.id);

    return respondWithIdempotency(
      req,
      caller,
      BUNDLE,
      '/comments/:id',
      null,
      async () => {
        const { error } = await admin()
          .from('comments')
          .update({
            deleted_at: new Date().toISOString(),
            updated_by: caller.userId,
          })
          .eq('id', params.id)
          .eq('org_id', caller.orgId);
        if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
        return noContent();
      },
    );
  },
};

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------
const listNotifications: Route = {
  method: 'GET',
  path: '/notifications',
  async handler({ req, url }) {
    const caller = requireCaller(req);
    requireCap(caller, 'notifications.notification.read');
    const limit = parseLimit(url);

    const { data, error } = await admin()
      .from('notifications')
      .select('*')
      .eq('org_id', caller.orgId)
      .eq('recipient_user_id', caller.userId)
      .order('queued_at', { ascending: false })
      .limit(limit);
    if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
    return ok(data ?? []);
  },
};

const markRead: Route = {
  method: 'POST',
  path: '/notifications/:id/read',
  async handler({ req, params }) {
    const caller = requireCaller(req);
    requireCap(caller, 'notifications.notification.update');
    parseUuidParam(params.id);

    return respondWithIdempotency(
      req,
      caller,
      BUNDLE,
      '/notifications/:id/read',
      null,
      async () => {
        const { data, error } = await admin()
          .from('notifications')
          .update({
            read_at: new Date().toISOString(),
            updated_by: caller.userId,
          })
          .eq('id', params.id)
          .eq('org_id', caller.orgId)
          .eq('recipient_user_id', caller.userId)
          .select('*')
          .single();
        if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
        if (!data) throw new ApiError('NOT_FOUND', 404);
        return ok(data);
      },
    );
  },
};

// ---------------------------------------------------------------------------
// Saved views
// ---------------------------------------------------------------------------
const listSavedViews: Route = {
  method: 'GET',
  path: '/saved-views',
  async handler({ req, url }) {
    const caller = requireCaller(req);
    const entityType = url.searchParams.get('entity_type');
    if (!entityType) {
      throw new ApiError('VALIDATION_ERROR', 422, 'entity_type is required');
    }
    const { data, error } = await admin()
      .from('saved_views')
      .select('*')
      .eq('org_id', caller.orgId)
      .eq('entity_type', entityType)
      .or(`owner_user_id.eq.${caller.userId},is_shared.eq.true`);
    if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
    return ok(data ?? []);
  },
};

const createSavedView: Route = {
  method: 'POST',
  path: '/saved-views',
  async handler({ req }) {
    const caller = requireCaller(req);
    const body = await parseBody(req, SavedViewCreateSchema);

    return respondWithIdempotency(req, caller, BUNDLE, '/saved-views', body, async () => {
      const { data, error } = await admin()
        .from('saved_views')
        .insert({
          org_id: caller.orgId,
          owner_user_id: caller.userId,
          entity_type: body.entity_type,
          name: body.name,
          config: body.config,
          is_shared: body.is_shared,
          created_by: caller.userId,
          updated_by: caller.userId,
        })
        .select('*')
        .single();
      if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
      return created(data);
    });
  },
};

const deleteSavedView: Route = {
  method: 'DELETE',
  path: '/saved-views/:id',
  async handler({ req, params }) {
    const caller = requireCaller(req);
    parseUuidParam(params.id);

    return respondWithIdempotency(
      req,
      caller,
      BUNDLE,
      '/saved-views/:id',
      null,
      async () => {
        const { error } = await admin()
          .from('saved_views')
          .delete()
          .eq('id', params.id)
          .eq('org_id', caller.orgId)
          .eq('owner_user_id', caller.userId);
        if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
        return noContent();
      },
    );
  },
};

const TABLE: Route[] = [
  listAttachments,
  createAttachment,
  deleteAttachment,
  listComments,
  createComment,
  deleteComment,
  listNotifications,
  markRead,
  listSavedViews,
  createSavedView,
  deleteSavedView,
];

Deno.serve((req) => route(req, TABLE, { bundle: BUNDLE }));

// Re-export for downstream tests that may want to fold this bundle into a
// monolith. Unused at runtime.
export { TABLE };
