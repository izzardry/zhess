import type { GameEnd, GameLog, HeadMsg, LogsMsg, Message, SavedGame, Seat } from './types';
import zhess from './zhess';
import {
  appendPly,
  applyMoveMsg,
  colorOf,
  commonPrefix,
  compareLogs,
  currentLog,
  endLog,
  fromBase64Url,
  gamePoints,
  generateKey,
  generateNonce,
  hashLog,
  hashString,
  headPliesHash,
  isValidKey,
  logToGame,
  logToSaved,
  makeHead,
  makeLogs,
  mergeLogs,
  newLog,
  pliesHash,
  proofMessage,
  proveSeat,
  randomBytes,
  reconcile,
  rematchLog,
  roomGameId,
  roomScore,
  savedToLog,
  scoreView,
  seatOf,
  seatToMove,
  sortLogs,
  takebackLog,
  toBase64Url,
  turnOf,
  validateLog,
  verifySeat,
  whiteOfGame,
} from './sync';

/* ---------------------------------------------------------------------------------------------- */
/* Fixtures                                                                                         */
/* ---------------------------------------------------------------------------------------------- */

/** A deterministic rng (mulberry32). */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ITALIAN = ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'f8c5', 'c2c3', 'g8f6'];
const QUEENS = ['d2d4', 'd7d5', 'c2c4', 'e7e6'];
const SCHOLAR = ['e2e4', 'e7e5', 'f1c4', 'b8c6', 'd1h5', 'g8f6', 'h5f7']; // white mates
const RESIGN_W: GameEnd = { result: '0-1', by: 'resign' };
const RESIGN_B: GameEnd = { result: '1-0', by: 'resign' };
const AGREED: GameEnd = { result: '1/2-1/2', by: 'agreed' };

/** A log of game `n` with the given moves; each ply's ms is 1000 + index unless given. */
function log(
  n: number,
  moves: string[],
  o: { epoch?: number; white?: Seat; tc?: string | null; end?: GameEnd; ms?: number[] } = {},
): GameLog {
  const l: GameLog = {
    n,
    epoch: o.epoch ?? 0,
    white: o.white ?? (n % 2 === 1 ? 0 : 1),
    tc: o.tc === undefined ? null : o.tc,
    plies: moves.map((m, i) => ({ m, ms: o.ms?.[i] ?? 1000 + i })),
  };
  if (o.end) l.end = o.end;
  // Normalize through validation so fixtures are canonical, as stored logs are.
  const v = validateLog(l);
  if (!v.ok) throw new Error(`bad fixture: ${v.error}`);
  return v.log;
}

/** A finished room history: games 1..k-1 finished (white wins by resignation), game k as given. */
function room(current: GameLog, finished = current.n - 1): GameLog[] {
  const out: GameLog[] = [];
  for (let n = 1; n <= finished; n++) out.push(log(n, ITALIAN.slice(0, 4), { end: RESIGN_B }));
  out.push(current);
  return out;
}

const wire = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

interface Device {
  seat: Seat;
  logs: GameLog[];
  toasts: number;
  errors: number;
  adopted: number;
}

/**
 * Runs the reconcile protocol between two devices until no message is left: both send `head`,
 * every `send` goes out as a `logs` message (through JSON), every `adopt` is merged.
 * `order` picks which inbox is served next: alternating, one side first, or seeded random.
 */
function simulate(
  a: { seat: Seat; logs: GameLog[] },
  b: { seat: Seat; logs: GameLog[] },
  order: 'alternate' | 'a-first' | 'b-first' | number = 'alternate',
) {
  const dev: Device[] = [
    { seat: a.seat, logs: sortLogs(a.logs), toasts: 0, errors: 0, adopted: 0 },
    { seat: b.seat, logs: sortLogs(b.logs), toasts: 0, errors: 0, adopted: 0 },
  ];
  const inbox: Message[][] = [[wire(makeHead(currentLog(dev[1].logs)))], [wire(makeHead(currentLog(dev[0].logs)))]];
  const rng = typeof order === 'number' ? seeded(order) : null;
  let turn = 0;
  let messages = 2;
  for (let step = 0; inbox[0].length || inbox[1].length; step++) {
    if (step > 40) throw new Error('reconcile does not settle');
    let i: number;
    if (!inbox[0].length) i = 1;
    else if (!inbox[1].length) i = 0;
    else if (rng) i = rng() < 0.5 ? 0 : 1;
    else if (order === 'a-first') i = 0;
    else if (order === 'b-first') i = 1;
    else i = turn++ % 2;
    const msg = inbox[i].shift()!;
    const d = dev[i];
    const res = reconcile(d.logs, msg as HeadMsg | LogsMsg, d.seat);
    if (res.adopt) {
      d.logs = mergeLogs(d.logs, res.adopt);
      d.adopted += res.adopt.length;
    }
    if (res.forked) d.toasts++;
    if (res.status === 'invalid') d.errors++;
    if (res.send) {
      inbox[1 - i].push(wire(makeLogs(res.send)));
      messages++;
    }
  }
  return { a: dev[0], b: dev[1], messages };
}

const ORDERS = ['alternate', 'a-first', 'b-first', 1, 2, 3, 4, 5] as const;

/* ---------------------------------------------------------------------------------------------- */
/* Hashing and head                                                                                 */
/* ---------------------------------------------------------------------------------------------- */

describe('hashing', () => {
  it('is stable and 16 hex digits', () => {
    expect(hashString('')).toMatch(/^[0-9a-f]{16}$/);
    expect(hashString('zhess')).toBe(hashString('zhess'));
    expect(hashString('zhess')).not.toBe(hashString('zhesS'));
    // Pinned so that a change of the hash (a protocol change) is noticed.
    expect(hashString('zhess')).toMatchInlineSnapshot(`"9052b9bc02ad0ba6"`);
  });

  it('covers n, epoch, white, tc, moves and times, but not the end in pliesHash', () => {
    const base = log(1, ITALIAN);
    const h = pliesHash(base);
    expect(pliesHash({ ...base, n: 2 })).not.toBe(h);
    expect(pliesHash({ ...base, epoch: 1 })).not.toBe(h);
    expect(pliesHash({ ...base, white: 1 })).not.toBe(h);
    expect(pliesHash({ ...base, tc: '5+0' })).not.toBe(h);
    expect(pliesHash(log(1, ITALIAN, { ms: [1, 2, 3, 4, 5, 6, 7, 8] }))).not.toBe(h);
    expect(pliesHash(log(1, [...ITALIAN.slice(0, 7), 'g8e7']))).not.toBe(h);
    expect(pliesHash({ ...base, end: RESIGN_W })).toBe(h);
  });

  it('pliesHash of a prefix equals the hash of the shorter log', () => {
    const long = log(3, ITALIAN, { epoch: 2 });
    for (let k = 0; k <= ITALIAN.length; k++) {
      expect(pliesHash(long, k)).toBe(pliesHash(log(3, ITALIAN.slice(0, k), { epoch: 2 })));
    }
  });

  it('hashLog adds the end; headPliesHash strips it', () => {
    const open = log(1, QUEENS);
    const done = endLog(open, AGREED);
    expect(hashLog(open)).toBe(pliesHash(open));
    expect(hashLog(done)).toBe(`${pliesHash(open)}.1/2-1/2.agreed`);
    expect(headPliesHash(hashLog(done))).toBe(pliesHash(open));
    expect(hashLog(endLog(open, RESIGN_W))).not.toBe(hashLog(endLog(open, RESIGN_B)));
  });

  it('makeHead summarizes the current game', () => {
    const l = endLog(log(2, QUEENS, { epoch: 1 }), RESIGN_W);
    expect(makeHead(l)).toEqual({ t: 'head', v: 1, n: 2, epoch: 1, len: 4, hash: hashLog(l), ended: true });
    expect(makeHead(log(1, QUEENS), 1234.6)).toMatchObject({ ended: false, turnMs: 1235 });
    expect(makeHead(undefined)).toEqual({ t: 'head', v: 1, n: 0, epoch: 0, len: 0, hash: '', ended: false });
    expect('turnMs' in makeHead(log(1, QUEENS), NaN)).toBe(false);
  });

  it('makeLogs sorts oldest first and drops duplicates', () => {
    const msg = makeLogs([log(3, []), log(1, []), log(2, [])]);
    expect(msg.t).toBe('logs');
    expect(msg.v).toBe(1);
    expect(msg.games.map((g) => g.n)).toEqual([1, 2, 3]);
  });
});

