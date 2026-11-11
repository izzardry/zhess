/**
 * Room controller tests (DESIGN 9, 15.4; PLAN 7). Two (or more) controllers over 3B's memory
 * transport, on fake time and seeded randomness. Scenarios: join, lock, challenge failure, rejoin
 * grant and deny, offline move delivery, takeback, draw, rematch, clock pause, version mismatch,
 * plus drop and resend, disconnect mid-request, both reconnect, stale epoch, fork resolution, flag
 * claim timing, rematch colors and score, liveness, persistence and code collisions.
 */
import { describe, expect, it } from 'vitest';
import type { GameLog, Message, Room, SavedGame, Seat } from './types';
import { createStore, memoryStorage } from './storage';
import { appendPly, endLog, generateKey, hashLog, logToSaved, makeHead, newLog, proveSeat, roomGameId, roomScore, scoreView } from './sync';
import zhess from './zhess';
import { createRoomController, ROOM_DEFAULTS } from './room';
import { createHarness, fakePair, scriptPeer, seeded, WALL0, type Device, type Harness } from './room/testkit';

const CODE = 'K7QW2M';

/* ---------------------------------------------------------------------------------------------- */
/* Helpers                                                                                          */
/* ---------------------------------------------------------------------------------------------- */

async function joined(create: { tc: string | null; color: 'w' | 'b' | 'random' } = { tc: null, color: 'w' }, memory = {}) {
  const h = createHarness({ code: CODE, memory });
  const A = h.device('A', { create });
  await h.settle();
  const B = h.device('B');
  await h.settle();
  return { h, A, B };
}

/** Plays `ucis` in order, each by whichever device is to move. */
async function play(h: Harness, devs: Device[], ucis: string[], ms = 1000): Promise<void> {
  for (const u of ucis) {
    const d = devs.find((x) => x.ctrl.snapshot.myTurn);
    if (!d) throw new Error(`nobody to move for ${u}`);
    expect(d.ctrl.move(u, ms), `${d.name} plays ${u}`).toBe(true);
    await h.settle();
  }
}

const room = (d: Device): Room | undefined => d.store.rooms().find((r) => r.code === CODE);
const saved = (d: Device): SavedGame[] => d.store.games().filter((g) => g.code === CODE);
const ucis = (d: Device): string[] => d.ctrl.snapshot.game.plies.map((p) => p.m);
const strip = (logs: readonly GameLog[]) => logs.map((l) => hashLog(l));

function buildLog(n: number, white: Seat, tc: string | null, moves: string[], ms = 1000): GameLog {
  let l = newLog(n, white, tc);
  for (const m of moves) l = appendPly(l, m, ms);
  return l;
}

/** A storage holding a locked room with these games, as a device would have it. */
function seededStorage(seat: Seat, key: string, logs: GameLog[], lastSeenAt = WALL0) {
  const storage = memoryStorage();
  const store = createStore(storage);
  store.saveRoom({ code: CODE, key, seat, createdAt: WALL0, lastSeenAt, score: roomScore(logs), games: logs.map((l) => roomGameId(CODE, l.n)) });
  for (const l of logs) store.saveGame(logToSaved(l, { code: CODE, seat, now: WALL0 }));
  return storage;
}

function linkLog(h: Harness): string[] {
  return h.sent().map((e) => `${e.from.endsWith('#1') ? 'A' : e.from.slice(-2)}:${e.msg.t}`);
}

/* ---------------------------------------------------------------------------------------------- */
/* Join, lock, challenge                                                                            */
/* ---------------------------------------------------------------------------------------------- */

describe('join and lock', () => {
  it('the creator waits with an open room; the joiner gets seat 1, the key, the time control and its color', async () => {
    const h = createHarness({ code: CODE });
    const A = h.device('A', { create: { tc: '5+0', color: 'b' } });
    await h.settle();
    const s0 = A.ctrl.snapshot;
    expect(s0).toMatchObject({ code: CODE, presence: 'waiting', role: 'anchor', lock: 'open', seat: 0, n: 1, epoch: 0, color: 'b', live: false, phase: 'connecting' });
    expect(s0.tc).toEqual({ baseMs: 300_000, incMs: 0 });
    expect(s0.locked).toBe('disconnected'); // timed: nobody to play yet
    expect(s0.clock).toEqual({ paused: true, turnStart: null, turnUsed: 0 });
    // The open room is stored at once and shows in history.
    expect(room(A)).toMatchObject({ seat: 0, lastSeenAt: 0, score: [0, 0], games: [`${CODE}.1`] });
    expect(saved(A)).toEqual([expect.objectContaining({ id: `${CODE}.1`, mode: 'room', color: 'b', tc: '5+0', moves: '', room: { n: 1, epoch: 0 } })]);

    const B = h.device('B');
    await h.settle();
    expect(linkLog(h)).toEqual(['A:hello', '#2:hello', '#2:join', 'A:welcome', 'A:head', '#2:head']);
    const welcome = h.sent().find((e) => e.msg.t === 'welcome')?.msg;
    expect(welcome).toMatchObject({ t: 'welcome', v: 1, seat: 1, tc: '5+0', color: 'w', key: room(A)?.key });

    expect(A.ctrl.snapshot).toMatchObject({ presence: 'connected', lock: 'locked', live: true, phase: 'live', seat: 0, color: 'b', locked: null });
    expect(B.ctrl.snapshot).toMatchObject({ presence: 'connected', lock: 'locked', live: true, phase: 'live', seat: 1, color: 'w', n: 1, locked: null, role: 'dialer' });
    expect(B.ctrl.snapshot.tc).toEqual({ baseMs: 300_000, incMs: 0 });
    expect(A.kinds()).toEqual(['opponent-joined']);
    expect(B.kinds()).toEqual(['opponent-connected']);
    expect(room(B)?.key).toBe(room(A)?.key);
    expect(room(B)).toMatchObject({ seat: 1, games: [`${CODE}.1`] });
    expect(room(A)?.lastSeenAt).toBeGreaterThan(0);
    expect(saved(B)).toEqual([expect.objectContaining({ id: `${CODE}.1`, mode: 'room', color: 'w', tc: '5+0' })]);
    // Clocks run once live; white (B) is to move.
    expect(B.ctrl.snapshot.myTurn).toBe(true);
    expect(B.ctrl.snapshot.canMove).toBe(true);
    expect(A.ctrl.snapshot.canMove).toBe(false);
    expect(B.ctrl.snapshot.clock).toEqual({ paused: false, turnStart: h.time.t, turnUsed: 0 });
  });

  it('a random creator color comes from the injected rng and both devices agree', async () => {
    for (const seed of [1, 2, 3, 4]) {
      const h = createHarness({ code: CODE });
      const A = h.device('A', { create: { tc: null, color: 'random' }, seed });
      const B = h.device('B');
      await h.settle();
      expect(A.ctrl.snapshot.live).toBe(true);
      expect(B.ctrl.snapshot.color).not.toBe(A.ctrl.snapshot.color);
      const again = createRoomController({ code: CODE, store: createStore(memoryStorage()), create: { tc: null, color: 'random' }, rng: seeded(seed), timers: h.time, now: h.time.now });
      expect(again.snapshot.color).toBe(A.ctrl.snapshot.color);
      again.leave();
    }
  });

  it('a third device without the key meets a locked room: it gets a rejoin request, not a seat', async () => {
    const { h, A, B } = await joined();
    B.ctrl.leave();
    await h.settle();
    expect(A.ctrl.snapshot).toMatchObject({ presence: 'reconnecting', live: false });
    expect(A.kinds()).toEqual(['opponent-joined', 'opponent-disconnected']);
    const C = h.device('C');
    await h.settle();
    expect(A.ctrl.snapshot).toMatchObject({ lock: 'rejoin-pending', phase: 'approving', requests: { incoming: 'rejoin' }, live: false });
    expect(C.ctrl.snapshot).toMatchObject({ phase: 'joining', seat: null, locked: 'no-seat', lock: 'open' });
    expect(h.sent().some((e) => e.msg.t === 'welcome' || e.msg.t === 'grant' || e.msg.t === 'head')).toBe(false);
    expect(room(C)).toBeUndefined();
  });

  it('challenge failure: a device with another key learns nothing and the anchor retries later', async () => {
    const { h, A, B } = await joined();
    await play(h, [A, B], ['e2e4', 'e7e5']);
    B.ctrl.leave();
    await h.settle();
    // A stranger who registered the room with its own key.
    const fake = seededStorage(1, generateKey(seeded(99)), [newLog(1, 0, null)]);
    const S = h.device('S', { storage: fake });
    await h.settle();
    const kinds = h.sent().map((e) => e.msg.t);
    expect(kinds).toEqual(['hello', 'hello', 'proof', 'proof']);
    expect(A.ctrl.snapshot).toMatchObject({ phase: 'stranger', live: false, presence: 'reconnecting' });
    expect(S.ctrl.snapshot).toMatchObject({ phase: 'stranger', live: false });
    expect(S.ctrl.snapshot.game.plies).toEqual([]);
    expect(A.kinds()).not.toContain('challenge-failed'); // a rejoin may still follow
    // After the retry delay A reports the failure and reconnects (a fresh channel).
    await h.advance(ROOM_DEFAULTS.retryMs);
    expect(A.kinds()).toContain('challenge-failed');
    expect(A.ctrl.snapshot.game.plies.length).toBe(2);
    expect(saved(S)[0].moves).toBe('');
    // The real opponent comes back: newest wins, the room goes live again.
    const B2 = h.device('B2', { storage: B.storage });
    await h.settle();
    expect(A.ctrl.snapshot.live).toBe(true);
    expect(B2.ctrl.snapshot.live).toBe(true);
    expect(ucis(B2)).toEqual(['e2e4', 'e7e5']);
    expect(A.kinds().at(-1)).toBe('reconnected');
  });

  it('both devices created a room under the same code: the dialer gives up its provisional room and joins', async () => {
    const h = createHarness({ code: CODE });
    const A = h.device('A', { create: { tc: '3+2', color: 'w' } });
    const B = h.device('B', { create: { tc: null, color: 'w' } });
    await h.settle();
    expect(A.ctrl.snapshot).toMatchObject({ live: true, seat: 0, color: 'w', lock: 'locked' });
    expect(B.ctrl.snapshot).toMatchObject({ live: true, seat: 1, color: 'b', lock: 'locked' });
    expect(B.ctrl.snapshot.tc).toEqual({ baseMs: 180_000, incMs: 2000 });
    expect(room(B)?.key).toBe(room(A)?.key);
    expect(saved(B)).toEqual([expect.objectContaining({ id: `${CODE}.1`, color: 'b', tc: '3+2' })]);
  });

  it('neither device holds the room (two invite links): the anchor creates it', async () => {
    const h = createHarness({ code: CODE });
    const A = h.device('A');
    await h.settle();
    expect(A.ctrl.snapshot).toMatchObject({ seat: null, locked: 'no-seat', presence: 'waiting' });
    expect(room(A)).toBeUndefined();
    const B = h.device('B');
    await h.settle();
    expect(A.ctrl.snapshot).toMatchObject({ live: true, seat: 0, lock: 'locked' });
    expect(B.ctrl.snapshot).toMatchObject({ live: true, seat: 1 });
    expect(A.ctrl.snapshot.tc).toBeNull();
    expect(room(A)?.key).toBe(room(B)?.key);
  });

  it('the creator moved while waiting (untimed): the joiner receives the move', async () => {
    const h = createHarness({ code: CODE });
    const A = h.device('A', { create: { tc: null, color: 'w' } });
    await h.settle();
    expect(A.ctrl.snapshot.canMove).toBe(true);
    expect(A.ctrl.move('e2e4')).toBe(true);
    expect(A.ctrl.snapshot.unsent).toBe(1);
    const B = h.device('B');
    await h.settle();
    expect(ucis(B)).toEqual(['e2e4']);
    expect(B.ctrl.snapshot.myTurn).toBe(true);
    expect(A.ctrl.snapshot.unsent).toBe(0);
  });

  it('a lost welcome: the creator still holds an open room, the joiner its key; the next connection binds them', async () => {
    const h = createHarness({ code: CODE });
    const A = h.device('A', { create: { tc: null, color: 'w' } });
    await h.settle();
    // Drop everything after the welcome reached B (B's head never arrives).
    let welcomed = false;
    const B = h.device('B');
    const link = h.net.link(CODE);
    link?.setDrop((m) => {
      if (m.t === 'welcome') welcomed = true;
      return welcomed && m.t === 'head';
    });
    await h.settle();
    expect(room(A)?.lastSeenAt).toBe(0);
    expect(room(B)?.key).toBe(room(A)?.key);
    link?.setDrop(false);
    link?.reconnect();
    await h.settle();
    expect(A.ctrl.snapshot).toMatchObject({ live: true, lock: 'locked' });
    expect(B.ctrl.snapshot.live).toBe(true);
    expect(room(A)?.lastSeenAt).toBeGreaterThan(0);
    expect(A.kinds()).toContain('opponent-joined');
  });
});

