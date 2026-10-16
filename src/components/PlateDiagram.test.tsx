import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PlateDiagram } from "./PlateDiagram";
import { setGymHas25s } from "@/lib/gymPlates";

describe("PlateDiagram", () => {
  it("describes the per-side loadout for a loadable weight", () => {
    render(<PlateDiagram totalKg={80} />);
    // 80kg on a 20kg bar → 30/side → a 25 and a 5.
    expect(screen.getByRole("img", { name: /80kg: 25, 5 per side on a 20kg bar/i })).toBeInTheDocument();
  });

  it("labels an empty bar", () => {
    render(<PlateDiagram totalKg={20} />);
    expect(screen.getByRole("img", { name: /empty 20kg bar/i })).toBeInTheDocument();
  });

  it("flags a weight that standard plates can't make", () => {
    render(<PlateDiagram totalKg={21} />);
    expect(screen.getByRole("img", { name: /not loadable/i })).toBeInTheDocument();
  });

  it("draws every load at one scale, so a plate never changes size", () => {
    const viewBox = (kg: number) =>
      render(<PlateDiagram totalKg={kg} />).container.querySelector("svg")!.getAttribute("viewBox");
    // A tight, load-fitted viewBox rescaled the whole bar on every ±2.5.
    expect(viewBox(25)).toBe(viewBox(140));
  });

  it("names the plates for each side", () => {
    render(<PlateDiagram totalKg={90} />);
    // 90kg → 35/side → a 25 and a 10.
    expect(screen.getByText("Each side")).toBeInTheDocument();
    expect(screen.getByText("25")).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument();
  });

  it("loads from 20s down in a gym without 25s", () => {
    setGymHas25s(false);
    try {
      render(<PlateDiagram totalKg={80} />);
      expect(screen.getByRole("img", { name: /80kg: 20, 10 per side/i })).toBeInTheDocument();
    } finally {
      setGymHas25s(true);
    }
  });
});