/* ---------------------------------------------------------------------------------------------- */
/* Validation                                                                                       */
/* ---------------------------------------------------------------------------------------------- */

describe('validateLog', () => {
  const ok = (raw: unknown) => {
    const v = validateLog(raw);
    if (!v.ok) throw new Error(v.error);
    return v;
  };
  const base = { n: 1, epoch: 0, white: 0, tc: null, plies: [] as { m: string; ms: number }[] };

  it.each([
    ['null', null],
    ['a string', 'log'],
    ['n = 0', { ...base, n: 0 }],
    ['fractional n', { ...base, n: 1.5 }],
    ['negative epoch', { ...base, epoch: -1 }],
    ['seat 2', { ...base, white: 2 }],
    ['bad tc', { ...base, tc: 'fast' }],
    ['missing tc', { n: 1, epoch: 0, white: 0, plies: [] }],
    ['plies not a list', { ...base, plies: {} }],
    ['ply not an object', { ...base, plies: ['e2e4'] }],
    ['bad UCI', { ...base, plies: [{ m: 'e4', ms: 0 }] }],
    ['negative ms', { ...base, plies: [{ m: 'e2e4', ms: -1 }] }],
    ['NaN ms', { ...base, plies: [{ m: 'e2e4', ms: NaN }] }],
    ['illegal ply', { ...base, plies: [{ m: 'e2e5', ms: 0 }] }],
    ['illegal later ply', { ...base, plies: [{ m: 'e2e4', ms: 0 }, { m: 'e2e4', ms: 0 }] }],
    ['ply after mate', { ...base, plies: [...SCHOLAR, 'a7a6'].map((m) => ({ m, ms: 0 })) }],
    ['unknown result', { ...base, end: { result: '2-0', by: 'resign' } }],
    ['unknown termination', { ...base, end: { result: '1-0', by: 'abandon' } }],
    ['agreed with a winner', { ...base, end: { result: '1-0', by: 'agreed' } }],
    ['resigned draw', { ...base, end: { result: '1/2-1/2', by: 'resign' } }],
    ['mate claimed without mate', { ...base, end: { result: '1-0', by: 'mate' } }],
    ['stalemate claimed', { ...base, end: { result: '1/2-1/2', by: 'stalemate' } }],
    ['end contradicting mate', { ...base, plies: SCHOLAR.map((m) => ({ m, ms: 0 })), end: { result: '0-1', by: 'resign' } }],
  ])('rejects %s', (_label, raw) => {
    expect(validateLog(raw).ok).toBe(false);
  });

  it('accepts a log and returns a fresh normalized copy with the game', () => {
    const raw = { ...base, tc: '5+3', plies: [{ m: 'e2e4', ms: 1200.4 }, { m: 'e7e5', ms: 0 }] };
    const v = ok(raw);
    expect(v.log).toEqual({ n: 1, epoch: 0, white: 0, tc: '5+3', plies: [{ m: 'e2e4', ms: 1200 }, { m: 'e7e5', ms: 0 }] });
    expect(v.log).not.toBe(raw);
    expect(v.game.plies).toHaveLength(2);
    expect(v.game.turn).toBe('w');
  });

  it('canonicalizes castling onto the rook and letterless queen promotion', () => {
    const castle = ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'f8c5', 'e1h1'];
    expect(ok({ ...base, plies: castle.map((m) => ({ m, ms: 0 })) }).log.plies[6].m).toBe('e1g1');
    const promo = ['h2h4', 'g7g5', 'h4g5', 'h7h6', 'g5h6', 'g8f6', 'h6h7', 'f6g8', 'h7g8'];
    expect(ok({ ...base, plies: promo.map((m) => ({ m, ms: 0 })) }).log.plies[8].m).toBe('h7g8q');
  });

  it('fills in an automatic ending the sender left out and keeps a matching one', () => {
    const plies = SCHOLAR.map((m) => ({ m, ms: 0 }));
    expect(ok({ ...base, plies }).log.end).toEqual({ result: '1-0', by: 'mate' });
    expect(ok({ ...base, plies, end: { result: '1-0', by: 'mate' } }).log.end).toEqual({ result: '1-0', by: 'mate' });
  });

  it('accepts manual endings and applies them to the game', () => {
    for (const end of [RESIGN_W, RESIGN_B, AGREED, { result: '1-0', by: 'time' } as GameEnd, { result: '1/2-1/2', by: 'time' } as GameEnd]) {
      const v = ok({ ...base, plies: [{ m: 'e2e4', ms: 0 }], end });
      expect(v.log.end).toEqual(end);
      expect(v.game.end).toEqual(end);
    }
  });

  it('logToGame replays or throws', () => {
    expect(logToGame(log(1, ITALIAN)).fen).toBe(zhess.replay(log(1, ITALIAN).plies).fen);
    expect(() => logToGame({ ...base, plies: [{ m: 'a1a8', ms: 0 }] } as GameLog)).toThrow(/Invalid game log/);
  });
});

/* ---------------------------------------------------------------------------------------------- */
/* compareLogs: rules 2–5                                                                           */
/* ---------------------------------------------------------------------------------------------- */

