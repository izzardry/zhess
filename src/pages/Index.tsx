/**
 * Placeholder stage (phase 0). Integrator 1 replaces this with the single stage of
 * DESIGN.md section 4: start screen, game, history and review.
 */
const Index = () => (
  <div className="halftone-bg min-h-screen select-none">
    <main className="flex min-h-screen flex-col items-center justify-center px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]">
      <h1 className="font-mono text-3xl font-light tracking-[0.3em] sm:text-4xl">ZHESS</h1>
      <p className="mt-2 text-sm text-muted-foreground">Zero Distractions. Just Chess.</p>
    </main>
    <div className="fixed bottom-[max(0.25rem,env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 font-mono text-[9px] text-muted-foreground/30 sm:left-auto sm:right-[max(0.25rem,env(safe-area-inset-right))] sm:translate-x-0 sm:text-[10px]">
      {__GIT_DATE__} ({__GIT_HASH__})
    </div>
  </div>
);

export default Index;
