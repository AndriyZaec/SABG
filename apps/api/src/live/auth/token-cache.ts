// File-backed cache for the TxLine API token and guest JWT (per the no-Redis decision for
// this port). Persists to a gitignored JSON file next to apps/api so repeated `pnpm live:dev`
// restarts during dev/testing reuse a still-valid TxLine subscription instead of re-running
// the on-chain `subscribe()` call (and spending TXL tokens) every time. Not Redis-grade (no
// TTL sweeping, single-process only) but enough to survive a restart.

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

interface Entry {
  value: string;
  expiresAt: number;
}

const defaultCacheFile = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  ".txline-cache.json",
);
const CACHE_FILE = path.resolve(process.env["TXLINE_CACHE_FILE"] ?? defaultCacheFile);

function readStore(): Record<string, Entry> {
  if (!existsSync(CACHE_FILE)) return {};
  try {
    return JSON.parse(readFileSync(CACHE_FILE, "utf8")) as Record<string, Entry>;
  } catch {
    return {};
  }
}

function writeStore(store: Record<string, Entry>): void {
  mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
  const temporaryFile = `${CACHE_FILE}.${process.pid}.tmp`;
  try {
    writeFileSync(temporaryFile, JSON.stringify(store, null, 2), { mode: 0o600 });
    renameSync(temporaryFile, CACHE_FILE);
  } finally {
    rmSync(temporaryFile, { force: true });
  }
}

export function getCached(key: string): string | undefined {
  const store = readStore();
  const entry = store[key];
  if (!entry) return undefined;
  if (Date.now() >= entry.expiresAt) {
    delete store[key];
    writeStore(store);
    return undefined;
  }
  return entry.value;
}

export function setCached(key: string, value: string, ttlSeconds: number): void {
  const store = readStore();
  store[key] = { value, expiresAt: Date.now() + ttlSeconds * 1000 };
  writeStore(store);
}
