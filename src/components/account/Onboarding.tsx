"use client";

/** First launch on a device: create an account, sign in with a passkey, or
 * recover by email. The app proper only appears once the device has an
 * account — `adopt` is the last step of every path. */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { newId } from "@/db/db";
import type { Account } from "@/db/account";
import {
  addPasskey,
  authConfig,
  authErrorMessage,
  AuthError,
  createAccount,
  passkeysSupported,
  signInWithPasskey,
  type AuthConfig,
} from "@/lib/auth";
import { getTemplate } from "@/lib/programTemplates";
import { useUser } from "@/state/UserContext";
import { Chevron } from "@/components/Chevron";
import { EmailCodeForm } from "./EmailCodeForm";
import { Turnstile } from "./Turnstile";
import { ERROR, FIELD, PRIMARY, SECONDARY } from "@/components/ui";

/** The three ways to train. StrongLifts' variants (Plus, Lite…) are a switch
 * away in Settings; three choices is enough to start. */
const STARTER_PROGRAMS = ["5x5", "madcow", "routine"] as const;

const FALLBACK_CONFIG: AuthConfig = { accounts: true, email: false, turnstileSiteKey: null };

type Step =
  | { kind: "welcome" }
  | { kind: "create" }
  | { kind: "recover" }
  | { kind: "add-email"; account: Account }
  | { kind: "add-passkey"; account: Account };

export function Onboarding() {
  const { adopt } = useUser();
  const [step, setStep] = useState<Step>({ kind: "welcome" });
  const [config, setConfig] = useState<AuthConfig>(FALLBACK_CONFIG);
  // Kept as a promise too: a decision taken after the passkey step must wait
  // for the real answer, not read the fallback (see onCreated).
  const [loaded] = useState(() => authConfig().catch(() => FALLBACK_CONFIG));

  useEffect(() => {
    void loaded.then(setConfig);
  }, [loaded]);

  switch (step.kind) {
    case "welcome":
      return (
        <Welcome
          accounts={config.accounts}
          canRecover={config.email}
          onCreate={() => setStep({ kind: "create" })}
          onRecover={() => setStep({ kind: "recover" })}
          onSignedIn={adopt}
        />
      );
    case "create":
      return (
        <Create
          local={!config.accounts}
          turnstileSiteKey={config.turnstileSiteKey}
          onBack={() => setStep({ kind: "welcome" })}
          onCreated={async (account) =>
            (await loaded).email ? setStep({ kind: "add-email", account }) : void adopt(account)
          }
        />
      );
    case "recover":
      return (
        <Screen title="Recover your account" onBack={() => setStep({ kind: "welcome" })}>
          <p className="mb-5 text-[15px] leading-snug text-ink-dim">
            Lost the phone with your passkey? Enter your recovery email and we&apos;ll send a code.
          </p>
          <EmailCodeForm
            purpose="recover"
            turnstileSiteKey={config.turnstileSiteKey}
            onDone={(account) => setStep({ kind: "add-passkey", account })}
          />
        </Screen>
      );
    case "add-email":
      return (
        <Screen title="Add a recovery email">
          <p className="mb-5 text-[15px] leading-snug text-ink-dim">
            Your passkey is your login. If you ever lose every device it&apos;s on, this email
            gets you back in. We only use it for that.
          </p>
          <EmailCodeForm purpose="add-email" onDone={(account) => void adopt(account)} />
          <button className="mt-1 min-h-[44px] py-3 text-[15px] text-ink-dim" onClick={() => void adopt(step.account)}>
            Not now
          </button>
        </Screen>
      );
    case "add-passkey":
      return <AddPasskey onDone={() => void adopt(step.account)} />;
  }
}

/** The page frame, padded for the notch and the home indicator like AppShell. */
function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col pb-[max(env(safe-area-inset-bottom),24px)] pl-[max(env(safe-area-inset-left),16px)] pr-[max(env(safe-area-inset-right),16px)] pt-[max(env(safe-area-inset-top),12px)]">
      {children}
    </div>
  );
}

