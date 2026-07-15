import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Sheet } from "./Sheet";

afterEach(() => {
  vi.restoreAllMocks();
});

function Harness({ onClose = () => {} }: { onClose?: () => void }) {
  return (
    <>
      <button>outside before</button>
      <Sheet label="Test sheet" onClose={onClose}>
        <button>first</button>
        <button>second</button>
      </Sheet>
      <button>outside after</button>
    </>
  );
}

describe("Sheet (native bottom sheet)", () => {
  it("exposes a labelled modal dialog", () => {
    render(<Harness />);
    const dialog = screen.getByRole("dialog", { name: "Test sheet" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
  });

  it("closes on Escape", async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });

  it("traps Tab within the sheet (forward wraps to the first control)", async () => {
    render(<Harness />);
    const first = screen.getByRole("button", { name: "first" });
    const second = screen.getByRole("button", { name: "second" });
    second.focus();
    await userEvent.tab();
    expect(first).toHaveFocus();
    expect(screen.getByRole("button", { name: "outside after" })).not.toHaveFocus();
  });

  it("traps Shift+Tab within the sheet (backward wraps to the last control)", async () => {
    render(<Harness />);
    const first = screen.getByRole("button", { name: "first" });
    const second = screen.getByRole("button", { name: "second" });
    first.focus();
    await userEvent.tab({ shift: true });
    expect(second).toHaveFocus();
  });
});

/** The sheet pushes a history entry so the back gesture closes it. Popping
 * that entry on unmount is only correct while the entry is still ours — if
 * the router navigated, it overwrote our entry with the new route, and
 * popping then walks the user BACK to the screen they just left. */
describe("Sheet (history entry)", () => {
  it("pops its own entry when the user dismisses it", () => {
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
    const { unmount } = render(<Harness />);
    unmount();
    expect(back).toHaveBeenCalledOnce();
  });

  it("does not pop when the router already replaced the entry", () => {
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
    const navigatingAway = { current: false };
    const { unmount } = render(
      <Sheet label="Test sheet" onClose={() => {}} keepHistoryOnUnmount={navigatingAway}>
        <button>first</button>
      </Sheet>,
    );

    // What router.replace("/history") does: overwrite the top entry — ours.
    navigatingAway.current = true;
    window.history.replaceState({}, "", "/history");
    unmount();

    expect(back).not.toHaveBeenCalled();
  });
});
