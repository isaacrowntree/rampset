/** The Auth Durable Object: accounts, passkeys, sessions and recovery codes,
 * in one instance for the whole app (idFromName("auth")). It runs requests one
 * at a time, which is what makes AuthStore's check-then-write steps atomic.
 *
 * A single RPC method dispatches onto the store; stub.ts turns it back into
 * the store's typed interface for the routes. Exported from custom-worker.ts
 * (and from the integration suite's worker). */

import { DurableObject } from "cloudflare:workers";
import { AuthStore } from "./store";

export class Auth extends DurableObject {
  private store = new AuthStore(this.ctx.storage.sql);

  run(method: string, args: unknown[]): unknown {
    const fn = (AuthStore.prototype as unknown as Record<string, unknown>)[method];
    if (method === "constructor" || typeof fn !== "function") {
      throw new Error(`Unknown auth method: ${method}`);
    }
    return (fn as (...a: unknown[]) => unknown).apply(this.store, args);
  }
}
