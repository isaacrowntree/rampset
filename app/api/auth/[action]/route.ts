/** Sign-in endpoints: /api/auth/<action>. The logic is src/server/auth —
 * this is only where Cloudflare's bindings meet it. */

import { handleAuth } from "@/server/auth/handlers";
import { authDeps } from "@/server/auth/deps";

export const dynamic = "force-dynamic";

async function handle(req: Request, { params }: { params: Promise<{ action: string }> }) {
  const deps = authDeps();
  if (!deps) return Response.json({ error: "Accounts not configured" }, { status: 503 });
  return handleAuth((await params).action, req, deps);
}

export { handle as GET, handle as POST, handle as PUT };
