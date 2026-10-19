/** Sign-in endpoints: /api/auth/<action>. The logic is durable-auth, wired
 * in src/server/auth/deps.ts — this is only where Next meets it. */

import { rampsetAuth } from "@/server/auth/deps";

export const dynamic = "force-dynamic";

async function handle(req: Request) {
  const auth = rampsetAuth();
  if (!auth) return Response.json({ error: "Accounts not configured" }, { status: 503 });
  return (await auth.handle(req)) ?? Response.json({ error: "Not found" }, { status: 404 });
}

export { handle as GET, handle as POST, handle as PUT };