describe('compareLogs (DESIGN 9.4 rules 2–5)', () => {
  const L = (moves: string[], o: Parameters<typeof log>[2] = {}) => log(1, moves, o);
  const rows: {
    rule: string;
    a: GameLog;
    b: GameLog;
    /** Winner when `a` belongs to seat 0 and `b` to seat 1. */
    win: 'a' | 'b' | 'same';
    fork: boolean;
    no: 0 | 2 | 3 | 4 | 5;
  }[] = [
    { rule: 'identical', a: L(ITALIAN), b: L(ITALIAN), win: 'same', fork: false, no: 0 },
    { rule: 'identical, both finished alike', a: L(QUEENS, { end: AGREED }), b: L(QUEENS, { end: AGREED }), win: 'same', fork: false, no: 0 },
    { rule: '2: higher epoch wins though shorter', a: L(ITALIAN.slice(0, 3), { epoch: 1 }), b: L(ITALIAN), win: 'a', fork: false, no: 2 },
    { rule: '2: higher epoch wins though unfinished', a: L(ITALIAN, { end: RESIGN_W }), b: L(ITALIAN.slice(0, 2), { epoch: 3 }), win: 'b', fork: false, no: 2 },
    { rule: '2: higher epoch wins though different', a: L(QUEENS, { epoch: 2 }), b: L(ITALIAN, { epoch: 1 }), win: 'a', fork: false, no: 2 },
    { rule: '3: longer prefix wins', a: L(ITALIAN.slice(0, 5)), b: L(ITALIAN), win: 'b', fork: false, no: 3 },
    { rule: '3: longer prefix wins (other side)', a: L(ITALIAN), b: L(ITALIAN.slice(0, 1)), win: 'a', fork: false, no: 3 },
    { rule: '3: longer finished prefix wins', a: L(ITALIAN.slice(0, 2)), b: L(ITALIAN, { end: RESIGN_B }), win: 'b', fork: false, no: 3 },
    { rule: '3: from the empty log', a: L([]), b: L(['e2e4']), win: 'b', fork: false, no: 3 },
    { rule: '4: equal length, different moves', a: L(QUEENS), b: L(ITALIAN.slice(0, 4)), win: 'a', fork: true, no: 4 },
    { rule: '4: equal length, different times', a: L(QUEENS), b: L(QUEENS, { ms: [5, 5, 5, 5] }), win: 'a', fork: true, no: 4 },
    { rule: '4: different lengths, not a prefix', a: L(QUEENS.slice(0, 2)), b: L(ITALIAN), win: 'a', fork: true, no: 4 },
    { rule: '4: both finished, different ends', a: L(QUEENS, { end: RESIGN_W }), b: L(QUEENS, { end: AGREED }), win: 'a', fork: true, no: 4 },
    { rule: '4: both finished, different lengths', a: L(QUEENS.slice(0, 3), { end: RESIGN_B }), b: L(QUEENS, { end: AGREED }), win: 'a', fork: true, no: 4 },
    { rule: '4: different colors', a: L(QUEENS, { white: 0 }), b: L(QUEENS, { white: 1 }), win: 'a', fork: true, no: 4 },
    { rule: '4: different time control', a: L(QUEENS, { tc: '5+0' }), b: L(QUEENS, { tc: '3+2' }), win: 'a', fork: true, no: 4 },
    { rule: '5: finished beats unfinished, same length', a: L(QUEENS), b: L(QUEENS, { end: RESIGN_W }), win: 'b', fork: false, no: 5 },
    { rule: '5: finished beats a longer unfinished continuation', a: L(QUEENS.slice(0, 2), { end: AGREED }), b: L(QUEENS), win: 'a', fork: false, no: 5 },
  ];

  it.each(rows)('$rule', ({ a, b, win, fork, no }) => {
    // From seat 0 (a) and from seat 1 (b): the verdicts mirror each other.
    const fromA = compareLogs(a, b, 0);
    const fromB = compareLogs(b, a, 1);
    const map = { a: 'local', b: 'remote', same: 'same' } as const;
    const mirror = { a: 'remote', b: 'local', same: 'same' } as const;
    expect(fromA).toEqual({ winner: map[win], fork, rule: no });
    expect(fromB).toEqual({ winner: mirror[win], fork, rule: no });
    if (!fork) {
      // Without a fork the seats do not matter.
      expect(compareLogs(a, b, 1).winner).toBe(map[win]);
    } else {
      // In a fork seat 0's copy wins, whoever holds which copy.
      expect(compareLogs(a, b, 1)).toEqual({ winner: 'remote', fork: true, rule: 4 });
      expect(compareLogs(b, a, 0)).toEqual({ winner: 'local', fork: true, rule: 4 });
    }
  });

  it('commonPrefix compares moves and times', () => {
    expect(commonPrefix(L(ITALIAN).plies, L(ITALIAN.slice(0, 3)).plies)).toBe(3);
    expect(commonPrefix(L(QUEENS).plies, L(ITALIAN).plies)).toBe(0);
    expect(commonPrefix(L(QUEENS).plies, L(QUEENS, { ms: [1000, 1001, 9, 9] }).plies)).toBe(2);
  });
});

/* ---------------------------------------------------------------------------------------------- */
/* reconcile with a head                                                                            */
/* ---------------------------------------------------------------------------------------------- */

describe('reconcile with a head (DESIGN 9.4)', () => {
  const g = (moves: string[], o: Parameters<typeof log>[2] = {}, n = 1) => log(n, moves, o);
  type Row = {
    rule: string;
    local: GameLog[];
    remote: GameLog | undefined;
    seat: Seat;
    status: string;
    /** Game numbers sent, or undefined for none. */
    send?: number[];
  };
  const rows: Row[] = [
    { rule: 'both empty (no game yet)', local: [], remote: undefined, seat: 0, status: 'in-sync' },
    { rule: 'identical', local: [g(ITALIAN)], remote: g(ITALIAN), seat: 1, status: 'in-sync' },
    { rule: '1: remote has a higher n', local: room(g(QUEENS, {}, 2)), remote: g([], {}, 3), seat: 0, status: 'behind' },
    { rule: '1: local has a higher n, sends from the remote n on', local: room(g(QUEENS, {}, 4)), remote: g(['e2e4'], {}, 2), seat: 1, status: 'ahead', send: [2, 3, 4] },
    { rule: '1: remote has nothing (newcomer head)', local: room(g(QUEENS, {}, 3)), remote: undefined, seat: 0, status: 'ahead', send: [1, 2, 3] },
    { rule: '1: local has nothing', local: [], remote: g(QUEENS), seat: 1, status: 'behind' },
    { rule: '2: remote epoch higher', local: [g(ITALIAN)], remote: g(ITALIAN.slice(0, 2), { epoch: 1 }), seat: 0, status: 'behind' },
    { rule: '2: local epoch higher', local: [g(ITALIAN.slice(0, 2), { epoch: 1 })], remote: g(ITALIAN), seat: 1, status: 'ahead', send: [1] },
    { rule: '3: local longer, remote a prefix', local: [g(ITALIAN)], remote: g(ITALIAN.slice(0, 7)), seat: 1, status: 'ahead', send: [1] },
    { rule: '3: local shorter (seat 0 waits)', local: [g(ITALIAN.slice(0, 7))], remote: g(ITALIAN), seat: 0, status: 'behind' },
    { rule: '3: local shorter (seat 1 also sends, to expose a fork)', local: [g(ITALIAN.slice(0, 7))], remote: g(ITALIAN), seat: 1, status: 'behind', send: [1] },
    { rule: '4: equal length, different plies (seat 0)', local: [g(QUEENS)], remote: g(ITALIAN.slice(0, 4)), seat: 0, status: 'fork', send: [1] },
    { rule: '4: equal length, different plies (seat 1)', local: [g(QUEENS)], remote: g(ITALIAN.slice(0, 4)), seat: 1, status: 'fork', send: [1] },
    { rule: '4: local longer, not a prefix', local: [g(ITALIAN)], remote: g(QUEENS), seat: 1, status: 'fork', send: [1] },
    { rule: '4: same plies, different ends', local: [g(QUEENS, { end: RESIGN_W })], remote: g(QUEENS, { end: AGREED }), seat: 0, status: 'fork', send: [1] },
    { rule: '4: local longer finished, remote shorter finished', local: [g(QUEENS, { end: AGREED })], remote: g(QUEENS.slice(0, 2), { end: AGREED }), seat: 1, status: 'fork', send: [1] },
    { rule: '4: local shorter finished, remote longer finished', local: [g(QUEENS.slice(0, 2), { end: AGREED })], remote: g(QUEENS, { end: AGREED }), seat: 0, status: 'fork', send: [1] },
    { rule: '5: local finished, remote not, same length', local: [g(QUEENS, { end: RESIGN_B })], remote: g(QUEENS), seat: 1, status: 'ahead', send: [1] },
    { rule: '5: remote finished, local not, same length', local: [g(QUEENS)], remote: g(QUEENS, { end: RESIGN_B }), seat: 0, status: 'behind' },
    { rule: '5: local finished prefix, remote longer unfinished', local: [g(QUEENS.slice(0, 2), { end: RESIGN_W })], remote: g(QUEENS), seat: 1, status: 'ahead', send: [1] },
    { rule: '5: remote finished prefix, local longer unfinished', local: [g(QUEENS)], remote: g(QUEENS.slice(0, 2), { end: RESIGN_W }), seat: 0, status: 'behind' },
  ];

  it.each(rows)('$rule', ({ local, remote, seat, status, send }) => {
    const r = reconcile(local, wire(makeHead(remote)), seat);
    expect(r.status).toBe(status);
    expect(r.forked).toBe(false); // a head never reports a fork
    expect(r.adopt).toBeUndefined(); // nothing is adopted from a head
    expect(r.send?.map((l) => l.n)).toEqual(send);
  });

  it.each([
    ['a negative n', { n: -1 }],
    ['a fractional len', { len: 1.5 }],
    ['a missing hash', { hash: undefined }],
    ['a non-boolean ended', { ended: 'yes' }],
  ])('rejects a head with %s', (_label, change) => {
    const head = { ...makeHead(g(ITALIAN)), ...change } as unknown as HeadMsg;
    expect(reconcile([g(ITALIAN)], head, 0)).toEqual({ status: 'invalid', forked: false, error: 'bad head' });
  });

  it('accepts a head with turnMs and ignores it for the decision', () => {
    const r = reconcile([g(ITALIAN)], { ...makeHead(g(ITALIAN)), turnMs: 5000 }, 0);
    expect(r.status).toBe('in-sync');
  });
});

