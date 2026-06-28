// Imports service. Validate-then-commit CSV imports, plus the history ledger.

import { z } from 'zod';

import { apiRequest } from '@/lib/apiClient';
import {
  ImportValidateRequestSchema,
  ImportValidateResponseSchema,
  ImportCommitRequestSchema,
  ImportCommitResponseSchema,
  ImportJobSchema,
  type ImportEntityType,
  type ImportValidateResponse,
  type ImportCommitResponse,
  type ImportJob,
} from '@/lib/types/cross_cutting';

const ImportJobListSchema = z.array(ImportJobSchema);

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

export async function listImportJobs(): Promise<ImportJob[]> {
  const data = await apiRequest<unknown>('/imports-api/imports/jobs', {
    method: 'GET',
  });
  return ImportJobListSchema.parse(data);
}
