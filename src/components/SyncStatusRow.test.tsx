import { describe, it, expect } from "vitest";
import { summarise } from "./SyncStatusRow";

const NOW = 1_700_000_000_000;
const mins = (n: number) => NOW - n * 60_000;

describe("summarise (sync status)", () => {
  it("reports a healthy sync with nothing queued", () => {
    const s = summarise({ lastOkAt: mins(2) }, 0, NOW);
    expect(s.tone).toBe("ok");
    expect(s.label).toBe("Synced 2 minutes ago");
  });

  it("counts workouts still waiting to upload", () => {
    const s = summarise({ lastOkAt: mins(1) }, 2, NOW);
    expect(s.detail).toContain("2 workouts waiting to upload");
  });

  // The failure this exists for: a week of silently failed syncs used to look
  // exactly like success. It must never read as "Synced" while broken.
  it("says it is NOT syncing when the last attempt failed", () => {
    const s = summarise({ lastOkAt: mins(60 * 24 * 7), lastError: "Couldn't reach the sync journal" }, 3, NOW);
    expect(s.tone).toBe("warn");
    expect(s.label).toBe("Not syncing");
    // ...while still being honest that it DID work a week ago.
    expect(s.detail).toContain("7 days ago");
    expect(s.detail).toContain("3 workouts waiting to upload");
  });

  it("distinguishes never-synced from broken", () => {
    const s = summarise({}, 0, NOW);
    expect(s.tone).toBe("idle");
    expect(s.label).toBe("Not synced yet");
  });

  it("handles a failure on a device that never synced", () => {
    const s = summarise({ lastError: "Couldn't reach the sync journal" }, 1, NOW);
    expect(s.tone).toBe("warn");
    expect(s.detail).not.toContain("Last synced");
  });
});