/* ---------------------------------------------------------------------------------------------- */
/* reconcile with logs                                                                              */
/* ---------------------------------------------------------------------------------------------- */

describe('reconcile with logs', () => {
  it('adopts the winning copy, validated and normalized', () => {
    const local = [log(1, ITALIAN.slice(0, 3))];
    const remote = wire(makeLogs([log(1, ITALIAN)]));
    const r = reconcile(local, remote, 1);
    expect(r).toMatchObject({ status: 'behind', forked: false, rule: 3 });
    expect(r.adopt).toEqual([log(1, ITALIAN)]);
    expect(r.send).toBeUndefined();
  });

  it('accepts a plain list of games as from a grant', () => {
    const games = room(log(3, QUEENS));
    const r = reconcile([], wire(games), 1);
    expect(r.status).toBe('behind');
    expect(r.adopt?.map((l) => l.n)).toEqual([1, 2, 3]);
  });

  it('sends its own copy back when it wins', () => {
    const r = reconcile([log(1, ITALIAN)], makeLogs([log(1, ITALIAN.slice(0, 2))]), 0);
    expect(r).toMatchObject({ status: 'ahead', forked: false });
    expect(r.send).toEqual([log(1, ITALIAN)]);
    expect(r.adopt).toBeUndefined();
  });

  it('does nothing for an identical copy', () => {
    const r = reconcile([log(1, ITALIAN)], makeLogs([log(1, ITALIAN)]), 0);
    expect(r).toEqual({ status: 'in-sync', forked: false, rule: 0 });
  });

  it('reports a fork on seat 0 (keeps its copy, sends it) and on seat 1 (adopts)', () => {
    const r0 = reconcile([log(1, QUEENS)], makeLogs([log(1, ITALIAN.slice(0, 4))]), 0);
    expect(r0).toMatchObject({ status: 'ahead', forked: true, rule: 4, send: [log(1, QUEENS)] });
    expect(r0.adopt).toBeUndefined();
    const r1 = reconcile([log(1, ITALIAN.slice(0, 4))], makeLogs([log(1, QUEENS)]), 1);
    expect(r1).toMatchObject({ status: 'behind', forked: true, rule: 4, adopt: [log(1, QUEENS)] });
    expect(r1.send).toBeUndefined();
  });

  it('aborts on an illegal ply and adopts nothing (rule 3)', () => {
    const bad = { ...log(1, ITALIAN), plies: [...log(1, ITALIAN).plies, { m: 'a1a8', ms: 0 }] };
    const r = reconcile([log(1, ITALIAN.slice(0, 2))], makeLogs([bad]), 1);
    expect(r.status).toBe('invalid');
    expect(r.error).toMatch(/game 1: illegal ply 8/);
    expect(r.adopt).toBeUndefined();
    expect(r.send).toBeUndefined();
  });

  it('aborts on one invalid game among several', () => {
    const games = [log(1, ITALIAN, { end: RESIGN_B }), { ...log(2, []), white: 7 } as unknown as GameLog];
    expect(reconcile([], makeLogs(games), 1).status).toBe('invalid');
    expect(reconcile([], { t: 'logs', v: 1, games: 'x' } as unknown as GameLog[], 1).status).toBe('invalid');
  });

  it('compares older games one by one and adopts or sends each', () => {
    const local = [log(1, ITALIAN.slice(0, 4), { end: RESIGN_B }), log(2, QUEENS.slice(0, 2), { end: RESIGN_W }), log(3, ['e2e4'])];
    const remote = [log(1, ITALIAN.slice(0, 2), { end: RESIGN_B }), log(2, QUEENS.slice(0, 2), { end: RESIGN_W }), log(3, ['e2e4', 'e7e5'])];
    // Game 1: both finished, different lengths: a fork that seat 0 (remote here) wins.
    const r = reconcile(local, makeLogs(remote), 1);
    expect(r.adopt?.map((l) => l.n)).toEqual([1, 3]);
    expect(r.forked).toBe(true);
    expect(r.status).toBe('behind');
    const r0 = reconcile(local, makeLogs(remote), 0);
    expect(r0.adopt?.map((l) => l.n)).toEqual([3]);
    expect(r0.send?.map((l) => l.n)).toEqual([1]);
    expect(r0.status).toBe('behind'); // the current game decides the status
  });

  it('sends the games the other side is missing when it is behind on n', () => {
    const local = room(log(3, ['e2e4']));
    const r = reconcile(local, makeLogs([log(2, ITALIAN.slice(0, 4), { end: RESIGN_B })]), 1);
    expect(r.status).toBe('ahead');
    expect(r.rule).toBe(1);
    expect(r.send?.map((l) => l.n)).toEqual([3]); // game 2 was the same, game 3 is missing
    const r2 = reconcile(local, makeLogs([]), 1);
    expect(r2.send?.map((l) => l.n)).toEqual([1, 2, 3]);
  });

  it('mergeLogs replaces by game number', () => {
    const merged = mergeLogs([log(1, []), log(2, ['e2e4'])], [log(2, ['e2e4', 'e7e5']), log(3, [])]);
    expect(merged.map((l) => [l.n, l.plies.length])).toEqual([[1, 0], [2, 2], [3, 0]]);
  });
});

