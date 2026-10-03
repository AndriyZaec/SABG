import { eq } from "drizzle-orm";
import { db } from "../client.js";
import { settings } from "../schema.js";

export const settingsRepository = {
  /** A missing row reads as enabled: the migration seeds every switch, so absence is a setup gap, not an "off". */
  async isEnabled(name: string): Promise<boolean> {
    const [row] = await db.select({ enabled: settings.enabled }).from(settings).where(eq(settings.name, name));
    return row?.enabled ?? true;
  },
};