/* ---------------------------------------------------------------------------------------------- */
/* Rejoin                                                                                           */
/* ---------------------------------------------------------------------------------------------- */

describe('rejoin', () => {
  async function playedRoom() {
    const r = await joined({ tc: null, color: 'w' });
    const { h, A, B } = r;
    await play(h, [A, B], ['e2e4', 'e7e5']);
    expect(B.ctrl.resign()).toBe(true);
    await h.settle();
    expect(A.ctrl.ask('rematch')).toBe(true);
    await h.settle();
    expect(B.ctrl.reply('rematch', true)).toBe(true);
    await h.settle();
    await play(h, [A, B], ['d2d4', 'd7d5', 'c2c4']);
    return r;
  }

  for (const intent of ['invite link', 'typed code'] as const) {
    it(`grant restores seat, key, score and every game (${intent})`, async () => {
      const { h, A, B } = await playedRoom();
      const key = room(A)?.key;
      B.ctrl.leave();
      await h.settle();
      // B lost everything and starts the code again.
      const B2 = h.device('B2', intent === 'typed code' ? { create: { tc: '5+0', color: 'w' } } : {});
      await h.settle();
      expect(A.ctrl.snapshot).toMatchObject({ requests: { incoming: 'rejoin' }, lock: 'rejoin-pending' });
      expect(B2.ctrl.snapshot.phase).toBe('joining');
      expect(A.ctrl.reply('rejoin', true)).toBe(true);
      await h.settle();
      expect(A.ctrl.snapshot).toMatchObject({ live: true, lock: 'locked', requests: {} });
      expect(B2.ctrl.snapshot).toMatchObject({ live: true, seat: 1, n: 2, color: 'w', lock: 'locked' });
      expect(B2.ctrl.snapshot.score).toEqual(A.ctrl.snapshot.score);
      expect(scoreView(B2.ctrl.snapshot.score, 1)).toEqual([0, 1]);
      expect(strip(B2.ctrl.snapshot.logs)).toEqual(strip(A.ctrl.snapshot.logs));
      expect(ucis(B2)).toEqual(['d2d4', 'd7d5', 'c2c4']);
      expect(room(B2)).toMatchObject({ key, seat: 1, score: [2, 0], games: [`${CODE}.1`, `${CODE}.2`] });
      const g1 = saved(B2).find((g) => g.id === `${CODE}.1`);
      expect(g1).toMatchObject({ result: '1-0', by: 'resign', color: 'b', mode: 'room' });
      expect(A.kinds()).not.toContain('challenge-failed');
      // Play continues normally.
      await play(h, [A, B2], ['e7e6']);
      expect(ucis(A)).toEqual(['d2d4', 'd7d5', 'c2c4', 'e7e6']);
    });
  }

  it('the survivor is offline when the other returns: the newcomer waits as anchor, recovery happens later', async () => {
    const { h, A, B } = await playedRoom();
    A.ctrl.leave();
    B.ctrl.leave();
    await h.settle();
    const B2 = h.device('B2');
    await h.settle();
    expect(B2.ctrl.snapshot).toMatchObject({ presence: 'waiting', role: 'anchor', seat: null, locked: 'no-seat', phase: 'connecting' });
    const A2 = h.device('A2', { storage: A.storage });
    await h.settle();
    expect(A2.ctrl.snapshot.requests.incoming).toBe('rejoin');
    A2.ctrl.reply('rejoin', true);
    await h.settle();
    expect(B2.ctrl.snapshot).toMatchObject({ live: true, seat: 1, n: 2 });
    expect(strip(B2.ctrl.snapshot.logs)).toEqual(strip(A2.ctrl.snapshot.logs));
  });

  it('a `rejoin` message is treated like `join` by a locked room', async () => {
    const key = generateKey(seeded(31));
    const h = createHarness({ code: CODE });
    const pair = fakePair(h.time);
    const peer = scriptPeer(pair.b);
    const A = h.deviceOn('A', pair.a, { storage: seededStorage(0, key, [buildLog(1, 1, null, ['e2e4'])]) });
    await h.settle();
    peer.send({ t: 'hello', v: 1, hasKey: false, nonce: 'BBBBBBBBBBBBBBBBBBBBBB' });
    peer.send({ t: 'rejoin', v: 1 });
    await h.settle();
    expect(A.ctrl.snapshot.requests.incoming).toBe('rejoin');
    A.ctrl.reply('rejoin', true);
    await h.settle();
    const grant = peer.of('grant')[0];
    expect(grant).toMatchObject({ key, seat: 1, score: [0, 0] });
    expect(grant.games.map((g) => g.plies.map((p) => p.m))).toEqual([['e2e4']]);
    expect(peer.of('head').length).toBe(1);
  });

  it('a peer that starts over on the same channel takes its pending rejoin request with it', async () => {
    const key = generateKey(seeded(32));
    const h = createHarness({ code: CODE });
    const pair = fakePair(h.time);
    const peer = scriptPeer(pair.b);
    const A = h.deviceOn('A', pair.a, { storage: seededStorage(0, key, [buildLog(1, 0, null, [])]) });
    await h.settle();
    peer.send({ t: 'hello', v: 1, hasKey: false, nonce: 'BBBBBBBBBBBBBBBBBBBBBB' });
    peer.send({ t: 'join', v: 1 });
    await h.settle();
    expect(A.ctrl.snapshot.requests.incoming).toBe('rejoin');
    peer.send({ t: 'hello', v: 1, hasKey: false, nonce: 'CCCCCCCCCCCCCCCCCCCCCC' });
    await h.settle();
    expect(A.ctrl.snapshot.requests.incoming).toBeUndefined();
    expect(peer.of('hello').length).toBe(2); // A answered the restart with a fresh hello
    expect(peer.of('hello')[1].nonce).not.toBe(peer.of('hello')[0].nonce);
    expect(A.ctrl.reply('rejoin', true)).toBe(false);
  });

  it('deny: the newcomer is told and gets nothing; it does not ask again', async () => {
    const { h, A, B } = await playedRoom();
    B.ctrl.leave();
    await h.settle();
    const C = h.device('C');
    await h.settle();
    expect(A.ctrl.reply('rejoin', false)).toBe(true);
    await h.settle();
    expect(C.ctrl.snapshot).toMatchObject({ phase: 'denied', locked: 'denied', seat: null });
    expect(C.kinds()).toEqual(['rejoin-denied']);
    expect(C.ctrl.move('e2e4')).toBe(false);
    expect(room(C)).toBeUndefined();
    expect(saved(C)).toEqual([]);
    expect(h.sent().some((e) => e.msg.t === 'grant' || e.msg.t === 'head' || e.msg.t === 'logs')).toBe(false);
    expect(A.ctrl.snapshot).toMatchObject({ phase: 'stranger', requests: {}, lock: 'locked' });
    // A reconnects later; C stays quiet, so A is not asked again.
    await h.advance(ROOM_DEFAULTS.retryMs + 1);
    expect(A.ctrl.snapshot.requests.incoming).toBeUndefined();
    expect(A.kinds()).not.toContain('challenge-failed');
  });

  it('reply(rejoin) without a pending request does nothing', async () => {
    const { A } = await joined();
    expect(A.ctrl.reply('rejoin', true)).toBe(false);
  });

  it('the rejoin request disappears when the newcomer goes away', async () => {
    const { h, A, B } = await joined();
    B.ctrl.leave();
    const C = h.device('C');
    await h.settle();
    expect(A.ctrl.snapshot.requests.incoming).toBe('rejoin');
    C.ctrl.leave();
    await h.settle();
    expect(A.ctrl.snapshot.requests.incoming).toBeUndefined();
    expect(A.ctrl.reply('rejoin', true)).toBe(false);
  });

  it('a large room is granted in several messages that fit the size limit', async () => {
    const logs = [
      endLog(buildLog(1, 0, null, ['e2e4', 'e7e5', 'g1f3', 'b8c6']), { result: '1-0', by: 'resign' }),
      endLog(buildLog(2, 1, null, ['d2d4', 'd7d5', 'c2c4']), { result: '1/2-1/2', by: 'agreed' }),
      buildLog(3, 0, null, ['c2c4']),
    ];
    const key = generateKey(seeded(5));
    const h = createHarness({ code: CODE });
    const A = h.device('A', { storage: seededStorage(0, key, logs), maxMessageBytes: 260 });
    const C = h.device('C');
    await h.settle();
    A.ctrl.reply('rejoin', true);
    await h.settle();
    const sizes = h.sent().filter((e) => e.from.endsWith('#1') && (e.msg.t === 'grant' || e.msg.t === 'logs'));
    expect(sizes.length).toBeGreaterThan(1);
    expect(C.ctrl.snapshot.live).toBe(true);
    expect(strip(C.ctrl.snapshot.logs)).toEqual(strip(logs));
    expect(C.ctrl.snapshot.score).toEqual([3, 1]);
  });
});

