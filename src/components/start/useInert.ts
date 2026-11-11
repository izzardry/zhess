import { useEffect, type RefObject } from 'react';

/**
 * Sets the `inert` attribute while `inert` is true, so faded-out chrome (opacity 0,
 * pointer-events none) cannot be reached by Tab or a screen reader either.
 * React 18 does not know the `inert` prop, hence the effect.
 */
export function useInert(ref: RefObject<HTMLElement>, inert: boolean): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (inert) el.setAttribute('inert', '');
    else el.removeAttribute('inert');
  }, [ref, inert]);
}
