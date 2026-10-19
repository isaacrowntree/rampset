"use client";

/** Shaping a custom routine: its days, and the order of exercises in a day.
 * Guided programs (5×5, Madcow) keep their written structure — rotation and
 * progression depend on it — so the Program tab only offers these for
 * routine programs. History is never touched: a workout keeps its dayLabel
 * when the day it came from is renamed or removed. */

import { db, newId } from "./db";
import type { ProgramDay } from "@/lib/types";

export async function addDay(programId: string, name: string): Promise<ProgramDay> {
  const days = await db.programDays.where({ programId }).toArray();
  const day: ProgramDay = {
    id: `day-${newId()}`,
    programId,
    position: Math.max(-1, ...days.map((d) => d.position)) + 1,
    name: name.trim() || `Day ${days.length + 1}`,
  };
  await db.programDays.add(day);
  return day;
}

export async function renameDay(dayId: string, name: string): Promise<void> {
  const trimmed = name.trim();
  if (trimmed) await db.programDays.update(dayId, { name: trimmed });
}

/** The day and its exercise slots. The exercises themselves stay — they're
 * the lifter's, with history attached, and other days may use them. */
export async function deleteDay(dayId: string): Promise<void> {
  await db.transaction("rw", [db.programDays, db.programExercises], async () => {
    await db.programExercises.where({ programDayId: dayId }).delete();
    await db.programDays.delete(dayId);
  });
}

/** Swap an exercise with its neighbour in the day. Positions are rewritten
 * 0..n-1, so gaps left by removed exercises heal on the first move. */
export async function moveExercise(programExerciseId: string, direction: -1 | 1): Promise<void> {
  await db.transaction("rw", [db.programExercises], async () => {
    const pe = await db.programExercises.get(programExerciseId);
    if (!pe) return;
    const rows = await db.programExercises.where({ programDayId: pe.programDayId }).sortBy("position");
    const i = rows.findIndex((r) => r.id === pe.id);
    const j = i + direction;
    if (j < 0 || j >= rows.length) return;
    [rows[i], rows[j]] = [rows[j], rows[i]];
    await Promise.all(rows.map((r, position) => db.programExercises.update(r.id, { position })));
  });
}
