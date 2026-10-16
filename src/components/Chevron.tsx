/** The one disclosure chevron: 7×12, tertiary ink, like UITableView's. */
export function Chevron({ className = "" }: { className?: string }) {
  return (
    <svg
      width="7"
      height="12"
      viewBox="0 0 8 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`flex-none text-ink-faint opacity-70 ${className}`}
      aria-hidden
    >
      <path d="M1 1l6 6-6 6" />
    </svg>
  );
}