/* ---------------------------------------------------------------------------------------------- */
/* Live play                                                                                        */
/* ---------------------------------------------------------------------------------------------- */

describe('live play', () => {
  it('moves are acknowledged and every ply is stored on both devices', async () => {
    const { h, A, B } = await joined({ tc: null, color: 'w' });
    await play(h, [A, B], ['e2e4', 'e7e5', 'g1f3', 'b8c6'], 1500);
    expect(ucis(A)).toEqual(['e2e4', 'e7e5', 'g1f3', 'b8c6']);
    expect(ucis(B)).toEqual(ucis(A));
    expect(A.ctrl.snapshot.unsent).toBe(0);
    expect(B.ctrl.snapshot.unsent).toBe(0);
    const acks = h.sent().filter((e) => e.msg.t === 'ack');
    expect(acks.length).toBe(4);
    for (const d of [A, B]) {
      const g = saved(d)[0];
      expect(zhess.decodeMoves(g.moves)).toEqual(['e2e4', 'e7e5', 'g1f3', 'b8c6']);
      expect(g.ms).toEqual([1500, 1500, 1500, 1500]);
      expect(g.lastPlayedAt).toBeGreaterThanOrEqual(WALL0);
    }
  });

  it('refuses moves out of turn, illegal moves and moves after the end', async () => {
    const { h, A, B } = await joined({ tc: null, color: 'w' });
    expect(B.ctrl.move('e7e5')).toBe(false);
    expect(A.ctrl.move('e2e5')).toBe(false);
    expect(A.ctrl.move('nonsense')).toBe(false);
    await play(h, [A, B], ['f2f3', 'e7e5', 'g2g4', 'd8h4']);
    for (const d of [A, B]) expect(d.ctrl.snapshot.game.end).toEqual({ result: '0-1', by: 'mate' });
    expect(A.ctrl.move('a2a3')).toBe(false);
    expect(A.ctrl.resign()).toBe(false);
    expect(A.ctrl.snapshot.score).toEqual([0, 2]);
    expect(B.ctrl.snapshot.score).toEqual([0, 2]);
    expect(scoreView(B.ctrl.snapshot.score, 1)).toEqual([1, 0]);
  });

  it('drop and resend: a lost move is sent again until it is acknowledged', async () => {
    const { h, A, B } = await joined({ tc: null, color: 'w' });
    let dropped = 0;
    h.net.link(CODE)?.setDrop((m) => m.t === 'move' && dropped++ < 2);
    A.ctrl.move('e2e4');
    await h.settle();
    expect(ucis(B)).toEqual([]);
    expect(A.ctrl.snapshot.unsent).toBe(1);
    await h.advance(ROOM_DEFAULTS.resendMs);
    expect(ucis(B)).toEqual([]); // second copy dropped too
    await h.advance(ROOM_DEFAULTS.resendMs);
    expect(ucis(B)).toEqual(['e2e4']);
    expect(A.ctrl.snapshot.unsent).toBe(0);
    expect(h.sent().filter((e) => e.msg.t === 'move').length).toBe(3);
  });

  it('a lost ack: the resent move is a duplicate and is acknowledged again', async () => {
    const { h, A, B } = await joined({ tc: null, color: 'w' });
    let dropped = 0;
    h.net.link(CODE)?.setDrop((m) => m.t === 'ack' && dropped++ < 1);
    A.ctrl.move('e2e4');
    await h.settle();
    expect(ucis(B)).toEqual(['e2e4']);
    expect(A.ctrl.snapshot.unsent).toBe(1);
    await h.advance(ROOM_DEFAULTS.resendMs);
    expect(A.ctrl.snapshot.unsent).toBe(0);
    expect(ucis(B)).toEqual(['e2e4']);
  });

  it('resign is final and counts for the opponent', async () => {
    const { h, A, B } = await joined({ tc: '5+0', color: 'w' });
    await play(h, [A, B], ['e2e4']);
    expect(A.ctrl.resign()).toBe(true);
    await h.settle();
    for (const d of [A, B]) expect(d.ctrl.snapshot.game.end).toEqual({ result: '0-1', by: 'resign' });
    expect(room(A)?.score).toEqual([0, 2]);
    expect(room(B)?.score).toEqual([0, 2]);
    expect(saved(B)[0]).toMatchObject({ result: '0-1', by: 'resign' });
    expect(B.ctrl.snapshot.clock.turnStart).toBeNull();
  });

  it('a resignation crossing a move: the finished copy wins on both devices', async () => {
    const { h, A, B } = await joined({ tc: null, color: 'w' });
    await play(h, [A, B], ['e2e4']);
    // B moves and A resigns at the same moment.
    B.ctrl.move('e7e5');
    A.ctrl.resign();
    await h.settle();
    for (const d of [A, B]) {
      expect(d.ctrl.snapshot.game.end).toEqual({ result: '0-1', by: 'resign' });
      expect(ucis(d)).toEqual(['e2e4']);
    }
    expect(A.kinds()).not.toContain('restored-from-opponent');
  });
});

