/** The app's sign-in handlers in front of the real Auth Durable Object.
 *
 * Everything is production code except the edges a test can't reach: the
 * passkey cryptography (a fake that still round-trips the stored public key —
 * see below) and the email provider (codes are kept for the test to read). */
import { SyncJournal } from "durable-sync/server";
import { AuthDurableObject, createAuth, type AuthNamespace, type WebAuthn } from "durable-auth/server";
import { parseProfile } from "../../src/server/auth/parseProfile";
import { deleteUserData } from "../../src/server/auth/userData";
import { storeBackup } from "../../src/server/backupStore";

export class Auth extends AuthDurableObject {}
export { SyncJournal };

interface Env {
  AUTH: AuthNamespace;
  SYNC_JOURNAL: DurableObjectNamespace<SyncJournal>;
  BACKUPS: R2Bucket;
}

const sent: { to: string; code: string }[] = [];
let n = 0;

/** Registration stores whatever public key the "authenticator" claims; sign-in
 * verifies only if the key read back out of DO SQLite is byte-for-byte the
 * one it stored. That's the round trip — BLOB column, then RPC — that only
 * this suite exercises. */
const webauthn: WebAuthn = {
  generateRegistrationOptions: (async () => ({ challenge: `reg-${++n}` })) as never,
  generateAuthenticationOptions: (async () => ({ challenge: `auth-${++n}` })) as never,
  verifyRegistrationResponse: (async ({ response }: { response: { id: string; publicKey: number[] } }) => ({
    verified: true,
    registrationInfo: {
      credential: { id: response.id, publicKey: new Uint8Array(response.publicKey), counter: 0 },
    },
  })) as never,
  verifyAuthenticationResponse: (async ({
    response,
    credential,
  }: {
    response: { publicKey: number[] };
    credential: { publicKey: Uint8Array };
  }) => ({
    verified:
      credential.publicKey instanceof Uint8Array &&
      [...credential.publicKey].join() === response.publicKey.join(),
    authenticationInfo: { newCounter: 1 },
  })) as never,
};

const worker = {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/sent") return Response.json(sent.splice(0));
    // Give an account some data to delete, and report what it has.
    const user = url.searchParams.get("user");
    if (user && url.pathname === "/data") {
      const journal = env.SYNC_JOURNAL.get(env.SYNC_JOURNAL.idFromName(user));
      if (req.method === "POST") {
        await journal.push([{ opId: "w1", kind: "finishedWorkout", payload: {} }]);
        const backup = JSON.stringify({ format: "liftlog-backup", version: 1, userId: user, workouts: [{ id: "w1" }] });
        await storeBackup(env.BACKUPS as never, user, backup, new Date());
      }
      const { ops } = await journal.pull(0);
      // The deleted/ marker stays on purpose: it turns away an upload still
      // in flight when the account went.
      const objects = (await env.BACKUPS.list()).objects.filter(
        (o) => o.key.includes(user) && !o.key.startsWith("deleted/"),
      );
      return Response.json({ ops: ops.length, backups: objects.length });
    }
    // Rampset's own choices (profile validation, paths, cookie) on the real
    // library and the real Durable Object.
    const auth = createAuth({
      store: env.AUTH,
      rpName: "Rampset",
      basePath: "/api/auth",
      cookieName: "rampset_session",
      parseProfile,
      webauthn,
      sendCode: async (to, code) => void sent.push({ to, code }),
      codeSecret: "integration-code-secret-integration",
      onDeleteAccount: (userId) => deleteUserData(env as never, userId),
    });
    return (await auth.handle(req)) ?? new Response("Not found", { status: 404 });
  },
};

export default worker;