/* ---------------------------------------------------------------------------------------------- */
/* The whole exchange: every row of 9.4 and every recovery case of 9.5                              */
/* ---------------------------------------------------------------------------------------------- */

describe('two devices reconcile (DESIGN 9.4, 9.5)', () => {
  type Case = {
    name: string;
    a: GameLog[]; // seat 0
    b: GameLog[]; // seat 1
    /** The logs both must end with. */
    expect: GameLog[];
    /** Whether both show the fork toast (exactly once each). */
    fork?: boolean;
  };
  const finished = (n: number, end: GameEnd = RESIGN_B) => log(n, ITALIAN.slice(0, 4), { end });

  const cases: Case[] = [
    // 9.5: both devices have the room.
    { name: 'both have the room, in sync', a: room(log(2, QUEENS)), b: room(log(2, QUEENS)), expect: room(log(2, QUEENS)) },
    // 9.4 rule 1 / 9.5 older state: the behind side receives the finished games it missed and the current one.
    {
      name: 'rule 1: one device is several games behind (restored backup)',
      a: [finished(1), finished(2), finished(3, AGREED), log(4, QUEENS)],
      b: [finished(1), log(2, ['e2e4'])],
      expect: [finished(1), finished(2), finished(3, AGREED), log(4, QUEENS)],
    },
    {
      name: 'rule 1: seat 1 is ahead',
      a: [log(1, ['e2e4'])],
      b: [finished(1), log(2, QUEENS)],
      expect: [finished(1), log(2, QUEENS)],
    },
    // 9.5: one device lost everything (its head has n = 0).
    {
      name: 'one device lost everything (seat 1 lost)',
      a: room(log(3, ITALIAN)),
      b: [],
      expect: room(log(3, ITALIAN)),
    },
    {
      name: 'one device lost everything (seat 0 lost)',
      a: [],
      b: room(log(2, QUEENS, { end: AGREED })),
      expect: room(log(2, QUEENS, { end: AGREED })),
    },
    // 9.5: both lost the room / neither has a game yet.
    { name: 'neither has a game', a: [], b: [], expect: [] },
    {
      name: 'neither has the next game yet (both at a finished game)',
      a: room(log(2, QUEENS, { end: RESIGN_W })),
      b: room(log(2, QUEENS, { end: RESIGN_W })),
      expect: room(log(2, QUEENS, { end: RESIGN_W })),
    },
    {
      name: 'one side has the finished game, the other the same game unfinished (rule 5)',
      a: [log(1, QUEENS)],
      b: [log(1, QUEENS, { end: RESIGN_W })],
      expect: [log(1, QUEENS, { end: RESIGN_W })],
    },
    // 9.4 rule 2 / stale epochs.
    {
      name: 'rule 2: stale epoch with more plies loses to the takeback',
      a: [log(1, ITALIAN, { epoch: 0 })],
      b: [log(1, ITALIAN.slice(0, 5), { epoch: 1 })],
      expect: [log(1, ITALIAN.slice(0, 5), { epoch: 1 })],
    },
    {
      name: 'rule 2: stale epoch, finished, loses to the newer epoch',
      a: [log(2, ITALIAN.slice(0, 2), { epoch: 3 })],
      b: [finished(1), log(2, ITALIAN, { epoch: 2, end: RESIGN_W })],
      expect: [log(2, ITALIAN.slice(0, 2), { epoch: 3 })],
    },
    // 9.4 rule 3: offline move delivered.
    {
      name: 'rule 3: an offline move reaches seat 0',
      a: [log(1, ITALIAN.slice(0, 6))],
      b: [log(1, ITALIAN.slice(0, 7))],
      expect: [log(1, ITALIAN.slice(0, 7))],
    },
    {
      name: 'rule 3: an offline move reaches seat 1',
      a: [log(1, ITALIAN.slice(0, 7))],
      b: [log(1, ITALIAN.slice(0, 6))],
      expect: [log(1, ITALIAN.slice(0, 7))],
    },
    {
      name: 'rule 3: a finished longer log reaches the other side',
      a: [log(1, SCHOLAR.slice(0, 5))],
      b: [log(1, SCHOLAR)],
      expect: [log(1, SCHOLAR)],
    },
    // 9.4 rule 4: forks.
    { name: 'rule 4: equal length fork', a: [log(1, QUEENS)], b: [log(1, ITALIAN.slice(0, 4))], expect: [log(1, QUEENS)], fork: true },
    { name: 'rule 4: seat 0 longer, not a prefix', a: [log(1, ITALIAN)], b: [log(1, QUEENS)], expect: [log(1, ITALIAN)], fork: true },
    { name: 'rule 4: seat 1 longer, not a prefix', a: [log(1, QUEENS)], b: [log(1, ITALIAN)], expect: [log(1, QUEENS)], fork: true },
    { name: 'rule 4: different times only', a: [log(1, QUEENS)], b: [log(1, QUEENS, { ms: [1, 2, 3, 4] })], expect: [log(1, QUEENS)], fork: true },
    {
      name: 'rule 4: both finished with different ends',
      a: [log(1, QUEENS, { end: AGREED })],
      b: [log(1, QUEENS, { end: RESIGN_B })],
      expect: [log(1, QUEENS, { end: AGREED })],
      fork: true,
    },
    {
      name: 'rule 4: both finished at different lengths (seat 0 shorter)',
      a: [log(1, QUEENS.slice(0, 2), { end: RESIGN_W })],
      b: [log(1, QUEENS, { end: AGREED })],
      expect: [log(1, QUEENS.slice(0, 2), { end: RESIGN_W })],
      fork: true,
    },
    {
      name: 'rule 4: both finished at different lengths (seat 1 shorter)',
      a: [log(1, QUEENS, { end: AGREED })],
      b: [log(1, QUEENS.slice(0, 2), { end: RESIGN_W })],
      expect: [log(1, QUEENS, { end: AGREED })],
      fork: true,
    },
    {
      name: 'rule 4: seat 1 finished shorter, seat 0 longer different',
      a: [log(1, ITALIAN)],
      b: [log(1, QUEENS.slice(0, 2), { end: RESIGN_W })],
      expect: [log(1, ITALIAN)],
      fork: true,
    },
    // 9.4 rule 5.
    { name: 'rule 5: finished beats unfinished (seat 0 finished)', a: [log(1, QUEENS, { end: AGREED })], b: [log(1, QUEENS)], expect: [log(1, QUEENS, { end: AGREED })] },
    { name: 'rule 5: finished beats unfinished (seat 1 finished)', a: [log(1, QUEENS)], b: [log(1, QUEENS, { end: RESIGN_B })], expect: [log(1, QUEENS, { end: RESIGN_B })] },
    {
      name: 'rule 5: an offline resignation beats a crossing offline move (seat 1 resigned)',
      a: [log(1, QUEENS.slice(0, 3))],
      b: [log(1, QUEENS.slice(0, 2), { end: RESIGN_B })],
      expect: [log(1, QUEENS.slice(0, 2), { end: RESIGN_B })],
    },
    {
      name: 'rule 5: an offline resignation beats a crossing offline move (seat 0 resigned)',
      a: [log(1, QUEENS.slice(0, 2), { end: RESIGN_W })],
      b: [log(1, QUEENS.slice(0, 3))],
      expect: [log(1, QUEENS.slice(0, 2), { end: RESIGN_W })],
    },
  ];

  for (const c of cases) {
    it.each(ORDERS.map((o) => [o]))(`${c.name} (order %s)`, (order) => {
      const r = simulate({ seat: 0, logs: c.a }, { seat: 1, logs: c.b }, order);
      // Only the games from the behind side's current one on are exchanged, so compare from there.
      const want = sortLogs(c.expect);
      const fromN = Math.min(currentLog(c.a)?.n ?? 0, currentLog(c.b)?.n ?? 0);
      const tail = (ls: GameLog[]) => ls.filter((l) => l.n >= fromN);
      expect(currentLog(r.a.logs)).toEqual(currentLog(want));
      expect(currentLog(r.b.logs)).toEqual(currentLog(want));
      expect(tail(r.a.logs)).toEqual(tail(want));
      expect(tail(r.b.logs)).toEqual(tail(want));
      expect(r.a.toasts).toBe(c.fork ? 1 : 0);
      expect(r.b.toasts).toBe(c.fork ? 1 : 0);
      expect(r.a.errors + r.b.errors).toBe(0);
      expect(r.messages).toBeLessThanOrEqual(6);
      // A second connection finds both in sync at once.
      const again = simulate({ seat: 0, logs: r.a.logs }, { seat: 1, logs: r.b.logs }, order);
      expect(again.messages).toBe(2);
      expect(again.a.adopted + again.b.adopted).toBe(0);
    });
  }

  it('a device that lost everything is fully restored, finished games included', () => {
    const survivor = [finished(1), finished(2, AGREED), log(3, ITALIAN.slice(0, 5))];
    const r = simulate({ seat: 0, logs: survivor }, { seat: 1, logs: [] });
    expect(r.b.logs).toEqual(survivor);
    expect(roomScore(r.b.logs)).toEqual(roomScore(survivor));
  });

  it('an invalid log from corrupt storage aborts the sync on the receiving side only', () => {
    const corrupt = { ...log(1, ITALIAN), plies: [...log(1, ITALIAN).plies, { m: 'h1h8', ms: 0 }] };
    const r = simulate({ seat: 0, logs: [corrupt] }, { seat: 1, logs: [log(1, ITALIAN.slice(0, 3))] });
    expect(r.b.errors).toBeGreaterThan(0);
    expect(r.b.logs).toEqual([log(1, ITALIAN.slice(0, 3))]);
  });

  it('settles random copies of the current game in every order (property check)', () => {
    const rng = seeded(42);
    const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)];
    const lines = [ITALIAN, QUEENS, SCHOLAR, ['e2e4', 'c7c5', 'g1f3', 'd7d6']];
    const ends: (GameEnd | undefined)[] = [undefined, undefined, RESIGN_W, RESIGN_B, AGREED];
    const randomLog = (n: number): GameLog => {
      const line = pick(lines);
      const k = Math.floor(rng() * (line.length + 1));
      const moves = line.slice(0, k);
      const end = line === SCHOLAR && k === SCHOLAR.length ? undefined : pick(ends);
      return log(n, moves, { epoch: Math.floor(rng() * 2), end, ms: moves.map(() => (rng() < 0.9 ? 7 : 8)) });
    };
    let forks = 0;
    for (let t = 0; t < 300; t++) {
      const n = 1 + Math.floor(rng() * 3);
      const shared = Array.from({ length: n - 1 }, (_, i) => finished(i + 1));
      const a = [...shared, randomLog(n)];
      const b = [...shared, randomLog(n)];
      const r = simulate({ seat: 0, logs: a }, { seat: 1, logs: b }, t);
      expect(r.a.logs).toEqual(r.b.logs);
      // The survivor is one of the two copies, and it is the winner by compareLogs.
      const winner = compareLogs(a[n - 1], b[n - 1], 0).winner === 'remote' ? b[n - 1] : a[n - 1];
      expect(currentLog(r.a.logs)).toEqual(winner);
      expect(r.a.toasts).toBe(r.b.toasts);
      expect(r.a.toasts).toBe(compareLogs(a[n - 1], b[n - 1], 0).fork ? 1 : 0);
      forks += r.a.toasts;
      expect(r.a.errors + r.b.errors).toBe(0);
      expect(r.messages).toBeLessThanOrEqual(6);
      const again = simulate({ seat: 0, logs: r.a.logs }, { seat: 1, logs: r.b.logs }, t);
      expect(again.messages).toBe(2);
    }
    expect(forks).toBeGreaterThan(10); // the generator does produce forks
  });
});

