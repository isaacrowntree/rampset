"use client";

/** UISwitch: 51×31 track, the thumb springs across, green when on — iOS
 * keeps switches green whatever the app's tint. A real checkbox underneath,
 * exposed as role="switch". */

export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <input
      type="checkbox"
      role="switch"
      aria-label={label}
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      className="ios-switch flex-none"
    />
  );
}
