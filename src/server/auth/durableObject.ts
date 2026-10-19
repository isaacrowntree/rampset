/** The Auth Durable Object: accounts, passkeys, sessions and recovery codes,
 * in one instance for the whole app (idFromName("auth")). It runs requests one
 * at a time, which is what makes AuthStore's check-then-write steps atomic.
 *
 * A single RPC method dispatches onto the store; stub.ts turns it back into
 * the store's typed interface for the routes. Exported from custom-worker.ts
 * (and from the integration suite's worker). */

import { DurableObject } from "cloudflare:workers";
import { AuthStore } from "./store";

/** The store's public methods, by name — nothing inherited, nothing private. */
const METHODS = new Set(
  Object.getOwnPropertyNames(AuthStore.prototype).filter(
    (name) => name !== "constructor" && name !== "rows",
  ),
);

export class Auth extends DurableObject {
  private store = new AuthStore(this.ctx.storage.sql);

  run(method: string, args: unknown[]): unknown {
    if (!METHODS.has(method)) throw new Error(`Unknown auth method: ${method}`);
    const fn = (this.store as unknown as Record<string, (...a: unknown[]) => unknown>)[method];
    return fn.apply(this.store, args);
  }
}
