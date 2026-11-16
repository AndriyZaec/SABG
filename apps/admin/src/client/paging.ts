export interface Page<T> {
  rows: T[];
  /** Zero-based, clamped to the pages that exist. */
  page: number;
  pageCount: number;
  /** One-based positions of the shown rows; 0 and 0 for no rows. */
  first: number;
  last: number;
  total: number;
}

/** One page of rows; a page past the end shows the last one, so a shorter refresh never shows nothing. */
export function pageOf<T>(rows: readonly T[], page: number, size: number): Page<T> {
  const pageCount = Math.max(1, Math.ceil(rows.length / size));
  const current = Math.min(Math.max(page, 0), pageCount - 1);
  const start = current * size;
  const shown = rows.slice(start, start + size);
  return { rows: shown, page: current, pageCount, first: shown.length === 0 ? 0 : start + 1, last: start + shown.length, total: rows.length };
}
