const ALLOWED_REPLAY_FIXTURE_IDS = new Set([18179764, 18241006]);

export interface ReplayResetRequest {
  fixtureId: number;
  database: string;
}

export function describeDatabase(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  const port = url.port || "5432";
  return `${url.hostname}:${port}${url.pathname}`;
}

export function parseReplayResetRequest(
  argv: string[],
  env: NodeJS.ProcessEnv,
): ReplayResetRequest {
  if (env["GAME_SOURCE"] !== "replay") {
    throw new Error("Replay reset requires GAME_SOURCE=replay");
  }
  if (env["SOLANA_NETWORK"] !== "devnet") {
    throw new Error("Replay reset requires SOLANA_NETWORK=devnet");
  }

  const args = argv.slice(2);
  if (!args.includes("--force")) {
    throw new Error("Replay reset requires explicit --force confirmation");
  }
  const databaseUrl = env["DATABASE_URL"];
  if (!databaseUrl) throw new Error("DATABASE_URL is not set (see .env.example)");
  const database = describeDatabase(databaseUrl);
  const databaseConfirmation = args.find((arg) => arg.startsWith("--confirm-database="))?.slice(19);
  if (databaseConfirmation !== database) {
    throw new Error(`Replay reset requires --confirm-database=${database}`);
  }

  const positionals = args.filter(
    (arg) => arg !== "--force" && !arg.startsWith("--confirm-database="),
  );
  if (positionals.length > 1) {
    throw new Error("Usage: reset-replay [fixtureId] --force");
  }

  const fixtureId = Number(positionals[0] ?? env["GATEWAY_REPLAY_FIXTURE_ID"] ?? 18241006);
  if (!Number.isInteger(fixtureId) || !ALLOWED_REPLAY_FIXTURE_IDS.has(fixtureId)) {
    throw new Error(
      `Fixture ${String(fixtureId)} is not resettable; allowed fixtures: ${[...ALLOWED_REPLAY_FIXTURE_IDS].join(", ")}`,
    );
  }

  return { fixtureId, database };
}
