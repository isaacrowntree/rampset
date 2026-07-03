import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SetPlate } from "./SetPlate";

describe("SetPlate (program-mode tap-cycle circle)", () => {
  it("logs the full target on first tap", async () => {
    const onChange = vi.fn();
    render(<SetPlate target={5} value={null} onChange={onChange} />);
    await userEvent.click(screen.getByRole("button"));
    expect(onChange).toHaveBeenCalledWith(5);
  });

  it("decrements on each subsequent tap", async () => {
    const onChange = vi.fn();
    render(<SetPlate target={5} value={5} onChange={onChange} />);
    await userEvent.click(screen.getByRole("button"));
    expect(onChange).toHaveBeenCalledWith(4);
  });

  it("cycles from zero back to empty", async () => {
    const onChange = vi.fn();
    render(<SetPlate target={5} value={0} onChange={onChange} />);
    await userEvent.click(screen.getByRole("button"));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("shows the pending target dimly when empty", () => {
    render(<SetPlate target={5} value={null} onChange={() => {}} />);
    expect(screen.getByRole("button")).toHaveAccessibleName(/5 reps target/i);
  });

  it("announces logged reps", () => {
    render(<SetPlate target={5} value={3} onChange={() => {}} />);
    expect(screen.getByRole("button")).toHaveAccessibleName(/3 of 5/i);
  });
});