/* ---------------------------------------------------------------------------------------------- */
/* Live play                                                                                        */
/* ---------------------------------------------------------------------------------------------- */

describe('live play on a log', () => {
  const msg = (n: number, epoch: number, i: number, m: string, ms = 500) => ({ n, epoch, i, m, ms });

  it('applies the next ply and acks duplicates', () => {
    const l = log(1, ITALIAN.slice(0, 2), { epoch: 1 });
    const r = applyMoveMsg(l, msg(1, 1, 2, 'g1f3', 812.7));
    expect(r.kind).toBe('applied');
    if (r.kind !== 'applied') return;
    expect(r.log.plies[2]).toEqual({ m: 'g1f3', ms: 813 });
    expect(r.log.epoch).toBe(1);
    expect(l.plies).toHaveLength(2); // not mutated
    expect(applyMoveMsg(r.log, msg(1, 1, 2, 'g1f3', 813)).kind).toBe('duplicate');
    expect(applyMoveMsg(r.log, msg(1, 1, 0, 'e2e4', 1000)).kind).toBe('duplicate');
  });

  it('matches a resent letterless promotion as a duplicate', () => {
    const promo = ['h2h4', 'g7g5', 'h4g5', 'h7h6', 'g5h6', 'g8f6', 'h6h7', 'f6g8', 'h7g8'];
    const l = log(1, promo, { ms: promo.map(() => 0) });
    expect(applyMoveMsg(l, msg(1, 0, 8, 'h7g8', 0)).kind).toBe('duplicate');
  });

  it.each([
    ['older game', msg(0, 0, 2, 'g1f3'), 'stale'],
    ['older epoch', msg(1, 0, 2, 'g1f3'), 'stale'],
    ['newer game', msg(2, 0, 0, 'e2e4'), 'gap'],
    ['newer epoch', msg(1, 2, 2, 'g1f3'), 'gap'],
    ['skipped ply', msg(1, 1, 3, 'b8c6'), 'gap'],
    ['different ply at an index', msg(1, 1, 1, 'c7c5'), 'conflict'],
    ['illegal move', msg(1, 1, 2, 'e1e3'), 'conflict'],
    ['bad UCI', msg(1, 1, 2, 'Nf3'), 'conflict'],
    ['negative index', msg(1, 1, -1, 'g1f3'), 'conflict'],
  ])('%s → %s', (_label, m, kind) => {
    expect(applyMoveMsg(log(1, ITALIAN.slice(0, 2), { epoch: 1 }), m).kind).toBe(kind);
  });

  it('refuses a ply after the end', () => {
    const l = log(1, ITALIAN.slice(0, 2), { end: RESIGN_W });
    expect(applyMoveMsg(l, msg(1, 0, 2, 'g1f3'))).toMatchObject({ kind: 'conflict' });
    expect(() => appendPly(l, 'g1f3', 0)).toThrow();
  });

  it('appendPly detects mate', () => {
    const l = appendPly(log(1, SCHOLAR.slice(0, 6)), 'h5f7', 300);
    expect(l.end).toEqual({ result: '1-0', by: 'mate' });
    expect(l.plies.at(-1)).toEqual({ m: 'h5f7', ms: 300 });
  });

  it('endLog ends once', () => {
    const l = endLog(log(1, QUEENS), RESIGN_W);
    expect(l.end).toEqual(RESIGN_W);
    expect(endLog(l, AGREED)).toBe(l);
  });

  it('turn and seat to move follow the colors of the game', () => {
    const l = log(2, ['e2e4'], { white: 1 });
    expect(turnOf(l)).toBe('b');
    expect(seatToMove(l)).toBe(0);
    expect(colorOf(l, 1)).toBe('w');
    expect(seatOf(l, 'b')).toBe(0);
  });

  describe('takebackLog (DESIGN 9.7)', () => {
    it.each([
      ['white takes back its last move, black has not replied', ['e2e4'], 0, 0],
      ['white takes back after black replied', ['e2e4', 'e7e5'], 0, 0],
      ['black takes back its last move', ['e2e4', 'e7e5'], 1, 1],
      ['black takes back after white replied', ['e2e4', 'e7e5', 'g1f3'], 1, 1],
      ['white, deeper in the game', ITALIAN.slice(0, 7), 0, 6],
    ] as const)('%s', (_label, moves, seat, len) => {
      const l = log(1, [...moves], { white: 0, epoch: 2 });
      const t = takebackLog(l, seat);
      expect(t?.plies).toEqual(l.plies.slice(0, len));
      expect(t?.epoch).toBe(3);
      expect(t?.n).toBe(1);
    });

    it('works with swapped colors', () => {
      const l = log(2, ['e2e4', 'e7e5'], { white: 1 });
      expect(takebackLog(l, 1)?.plies).toHaveLength(0);
      expect(takebackLog(l, 0)?.plies).toHaveLength(1);
    });

    it('is null without an own move or after the end', () => {
      expect(takebackLog(log(1, ['e2e4'], { white: 0 }), 1)).toBeNull();
      expect(takebackLog(log(1, []), 0)).toBeNull();
      expect(takebackLog(log(1, QUEENS, { end: AGREED }), 0)).toBeNull();
    });

    it('wins the next reconcile over the stale longer copy', () => {
      const before = log(1, ITALIAN.slice(0, 5));
      const after = takebackLog(before, 0)!;
      expect(compareLogs(before, after, 0).winner).toBe('remote');
    });
  });

  it('rematch swaps colors and keeps the time control', () => {
    const g1 = log(1, QUEENS, { white: 0, tc: '5+3', end: AGREED });
    const g2 = rematchLog(g1);
    expect(g2).toEqual({ n: 2, epoch: 0, plies: [], white: 1, tc: '5+3' });
    expect(rematchLog(g2).white).toBe(0);
    expect(newLog(1, 1, null)).toEqual({ n: 1, epoch: 0, plies: [], white: 1, tc: null });
    expect([1, 2, 3, 4].map((n) => whiteOfGame(n, 1))).toEqual([1, 0, 1, 0]);
  });
});

