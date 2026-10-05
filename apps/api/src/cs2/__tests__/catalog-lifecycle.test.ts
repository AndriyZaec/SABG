import { describe, expect, it } from "vitest";
import { catalogLifecycleOnRead } from "../catalog-lifecycle.js";

const NOW = "2026-10-05T15:00:00.000Z";

describe("catalogLifecycleOnRead", () => {
  it("keeps an upcoming series upcoming until its start", () => {
    expect(catalogLifecycleOnRead("upcoming", "2026-10-05T16:30:00.000Z", NOW, false)).toBe("upcoming");
  });

  it("stops showing a series as upcoming once its start passed without a sync", () => {
    expect(catalogLifecycleOnRead("upcoming", "2026-10-04T09:00:00.000Z", NOW, false)).toBe("unknown");
    expect(catalogLifecycleOnRead("upcoming", NOW, NOW, false)).toBe("unknown");
  });

  it("shows the runner's series as live before its first arena opens", () => {
    expect(catalogLifecycleOnRead("unknown", "2026-10-05T14:20:00.000Z", NOW, true)).toBe("live");
    expect(catalogLifecycleOnRead("upcoming", "2026-10-05T14:20:00.000Z", NOW, true)).toBe("live");
  });

  it("keeps a completed series completed even while its runner winds down", () => {
    expect(catalogLifecycleOnRead("completed", "2026-10-05T14:20:00.000Z", NOW, true)).toBe("completed");
  });

  it("leaves a stored live or unknown series as it is", () => {
    expect(catalogLifecycleOnRead("live", "2026-10-05T14:20:00.000Z", NOW, false)).toBe("live");
    expect(catalogLifecycleOnRead("unknown", "2026-10-05T14:20:00.000Z", NOW, false)).toBe("unknown");
  });
});
