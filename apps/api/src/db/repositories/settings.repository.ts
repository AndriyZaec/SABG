import { eq } from "drizzle-orm";
import { db } from "../client.js";
import { settings } from "../schema.js";

/** The `settings` row that switches the CS2 autopilot on and off (seeded by migration 0016). */
export const CS2_AUTOPILOT_SETTING = "cs2_autopilot";

export const settingsRepository = {
  /** A missing row reads as enabled: the migration seeds every switch, so absence is a setup gap, not an "off". */
  async isEnabled(name: string): Promise<boolean> {
    const [row] = await db.select({ enabled: settings.enabled }).from(settings).where(eq(settings.name, name));
    return row?.enabled ?? true;
  },
};
