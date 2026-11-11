/**
 * Arbitrary timings must survive Tailwind (final visual pass): `duration-[400ms]` is ambiguous
 * between Tailwind's transition-duration and tailwindcss-animate's animation-duration, so Tailwind
 * dropped it. The components use explicit `[transition-duration:…]` / `[animation-duration:…]`.
 */
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import { describe, expect, it } from 'vitest';
import config from '../../tailwind.config';

async function utilitiesFor(files: string[]): Promise<string> {
  const result = await postcss([tailwindcss({ ...config, content: files })]).process('@tailwind utilities;', { from: undefined });
  return result.css;
}

describe('Tailwind keeps the intended arbitrary timings', () => {
  it('tutorial fade-out 400 ms and resign-undo toast entrance 250 ms', async () => {
    const css = await utilitiesFor(['src/components/platform/TutorialOverlay.tsx', 'src/components/game/ResignUndoToast.tsx']);
    expect(css).toMatch(/transition-duration:\s*400ms/);
    expect(css).toMatch(/animation-duration:\s*250ms/);
  });
});