/* ---------------------------------------------------------------------------------------------- */
/* Offline moves and reconnects                                                                     */
/* ---------------------------------------------------------------------------------------------- */

describe('offline moves', () => {
  it('untimed: the player to move moves while the opponent is away; the move arrives when they return', async () => {
    const { h, A, B } = await joined({ tc: null, color: 'w' });
    await play(h, [A, B], ['e2e4', 'e7e5']);
    B.ctrl.leave();
    await h.settle();
    expect(A.ctrl.snapshot).toMatchObject({ presence: 'reconnecting', locked: null, canMove: true });
    expect(A.ctrl.move('g1f3')).toBe(true);
    expect(A.ctrl.snapshot).toMatchObject({ unsent: 1, myTurn: false, canMove: false });
    expect(zhess.decodeMoves(saved(A)[0].moves)).toEqual(['e2e4', 'e7e5', 'g1f3']);
    // B reopens the room later (same storage, new page).
    const B2 = h.device('B2', { storage: B.storage });
    expect(ucis(B2)).toEqual(['e2e4', 'e7e5']);
    await h.settle();
    expect(ucis(B2)).toEqual(['e2e4', 'e7e5', 'g1f3']);
    expect(A.ctrl.snapshot.unsent).toBe(0);
    expect(B2.ctrl.snapshot.myTurn).toBe(true);
    expect(zhess.decodeMoves(saved(B2)[0].moves)).toEqual(['e2e4', 'e7e5', 'g1f3']);
    expect(A.kinds().at(-1)).toBe('reconnected');
    expect(B2.kinds()).toEqual(['opponent-connected']);
  });

  it('correspondence: both close the app; the moves cross whenever both are online', async () => {
    const { h, A, B } = await joined({ tc: null, color: 'w' });
    A.ctrl.leave();
    B.ctrl.leave();
    await h.settle();
    const A2 = h.device('A2', { storage: A.storage });
    await h.settle();
    expect(A2.ctrl.snapshot.presence).toBe('waiting');
    expect(A2.ctrl.move('d2d4')).toBe(true);
    A2.ctrl.leave();
    await h.settle();
    const B2 = h.device('B2', { storage: B.storage });
    await h.settle();
    expect(B2.ctrl.snapshot).toMatchObject({ presence: 'waiting', live: false });
    expect(ucis(B2)).toEqual([]);
    expect(B2.ctrl.move('d7d5')).toBe(false); // not B's turn as far as B knows
    const A3 = h.device('A3', { storage: A.storage });
    await h.settle();
    expect(ucis(B2)).toEqual(['d2d4']);
    expect(B2.ctrl.move('d7d5')).toBe(true);
    await h.settle();
    expect(ucis(A3)).toEqual(['d2d4', 'd7d5']);
  });

  it('timed: the board locks while disconnected and the strips pause', async () => {
    const { h, A, B } = await joined({ tc: '5+0', color: 'w' });
    await play(h, [A, B], ['e2e4', 'e7e5']);
    h.net.link(CODE)?.disconnect();
    await h.settle();
    for (const d of [A, B]) {
      expect(d.ctrl.snapshot).toMatchObject({ locked: 'disconnected', presence: 'reconnecting', live: false, canMove: false });
      expect(d.ctrl.snapshot.clock.paused).toBe(true);
      expect(d.ctrl.snapshot.clock.turnStart).toBeNull();
    }
    expect(A.ctrl.move('g1f3')).toBe(false);
    expect(A.kinds()).toEqual(['opponent-joined', 'opponent-disconnected']);
  });

  it('both reconnect: a dropped channel comes back and play continues', async () => {
    const { h, A, B } = await joined({ tc: null, color: 'w' });
    await play(h, [A, B], ['e2e4']);
    h.net.link(CODE)?.disconnect();
    await h.settle();
    expect(A.ctrl.snapshot.presence).toBe('reconnecting');
    expect(B.ctrl.snapshot.presence).toBe('reconnecting');
    // B moves offline meanwhile (untimed).
    expect(B.ctrl.move('c7c5')).toBe(true);
    h.net.link(CODE)?.reconnect();
    await h.settle();
    for (const d of [A, B]) {
      expect(d.ctrl.snapshot).toMatchObject({ presence: 'connected', live: true, unsent: 0 });
      expect(ucis(d)).toEqual(['e2e4', 'c7c5']);
      expect(d.kinds().slice(-2)).toEqual(['opponent-disconnected', 'reconnected']);
    }
  });

  it('liveness: three missed pongs mark the peer disconnected and reconnect the transport', async () => {
    const { h, A, B } = await joined({ tc: '5+0', color: 'w' });
    const link = h.net.link(CODE);
    link?.setDrop(true);
    // The first tick still counts the join traffic; then three silent intervals.
    await h.advance(ROOM_DEFAULTS.pingMs * 3);
    expect(A.ctrl.snapshot.live).toBe(true);
    await h.advance(ROOM_DEFAULTS.pingMs);
    expect(A.ctrl.snapshot.live).toBe(false);
    expect(B.ctrl.snapshot.live).toBe(false);
    expect(A.ctrl.snapshot.locked).toBe('disconnected');
    expect(A.kinds()).toContain('opponent-disconnected');
    link?.setDrop(false);
    // The fresh channel's hellos were lost too: the stalled handshake is retried after the
    // same number of silent intervals, then the room is live again.
    await h.advance(ROOM_DEFAULTS.pingMs * 3);
    expect(A.ctrl.snapshot.live).toBe(false);
    await h.advance(ROOM_DEFAULTS.pingMs);
    expect(A.ctrl.snapshot.live).toBe(true);
    expect(B.ctrl.snapshot.live).toBe(true);
    expect(A.kinds().at(-1)).toBe('reconnected');
  });

  it('a page reload keeps the room: the record and the games come from the store', async () => {
    const { h, A, B } = await joined({ tc: '10+5', color: 'b' });
    await play(h, [A, B], ['e2e4', 'c7c5', 'g1f3']);
    A.ctrl.leave();
    await h.settle();
    const A2 = h.device('A2', { storage: A.storage });
    expect(A2.ctrl.snapshot).toMatchObject({ seat: 0, color: 'b', n: 1, lock: 'locked', presence: 'connecting' });
    expect(ucis(A2)).toEqual(['e2e4', 'c7c5', 'g1f3']);
    await h.settle();
    expect(A2.ctrl.snapshot.live).toBe(true);
  });
});

/* ---------------------------------------------------------------------------------------------- */
/* Requests                                                                                         */
/* ---------------------------------------------------------------------------------------------- */

