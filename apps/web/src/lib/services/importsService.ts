// Imports service. Validate-then-commit CSV imports.

import { apiRequest } from '@/lib/apiClient';
import {
  ImportValidateRequestSchema,
  ImportValidateResponseSchema,
  ImportCommitRequestSchema,
  ImportCommitResponseSchema,
  type ImportEntityType,
  type ImportValidateResponse,
  type ImportCommitResponse,
} from '@/lib/types/cross_cutting';

export async function validateImport(
  entityType: ImportEntityType,
  rows: Array<Record<string, unknown>>,
): Promise<ImportValidateResponse> {
  const body = ImportValidateRequestSchema.parse({ entity_type: entityType, rows });
  const data = await apiRequest<unknown>(
    `/imports-api/imports/${encodeURIComponent(entityType)}/validate`,
    { method: 'POST', body },
  );
  return ImportValidateResponseSchema.parse(data);
}

export async function commitImport(
  entityType: ImportEntityType,
  rows: Array<Record<string, unknown>>,
): Promise<ImportCommitResponse> {
  const body = ImportCommitRequestSchema.parse({ entity_type: entityType, rows });
  const data = await apiRequest<unknown>(
    `/imports-api/imports/${encodeURIComponent(entityType)}/commit`,
    { method: 'POST', body },
  );
  return ImportCommitResponseSchema.parse(data);
}
