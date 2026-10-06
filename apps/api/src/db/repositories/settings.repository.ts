import { eq } from "drizzle-orm";
import { db } from "../client.js";
import { settings } from "../schema.js";

/** The `settings` row that switches the CS2 autopilot on and off (seeded by migration 0016). */
export const CS2_AUTOPILOT_SETTING = "cs2_autopilot";
export const CS2_ACTIVE_TOURNAMENT_SETTING = "cs2_active_tournament";

export const settingsRepository = {
  /** A missing row reads as enabled: the migration seeds every switch, so absence is a setup gap, not an "off". */
  async isEnabled(name: string): Promise<boolean> {
    const [row] = await db.select({ enabled: settings.enabled }).from(settings).where(eq(settings.name, name));
    return row?.enabled ?? true;
  },

  async getActiveCs2TournamentId(): Promise<string | undefined> {
    const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.name, CS2_ACTIVE_TOURNAMENT_SETTING));
    return row?.value ?? undefined;
  },

  async setActiveCs2TournamentId(gridTournamentId: string): Promise<void> {
    await db.insert(settings)
      .values({ name: CS2_ACTIVE_TOURNAMENT_SETTING, value: gridTournamentId })
      .onConflictDoUpdate({
        target: settings.name,
        set: { value: gridTournamentId, updatedAt: new Date() },
      });
  },

  async bootstrapActiveCs2TournamentId(envTournamentIds: readonly string[]): Promise<string | undefined> {
    const existing = await this.getActiveCs2TournamentId();
    if (existing !== undefined) return existing;
    if (envTournamentIds.length === 0) return undefined;
    if (envTournamentIds.length > 1) {
      throw new Error("Only one active CS2 tournament is supported");
    }
    const gridTournamentId = envTournamentIds[0]!;
    await db.insert(settings)
      .values({ name: CS2_ACTIVE_TOURNAMENT_SETTING, value: gridTournamentId })
      .onConflictDoNothing({ target: settings.name });
    return await this.getActiveCs2TournamentId();
  },
};