describe('requests', () => {
  it('takeback accepted: cut before the requester last move, epoch + 1, same on both devices', async () => {
    const { h, A, B } = await joined({ tc: '5+0', color: 'w' });
    await play(h, [A, B], ['e2e4', 'e7e5', 'g1f3']);
    expect(A.ctrl.snapshot.canAsk.takeback).toBe(true);
    expect(A.ctrl.ask('takeback')).toBe(true);
    expect(A.ctrl.snapshot.requests).toEqual({ outgoing: 'takeback' });
    expect(A.ctrl.ask('draw')).toBe(false); // one request at a time
    await h.settle();
    expect(B.ctrl.snapshot.requests).toEqual({ incoming: 'takeback' });
    expect(B.ctrl.reply('takeback', true)).toBe(true);
    await h.settle();
    for (const d of [A, B]) {
      expect(ucis(d)).toEqual(['e2e4', 'e7e5']);
      expect(d.ctrl.snapshot).toMatchObject({ epoch: 1, requests: {} });
      expect(saved(d)[0].room).toEqual({ n: 1, epoch: 1 });
    }
    expect(A.ctrl.snapshot.myTurn).toBe(true);
    // Clocks return to the stamps of that position (derived from the log).
    expect(zhess.clocks(A.ctrl.snapshot.game, A.ctrl.snapshot.tc)).toEqual(zhess.clocks(zhess.replay(A.ctrl.snapshot.game.plies), A.ctrl.snapshot.tc));
    expect(A.ctrl.snapshot.clock.turnUsed).toBe(0);
    await play(h, [A, B], ['d2d4']);
    expect(ucis(B)).toEqual(['e2e4', 'e7e5', 'd2d4']);
  });

  it('takeback declined: the requester is told', async () => {
    const { h, A, B } = await joined();
    await play(h, [A, B], ['e2e4']);
    A.ctrl.ask('takeback');
    await h.settle();
    B.ctrl.reply('takeback', false);
    await h.settle();
    expect(A.notices.at(-1)).toMatchObject({ kind: 'request-declined', request: 'takeback' });
    expect(A.ctrl.snapshot.notice).toMatchObject({ kind: 'request-declined', request: 'takeback' });
    expect(A.ctrl.snapshot.requests).toEqual({});
    expect(ucis(A)).toEqual(['e2e4']);
  });

  it('takeback is withdrawn when the requester moves', async () => {
    const { h, A, B } = await joined();
    await play(h, [A, B], ['e2e4', 'e7e5']);
    A.ctrl.ask('takeback');
    await h.settle();
    expect(B.ctrl.snapshot.requests.incoming).toBe('takeback');
    A.ctrl.move('g1f3');
    expect(A.ctrl.snapshot.requests).toEqual({});
    await h.settle();
    expect(B.ctrl.snapshot.requests).toEqual({});
    expect(B.ctrl.reply('takeback', true)).toBe(false);
    expect(ucis(B)).toEqual(['e2e4', 'e7e5', 'g1f3']);
  });

  it('takeback cannot be asked before moving, while disconnected, or after the end', async () => {
    const { h, A, B } = await joined();
    expect(A.ctrl.ask('takeback')).toBe(false);
    await play(h, [A, B], ['e2e4']);
    expect(B.ctrl.ask('takeback')).toBe(false);
    h.net.link(CODE)?.disconnect();
    await h.settle();
    expect(A.ctrl.ask('takeback')).toBe(false);
    expect(A.ctrl.ask('draw')).toBe(false);
  });

  it('a takeback accepted while the reply is lost: reconcile brings the requester to the new epoch', async () => {
    const { h, A, B } = await joined();
    await play(h, [A, B], ['e2e4', 'e7e5']);
    A.ctrl.ask('takeback');
    await h.settle();
    h.net.link(CODE)?.setDrop((m) => m.t === 'reply');
    B.ctrl.reply('takeback', true);
    await h.settle();
    expect(ucis(A)).toEqual(['e2e4', 'e7e5']);
    expect(ucis(B)).toEqual([]);
    h.net.link(CODE)?.setDrop(false);
    h.net.link(CODE)?.disconnect();
    h.net.link(CODE)?.reconnect();
    await h.settle();
    for (const d of [A, B]) expect(d.ctrl.snapshot).toMatchObject({ epoch: 1, live: true, requests: {} });
    expect(ucis(A)).toEqual([]);
  });

  it('draw declined, then accepted: 1/2-1/2 by agreement, half a point each', async () => {
    const { h, A, B } = await joined({ tc: '5+0', color: 'w' });
    await play(h, [A, B], ['e2e4', 'e7e5']);
    expect(A.ctrl.ask('draw')).toBe(true);
    await h.settle();
    expect(B.ctrl.snapshot.requests.incoming).toBe('draw');
    B.ctrl.reply('draw', false);
    await h.settle();
    expect(A.notices.at(-1)).toMatchObject({ kind: 'request-declined', request: 'draw' });
    expect(B.ctrl.ask('draw')).toBe(true);
    await h.settle();
    A.ctrl.reply('draw', true);
    await h.settle();
    for (const d of [A, B]) {
      expect(d.ctrl.snapshot.game.end).toEqual({ result: '1/2-1/2', by: 'agreed' });
      expect(d.ctrl.snapshot.score).toEqual([1, 1]);
      expect(saved(d)[0]).toMatchObject({ result: '1/2-1/2', by: 'agreed' });
    }
    expect(scoreView(A.ctrl.snapshot.score, 0)).toEqual([0.5, 0.5]);
  });

  it('a draw offer expires when the opponent moves', async () => {
    const { h, A, B } = await joined();
    await play(h, [A, B], ['e2e4']);
    A.ctrl.ask('draw');
    await h.settle();
    expect(B.ctrl.snapshot.requests.incoming).toBe('draw');
    B.ctrl.move('e7e5');
    expect(B.ctrl.snapshot.requests).toEqual({});
    await h.settle();
    expect(A.ctrl.snapshot.requests).toEqual({});
    expect(A.ctrl.snapshot.game.end).toBeUndefined();
  });

  it('crossing draw offers are an agreement', async () => {
    const { h, A, B } = await joined();
    await play(h, [A, B], ['e2e4']);
    A.ctrl.ask('draw');
    B.ctrl.ask('draw');
    await h.settle();
    for (const d of [A, B]) expect(d.ctrl.snapshot.game.end).toEqual({ result: '1/2-1/2', by: 'agreed' });
    expect(A.ctrl.snapshot.requests).toEqual({});
  });

  it('disconnect mid-request: the toast goes away, the request is asked again after the reconnect', async () => {
    const { h, A, B } = await joined();
    await play(h, [A, B], ['e2e4', 'e7e5']);
    A.ctrl.ask('draw');
    await h.settle();
    expect(B.ctrl.snapshot.requests.incoming).toBe('draw');
    h.net.link(CODE)?.disconnect();
    await h.settle();
    expect(B.ctrl.snapshot.requests).toEqual({});
    expect(B.ctrl.reply('draw', true)).toBe(false);
    expect(A.ctrl.snapshot.requests).toEqual({ outgoing: 'draw' });
    h.net.link(CODE)?.reconnect();
    await h.settle();
    expect(B.ctrl.snapshot.requests.incoming).toBe('draw');
    B.ctrl.reply('draw', true);
    await h.settle();
    for (const d of [A, B]) expect(d.ctrl.snapshot.game.end?.by).toBe('agreed');
  });

  it('a lost ask is sent again', async () => {
    const { h, A, B } = await joined();
    await play(h, [A, B], ['e2e4']);
    let dropped = 0;
    h.net.link(CODE)?.setDrop((m) => m.t === 'ask' && dropped++ < 1);
    A.ctrl.ask('draw');
    await h.settle();
    expect(B.ctrl.snapshot.requests).toEqual({});
    await h.advance(ROOM_DEFAULTS.resendMs);
    expect(B.ctrl.snapshot.requests.incoming).toBe('draw');
  });

  it('rematch: n + 1, colors swapped, same time control, score kept; again swaps back', async () => {
    const { h, A, B } = await joined({ tc: '3+2', color: 'w' });
    expect(A.ctrl.ask('rematch')).toBe(false); // game not over
    await play(h, [A, B], ['f2f3', 'e7e5', 'g2g4', 'd8h4']); // B (black) mates
    expect(B.ctrl.snapshot.canAsk.rematch).toBe(true);
    expect(B.ctrl.ask('rematch')).toBe(true);
    await h.settle();
    expect(A.ctrl.snapshot.requests.incoming).toBe('rematch');
    A.ctrl.reply('rematch', true);
    await h.settle();
    for (const d of [A, B]) {
      expect(d.ctrl.snapshot).toMatchObject({ n: 2, epoch: 0, requests: {} });
      expect(d.ctrl.snapshot.tc).toEqual({ baseMs: 180_000, incMs: 2000 });
      expect(d.ctrl.snapshot.game.plies).toEqual([]);
      expect(d.ctrl.snapshot.score).toEqual([0, 2]);
      expect(room(d)?.games).toEqual([`${CODE}.1`, `${CODE}.2`]);
    }
    expect(A.ctrl.snapshot.color).toBe('b');
    expect(B.ctrl.snapshot.color).toBe('w');
    expect(saved(A).find((g) => g.id === `${CODE}.2`)).toMatchObject({ color: 'b', tc: '3+2', room: { n: 2, epoch: 0 } });
    // Game 2: B (white) resigns; A wins.
    await play(h, [A, B], ['e2e4']);
    B.ctrl.resign();
    await h.settle();
    expect(A.ctrl.snapshot.score).toEqual([2, 2]);
    expect(scoreView(A.ctrl.snapshot.score, 0)).toEqual([1, 1]);
    // Crossing rematch requests are an agreement; colors swap back.
    A.ctrl.ask('rematch');
    B.ctrl.ask('rematch');
    await h.settle();
    for (const d of [A, B]) expect(d.ctrl.snapshot.n).toBe(3);
    expect(A.ctrl.snapshot.color).toBe('w');
    expect(B.ctrl.snapshot.color).toBe('b');
    expect(room(B)?.score).toEqual([2, 2]);
    expect(room(B)?.games).toEqual([`${CODE}.1`, `${CODE}.2`, `${CODE}.3`]);
  });
});

