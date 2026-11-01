import type { SplitwisePreviewRow } from './api';

export interface ReviewRow extends SplitwisePreviewRow {
  include: boolean;
  chosen: string | null;
}

/**
 * Rows the user reviews before importing. On a re-preview (Retry, or a
 * different member) `previous` carries over the user's own picks and
 * unticks by fingerprint; everything else comes fresh from the server.
 */
export function toReviewRows(rows: SplitwisePreviewRow[], previous: ReviewRow[] = []): ReviewRow[] {
  const before = new Map(previous.map(r => [r.fingerprint, r]));
  return rows
    .filter(r => !r.alreadyImported)
    .map(r => {
      const prior = before.get(r.fingerprint);
      // A pick that differs from what was suggested then is the user's own.
      const picked = prior && prior.chosen !== null && prior.chosen !== prior.category ? prior.chosen : null;
      return { ...r, include: prior?.include ?? true, chosen: picked ?? r.category ?? prior?.chosen ?? null };
    });
}
