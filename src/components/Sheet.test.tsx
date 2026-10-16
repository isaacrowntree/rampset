import { describe, it, expect, vi, afterEach } from "vitest";
import { StrictMode } from "react";
import { act, render, screen } from "@testing-library/react";
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
  it("pops its own entry when the user dismisses it", async () => {
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
    const { unmount } = render(<Harness />);
    unmount();
    await new Promise((r) => setTimeout(r, 0));
    expect(back).toHaveBeenCalledOnce();
  });

  it("keeps one entry, and stays open, through StrictMode's double mount", async () => {
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
    const push = vi.spyOn(window.history, "pushState");
    const onClose = vi.fn();
    const { unmount } = render(
      <StrictMode>
        <Harness onClose={onClose} />
      </StrictMode>,
    );
    await act(() => new Promise((r) => setTimeout(r, 10)));
    expect(push).toHaveBeenCalledOnce();
    expect(back).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    // Let the teardown's pop land on the spy, not the next test.
    unmount();
    await new Promise((r) => setTimeout(r, 0));
  });

  it("does not pop when the router already replaced the entry", async () => {
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
    await new Promise((r) => setTimeout(r, 0));

    expect(back).not.toHaveBeenCalled();
  });

  it("closes only the top sheet when one is stacked on another", async () => {
    const outer = vi.fn();
    const inner = vi.fn();
    render(
      <>
        <Sheet label="Outer" onClose={outer}>
          <button>a</button>
        </Sheet>
        <Sheet label="Inner" onClose={inner}>
          <button>b</button>
        </Sheet>
      </>,
    );
    await act(async () => {
      window.history.back();
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(inner).toHaveBeenCalledOnce();
    expect(outer).not.toHaveBeenCalled();
  });

  it("hands its entry to a sheet that replaces it, which stays open", async () => {
    // Let the previous test's teardown pop land before counting.
    await new Promise((r) => setTimeout(r, 0));
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
    const push = vi.spyOn(window.history, "pushState");
    const editClose = vi.fn();
    const { rerender, unmount } = render(
      <Sheet label="Summary" onClose={() => {}}>
        <button>a</button>
      </Sheet>,
    );
    // Summary → Edit in one commit, as History's "Edit workout" does.
    rerender(
      <Sheet key="edit" label="Edit" onClose={editClose}>
        <button>b</button>
      </Sheet>,
    );
    await act(() => new Promise((r) => setTimeout(r, 10)));
    expect(push).toHaveBeenCalledOnce();
    expect(back).not.toHaveBeenCalled();
    expect(editClose).not.toHaveBeenCalled();
    unmount();
    await new Promise((r) => setTimeout(r, 0));
  });
});