/* ---------------------------------------------------------------------------------------------- */
/* Score                                                                                            */
/* ---------------------------------------------------------------------------------------------- */

describe('room score', () => {
  it.each([
    ['white wins, seat 0 white', 0, '1-0', [2, 0]],
    ['white wins, seat 1 white', 1, '1-0', [0, 2]],
    ['black wins, seat 0 white', 0, '0-1', [0, 2]],
    ['black wins, seat 1 white', 1, '0-1', [2, 0]],
    ['draw', 0, '1/2-1/2', [1, 1]],
  ] as const)('%s', (_label, white, result, points) => {
    const by = result === '1/2-1/2' ? 'agreed' : 'resign';
    expect(gamePoints({ white, end: { result, by } })).toEqual(points);
  });

  it('counts nothing for an unfinished game', () => {
    expect(gamePoints({ white: 0 })).toEqual([0, 0]);
  });

  it('adds up across rematches with alternating colors', () => {
    // Game 1: seat 0 white wins. Game 2: seat 1 white wins. Game 3: draw. Game 4: seat 0 (black) wins. Game 5 running.
    const games = [
      log(1, QUEENS, { white: 0, end: RESIGN_B }),
      log(2, QUEENS, { white: 1, end: RESIGN_B }),
      log(3, QUEENS, { white: 0, end: AGREED }),
      log(4, QUEENS, { white: 1, end: RESIGN_W }),
      log(5, ['e2e4'], { white: 0 }),
    ];
    expect(roomScore(games)).toEqual([5, 3]);
    expect(scoreView(roomScore(games), 0)).toEqual([2.5, 1.5]);
    expect(scoreView(roomScore(games), 1)).toEqual([1.5, 2.5]);
    expect(roomScore([])).toEqual([0, 0]);
  });

  it('counts a mate and a time loss', () => {
    expect(roomScore([log(1, SCHOLAR, { white: 1 }), log(2, ['e2e4'], { white: 0, end: { result: '0-1', by: 'time' } })])).toEqual([0, 4]);
  });
});

/* ---------------------------------------------------------------------------------------------- */
/* base64url and the seat key                                                                       */
/* ---------------------------------------------------------------------------------------------- */

describe('base64url', () => {
  it('round-trips every length', () => {
    const rng = seeded(7);
    for (let n = 0; n < 40; n++) {
      const bytes = randomBytes(n, rng);
      const s = toBase64Url(bytes);
      expect(s).toMatch(/^[A-Za-z0-9_-]*$/);
      expect(s.length).toBe(Math.ceil((n * 4) / 3));
      expect([...fromBase64Url(s)]).toEqual([...bytes]);
    }
  });

  it('matches the standard encoding', () => {
    const bytes = new Uint8Array([0xfb, 0xff, 0xbf, 0x00, 0x10]);
    expect(toBase64Url(bytes)).toBe('-_-_ABA');
    expect([...fromBase64Url('-_-_ABA=')]).toEqual([...bytes]);
    expect(toBase64Url(new TextEncoder().encode('Zhess'))).toBe('Wmhlc3M');
  });

  it('rejects bad input', () => {
    expect(() => fromBase64Url('ab+c')).toThrow();
    expect(() => fromBase64Url('abcde')).toThrow();
  });
});

