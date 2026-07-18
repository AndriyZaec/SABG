import { z } from "zod";

export const WORLD_CUP_COMPETITION_ID = 72;

/** A fixture becomes current thirty minutes before its scheduled start. */
export const CURRENT_FIXTURE_LOOKAHEAD_MS = 30 * 60 * 1_000;

export const FixtureSnapshotSchema = z
  .object({
    FixtureId: z.number().int().positive(),
    StartTime: z.number().finite(),
    CompetitionId: z.number().int(),
    Participant1: z.string().trim().min(1),
    Participant2: z.string().trim().min(1),
    Participant1IsHome: z.boolean().optional(),
    GameState: z.union([z.number().int(), z.string()]).optional(),
    Competition: z.string().optional(),
  })
  .passthrough();

export const FixtureSnapshotResponseSchema = z.array(FixtureSnapshotSchema);

export type FixtureSnapshot = z.infer<typeof FixtureSnapshotSchema>;

export interface FixtureMetadata {
  fixtureId: number;
  homeTeam: string;
  awayTeam: string;
  startTime: number;
}

export interface FixtureDiscoveryClient {
  get(path: string): Promise<{ data: unknown }>;
}

export interface FixtureSelectionOptions {
  now: number;
  fixtureId?: number;
}

export interface DiscoverFixtureOptions {
  client?: FixtureDiscoveryClient;
  fixtureId?: number;
  now?: number;
}

const defaultFixtureDiscoveryClient: FixtureDiscoveryClient = {
  async get(path) {
    // Keep live environment validation out of pure consumers and injected-client tests.
    const { txoddsClient } = await import("./config/txodds-client.js");
    const response = await txoddsClient.get<unknown>(path);
    return { data: response.data };
  },
};

function toMetadata(fixture: FixtureSnapshot): FixtureMetadata {
  const participant1IsHome = fixture.Participant1IsHome !== false;
  return {
    fixtureId: fixture.FixtureId,
    homeTeam: participant1IsHome ? fixture.Participant1 : fixture.Participant2,
    awayTeam: participant1IsHome ? fixture.Participant2 : fixture.Participant1,
    startTime: fixture.StartTime,
  };
}

function sanitizeName(name: string): string {
  return name.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}

function describeFixtures(fixtures: readonly FixtureSnapshot[]): string {
  if (fixtures.length === 0) return "none";
  return fixtures
    .map(
      (fixture) =>
        `id=${fixture.FixtureId} ${JSON.stringify(sanitizeName(fixture.Participant1))} vs ${JSON.stringify(sanitizeName(fixture.Participant2))} at ${new Date(fixture.StartTime).toISOString()}`,
    )
    .join("; ");
}

/** Selects one World Cup fixture without performing I/O or consulting the system clock. */
export function selectWorldCupFixture(
  snapshot: readonly FixtureSnapshot[],
  options: FixtureSelectionOptions,
): FixtureMetadata {
  if (!Number.isFinite(options.now)) throw new Error("Fixture selection requires a finite current time");

  const worldCupFixtures = snapshot.filter((fixture) => fixture.CompetitionId === WORLD_CUP_COMPETITION_ID);

  if (options.fixtureId !== undefined) {
    if (!Number.isInteger(options.fixtureId) || options.fixtureId <= 0) {
      throw new Error("The explicit fixture override must be a positive integer");
    }
    const selected = worldCupFixtures.find((fixture) => fixture.FixtureId === options.fixtureId);
    if (!selected) {
      throw new Error(
        `Fixture override ${options.fixtureId} is not in the World Cup snapshot. Available World Cup fixtures: ${describeFixtures(worldCupFixtures)}`,
      );
    }
    return toMetadata(selected);
  }

  const latestStart = options.now + CURRENT_FIXTURE_LOOKAHEAD_MS;
  const candidates = worldCupFixtures.filter(
    // GameState semantics are not documented reliably: value 1 appears on both current and
    // months-away fixtures. Auto-select only an unambiguous pre-kickoff fixture; once kickoff has
    // passed, the operator must choose an ID from the sanitized snapshot list explicitly.
    (fixture) => fixture.StartTime >= options.now && fixture.StartTime <= latestStart,
  );

  if (candidates.length !== 1) {
    const detail =
      candidates.length === 0
        ? `Available World Cup fixtures: ${describeFixtures(worldCupFixtures)}`
        : `Current candidates: ${describeFixtures(candidates)}`;
    throw new Error(
      `Expected exactly one current World Cup fixture, found ${candidates.length}. ${detail}. Set an explicit fixture override.`,
    );
  }

  return toMetadata(candidates[0]!);
}

export async function fetchWorldCupSnapshot(
  client: FixtureDiscoveryClient = defaultFixtureDiscoveryClient,
): Promise<FixtureSnapshot[]> {
  const response = await client.get("/fixtures/snapshot");
  return FixtureSnapshotResponseSchema.parse(response.data).filter(
    (fixture) => fixture.CompetitionId === WORLD_CUP_COMPETITION_ID,
  );
}

export async function discoverWorldCupFixture(options: DiscoverFixtureOptions = {}): Promise<FixtureMetadata> {
  const snapshot = await fetchWorldCupSnapshot(options.client);
  const selectionOptions: FixtureSelectionOptions = { now: options.now ?? Date.now() };
  if (options.fixtureId !== undefined) selectionOptions.fixtureId = options.fixtureId;
  return selectWorldCupFixture(snapshot, selectionOptions);
}
