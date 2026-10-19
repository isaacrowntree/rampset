/** The few control styles the account screens share — the same ones the rest
 * of the app uses for fields and full-width actions. */

export const FIELD =
  "w-full rounded-[12px] bg-fill px-4 py-3 text-[17px] text-ink outline-none placeholder:text-ink-faint focus:ring-2 focus:ring-accent";

export const PRIMARY =
  "w-full rounded-full bg-accent py-3.5 text-[17px] font-semibold text-on-accent disabled:opacity-50";

export const SECONDARY = "w-full rounded-full py-3.5 text-[17px] text-accent disabled:opacity-50";

/** An error line: danger-tinted, readable in both skins. */
export const ERROR = "text-[15px] leading-snug text-danger";
