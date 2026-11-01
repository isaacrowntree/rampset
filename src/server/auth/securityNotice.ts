/** Emails a lifter when how their account is signed in to changes — a passkey
 * added or removed, the recovery email changed, the account recovered. It may
 * not have been them, and this is often how they'd find out.
 *
 * Only an account with a recovery email can be told. A changed email is
 * reported to the address it replaced: that's the inbox of the person who
 * might not have made the change. Pure apart from what's passed in, so it's
 * tested without a Worker. */

import type { EmailBinding, SecurityEvent } from "durable-auth/server";

export interface NoticeDeps {
  email: EmailBinding;
  from: string;
  /** The account's recovery email, or null. */
  recoveryEmail(userId: string): Promise<string | null>;
}

const APP = "Rampset";
const IF_NOT_YOU =
  "If this wasn't you, sign in to Rampset and remove any passkey you don't recognise, or recover your account by email.";

function message(event: SecurityEvent): { subject: string; body: string } {
  switch (event.type) {
    case "passkey-added":
      return { subject: "A passkey was added to your Rampset account", body: "A new passkey can now sign in to your Rampset account." };
    case "passkey-removed":
      return {
        subject: "A passkey was removed from your Rampset account",
        body: "A passkey was removed from your Rampset account, and every other device was signed out.",
      };
    case "email-changed":
      return {
        subject: "Your Rampset recovery email changed",
        body: `Your Rampset account's recovery email is now ${event.email}. Codes to sign back in will go there from now on.`,
      };
    case "recovered":
      return {
        subject: "Your Rampset account was recovered",
        body: "Someone signed in to your Rampset account with a code sent to this address. Every device was signed out and every passkey removed.",
      };
  }
}

/** Where a notice for this event goes, if anywhere. */
async function recipient(deps: NoticeDeps, userId: string, event: SecurityEvent): Promise<string | null> {
  if (event.type === "recovered") return event.email;
  if (event.type === "email-changed") return event.previous;
  return deps.recoveryEmail(userId);
}

export function securityNotice(deps: NoticeDeps) {
  return async (userId: string, event: SecurityEvent): Promise<void> => {
    const to = await recipient(deps, userId, event);
    if (!to) return;
    const { subject, body } = message(event);
    const p = (s: string, style = "") =>
      `<p style="font:16px/1.5 -apple-system,system-ui,sans-serif${style}">${escape(s)}</p>`;
    await deps.email.send({
      to,
      from: { email: deps.from, name: APP },
      subject,
      text: `${body}\n\n${IF_NOT_YOU}`,
      html: p(body) + p(IF_NOT_YOU, ";color:#666"),
    });
  };
}

function escape(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}
