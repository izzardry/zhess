/**
 * Sharing without React (DESIGN 13.2): the Web Share sheet where it exists, the clipboard otherwise.
 */

/** What happened to a share request. */
export type ShareOutcome = 'shared' | 'copied' | 'cancelled' | 'failed';

/** The parts of `navigator` the helpers use; tests pass a fake. */
export type ShareNavigator = {
  share?: (data: ShareData) => Promise<void>;
  clipboard?: Pick<Clipboard, 'writeText'>;
};

const defaultNav = (): ShareNavigator | undefined => (typeof navigator === 'undefined' ? undefined : navigator);

/**
 * Copies text: the async Clipboard API, else a hidden textarea and `execCommand('copy')`
 * (older iOS, insecure contexts). Resolves true on success.
 */
export async function copyText(text: string, nav: ShareNavigator | undefined = defaultNav()): Promise<boolean> {
  try {
    if (nav?.clipboard?.writeText) {
      await nav.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the textarea path */
  }
  try {
    if (typeof document === 'undefined' || typeof document.execCommand !== 'function') return false;
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/**
 * Opens the share sheet with title, text and URL. When the sheet is missing or fails, copies the
 * URL instead. A sheet the user closed (`AbortError`) counts as cancelled and copies nothing.
 */
export async function shareOrCopy(
  data: { title: string; text: string; url: string },
  nav: ShareNavigator | undefined = defaultNav(),
): Promise<ShareOutcome> {
  if (nav?.share) {
    try {
      await nav.share(data);
      return 'shared';
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return 'cancelled';
    }
  }
  return (await copyText(data.url, nav)) ? 'copied' : 'failed';
}
