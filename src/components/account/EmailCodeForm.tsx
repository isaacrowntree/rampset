"use client";

/** Email, then the six-digit code we sent to it. One form for both jobs:
 * recovering an account (signed out) and adding a recovery email (signed in). */

import { useState } from "react";
import type { Account } from "@/db/account";
import {
  authErrorMessage,
  finishEmailVerification,
  finishRecovery,
  startEmailVerification,
  startRecovery,
} from "@/lib/auth";
import { Turnstile } from "./Turnstile";
import { ERROR, FIELD, PRIMARY, SECONDARY } from "./ui";

export function EmailCodeForm({
  purpose,
  turnstileSiteKey = null,
  onDone,
}: {
  purpose: "recover" | "add-email";
  /** Recovery is reachable signed out, so it gets the bot check. */
  turnstileSiteKey?: string | null;
  onDone: (account: Account) => void;
}) {
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [token, setToken] = useState<string | null>(null);
  // A Turnstile token is single use: every send needs a fresh widget.
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const needsToken = purpose === "recover" && Boolean(turnstileSiteKey);

  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await task();
    } catch (e) {
      setError(authErrorMessage(e, "Something went wrong — try again."));
    } finally {
      setBusy(false);
    }
  };

  const send = () =>
    run(async () => {
      try {
        if (purpose === "recover") await startRecovery(email, token ?? undefined);
        else await startEmailVerification(email);
      } finally {
        setToken(null);
        setAttempt((n) => n + 1);
      }
      setCode("");
      setStep("code");
    });

  const verify = () =>
    run(async () => {
      onDone(purpose === "recover" ? await finishRecovery(email, code) : await finishEmailVerification(email, code));
    });

  if (step === "email") {
    return (
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <input
          className={FIELD}
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="send"
          placeholder="Email"
          aria-label="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          data-selectable
        />
        {needsToken && <Turnstile key={attempt} siteKey={turnstileSiteKey!} onToken={setToken} />}
        {error && <p role="alert" className={`px-1 ${ERROR}`}>{error}</p>}
        <button type="submit" className={PRIMARY} disabled={busy || !email.trim() || (needsToken && !token)}>
          {busy ? "Sending…" : "Send code"}
        </button>
      </form>
    );
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void verify();
      }}
    >
      <p className="px-1 text-[15px] leading-snug text-ink-dim">
        {purpose === "recover"
          ? `If ${email} has an account, a code is on its way. It expires in 10 minutes.`
          : `We sent a code to ${email}. It expires in 10 minutes.`}
      </p>
      <input
        className={`${FIELD} mono text-center text-[24px] tracking-[0.3em]`}
        inputMode="numeric"
        autoComplete="one-time-code"
        enterKeyHint="done"
        autoFocus
        placeholder="000000"
        aria-label="6-digit code"
        value={code}
        // Filter, then cut: a pasted "123 456" must keep all six digits.
        onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
        data-selectable
      />
      {error && <p role="alert" className={`px-1 ${ERROR}`}>{error}</p>}
      <button type="submit" className={PRIMARY} disabled={busy || code.length !== 6}>
        {busy ? "Checking…" : "Continue"}
      </button>
      <button
        type="button"
        className={SECONDARY}
        disabled={busy}
        onClick={() => {
          setCode("");
          setError(null);
          setStep("email");
        }}
      >
        Resend, or use a different email
      </button>
    </form>
  );
}