/* ---------------------------------------------------------------------------------------------- */
/* Clocks                                                                                           */
/* ---------------------------------------------------------------------------------------------- */

describe('clocks', () => {
  it('pause on disconnect, resume from the stamps the mover reports', async () => {
    const h = createHarness({ code: CODE, memory: { delayMs: 100 } });
    const A = h.device('A', { create: { tc: '1+0', color: 'w' } });
    const B = h.device('B');
    await h.advance(1000);
    expect(A.ctrl.snapshot.live && B.ctrl.snapshot.live).toBe(true);
    const step = async (d: Device, uci: string, think: number) => {
      await h.advance(think);
      expect(d.ctrl.move(uci)).toBe(true);
      await h.advance(200);
    };
    await step(A, 'e2e4', 1000);
    await step(B, 'e7e5', 1000);
    await step(A, 'g1f3', 2000); // B's turn from here; B's clock runs (its first move was free)
    await h.advance(4800);
    // B's own view started when the move arrived (100 ms after A's view).
    expect(B.ctrl.elapsed()).toBe(5000 - 100);
    expect(A.ctrl.elapsed()).toBe(5000);
    h.net.link(CODE)?.disconnect();
    await h.settle();
    for (const d of [A, B]) {
      expect(d.ctrl.snapshot.clock.paused).toBe(true);
      expect(d.ctrl.snapshot.clock.turnStart).toBeNull();
    }
    const bUsed = B.ctrl.elapsed();
    await h.advance(60_000);
    expect(B.ctrl.elapsed()).toBe(bUsed);
    expect(A.ctrl.elapsed()).toBe(5000);
    expect(B.ctrl.snapshot.game.end).toBeUndefined();
    const mark = h.sent().length;
    h.net.link(CODE)?.reconnect();
    await h.advance(1000);
    expect(A.ctrl.snapshot.live).toBe(true);
    // B reported its turn time in its head; A adopted it.
    const head = h.sent().slice(mark).find((e) => e.msg.t === 'head' && !e.from.endsWith('#1'))?.msg as { turnMs?: number } | undefined;
    expect(head?.turnMs).toBe(bUsed);
    expect(A.ctrl.snapshot.clock.paused).toBe(false);
    expect(A.ctrl.snapshot.clock.turnUsed).toBe(bUsed);
    expect(A.ctrl.elapsed() - B.ctrl.elapsed()).toBeLessThanOrEqual(200);
    expect(Math.abs(A.ctrl.elapsed() - B.ctrl.elapsed())).toBeLessThanOrEqual(200);
    // B moves; its ms is what it measured, and A takes it.
    expect(B.ctrl.move('b8c6')).toBe(true);
    await h.advance(200);
    expect(A.ctrl.snapshot.game.plies[3].ms).toBe(B.ctrl.snapshot.game.plies[3].ms);
  });

  it('the first move of each side is untimed; own flag falls at zero', async () => {
    const { h, A, B } = await joined({ tc: '1+0', color: 'w' });
    await h.advance(90_000); // white's first move: no clock yet
    expect(A.ctrl.snapshot.game.end).toBeUndefined();
    await play(h, [A, B], ['e2e4', 'e7e5']);
    expect(A.ctrl.flag()).toBe(false);
    await h.advance(59_999);
    expect(A.ctrl.snapshot.game.end).toBeUndefined();
    await h.advance(1);
    for (const d of [A, B]) expect(d.ctrl.snapshot.game.end).toEqual({ result: '0-1', by: 'time' });
    expect(B.ctrl.snapshot.score).toEqual([0, 2]);
  });

  it("flag claim timing: the opponent's flag is claimed after its clock has read zero for 2 seconds", async () => {
    const h = createHarness({ code: CODE });
    let frozenAt: number | null = null;
    const nowA = () => (frozenAt ?? h.time.t);
    const A = h.device('A', { create: { tc: '1+0', color: 'w' }, now: nowA });
    const B = h.device('B');
    await h.settle();
    await play(h, [A, B], ['e2e4', 'e7e5']);
    frozenAt = h.time.t; // A's device stalls (e.g. a frozen tab): it never sees its own flag fall
    await h.advance(60_000);
    expect(B.ctrl.flag()).toBe(false);
    await h.advance(1999);
    expect(B.ctrl.snapshot.game.end).toBeUndefined();
    expect(B.ctrl.flag()).toBe(false);
    await h.advance(1);
    for (const d of [A, B]) expect(d.ctrl.snapshot.game.end).toEqual({ result: '0-1', by: 'time' });
    expect(h.sent().filter((e) => e.msg.t === 'end').map((e) => e.from.endsWith('#2'))).toEqual([true]);
  });

  it('no claim on a disconnected opponent: the clock is paused', async () => {
    const h = createHarness({ code: CODE });
    let frozenAt: number | null = null;
    const A = h.device('A', { create: { tc: '1+0', color: 'w' }, now: () => frozenAt ?? h.time.t });
    const B = h.device('B');
    await h.settle();
    await play(h, [A, B], ['e2e4', 'e7e5']);
    frozenAt = h.time.t;
    await h.advance(30_000);
    h.net.link(CODE)?.disconnect();
    await h.advance(120_000);
    expect(B.ctrl.snapshot.game.end).toBeUndefined();
    expect(B.ctrl.flag()).toBe(false);
  });

  it('a timed game loaded from storage flags on both devices with the result of the position', async () => {
    const key = generateKey(seeded(3));
    const logs = [buildLog(1, 0, '1+0', ['e2e4', 'e7e5'])];
    const h = createHarness({ code: CODE });
    const A = h.device('A', { storage: seededStorage(0, key, logs) });
    const B = h.device('B', { storage: seededStorage(1, key, logs) });
    await h.settle();
    expect(A.ctrl.snapshot.live).toBe(true);
    await h.advance(60_000);
    expect(A.ctrl.snapshot.game.end).toEqual(zhess.timeoutResult(zhess.replay(logs[0].plies), 'w'));
    expect(B.ctrl.snapshot.game.end).toEqual(A.ctrl.snapshot.game.end);
  });

  it('untimed: the own turn keeps counting while offline; the opponent turn waits', async () => {
    const { h, A, B } = await joined({ tc: null, color: 'w' });
    await play(h, [A, B], ['e2e4']);
    B.ctrl.leave();
    await h.settle();
    // B's turn: A cannot see B think while B is away.
    expect(A.ctrl.snapshot.clock.turnStart).toBeNull();
    expect(A.ctrl.snapshot.clock.paused).toBe(false); // untimed rooms show no Paused state
    const B2 = h.device('B2', { storage: B.storage, initialTurn: { n: 1, epoch: 0, len: 1, ms: 7000 } });
    await h.settle();
    expect(B2.ctrl.elapsed()).toBe(7000);
    expect(A.ctrl.snapshot.clock.turnUsed).toBe(7000);
    expect(A.ctrl.snapshot.clock.turnStart).toBe(h.time.t);
  });
});

/* ---------------------------------------------------------------------------------------------- */
/* Sync: stale state, forks                                                                         */
/* ---------------------------------------------------------------------------------------------- */

