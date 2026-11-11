/**
 * Game code field (DESIGN 4.1, Ztyle 08 "Selectors", 10 "Code selector"), ported from Zudoku's
 * SeedSelector without the seed search:
 *
 *   K7QW2M  ✎
 *   game code
 *
 * - The big code is a button: tap = a new random 6-character code.
 * - ✎ edits inline: uppercase `0-9A-Z` only, at most 8 characters.
 * - ✓, Enter or blur confirm; Escape reverts. An empty entry reverts too.
 *
 * Audit fixes: all strings translated (#15); the ✓ button keeps the input focused on press, so
 * the blur-confirm and the click no longer race and re-open the editor.
 */
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Check, Pencil } from 'lucide-react';
import { generateCode, normalizeCode, CODE_MAX_LENGTH, defaultRng } from '@/lib/codes';
import { useI18n } from '@/lib/i18n';
import type { Rng } from '@/lib/types';
import { cn } from '@/lib/utils';

/** Where a new code came from: the random roll or the user's typing. */
export type CodeSource = 'random' | 'typed';

export interface CodeSelectorProps {
  /** The current code (uppercase, 1–8 characters). */
  code: string;
  /** Called with a new, normalized code. Not called when an edit ends unchanged or empty. */
  onChange: (code: string, source: CodeSource) => void;
  /** Random source for new codes (tests). Defaults to WebCrypto. */
  rng?: Rng;
  /** Blocks rolling and editing (e.g. during the start transition). */
  disabled?: boolean;
  /** One step smaller caption, as in Ztyle's landscape layout. */
  landscape?: boolean;
  /** Show the `game code` caption under the code (default true). */
  showLabel?: boolean;
  className?: string;
}

export function CodeSelector({
  code,
  onChange,
  rng = defaultRng,
  disabled = false,
  landscape = false,
  showLabel = true,
  className,
}: CodeSelectorProps) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(code);
  /** Set once the current edit has been confirmed or cancelled, so a late blur is ignored. */
  const closed = useRef(false);
  const refocus = useRef(false);
  const editButton = useRef<HTMLButtonElement>(null);

  // Leave edit mode if the field gets disabled mid-edit (e.g. Start pressed elsewhere).
  useEffect(() => {
    if (disabled) setEditing(false);
  }, [disabled]);

  // After a keyboard confirm or cancel, put focus back on the pencil button.
  useEffect(() => {
    if (!editing && refocus.current) {
      refocus.current = false;
      editButton.current?.focus();
    }
  }, [editing]);

  const startEdit = useCallback(() => {
    if (disabled) return;
    closed.current = false;
    setDraft(code);
    setEditing(true);
  }, [code, disabled]);

  const confirm = useCallback(() => {
    if (closed.current) return;
    closed.current = true;
    const next = normalizeCode(draft);
    setEditing(false);
    if (next && next !== code) onChange(next, 'typed');
  }, [draft, code, onChange]);

  const cancel = useCallback(() => {
    closed.current = true;
    setDraft(code);
    setEditing(false);
  }, [code]);

  const roll = useCallback(() => {
    if (disabled) return;
    let next = generateCode(rng);
    // A roll must visibly change the code; retry once on the (1 in 2 billion) repeat.
    if (next === code) next = generateCode(rng);
    onChange(next, 'random');
  }, [code, disabled, onChange, rng]);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      refocus.current = true;
      confirm();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      refocus.current = true;
      cancel();
    }
  };

  return (
    <div className={cn('flex flex-col items-center', className)}>
      <div className="flex items-center justify-center gap-3">
        {/* Spacer the width of the pencil button so the code stays centered over the board. */}
        <span aria-hidden="true" className="icon-button invisible">
          <Pencil className="h-5 w-5" />
        </span>

        {editing ? (
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(normalizeCode(e.target.value))}
            onKeyDown={onKeyDown}
            onBlur={confirm}
            maxLength={CODE_MAX_LENGTH}
            autoFocus
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="characters"
            spellCheck={false}
            enterKeyHint="done"
            aria-label={t('start.codeInputAria')}
            data-testid="code-input"
            className="code-display code-input w-48 font-mono"
          />
        ) : (
          <button
            type="button"
            onClick={roll}
            disabled={disabled}
            aria-label={t('start.codeNewAria', { code })}
            data-testid="code-roll"
            className={cn(
              'code-display font-mono transition-opacity duration-150 hover:opacity-70 active:scale-95',
              disabled && 'cursor-not-allowed opacity-50',
            )}
          >
            {code}
          </button>
        )}

        <button
          ref={editButton}
          type="button"
          onMouseDown={(e) => {
            // Keep the input focused, so blur does not confirm before this click does.
            if (editing) e.preventDefault();
          }}
          onClick={editing ? confirm : startEdit}
          disabled={disabled}
          aria-label={editing ? t('start.codeConfirmAria') : t('start.codeEditAria')}
          data-testid="code-edit"
          className="icon-button"
        >
          {editing ? <Check className="h-5 w-5" /> : <Pencil className="h-5 w-5" />}
        </button>
      </div>

      {showLabel && (
        <p className={cn('mt-1 text-center lowercase text-muted-foreground/70', landscape ? 'text-[10px]' : 'text-xs')}>
          {t('gameCode')}
        </p>
      )}
    </div>
  );
}
