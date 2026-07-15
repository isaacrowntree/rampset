import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import "fake-indexeddb/auto";
import { db } from "./db";
import { seedIfEmpty } from "./seed";
import { startWorkout, logSet, finishWorkout } from "./session";
import {
  buildFinishedWorkoutOp,
  enqueueFinishedWorkout,
  flushOutbox,
  pullAndApply,
  applyOp,
  syncCursorKey,
} from "./sync";

const USER1 = "user-1";

beforeEach(async () => {
  await db.delete();
  await db.open();
  await seedIfEmpty();
  localStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

async function finishRealWorkout(): Promise<string> {
  const day = await db.programDays.get("day-5x5-b-user-1");
  const s = await startWorkout(USER1, day!.id);
  const squat = s.exercises.find((e) => e.exercise.name === "Squat")!;
  for (let i = 0; i < 5; i++) {
    await logSet(s.workout.id, USER1, squat.exercise.id, i, { weightKg: 27.5, reps: 5 });
  }
  await finishWorkout(s.workout.id);
  return s.workout.id;
}

describe("buildFinishedWorkoutOp", () => {
  it("bundles the workout, its sets, and current working weights", async () => {
    const workoutId = await finishRealWorkout();
    const op = await buildFinishedWorkoutOp(workoutId);
    expect(op?.opId).toBe(workoutId);
    expect(op?.kind).toBe("finishedWorkout");
    const p = op!.payload;
    expect(p.workout.id).toBe(workoutId);
    expect(p.sets).toHaveLength(5);
    expect(p.weights.length).toBeGreaterThan(0);
  });

  it("returns null for unfinished or missing workouts", async () => {
    const day = await db.programDays.get("day-5x5-a-user-1");
    const s = await startWorkout(USER1, day!.id);
    expect(await buildFinishedWorkoutOp(s.workout.id)).toBeNull();
    expect(await buildFinishedWorkoutOp("nope")).toBeNull();
  });
});

describe("outbox flush", () => {
  it("sends queued ops and drains the outbox on success", async () => {
    const workoutId = await finishRealWorkout();
    await enqueueFinishedWorkout(USER1, workoutId);
    expect(await db.outbox.count()).toBe(1);

    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ seq: 1, accepted: 1 }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await flushOutbox(USER1, "lifter-one@example.com");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(await db.outbox.count()).toBe(0);
  });

  it("keeps ops queued when offline", async () => {
    const workoutId = await finishRealWorkout();
    await enqueueFinishedWorkout(USER1, workoutId);
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("network down");
    }));
    await flushOutbox(USER1, "lifter-one@example.com");
    expect(await db.outbox.count()).toBe(1);
  });

  // An expired Cloudflare Access session redirects to a same-origin login
  // page, which fetch follows and reports as a 200 — so `res.ok` is true
  // while the journal never saw the ops. Draining here destroys the only
  // copy of an unsynced workout.
  it("keeps ops queued when Access answers with its 200 login page", async () => {
    const workoutId = await finishRealWorkout();
    await enqueueFinishedWorkout(USER1, workoutId);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response("<!DOCTYPE html><title>Sign in</title>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
      ),
    );

    await flushOutbox(USER1, "lifter-one@example.com");
    expect(await db.outbox.count()).toBe(1);
  });
});

describe("pull and apply", () => {
  it("applies a finished-workout op from another device", async () => {
    // Device A produces the op
    const workoutId = await finishRealWorkout();
    const op = await buildFinishedWorkoutOp(workoutId);

    // Device B: fresh db
    await db.delete();
    await db.open();
    await seedIfEmpty();

    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ ops: [{ ...op, seq: 1 }], seq: 1 }), { status: 200 }),
    ));
    const { applied } = await pullAndApply(USER1, "lifter-one@example.com");
    expect(applied).toBe(1);
    expect(await db.workouts.get(workoutId)).toBeDefined();
    expect(await db.sets.where({ workoutId }).count()).toBe(5);
    // progression state came along (squat B advanced to 30)
    const pes = await db.programExercises
      .where({ programDayId: "day-5x5-b-user-1" })
      .sortBy("position");
    expect(pes[0].workingWeightKg).toBe(30);
    // cursor advanced
    expect(localStorage.getItem(syncCursorKey(USER1))).toBe("1");
  });

  // One malformed op must not take the whole journal down with it. The apply
  // loop and the cursor write share a try/catch, so a single throwing op
  // leaves the cursor unmoved — every later sync refetches from the same
  // place, hits the same op, and throws again. Sync is wedged forever, and
  // silently, because pullAndApply reports 0 either way.
  it("steps over a malformed op instead of wedging the cursor", async () => {
    const workoutId = await finishRealWorkout();
    const op = await buildFinishedWorkoutOp(workoutId);

    await db.delete();
    await db.open();
    await seedIfEmpty();

    const poison = {
      opId: "corrupt",
      kind: "finishedWorkout",
      payload: { workout: { id: "bad", userId: USER1 }, sets: null, weights: [], exercises: [] },
    };
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(
        JSON.stringify({ ops: [{ ...poison, seq: 1 }, { ...op, seq: 2 }], seq: 2 }),
        { status: 200 },
      ),
    ));

    const { applied } = await pullAndApply(USER1, "lifter-one@example.com");

    // The healthy op behind the poison one still landed...
    expect(applied).toBe(1);
    expect(await db.workouts.get(workoutId)).toBeDefined();
    // ...and the cursor moved on, so the next sync makes progress.
    expect(localStorage.getItem(syncCursorKey(USER1))).toBe("2");
  });

  it("re-applying the same op is a no-op", async () => {
    const workoutId = await finishRealWorkout();
    const op = await buildFinishedWorkoutOp(workoutId);
    const before = await db.sets.count();
    await applyOp(USER1, op!);
    expect(await db.sets.count()).toBe(before);
  });

  it("pulls only ops after the stored cursor", async () => {
    localStorage.setItem(syncCursorKey(USER1), "7");
    const fetchMock = vi.fn(async (_input: string | URL | Request) =>
      new Response(JSON.stringify({ ops: [], seq: 7 }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await pullAndApply(USER1, "lifter-one@example.com");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("since=7");
  });
});