describe('sync on connect', () => {
  it('stale epoch: a device restored from an older backup adopts the takeback', async () => {
    const { h, A, B } = await joined();
    await play(h, [A, B], ['e2e4', 'e7e5', 'g1f3']);
    const backup = B.storage.dump();
    A.ctrl.ask('takeback');
    await h.settle();
    B.ctrl.reply('takeback', true);
    await h.settle();
    expect(B.ctrl.snapshot.epoch).toBe(1);
    B.ctrl.leave();
    await h.settle();
    const B2 = h.device('B2', { storage: memoryStorage(backup) });
    expect(B2.ctrl.snapshot).toMatchObject({ epoch: 0 });
    expect(ucis(B2)).toEqual(['e2e4', 'e7e5', 'g1f3']);
    await h.settle();
    expect(B2.ctrl.snapshot).toMatchObject({ epoch: 1, live: true });
    expect(ucis(B2)).toEqual(['e2e4', 'e7e5']);
    expect(saved(B2)[0].room).toEqual({ n: 1, epoch: 1 });
    expect(B2.kinds()).not.toContain('restored-from-opponent');
  });

  it('an older backup several games behind catches up (rule 1)', async () => {
    const { h, A, B } = await joined();
    const backup = B.storage.dump();
    await play(h, [A, B], ['e2e4']);
    A.ctrl.resign();
    await h.settle();
    B.ctrl.ask('rematch');
    await h.settle();
    A.ctrl.reply('rematch', true);
    await h.settle();
    await play(h, [A, B], ['e2e4']);
    B.ctrl.leave();
    await h.settle();
    const B2 = h.device('B2', { storage: memoryStorage(backup) });
    await h.settle();
    expect(B2.ctrl.snapshot).toMatchObject({ n: 2, live: true, score: [0, 2] });
    expect(strip(B2.ctrl.snapshot.logs)).toEqual(strip(A.ctrl.snapshot.logs));
    expect(room(B2)?.games).toEqual([`${CODE}.1`, `${CODE}.2`]);
  });

  it("fork resolution: seat 0's copy wins and each device shows the restore toast once", async () => {
    const key = generateKey(seeded(11));
    const mine = buildLog(1, 0, null, ['e2e4', 'e7e5']);
    const theirs = buildLog(1, 0, null, ['d2d4', 'd7d5']);
    const h = createHarness({ code: CODE });
    const A = h.device('A', { storage: seededStorage(0, key, [mine]) });
    const B = h.device('B', { storage: seededStorage(1, key, [theirs]) });
    await h.settle();
    for (const d of [A, B]) {
      expect(ucis(d)).toEqual(['e2e4', 'e7e5']);
      expect(d.kinds().filter((k) => k === 'restored-from-opponent').length).toBe(1);
      expect(d.ctrl.snapshot.live).toBe(true);
    }
    expect(zhess.decodeMoves(saved(B)[0].moves)).toEqual(['e2e4', 'e7e5']);
  });

  it('a stale or conflicting live move is ignored and answered with a head', async () => {
    const key = generateKey(seeded(21));
    const log = buildLog(1, 0, null, ['e2e4', 'e7e5']);
    const h = createHarness({ code: CODE });
    const pair = fakePair(h.time);
    const peer = scriptPeer(pair.b);
    const A = h.deviceOn('A', pair.a, { storage: seededStorage(0, key, [log]) });
    await h.settle();
    const hello = peer.of('hello')[0];
    peer.send({ t: 'hello', v: 1, hasKey: true, nonce: 'BBBBBBBBBBBBBBBBBBBBBB' });
    await h.settle();
    peer.send({ t: 'proof', v: 1, mac: await proveSeat(key, hello.nonce, CODE, 1) });
    await h.settle();
    expect(peer.of('head').length).toBe(1);
    peer.send(makeHead(log));
    await h.settle();
    expect(A.ctrl.snapshot.live).toBe(true);
    const heads = () => peer.of('head').length;
    // Stale epoch.
    peer.send({ t: 'move', v: 1, n: 1, epoch: 0, i: 1, m: 'e7e6', ms: 5 });
    await h.settle();
    expect(heads()).toBe(2);
    // A ply for A's own color (white to move at i = 2).
    peer.send({ t: 'move', v: 1, n: 1, epoch: 0, i: 2, m: 'g1f3', ms: 5 });
    await h.settle();
    expect(heads()).toBe(3);
    // An older game number.
    peer.send({ t: 'move', v: 1, n: 0, epoch: 0, i: 0, m: 'e2e4', ms: 5 });
    await h.settle();
    expect(ucis(A)).toEqual(['e2e4', 'e7e5']);
    // Garbage does not break anything.
    peer.send({ t: 'move', v: 1 } as unknown as Message);
    peer.send({ t: 'ask', v: 1, kind: 'nonsense' } as unknown as Message);
    peer.send({ t: 'logs', v: 1, games: [{ n: 1, epoch: 9, white: 0, tc: null, plies: [{ m: 'e2e5', ms: 0 }] }] } as unknown as Message);
    await h.settle();
    expect(A.kinds()).toContain('sync-error');
    expect(ucis(A)).toEqual(['e2e4', 'e7e5']);
    expect(A.ctrl.snapshot.live).toBe(true);
  });

  it('messages from an unauthenticated peer are ignored', async () => {
    const key = generateKey(seeded(22));
    const log = buildLog(1, 0, null, ['e2e4']);
    const h = createHarness({ code: CODE });
    const pair = fakePair(h.time);
    const peer = scriptPeer(pair.b);
    const A = h.deviceOn('A', pair.a, { storage: seededStorage(0, key, [log]) });
    await h.settle();
    peer.send({ t: 'hello', v: 1, hasKey: true, nonce: 'BBBBBBBBBBBBBBBBBBBBBB' });
    peer.send({ t: 'head', v: 1, n: 5, epoch: 0, len: 0, hash: 'x', ended: false });
    peer.send({ t: 'logs', v: 1, games: [buildLog(2, 0, null, [])] });
    peer.send({ t: 'move', v: 1, n: 1, epoch: 0, i: 1, m: 'e7e5', ms: 0 });
    peer.send({ t: 'end', v: 1, n: 1, result: '1-0', by: 'resign' });
    await h.settle();
    expect(A.ctrl.snapshot).toMatchObject({ live: false, n: 1, phase: 'handshake' });
    expect(ucis(A)).toEqual(['e2e4']);
    expect(peer.of('head')).toEqual([]);
    expect(peer.of('proof').length).toBe(1);
  });
});

/* ---------------------------------------------------------------------------------------------- */
/* Version, read-only, misc                                                                         */
/* ---------------------------------------------------------------------------------------------- */

describe('protocol version', () => {
  it('a peer with another version: calm update-needed lock and a notice, nothing else is sent', async () => {
    const h = createHarness({ code: CODE });
    const pair = fakePair(h.time);
    const peer = scriptPeer(pair.b);
    const A = h.deviceOn('A', pair.a, { create: { tc: null, color: 'w' } });
    await h.settle();
    peer.send({ t: 'hello', v: 2, hasKey: true, nonce: 'BBBBBBBBBBBBBBBBBBBBBB' } as unknown as Message);
    await h.settle();
    expect(A.ctrl.snapshot).toMatchObject({ locked: 'version', phase: 'version', canMove: false, live: false });
    expect(A.kinds()).toEqual(['version-mismatch']);
    expect(peer.inbox.map((m) => m.t)).toEqual(['hello']);
    expect(A.ctrl.move('e2e4')).toBe(false);
    expect(A.ctrl.resign()).toBe(false);
    // Our own hello carried v 1, so the other side can show its toast too.
    expect(peer.of('hello')[0].v).toBe(1);
  });

  it('two controllers: both lock when one side runs another version', async () => {
    const h = createHarness({ code: CODE });
    const pair = fakePair(h.time);
    const A = h.deviceOn('A', pair.a, { create: { tc: null, color: 'w' } });
    // B stands for a device on version 2: its messages carry v 2, and it sees everything with
    // another version than its own (rewritten to 2 here, since this controller only speaks v 1).
    const b = pair.b;
    const send = b.send.bind(b);
    (b as { send: (m: Message) => void }).send = (m: Message) => send({ ...m, v: 2 } as unknown as Message);
    const on = b.onMessage.bind(b);
    (b as { onMessage: (cb: (m: Message) => void) => () => void }).onMessage = (cb) => on((m) => cb({ ...m, v: 2 } as unknown as Message));
    const B = h.deviceOn('B', b);
    await h.settle();
    expect(A.ctrl.snapshot.locked).toBe('version');
    expect(B.ctrl.snapshot.locked).toBe('version');
    expect(A.kinds()).toEqual(['version-mismatch']);
    expect(B.kinds()).toEqual(['version-mismatch']);
  });
});

