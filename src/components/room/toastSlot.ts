/**
 * Sonner ids per showing, for the room's toasts that come and go under one name (presence, the
 * failure message, an incoming request).
 *
 * sonner 1.7 keeps a dismissed or timed-out toast's `delete` mark through its exit animation
 * (~200 ms). A toast re-created under the same id in that window inherits the mark and vanishes
 * at once. A slot therefore hands out a fresh id for every new showing, and keeps the id while the
 * toast is on screen, so an update replaces it in place (a quick flap shows only the latest).
 */
import { toast } from 'sonner';

export interface ToastSlot {
  /** Id of the toast on screen (or of the last one shown). */
  readonly id: string;
  /** Whether a toast of this slot is on screen. */
  readonly onScreen: boolean;
  /** Id for a showing: the current one while it is on screen (update in place), else a fresh one. */
  show(): string;
  /** The toast with this id went away (swiped, timed out, answered). Ids of older showings are ignored. */
  gone(id: string): void;
  /** Dismisses the toast on screen, if any. */
  dismiss(): void;
}

export function createToastSlot(prefix: string): ToastSlot {
  let n = 0;
  let id = prefix;
  let onScreen = false;
  return {
    get id() {
      return id;
    },
    get onScreen() {
      return onScreen;
    },
    show() {
      if (!onScreen) id = `${prefix}-${++n}`;
      onScreen = true;
      return id;
    },
    gone(which: string) {
      if (which === id) onScreen = false;
    },
    dismiss() {
      if (!onScreen) return;
      onScreen = false;
      toast.dismiss(id);
    },
  };
}
