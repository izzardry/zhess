import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Index from "@/pages/Index";
import NotFound from "@/pages/NotFound";
import { I18nProvider } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { flags } from "@/lib/flags";

describe("scaffold", () => {
  it("shows the wordmark and tagline", () => {
    render(
      <I18nProvider language="en">
        <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <Index />
        </MemoryRouter>
      </I18nProvider>,
    );
    expect(screen.getByRole("heading", { name: "ZHESS" })).toBeInTheDocument();
    expect(screen.getByText("Zero Distractions. Just Chess.")).toBeInTheDocument();
  });

  it("renders the not-found page with a way back", () => {
    render(
      <I18nProvider language="de">
        <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <NotFound />
        </MemoryRouter>
      </I18nProvider>,
    );
    expect(screen.getByRole("link", { name: "Zurück" })).toHaveAttribute("href", "/");
    expect(screen.getByText(/Diese Seite gibt es nicht/)).toBeInTheDocument();
  });

  it("merges class names with tailwind-merge", () => {
    const hidden = false;
    expect(cn("p-2", hidden && "hidden", "p-4")).toBe("p-4");
  });

  it("has every feature flag on by default", () => {
    expect(Object.values(flags).every(Boolean)).toBe(true);
  });
});
