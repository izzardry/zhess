/**
 * The blurred preview board on the start screen fits between the header (wordmark, tagline, code)
 * and the footer (opponent selector, pills): DESIGN 4.1's mock puts the code above the board and the
 * selectors below it. The board keeps its game size and place in the layout; on the start screen it
 * is only drawn smaller and shifted (CSS `scale` / `translate`), so Start animates it back into
 * place together with the blur.
 */

/** Space kept between the board and the chrome above and below it. */
export const PREVIEW_GAP = 12;
/** The preview never shrinks below this (a sliver of a board helps nobody). */
export const PREVIEW_MIN_SCALE = 0.3;

export interface PreviewBox {
  /** The board's top and height in page coordinates, untransformed. */
  readonly boardTop: number;
  readonly boardHeight: number;
  /** Bottom edge of the header and top edge of the footer, in the same coordinates. */
  readonly top: number;
  readonly bottom: number;
}

export interface PreviewFit {
  readonly scale: number;
  /** Vertical shift of the board's centre, px. */
  readonly dy: number;
}

export const NO_FIT: PreviewFit = Object.freeze({ scale: 1, dy: 0 });

/** How to draw the preview so it stays clear of the chrome. No change when it already fits. */
export function previewFit({ boardTop, boardHeight, top, bottom }: PreviewBox): PreviewFit {
  if (!(boardHeight > 0)) return NO_FIT;
  const lo = top + PREVIEW_GAP;
  const hi = bottom - PREVIEW_GAP;
  const room = hi - lo;
  if (!(room > 0)) return NO_FIT;
  const boardBottom = boardTop + boardHeight;
  if (boardHeight <= room) {
    // Fits at full size: shift only if it overlaps one side.
    const dy = boardTop < lo ? lo - boardTop : boardBottom > hi ? hi - boardBottom : 0;
    return dy === 0 ? NO_FIT : { scale: 1, dy };
  }
  const scale = Math.max(PREVIEW_MIN_SCALE, room / boardHeight);
  const dy = (lo + hi) / 2 - (boardTop + boardHeight / 2);
  return { scale, dy };
}
