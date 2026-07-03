import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { SetRow } from "./SetRow";

describe("SetRow (routine-mode Strong-style row)", () => {
  it("renders set number, previous values, and editable fields", () => {
    render(
      <SetRow
        index={0}
        previous="70kg × 15"
        weightKg={70}
        reps={15}
        done={false}
        onChange={() => {}}
        onToggle={() => {}}
      />,
    );
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("70kg × 15")).toBeInTheDocument();
    expect(screen.getByLabelText(/weight/i)).toHaveValue(70);
    expect(screen.getByLabelText(/reps/i)).toHaveValue(15);
  });

  it("marks the set done via the check button", async () => {
    const onToggle = vi.fn();
    render(
      <SetRow
        index={1}
        previous="—"
        weightKg={25}
        reps={8}
        done={false}
        onChange={() => {}}
        onToggle={onToggle}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /mark set 2 done/i }));
    expect(onToggle).toHaveBeenCalled();
  });

  it("edits propagate through onChange", async () => {
    const onChange = vi.fn();
    function Harness() {
      const [values, setValues] = useState({ weightKg: 70 as number | undefined, reps: 15 as number | undefined });
      return (
        <SetRow
          index={0}
          previous="—"
          weightKg={values.weightKg}
          reps={values.reps}
          done={false}
          onChange={(v) => {
            setValues({ weightKg: v.weightKg, reps: v.reps });
            onChange(v);
          }}
          onToggle={() => {}}
        />
      );
    }
    render(<Harness />);
    const weight = screen.getByLabelText(/weight/i);
    await userEvent.clear(weight);
    await userEvent.type(weight, "72.5");
    expect(onChange).toHaveBeenLastCalledWith({ weightKg: 72.5, reps: 15 });
  });

  it("renders seconds field for timed sets", () => {
    render(
      <SetRow
        index={0}
        previous="60s"
        seconds={60}
        timed
        done={false}
        onChange={() => {}}
        onToggle={() => {}}
      />,
    );
    expect(screen.getByLabelText(/seconds/i)).toHaveValue(60);
    expect(screen.queryByLabelText(/weight/i)).not.toBeInTheDocument();
  });
});