describe('misc', () => {
  it('read-only (another tab): loads the room, never connects, board locked', async () => {
    const { h, A, B } = await joined();
    await play(h, [A, B], ['e2e4']);
    const R = h.deviceOn('R', null, { storage: A.storage, readOnly: true, factory: h.net.factory });
    await h.settle();
    expect(R.ctrl.snapshot).toMatchObject({ locked: 'other-tab', phase: 'read-only', seat: 0, canMove: false });
    expect(ucis(R)).toEqual(['e2e4']);
    expect(R.ctrl.transport).toBeNull();
    expect(h.net.peers(CODE).length).toBe(2);
  });

  it('leave() closes the transport and makes the controller inert', async () => {
    const { h, A, B } = await joined();
    const seen: string[] = [];
    A.ctrl.subscribe((s) => seen.push(s.phase));
    A.ctrl.leave();
    await h.settle();
    expect(A.ctrl.snapshot.phase).toBe('closed');
    expect(A.ctrl.move('e2e4')).toBe(false);
    expect(A.kinds()).toEqual(['opponent-joined']);
    expect(B.ctrl.snapshot.presence).toBe('reconnecting');
    expect(seen).toEqual(['closed']);
  });

  it('subscribe gets a new immutable snapshot on every change; unsubscribe stops it', async () => {
    const { h, A, B } = await joined();
    const snaps: unknown[] = [];
    const off = A.ctrl.subscribe((s) => snaps.push(s));
    const before = A.ctrl.snapshot;
    await play(h, [A, B], ['e2e4']);
    expect(snaps.length).toBeGreaterThan(0);
    expect(Object.isFrozen(A.ctrl.snapshot)).toBe(true);
    expect(before.game.plies).toEqual([]);
    off();
    const n = snaps.length;
    await play(h, [A, B], ['e7e5']);
    expect(snaps.length).toBe(n);
  });

  it('attach() switches to another transport (manual connection, then back)', async () => {
    const h = createHarness({ code: CODE });
    const p1 = fakePair(h.time);
    const A = h.deviceOn('A', p1.a, { create: { tc: null, color: 'w' } });
    const B = h.deviceOn('B', p1.b);
    await h.settle();
    expect(A.ctrl.snapshot.live).toBe(true);
    await play(h, [A, B], ['e2e4']);
    p1.close();
    await h.settle();
    expect(A.ctrl.snapshot.live).toBe(false);
    const p2 = fakePair(h.time);
    A.ctrl.attach(p2.a);
    B.ctrl.attach(p2.b);
    await h.settle();
    expect(A.ctrl.snapshot.live).toBe(true);
    expect(A.kinds().at(-1)).toBe('reconnected');
    await play(h, [A, B], ['e7e5']);
    expect(ucis(A)).toEqual(['e2e4', 'e7e5']);
  });

  it('a failing factory is reported as broker-unreachable', async () => {
    const h = createHarness({ code: CODE });
    const D = h.deviceOn('D', null, { create: { tc: null, color: 'w' }, factory: () => Promise.reject(new Error('no')) });
    await h.settle();
    expect(D.ctrl.snapshot.failure).toBe('broker-unreachable');
  });

  it('transport failures are exposed; ice-failed raises its notice once', async () => {
    const { h, A } = await joined();
    h.net.link(CODE)?.fail('a', 'ice-failed');
    await h.settle();
    expect(A.ctrl.snapshot.failure).toBe('ice-failed');
    expect(A.ctrl.snapshot.failureKind).toBe('ice-failed');
    h.net.link(CODE)?.fail('a', 'ice-failed');
    await h.settle();
    expect(A.kinds().filter((k) => k === 'ice-failed').length).toBe(1);
  });
});

/* ---------------------------------------------------------------------------------------------- */
/* Randomized: two devices always converge                                                          */
/* ---------------------------------------------------------------------------------------------- */

describe('randomized sessions', () => {
  it('moves, takebacks, draws, resignations, rematches and disconnects: both devices end equal', async () => {
    for (let seed = 1; seed <= 16; seed++) {
      const rnd = seeded(seed * 104729);
      const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)];
      const { h, A, B } = await joined({ tc: null, color: pick(['w', 'b'] as const) });
      const devs = [A, B];
      const link = () => h.net.link(CODE);
      let up = true;
      const trace: string[] = [];
      const t0 = (x: string) => trace.push(x);
      A.ctrl.onNotice((n) => t0(`A!${n.kind}`));
      B.ctrl.onNotice((n) => t0(`B!${n.kind}`));
      for (let step = 0; step < 60; step++) {
        const r = rnd();
        const mover = devs.find((d) => d.ctrl.snapshot.myTurn);
        const g = mover?.ctrl.snapshot.game;
        t0(`#${step} up=${up} A=${A.ctrl.snapshot.n}/${A.ctrl.snapshot.epoch}/${A.ctrl.snapshot.game.plies.length}${A.ctrl.snapshot.game.end ? 'E' : ''} B=${B.ctrl.snapshot.n}/${B.ctrl.snapshot.epoch}/${B.ctrl.snapshot.game.plies.length}${B.ctrl.snapshot.game.end ? 'E' : ''} r=${r.toFixed(2)}`);
        if (up && r < 0.08) {
          link()?.disconnect();
          up = false;
        } else if (!up && r < 0.35) {
          link()?.reconnect();
          up = true;
        } else if (r < 0.75 && mover && g && !g.end) {
          const moves = zhess.legalMoves(g);
          if (moves.length) mover.ctrl.move(pick(moves).uci, Math.floor(rnd() * 5000));
        } else if (up && r < 0.85) {
          const asker = pick(devs);
          const kind = pick(['takeback', 'draw', 'rematch'] as const);
          if (asker.ctrl.ask(kind)) {
            await h.settle();
            const other = devs.find((d) => d !== asker) as Device;
            if (rnd() < 0.2) {
              link()?.disconnect();
              up = false;
            }
            other.ctrl.reply(kind, rnd() < 0.6);
          }
        } else if (r < 0.88) {
          // Only while connected: two resignations made while apart are two different finished
          // copies, which reconcile settles as a fork (rule 4, seat 0 wins, with the toast).
          if (up) pick(devs).ctrl.resign();
        } else if (r < 0.95) {
          const over = devs.every((d) => d.ctrl.snapshot.game.end);
          if (up && over) {
            A.ctrl.ask('rematch');
            await h.settle();
            B.ctrl.reply('rematch', true);
          }
        }
        await h.settle();
        if (up) {
          expect(strip(A.ctrl.snapshot.logs), `seed ${seed} step ${step}`).toEqual(strip(B.ctrl.snapshot.logs));
        }
      }
      link()?.reconnect();
      await h.settle();
      expect(A.ctrl.snapshot.live && B.ctrl.snapshot.live).toBe(true);
      expect(strip(A.ctrl.snapshot.logs)).toEqual(strip(B.ctrl.snapshot.logs));
      expect(A.ctrl.snapshot.unsent + B.ctrl.snapshot.unsent).toBe(0);
      expect(A.ctrl.snapshot.score).toEqual(B.ctrl.snapshot.score);
      expect(A.ctrl.snapshot.score).toEqual(roomScore(A.ctrl.snapshot.logs));
      expect(room(A)?.score).toEqual(room(B)?.score);
      if (process.env.ROOM_TRACE === String(seed)) console.log(trace.join('\n'));
      for (const d of devs) {
        expect(d.kinds(), `seed ${seed}`).not.toContain('sync-error');
        expect(d.kinds(), `seed ${seed}`).not.toContain('restored-from-opponent');
        const stored = saved(d).map((x) => [x.id, x.moves, x.result ?? '', x.room?.epoch]).sort();
        const other = saved(d === A ? B : A).map((x) => [x.id, x.moves, x.result ?? '', x.room?.epoch]).sort();
        expect(stored).toEqual(other);
      }
    }
  }, 60_000);
});

describe('both devices end the game while apart', () => {
  it('two finished copies of different length are a fork: seat 0 wins and both are told once', async () => {
    const { h, A, B } = await joined({ tc: null, color: 'w' });
    await play(h, [A, B], ['e2e4', 'e7e5']);
    h.net.link(CODE)?.disconnect();
    await h.settle();
    A.ctrl.move('g1f3');
    A.ctrl.resign();
    B.ctrl.resign();
    h.net.link(CODE)?.reconnect();
    await h.settle();
    for (const d of [A, B]) {
      expect(ucis(d)).toEqual(['e2e4', 'e7e5', 'g1f3']);
      expect(d.ctrl.snapshot.game.end).toEqual({ result: '0-1', by: 'resign' });
      expect(d.kinds().filter((k) => k === 'restored-from-opponent').length).toBe(1);
    }
    expect(A.ctrl.snapshot.score).toEqual([0, 2]);
  });
});

describe('plain transports', () => {
  /** Only the `Transport` contract of types.ts: no state, no reconnect, no unsubscribe. */
  function plain(t: import('./transport/memory').MemoryTransport): import('./types').Transport {
    return {
      get role() {
        return t.role;
      },
      send: (m) => t.send(m),
      onMessage: (cb) => {
        t.onMessage(cb);
      },
      onState: (cb) => {
        t.onState(cb);
      },
      close: () => t.close(),
    };
  }

  it('work end to end, and a dead channel without reconnect() is handshaken again in place', async () => {
    const h = createHarness({ code: CODE });
    const pair = fakePair(h.time);
    const A = h.deviceOn('A', null, { create: { tc: null, color: 'w' }, transport: plain(pair.a) });
    const B = h.deviceOn('B', null, { transport: plain(pair.b) });
    await h.settle();
    expect(A.ctrl.snapshot.live && B.ctrl.snapshot.live).toBe(true);
    await play(h, [A, B], ['e2e4']);
    pair.setDrop(true);
    await h.advance(ROOM_DEFAULTS.pingMs * 4);
    expect(A.ctrl.snapshot.live).toBe(false);
    expect(B.ctrl.snapshot.live).toBe(false);
    pair.setDrop(false);
    await h.advance(ROOM_DEFAULTS.pingMs * 5);
    expect(A.ctrl.snapshot.live && B.ctrl.snapshot.live).toBe(true);
    await play(h, [A, B], ['e7e5']);
    expect(ucis(A)).toEqual(['e2e4', 'e7e5']);
  });
});
