/**
 * State behind `<DeleteUndoToasts>`: a stack of deletions that can still be undone.
 * The caller deletes first, then calls `add`; `undo` hands the item to `onRestore`.
 */
import { useCallback, useRef, useState } from 'react';
import type { PendingDeletion } from './DeleteUndoToasts';

export interface UndoDeletions<T> {
  deletions: PendingDeletion<T>[];
  /** Puts a just-deleted item on the stack. Returns its id. */
  add: (item: T, subject: string) => string;
  /** Restores one item and drops its toast. */
  undo: (id: string) => void;
  /** Restores every item on the stack, oldest first. */
  undoAll: () => void;
  /** Drops one toast; its deletion stays. */
  dismiss: (id: string) => void;
  /** Drops all toasts; all deletions stay. */
  expire: () => void;
}

export function useUndoDeletions<T>(onRestore: (item: T) => void): UndoDeletions<T> {
  const [deletions, setDeletions] = useState<PendingDeletion<T>[]>([]);
  const counter = useRef(0);
  const current = useRef(deletions);
  current.current = deletions;
  const restore = useRef(onRestore);
  restore.current = onRestore;

  const add = useCallback((item: T, subject: string) => {
    const id = `del-${++counter.current}`;
    const next = [...current.current, { id, subject, item }];
    current.current = next;
    setDeletions(next);
    return id;
  }, []);

  const undo = useCallback((id: string) => {
    const found = current.current.find((d) => d.id === id);
    if (!found) return;
    const next = current.current.filter((d) => d.id !== id);
    current.current = next;
    setDeletions(next);
    restore.current(found.item);
  }, []);

  const undoAll = useCallback(() => {
    const all = current.current;
    current.current = [];
    setDeletions([]);
    for (const d of all) restore.current(d.item);
  }, []);

  const dismiss = useCallback((id: string) => {
    const next = current.current.filter((d) => d.id !== id);
    current.current = next;
    setDeletions(next);
  }, []);

  const expire = useCallback(() => {
    current.current = [];
    setDeletions([]);
  }, []);

  return { deletions, add, undo, undoAll, dismiss, expire };
}
