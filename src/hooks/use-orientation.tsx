/**
 * Mobile landscape detection (Ztyle 05 "Portrait vs. landscape"):
 * `innerWidth > innerHeight && min(innerWidth, innerHeight) < 768`.
 * Desktop wide screens stay in the portrait layout. Ported from Zudoku `use-orientation.tsx`.
 */
import { useEffect, useState } from 'react';
import { MOBILE_BREAKPOINT } from './use-mobile';

/** The Ztyle mobile-landscape rule for a viewport size. */
export function isMobileLandscape(width: number, height: number): boolean {
  return width > height && Math.min(width, height) < MOBILE_BREAKPOINT;
}

function current(): boolean {
  return typeof window !== 'undefined' && isMobileLandscape(window.innerWidth, window.innerHeight);
}

/** True in mobile landscape; follows resize and orientation changes. */
export function useIsMobileLandscape(): boolean {
  const [landscape, setLandscape] = useState(current);

  useEffect(() => {
    const update = () => setLandscape(current());
    update();
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
    };
  }, []);

  return landscape;
}

/** `'landscape'` in mobile landscape (rails), else `'portrait'` (Ztyle 05). */
export function useOrientation(): 'portrait' | 'landscape' {
  return useIsMobileLandscape() ? 'landscape' : 'portrait';
}
