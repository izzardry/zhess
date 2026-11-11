/**
 * Where sonner's toasts sit (see sonner.tsx): above the portrait toolbar with the bottom safe area,
 * or beside the board in mobile landscape. Pure, for tests.
 */
import type { ComponentProps, CSSProperties } from "react";
import type { Toaster as Sonner } from "sonner";

type ToasterProps = ComponentProps<typeof Sonner>;

/** Above the portrait toolbar: its inset, its height (44 px buttons + py-1.5 + border) and a gap. */
export const TOAST_BOTTOM_PORTRAIT = "calc(max(1rem, env(safe-area-inset-bottom)) + 58px + 0.5rem)";
/** Landscape: the board leaves (100vw − board) / 2 on each side; the toast takes the right one. */
const BOARD_LANDSCAPE = "clamp(272px, calc(100dvh - 3rem), 608px)";
export const TOAST_WIDTH_LANDSCAPE = `max(160px, min(356px, calc((100vw - ${BOARD_LANDSCAPE}) / 2 - 0.75rem - max(1rem, env(safe-area-inset-right)))))`;
const RIGHT = "max(1rem, env(safe-area-inset-right))";

/** Sonner's offsets for the current layout (exported for tests). */
export function toasterPlacement(landscape: boolean): Pick<ToasterProps, "offset" | "mobileOffset" | "style" | "className"> {
  if (landscape) {
    const offset = { bottom: "max(0.75rem, env(safe-area-inset-bottom))", right: RIGHT, left: "auto" };
    return {
      offset,
      mobileOffset: offset,
      style: { "--width": TOAST_WIDTH_LANDSCAPE } as CSSProperties,
      className: "zhess-toaster-rail",
    };
  }
  return {
    offset: { bottom: TOAST_BOTTOM_PORTRAIT, right: RIGHT },
    mobileOffset: { bottom: TOAST_BOTTOM_PORTRAIT, left: "1rem", right: "1rem" },
  };
}
