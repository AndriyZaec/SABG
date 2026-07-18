import { GuestJwtService } from "./auth/guest-jwt.service.js";
import { TxLineService } from "./auth/txline.service.js";
import { discoverWorldCupFixture } from "./fixture-discovery.js";
import { ensureIndexes } from "./mongo/ensure-indexes.js";
import { MongoService } from "./mongo/mongo.service.js";

async function main(): Promise<void> {
  try {
    await MongoService.getDb();
    await ensureIndexes();
    await GuestJwtService.getInstance().getJwt();
    await TxLineService.getInstance().getApiToken();

    const fixtureIdValue = process.env["TXODDS_LIVE_FIXTURE_ID"];
    const fixtureId = fixtureIdValue ? Number(fixtureIdValue) : undefined;
    const fixture = await discoverWorldCupFixture({
      ...(fixtureId !== undefined ? { fixtureId } : {}),
    });
    const payload = Buffer.from(
      JSON.stringify({
        fixtureId: fixture.fixtureId,
        homeTeam: fixture.homeTeam,
        awayTeam: fixture.awayTeam,
        startTime: new Date(fixture.startTime).toISOString(),
      }),
      "utf8",
    ).toString("base64url");
    process.stdout.write(`SABG_LIVE_FIXTURE=${payload}\n`);
  } finally {
    await MongoService.quit();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown live preflight error";
  const safeMessage = message.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 500);
  process.stderr.write(`Live preflight failed: ${safeMessage}\n`);
  process.exitCode = 1;
});
