import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Index from "@/pages/Index";
import NotFound from "@/pages/NotFound";
import { cn } from "@/lib/utils";
import { flags } from "@/lib/flags";

describe("scaffold", () => {
  it("shows the wordmark and tagline", () => {
    render(<Index />);
    expect(screen.getByRole("heading", { name: "ZHESS" })).toBeInTheDocument();
    expect(screen.getByText("Zero Distractions. Just Chess.")).toBeInTheDocument();
  });

  it("renders the not-found page with a way back", () => {
    render(
      <MemoryRouter>
        <NotFound />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: "Back" })).toHaveAttribute("href", "/");
  });

  it("merges class names with tailwind-merge", () => {
    const hidden = false;
    expect(cn("p-2", hidden && "hidden", "p-4")).toBe("p-4");
  });

  it("has every feature flag on by default", () => {
    expect(Object.values(flags).every(Boolean)).toBe(true);
  });
});
