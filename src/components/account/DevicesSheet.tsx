"use client";

/** The account's passkeys and signed-in devices: remove a passkey that's on a
 * lost phone, and sign every other device out. Without these, a phone stolen
 * while signed in stayed signed in. */

import { useEffect, useState } from "react";
import { Sheet } from "@/components/Sheet";
import { ConfirmSheet } from "@/components/ConfirmSheet";
import {
  authErrorMessage,
  listPasskeys,
  removePasskey,
  signOutOtherDevices,
  type PasskeySummary,
} from "@/lib/auth";

const day = (ms: number) => new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

export function DevicesSheet({ onClose }: { onClose: () => void }) {
  const [keys, setKeys] = useState<PasskeySummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<{ kind: "others" } | { kind: "remove"; id: string } | null>(null);

  const load = () =>
    listPasskeys().then(setKeys, (e) => setError(authErrorMessage(e, "Couldn't load your passkeys.") ?? null));
  useEffect(() => {
    void load();
  }, []);

  const run = async (work: () => Promise<unknown>, done: string, fallback: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await work();
      setNotice(done);
      await load();
    } catch (e) {
      const message = authErrorMessage(e, fallback);
      if (message) setError(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet label="Passkeys and devices" onClose={onClose}>
      <h2 className="disp mb-1 text-[19px]">Passkeys and devices</h2>
      <p className="mb-4 text-[15px] leading-snug text-ink-dim">
        Lost a phone? Remove its passkey, then sign other devices out.
      </p>

      <ul aria-label="Passkeys" className="glass">
        {keys === null && !error && <li className="px-4 py-3.5 text-[13.5px] text-ink-faint">Loading…</li>}
        {keys?.map((k, i) => (
          <li
            key={k.id}
            className={`flex items-center justify-between gap-3 px-4 py-3 ${i < keys.length - 1 ? "border-b border-line" : ""}`}
          >
            <span className="min-w-0">
              <span className="block text-[15px] font-medium">
                {k.backedUp ? "Synced passkey" : "Passkey on one device"}
              </span>
              <span className="block text-[12.5px] text-ink-faint">
                Added {day(k.createdAt)}
                {k.lastUsedAt ? ` · last used ${day(k.lastUsedAt)}` : ""}
              </span>
            </span>
            <button
              onClick={() => setConfirm({ kind: "remove", id: k.id })}
              disabled={busy || keys.length < 2}
              title={keys.length < 2 ? "Your only passkey can't be removed" : undefined}
              className="min-h-[44px] shrink-0 px-2 text-[15px] font-medium text-danger disabled:opacity-40"
            >
              Remove
            </button>
          </li>
        ))}
      </ul>

      <button
        onClick={() => setConfirm({ kind: "others" })}
        disabled={busy}
        className="mt-3 glass flex min-h-[44px] w-full items-center px-4 py-3.5 text-left text-[15px] font-medium text-danger disabled:opacity-60"
      >
        Sign out other devices
      </button>

      <div role="status" aria-live="polite" className="mt-3 text-[13.5px] text-ink-dim">
        {notice}
      </div>
      {error && (
        <div role="alert" className="mt-2 text-[13.5px] text-danger">
          {error}
        </div>
      )}

      {confirm?.kind === "others" && (
        <ConfirmSheet
          title="Sign out other devices?"
          body="Every other phone or browser on this account is signed out. This one stays signed in."
          confirmLabel="Sign out others"
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            setConfirm(null);
            void run(signOutOtherDevices, "Every other device is signed out.", "Couldn't sign other devices out.");
          }}
        />
      )}
      {confirm?.kind === "remove" && (
        <ConfirmSheet
          title="Remove this passkey?"
          body="It won't sign in to Rampset again. Devices already signed in stay signed in until you sign them out."
          confirmLabel="Remove passkey"
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            const { id } = confirm;
            setConfirm(null);
            void run(() => removePasskey(id), "Passkey removed.", "Couldn't remove the passkey.");
          }}
        />
      )}
    </Sheet>
  );
}
