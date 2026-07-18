const ALLOWED_DEMO_FIXTURE_IDS = new Set([18179764, 18241006]);

export interface DemoResetRequest {
  fixtureId: number;
  database: string;
}

export function describeDatabase(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  const port = url.port || "5432";
  return `${url.hostname}:${port}${url.pathname}`;
}

export function parseDemoResetRequest(
  argv: string[],
  env: NodeJS.ProcessEnv,
): DemoResetRequest {
  if (env["DEPLOYMENT_ENV"] !== "demo") {
    throw new Error("Demo reset requires DEPLOYMENT_ENV=demo");
  }
  if (env["SOLANA_NETWORK"] !== "devnet") {
    throw new Error("Demo reset requires SOLANA_NETWORK=devnet");
  }

  const args = argv.slice(2);
  if (!args.includes("--force")) {
    throw new Error("Demo reset requires explicit --force confirmation");
  }
  const databaseUrl = env["DATABASE_URL"];
  if (!databaseUrl) throw new Error("DATABASE_URL is not set (see .env.example)");
  const database = describeDatabase(databaseUrl);
  const databaseConfirmation = args.find((arg) => arg.startsWith("--confirm-database="))?.slice(19);
  if (databaseConfirmation !== database) {
    throw new Error(`Demo reset requires --confirm-database=${database}`);
  }

  const positionals = args.filter(
    (arg) => arg !== "--force" && !arg.startsWith("--confirm-database="),
  );
  if (positionals.length > 1) {
    throw new Error("Usage: reset-demo [fixtureId] --force");
  }

  const fixtureId = Number(positionals[0] ?? env["GATEWAY_DEMO_FIXTURE_ID"] ?? 18179764);
  if (!Number.isInteger(fixtureId) || !ALLOWED_DEMO_FIXTURE_IDS.has(fixtureId)) {
    throw new Error(
      `Fixture ${String(fixtureId)} is not resettable; allowed fixtures: ${[...ALLOWED_DEMO_FIXTURE_IDS].join(", ")}`,
    );
  }

  return { fixtureId, database };
}
