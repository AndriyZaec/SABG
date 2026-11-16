import { describe, expect, it } from "vitest";
import { pageOf } from "./paging.js";

const rows = Array.from({ length: 60 }, (_, index) => index + 1);

describe("pageOf", () => {
  it("shows the first page", () => {
    expect(pageOf(rows, 0, 25)).toEqual({ rows: rows.slice(0, 25), page: 0, pageCount: 3, first: 1, last: 25, total: 60 });
  });

  it("shows a partial last page", () => {
    expect(pageOf(rows, 2, 25)).toMatchObject({ rows: rows.slice(50), page: 2, first: 51, last: 60 });
  });

  it("clamps a page past the end to the last one, and a negative page to the first", () => {
    expect(pageOf(rows, 7, 25)).toMatchObject({ page: 2, first: 51, last: 60 });
    expect(pageOf(rows, -1, 25)).toMatchObject({ page: 0, first: 1 });
  });

  it("keeps one empty page for no rows", () => {
    expect(pageOf([], 3, 25)).toEqual({ rows: [], page: 0, pageCount: 1, first: 0, last: 0, total: 0 });
  });
});