function Screen({ title, onBack, children }: { title: string; onBack?: () => void; children: ReactNode }) {
  // Each step replaces the page: move focus to its title, so a screen reader
  // announces where the lifter has landed instead of falling to <body>.
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  return (
    <Frame>
      <div className="flex h-11 items-center">
        {onBack && (
          <button onClick={onBack} className="-ml-2 flex h-11 min-w-[44px] items-center gap-1 px-2 text-[17px] text-accent">
            <span className="rotate-180">
              <Chevron />
            </span>
            Back
          </button>
        )}
      </div>
      <h1 ref={heading} tabIndex={-1} className="large-title mb-3 mt-2 outline-none">
        {title}
      </h1>
      {children}
    </Frame>
  );
}

function Welcome({
  accounts,
  canRecover,
  onCreate,
  onRecover,
  onSignedIn,
}: {
  accounts: boolean;
  canRecover: boolean;
  onCreate: () => void;
  onRecover: () => void;
  onSignedIn: (account: Account) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState(false);
  const supported = passkeysSupported();

  const signIn = async () => {
    setBusy(true);
    setError(null);
    setHint(false);
    try {
      await onSignedIn(await signInWithPasskey());
    } catch (e) {
      const message = authErrorMessage(e, "Couldn't sign in — try again.");
      // Dismissed: most often there was no passkey to pick. Point the way.
      if (message === null) setHint(true);
      else setError(message);
      setBusy(false);
    }
  };

  return (
    <Frame>
      <div className="flex flex-1 flex-col justify-center">
        <h1 className="large-title">
          Rampset<span className="text-accent">.</span>
        </h1>
        <p className="mt-2 text-[17px] leading-snug text-ink-dim">
          The barbell log you own. Everything stays on this phone and works offline once
          you&apos;re set up — your account just keeps your devices in sync.
        </p>
      </div>

      {!accounts ? (
        <div className="flex flex-col gap-3">
          <p className="text-[15px] leading-snug text-ink-dim">
            Accounts aren&apos;t set up on this server, so Rampset will keep everything on this
            device, without sync.
          </p>
          <button className={PRIMARY} onClick={onCreate}>
            Start on this device
          </button>
        </div>
      ) : (
        <>
          {!supported && (
            <p role="alert" className={`mb-3 ${ERROR}`}>
              This browser doesn&apos;t support passkeys. Open Rampset in Safari or Chrome.
            </p>
          )}
          {error && (
            <p role="alert" className={`mb-3 ${ERROR}`}>
              {error}
            </p>
          )}
          {hint && (
            <p role="status" className="mb-3 text-[15px] leading-snug text-ink-dim">
              No passkey on this phone? Create an account{canRecover ? ", or recover by email" : ""}.
            </p>
          )}
          <div className="flex flex-col gap-1">
            <button className={PRIMARY} disabled={!supported || busy} onClick={onCreate}>
              Create account
            </button>
            <button className={SECONDARY} disabled={!supported || busy} onClick={() => void signIn()}>
              {busy ? "Signing in…" : "Sign in with passkey"}
            </button>
            {/* The slot is always there, so the buttons above don't jump when
                the server's answer about email arrives. */}
            <button
              className={`min-h-[44px] py-3 text-[15px] text-ink-dim ${canRecover ? "" : "invisible"}`}
              onClick={onRecover}
              tabIndex={canRecover ? undefined : -1}
              aria-hidden={canRecover ? undefined : true}
            >
              Lost your passkey? Recover by email
            </button>
          </div>
        </>
      )}
    </Frame>
  );
}

function Create({
  local,
  turnstileSiteKey,
  onBack,
  onCreated,
}: {
  /** No server accounts: make a device-only one, no passkey. */
  local: boolean;
  turnstileSiteKey: string | null;
  onBack: () => void;
  onCreated: (account: Account) => void;
}) {
  const [name, setName] = useState("");
  const [templateId, setTemplateId] = useState<(typeof STARTER_PROGRAMS)[number]>("5x5");
  const [token, setToken] = useState<string | null>(null);
  // A Turnstile token is single use: every attempt needs a fresh widget.
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const needsToken = Boolean(turnstileSiteKey) && !local;

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      // Free-form routines have always worn the light skin; the guided
      // programs the OLED black one.
      const theme: "light" | "dark" = templateId === "routine" ? "light" : "dark";
      const profile = { unit: "kg" as const, templateId, theme };
      onCreated(
        local
          ? { id: `local_${newId()}`, name: name.trim(), email: null, profile: { ...profile, accent: "blue" } }
          : await createAccount(name.trim(), profile, token ?? undefined),
      );
    } catch (e) {
      setError(authErrorMessage(e, "Couldn't create your account — try again."));
      setToken(null);
      setAttempt((n) => n + 1);
      setBusy(false);
    }
  };

  return (
    <Screen title={local ? "Get started" : "Create account"} onBack={onBack}>
      <form
        className="flex flex-col"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <label htmlFor="account-name" className="eyebrow mb-2 block px-4">
          Your name
        </label>
        <input
          id="account-name"
          className={`${FIELD} mb-5`}
          autoComplete="given-name"
          enterKeyHint="done"
          maxLength={40}
          placeholder="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          // Return closes the keyboard; it mustn't fire the passkey prompt
          // while the program is still being chosen.
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.currentTarget.blur();
            }
          }}
          data-selectable
        />

        <h2 id="program-label" className="eyebrow mb-2 px-4">
          How do you want to train?
        </h2>
        <div role="group" aria-labelledby="program-label" className="glass mb-2 overflow-hidden">
          {STARTER_PROGRAMS.map((id) => {
            const t = getTemplate(id)!;
            const selected = templateId === id;
            return (
              <button
                key={id}
                type="button"
                aria-pressed={selected}
                onClick={() => setTemplateId(id)}
                className="flex w-full items-center gap-3 border-b border-line px-4 py-3.5 text-left last:border-b-0"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-[17px]">{t.name}</span>
                  <span className="block text-[13px] leading-snug text-ink-faint">{t.blurb}</span>
                </span>
                {selected && (
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" className="flex-none text-accent" aria-hidden>
                    <path d="M5 12.5l4.5 4.5L19 7.5" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
        <p className="mb-6 px-4 text-[13px] leading-snug text-ink-faint">
          You can switch any time in Settings — your history comes with you.
        </p>

        {needsToken && <Turnstile key={attempt} siteKey={turnstileSiteKey!} onToken={setToken} />}
        {error && (
          <p role="alert" className={`mb-3 px-1 ${ERROR}`}>
            {error}
          </p>
        )}
        <button type="submit" className={`${PRIMARY} mt-2`} disabled={busy || !name.trim() || (needsToken && !token)}>
          {local ? "Start" : busy ? "Creating…" : "Create with passkey"}
        </button>
        {needsToken && !token && !busy && (
          <p className="mt-2 text-center text-[13px] text-ink-faint">Checking your connection…</p>
        )}
        {!local && (
          <p className="mt-3 px-4 text-center text-[13px] leading-snug text-ink-faint">
            Your phone saves a passkey for Rampset — Face ID or your fingerprint is your login. No
            password.
          </p>
        )}
      </form>
    </Screen>
  );
}

function AddPasskey({ onDone }: { onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      await addPasskey();
      onDone();
    } catch (e) {
      // A passkey this phone already has (a synced keychain) is the goal met.
      if (e instanceof AuthError && e.kind === "already-registered") return onDone();
      setError(authErrorMessage(e, "Couldn't add a passkey — try again."));
      setBusy(false);
    }
  };

  return (
    <Screen title="You're back in">
      <p className="mb-6 text-[15px] leading-snug text-ink-dim">
        Add a passkey to this device so next time it&apos;s just Face ID or your fingerprint.
      </p>
      {error && (
        <p role="alert" className={`mb-3 px-1 ${ERROR}`}>
          {error}
        </p>
      )}
      <button className={PRIMARY} disabled={busy} onClick={() => void add()}>
        {busy ? "Adding…" : "Add passkey"}
      </button>
      <button className={`${SECONDARY} mt-1`} disabled={busy} onClick={onDone}>
        Not now
      </button>
    </Screen>
  );
}
