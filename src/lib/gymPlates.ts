"use client";

/** Which plates this gym has — a per-device preference (the device is in
 * the gym, the lifter isn't the variable). Only 25s are optional: everything
 * from 20 down is in every gym. */

import { useSyncExternalStore } from "react";
import { DEFAULT_PLATES, PLATES_WITHOUT_25 } from "./plates";

const KEY = "liftlog.plates25";
const listeners = new Set<() => void>();

function read(): boolean {
  try {
    return localStorage.getItem(KEY) !== "0";
  } catch {
    return true;
  }
}

export function setGymHas25s(has: boolean): void {
  try {
    localStorage.setItem(KEY, has ? "1" : "0");
  } catch {
    // storage blocked — the toggle just won't stick
  }
  for (const l of listeners) l();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useGymHas25s(): boolean {
  return useSyncExternalStore(subscribe, read, () => true);
}

/** The plate list to do plate math with, re-rendering when it changes. */
export function useGymPlates(): number[] {
  return useGymHas25s() ? DEFAULT_PLATES : PLATES_WITHOUT_25;
}