describe('seat key and proof (DESIGN 9.3)', () => {
  const CODE = 'K7QW2M';

  it('randomBytes uses the injected rng deterministically, or WebCrypto', () => {
    expect([...randomBytes(4, () => 0)]).toEqual([0, 0, 0, 0]);
    expect([...randomBytes(3, () => 0.999999)]).toEqual([255, 255, 255]);
    expect([...randomBytes(8, seeded(1))]).toEqual([...randomBytes(8, seeded(1))]);
    const a = randomBytes(16);
    const b = randomBytes(16);
    expect(a).toHaveLength(16);
    expect([...a]).not.toEqual([...b]);
  });

  it('generates 128-bit keys and nonces in base64url', () => {
    const key = generateKey(seeded(3));
    expect(key).toHaveLength(22);
    expect(isValidKey(key)).toBe(true);
    expect(generateKey(seeded(3))).toBe(key);
    expect(generateKey()).not.toBe(generateKey());
    expect(fromBase64Url(generateNonce(seeded(4)))).toHaveLength(16);
    expect(generateNonce(seeded(4))).not.toBe(generateNonce(seeded(5)));
  });

  it.each([
    ['too short', 'AAAA'],
    ['too long', 'A'.repeat(23)],
    ['bad characters', '+'.repeat(22)],
    ['not a string', 42],
  ])('isValidKey rejects %s', (_label, k) => {
    expect(isValidKey(k)).toBe(false);
  });

  it('a proof verifies with the same key, nonce, code and seat', async () => {
    const key = generateKey(seeded(10));
    const nonce = generateNonce(seeded(11));
    const mac = await proveSeat(key, nonce, CODE, 1);
    expect(fromBase64Url(mac)).toHaveLength(32);
    expect(await verifySeat(key, nonce, CODE, 1, mac)).toBe(true);
    expect(await proveSeat(key, nonce, CODE, 1)).toBe(mac); // deterministic
  });

  it('is HMAC-SHA-256 over nonce ‖ code ‖ seat (known answer)', async () => {
    const keyBytes = new Uint8Array(16).map((_, i) => i);
    const nonceBytes = new Uint8Array(16).map((_, i) => 0xa0 + i);
    const key = toBase64Url(keyBytes);
    const nonce = toBase64Url(nonceBytes);
    const msg = new Uint8Array([...nonceBytes, ...new TextEncoder().encode(CODE), 0]);
    expect([...proofMessage(nonce, CODE, 0)]).toEqual([...msg]);
    const k = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const want = toBase64Url(new Uint8Array(await crypto.subtle.sign('HMAC', k, msg)));
    const mac = await proveSeat(key, nonce, CODE, 0);
    expect(mac).toBe(want);
    // Pinned: a change here breaks the protocol between versions.
    expect(mac).toMatchInlineSnapshot(`"bOWZjYm7kM4rs3l3bsCzuq1xnAkllDiMj9d9ttE2XG8"`);
  });

  it.each([
    ['another key', { key: 1 }],
    ['another nonce', { nonce: 1 }],
    ['another code', { code: 'K7QW2N' }],
    ['the other seat', { seat: 0 as Seat }],
  ])('fails with %s', async (_label, change) => {
    const key = generateKey(seeded(20));
    const nonce = generateNonce(seeded(21));
    const mac = await proveSeat(key, nonce, CODE, 1);
    const k2 = 'key' in change ? generateKey(seeded(22)) : key;
    const n2 = 'nonce' in change ? generateNonce(seeded(23)) : nonce;
    const c2 = 'code' in change ? (change.code as string) : CODE;
    const s2 = 'seat' in change ? (change.seat as Seat) : 1;
    expect(await verifySeat(k2, n2, c2, s2, mac)).toBe(false);
  });

  it('a stranger cannot reflect a device its own proof', async () => {
    // Seat 0 sends nonce N; the stranger answers hello with the same N, receives seat 0's proof of
    // N and sends it back as its own. Seat 0 expects a proof from seat 1, so it fails.
    const key = generateKey(seeded(30));
    const n = generateNonce(seeded(31));
    const reflected = await proveSeat(key, n, CODE, 0);
    expect(await verifySeat(key, n, CODE, 1, reflected)).toBe(false);
  });

  it.each([
    ['an empty mac', ''],
    ['a short mac', 'AAAA'],
    ['a non-base64 mac', '!!!'],
  ])('verifySeat is false for %s', async (_label, mac) => {
    expect(await verifySeat(generateKey(seeded(1)), generateNonce(seeded(2)), CODE, 0, mac)).toBe(false);
  });

  it('verifySeat is false and proveSeat rejects on a malformed key or nonce', async () => {
    const nonce = generateNonce(seeded(2));
    expect(await verifySeat('nope', nonce, CODE, 0, 'A'.repeat(43))).toBe(false);
    expect(await verifySeat(generateKey(seeded(1)), '***', CODE, 0, 'A'.repeat(43))).toBe(false);
    await expect(proveSeat('nope', nonce, CODE, 0)).rejects.toThrow();
    await expect(proveSeat(generateKey(seeded(1)), 'AAAA', CODE, 0)).rejects.toThrow(/short/);
  });
});

/* ---------------------------------------------------------------------------------------------- */
/* Stored games                                                                                     */
/* ---------------------------------------------------------------------------------------------- */

describe('GameLog ↔ SavedGame', () => {
  const promo = ['h2h4', 'g7g5', 'h4g5', 'h7h6', 'g5h6', 'g8f6', 'h6h7', 'f6g8', 'h7g8n'];

  it('stores a room game for this seat', () => {
    const l = log(3, ITALIAN, { white: 0, epoch: 2, tc: '5+0', end: RESIGN_W });
    const s = logToSaved(l, { code: 'K7QW2M', seat: 1, now: 5000 });
    expect(s).toEqual({
      id: 'K7QW2M.3',
      code: 'K7QW2M',
      mode: 'room',
      color: 'b',
      tc: '5+0',
      moves: zhess.encodeMoves(l.plies),
      ms: l.plies.map((p) => p.ms),
      result: '0-1',
      by: 'resign',
      assisted: false,
      room: { n: 3, epoch: 2 },
      createdAt: 5000,
      lastPlayedAt: 5000,
    } satisfies SavedGame);
    expect(roomGameId('AB', 7)).toBe('AB.7');
  });

  it('keeps createdAt and assisted of the stored copy', () => {
    const prev = { ...logToSaved(log(1, []), { code: 'X', seat: 0, now: 1 }), assisted: true };
    const s = logToSaved(log(1, ['e2e4']), { code: 'X', seat: 0, now: 9, prev, lastPlayedAt: 8 });
    expect(s).toMatchObject({ createdAt: 1, assisted: true, lastPlayedAt: 8, color: 'w' });
    expect('result' in s).toBe(false);
  });

  it.each([0, 1] as const)('round-trips through SavedGame for seat %s', (seat) => {
    for (const l of [
      log(1, ITALIAN, { white: 1, tc: '3+2' }),
      log(2, promo, { white: 0, epoch: 1 }),
      log(4, SCHOLAR, { white: 1 }),
      log(5, QUEENS, { white: 0, end: AGREED }),
      log(6, [], { white: 1 }),
    ]) {
      expect(savedToLog(logToSaved(l, { code: 'Q', seat, now: 1 }), seat)).toEqual(l);
    }
  });

  it('savedToLog is null for solo games and broken records', () => {
    const solo: SavedGame = { ...logToSaved(log(1, []), { code: 'X', seat: 0, now: 1 }), mode: 'local' };
    delete solo.room;
    expect(savedToLog(solo, 0)).toBeNull();
    const broken = { ...logToSaved(log(1, ['e2e4']), { code: 'X', seat: 0, now: 1 }), moves: 'Mc' + 'Mc' };
    expect(savedToLog(broken, 0)).toBeNull();
  });
});

describe('helpers', () => {
  it('currentLog and sortLogs', () => {
    expect(currentLog([])).toBeUndefined();
    expect(currentLog([log(2, []), log(5, []), log(3, [])])?.n).toBe(5);
    expect(sortLogs([log(2, []), log(1, ['e2e4']), log(1, ['d2d4'])]).map((l) => [l.n, l.plies[0]?.m])).toEqual([
      [1, 'd2d4'],
      [2, undefined],
    ]);
  });
});
