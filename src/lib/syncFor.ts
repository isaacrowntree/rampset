"use client";

/** One sync engine per user, memoized.
 *
 * durable-sync is single-tenant by construction: the in-flight guard and the
 * throttle live in the instance's closure. That's correct for it and wrong for
 * us — the avatar switcher means one device serves two users — so the mapping
 * from user to instance is our business.
 *
 * Memoizing is the whole point. A fresh instance per render or per remount
 * resets `lastRunAt`, defeating the throttle that exists because ONE
 * foregrounding fires visibilitychange + focus + pageshow together. Keyed by
 * userId so nothing leaks across avatars: cursor, epoch and status are already
 * per-user, and this keeps the engine that owns them per-user too. */

import { createSync, localStorageCursor, type Sync, type OutboxStore } from "durable-sync/client";
import { db } from "@/db/db";
import { applyOp, type SyncOp } from "@/db/sync";
import { getActiveWorkout } from "@/db/activeWorkout";
import { mayWriteAs } from "@/lib/identityGate";
import type { User } from "@/lib/types";

/** The outbox is scoped to the user: it holds the ONLY copy of an unsynced
 * workout, and an unscoped one would push the other avatar's rows under this
 * user's identity. */
function dexieOutbox(userId: string): OutboxStore {
  return {
    add: async (op) => void (await db.outbox.add({ userId, ...op })),
    list: async () =>
      (await db.outbox.where({ userId }).toArray()).map((r) => ({
        id: r.id,
        opId: r.opId,
        kind: r.kind,
        payload: r.payload,
      })),
    remove: async (ids) => void (await db.outbox.bulkDelete(ids as number[])),
    has: async (opId) => (await db.outbox.where({ opId }).count()) > 0,
  };
}

const instances = new Map<string, Sync>();

export function syncFor(user: User): Sync {
  let sync = instances.get(user.id);
  if (sync) return sync;

  sync = createSync({
    endpoint: "/api/sync",
    outbox: dexieOutbox(user.id),
    cursor: localStorageCursor(`liftlog.syncCursor.${user.id}`),
    stateKey: `liftlog.syncState.${user.id}`,

    apply: (op) => applyOp(user.id, op as SyncOp),

    // Pushing is always safe. PULLING mid-workout is not: applyOp rewrites
    // programExercises.workingWeightKg, and finishWorkout reads it back to
    // decide deloads — an op landing mid-session can silently drop a 5×5 to
    // 3×5. The other device isn't mid-workout, so waiting costs nothing.
    canPull: async () => !(await getActiveWorkout(user.id)),

    // The journal is addressed by the server-side Access identity while these
    // ops carry the selected avatar. Writing as the wrong one files data under
    // someone else, permanently, in an append-only log.
    canWrite: () => mayWriteAs(user.email),

    // Behind Access the identity header is injected at the edge; local dev
    // supplies one so the route works.
    headers: (): Record<string, string> =>
      process.env.NODE_ENV === "development" ? { "x-liftlog-dev-user": user.email } : {},
  });

  instances.set(user.id, sync);
  return sync;
}

/** Tests only — the registry is deliberately shared otherwise. */
export function resetSyncRegistry(): void {
  instances.clear();
}
