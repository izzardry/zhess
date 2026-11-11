import { beforeEach, describe, expect, it } from 'vitest';
import zhess from './zhess';
import { MAX_AGE_MS, TURN_BANK_KEY, bankTurn, bankedTurnMs, clearBankedTurn, type BankStorage } from './turnBank';

function memStorage(): BankStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

const g0 = zhess.newGame();
const g1 = zhess.play(g0, 'e2e4', 100);

describe('turn bank', () => {
  let s: ReturnType<typeof memStorage>;
  let t = 1_000_000;
  const now = () => t;
  beforeEach(() => {
    s = memStorage();
    t = 1_000_000;
  });

  it('returns the banked ms for the same game and position', () => {
    bankTurn('ABC123', g1, 4321.4, now, s);
    expect(bankedTurnMs('ABC123', g1, now, s)).toBe(4321);
  });

  it('ignores another game, another position, an ended game and stale entries', () => {
    bankTurn('ABC123', g1, 5000, now, s);
    expect(bankedTurnMs('OTHER1', g1, now, s)).toBe(0);
    expect(bankedTurnMs('ABC123', g0, now, s)).toBe(0);
    expect(bankedTurnMs('ABC123', zhess.play(g1, 'e7e5', 0), now, s)).toBe(0);
    expect(bankedTurnMs('ABC123', zhess.end(g1, '0-1', 'resign'), now, s)).toBe(0);
    t += MAX_AGE_MS + 1;
    expect(bankedTurnMs('ABC123', g1, now, s)).toBe(0);
  });

  it('survives garbage and throwing storage', () => {
    s.setItem(TURN_BANK_KEY, '{nope');
    expect(bankedTurnMs('ABC123', g1, now, s)).toBe(0);
    s.setItem(TURN_BANK_KEY, JSON.stringify({ id: 'ABC123' }));
    expect(bankedTurnMs('ABC123', g1, now, s)).toBe(0);
    const broken: BankStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    // Falls back to memory.
    bankTurn('ABC123', g1, 700, now, broken);
    expect(bankedTurnMs('ABC123', g1, now, broken)).toBe(700);
    expect(() => clearBankedTurn(broken)).not.toThrow();
    expect(bankedTurnMs('ABC123', g1, now, broken)).toBe(0);
  });

  it('does not bank negative or non-finite times and clears', () => {
    bankTurn('ABC123', g1, -5, now, s);
    bankTurn('ABC123', g1, Number.NaN, now, s);
    expect(s.data.size).toBe(0);
    bankTurn('ABC123', g1, 10, now, s);
    clearBankedTurn(s);
    expect(bankedTurnMs('ABC123', g1, now, s)).toBe(0);
  });
});
