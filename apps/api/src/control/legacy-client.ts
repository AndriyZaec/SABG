import type { AdminMutationCommand, AdminMutationResult } from "@arena/contracts";

export function buildLegacyMutationCommand(type: string, target = "", value = ""): AdminMutationCommand {
  switch (type) {
    case "autopilot.set":
      if (value !== "true" && value !== "false") throw new Error("Autopilot value must be true or false");
      return { type, enabled: value === "true" };
    case "series.priority.set":
      if (value !== "true" && value !== "false") throw new Error("Priority value must be true or false");
      return { type, gridSeriesId: target, priority: value === "true" };
    case "series.stream.set":
      return { type, gridSeriesId: target, streamUrl: value === "" ? null : value };
    case "series.skip.request":
      return { type, gridSeriesId: target };
    case "tournament.publish":
      return { type, gridTournamentId: target, gridSeriesId: value };
    default:
      throw new Error("Unknown legacy control command");
  }
}

async function main(): Promise<void> {
  const token = process.env["CS2_CONTROL_MACHINE_TOKEN"];
  if (token === undefined) throw new Error("CS2 control machine token is not configured");
  const host = process.env["CS2_CONTROL_HOST"] ?? "127.0.0.1";
  const port = process.env["CS2_CONTROL_PORT"] ?? "4101";
  const command = buildLegacyMutationCommand(process.argv[2] ?? "", process.argv[3], process.argv[4]);
  const response = await fetch(`http://${host}:${port}/mutations`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "x-operator-id": "legacy-wizard",
      "x-operator-login": "legacy-wizard",
    },
    body: JSON.stringify(command),
  });
  const result = await response.json() as AdminMutationResult | { message?: string };
  if ("status" in result && result.status === "refused") throw new Error(result.reason);
  if (!response.ok) {
    throw new Error("message" in result && result.message !== undefined ? result.message : `Control API returned ${response.status}`);
  }
  if (!("status" in result)) throw new Error("Control API returned an invalid response");
  process.stdout.write(`${result.status}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Legacy control request failed";
    process.stderr.write(`Event control failed: ${message.replace(/[\u0000-\u001f\u007f]/gu, " ").slice(0, 500)}\n`);
    process.exitCode = 1;
  });
}
