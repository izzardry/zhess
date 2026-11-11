/** Room UI components (React Testing Library), driven by props or by useRoom over a fake controller. */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { toast } from 'sonner';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ShareNavigator } from '@/components/game/share';
import { IDLE_ROOM_VIEW, useRoom, type ManualView, type UseRoomOptions } from '@/hooks/useRoom';
import { dictionaries } from '@/lib/i18n';
import type { RoomControllerOptions } from '@/lib/room';
import type { RoomNotice, RoomNoticeKind } from '@/lib/types';
import { parseUrl, serializeUrl, urlQuery } from '@/lib/url';
import {
  InviteSheet,
  ManualConnectSheet,
  PresenceDot,
  RequestToasts,
  RoomBanner,
  RoomToasts,
  manualCauseKey,
  manualIssueKey,
  noticeKey,
  pendingKey,
  presenceKey,
  requestKey,
  shouldOfferInvite,
  signalOf,
  withoutSignal,
} from './index';
import { createFakeController, fakeRoomState, renderRoom, type FakeController } from './testUtils';

afterEach(() => {
  act(() => {
    toast.dismiss();
  });
  vi.useRealTimers();
});

const EN = dictionaries.en;

const manual = (patch: Partial<ManualView>): ManualView => ({ ...IDLE_ROOM_VIEW.manual, ...patch });

function fakeNav(withShare = true): ShareNavigator & { copied: string[]; shared: ShareData[] } {
  const copied: string[] = [];
  const shared: ShareData[] = [];
  return {
    copied,
    shared,
    clipboard: { writeText: async (s: string) => void copied.push(s) },
    share: withShare ? async (d: ShareData) => void shared.push(d) : undefined,
  };
}

/* ---------------------------------------------------------------------------------------------- */
/* Pure helpers                                                                                     */
/* ---------------------------------------------------------------------------------------------- */

describe('room text helpers', () => {
  it('maps every presence, notice, request, problem and cause to an existing string', () => {
    for (const p of ['connected', 'waiting', 'connecting', 'reconnecting'] as const) expect(EN[presenceKey(p)]).toBeTruthy();
    const kinds: RoomNoticeKind[] = [
      'opponent-joined',
      'opponent-connected',
      'opponent-disconnected',
      'reconnected',
      'restored-from-opponent',
      'sync-error',
      'version-mismatch',
      'rejoin-denied',
      'challenge-failed',
      'request-declined',
      'ice-failed',
    ];
    for (const kind of kinds) expect(EN[noticeKey({ kind })], kind).toBeTruthy();
    expect(EN[noticeKey({ kind: 'request-declined', request: 'takeback' })]).toBe('Takeback declined');
    expect(EN[noticeKey({ kind: 'restored-from-opponent' })]).toBe('Game restored from opponent’s copy');
    expect(EN[noticeKey({ kind: 'ice-failed' })]).toBe('Could not reach your opponent directly. Try another network.');
    for (const k of ['takeback', 'draw', 'rematch', 'rejoin'] as const) expect(EN[requestKey(k)]).toBeTruthy();
    expect(EN[requestKey('rejoin')]).toBe('Opponent is rejoining from a new device');
    for (const k of ['takeback', 'draw', 'rematch'] as const) expect(EN[pendingKey(k)]).toBeTruthy();
    for (const i of ['invalid', 'wrong-kind', 'mismatch', 'used', 'other-room', 'webrtc', 'ice-failed'] as const) {
      for (const lang of ['en', 'de', 'fr', 'es'] as const) expect(dictionaries[lang][manualIssueKey(i)], `${lang} ${i}`).toBeTruthy();
    }
    expect(manualCauseKey('no-broker')).toBeNull();
    for (const c of ['broker-unreachable', 'ice-failed', 'timeout'] as const) expect(EN[manualCauseKey(c)!]).toBeTruthy();
  });

  it('offers the invite while the creator waits in an open room', () => {
    expect(shouldOfferInvite(null)).toBe(false);
    expect(shouldOfferInvite(fakeRoomState())).toBe(true);
    expect(shouldOfferInvite(fakeRoomState({ seat: 1 }))).toBe(false);
    expect(shouldOfferInvite(fakeRoomState({ lastSeenAt: 5 }))).toBe(false);
    expect(shouldOfferInvite(fakeRoomState({ live: true }))).toBe(false);
    expect(shouldOfferInvite(fakeRoomState({ phase: 'read-only' }))).toBe(false);
  });

  it('reads and clears the transient x / y parameters (DESIGN 13.2)', () => {
    const p = parseUrl('s=K7QW2M&o=r&x=abc_-1');
    expect(signalOf(p)).toEqual({ offer: 'abc_-1', answer: null });
    expect(signalOf(parseUrl('s=K7QW2M&o=r&y=zz'))).toEqual({ offer: null, answer: 'zz' });
    expect(signalOf({})).toEqual({ offer: null, answer: null });
    expect(urlQuery(withoutSignal(p))).toBe('s=K7QW2M&o=r');
    expect(serializeUrl(withoutSignal({ ...p, answer: 'q' })).has('y')).toBe(false);
  });
});

/* ---------------------------------------------------------------------------------------------- */
/* PresenceDot                                                                                      */
/* ---------------------------------------------------------------------------------------------- */

describe('PresenceDot', () => {
  it('is solid when connected and hollow and pulsing otherwise', () => {
    const { container, rerender } = renderRoom(<PresenceDot presence="connected" />);
    expect(screen.getByRole('img', { name: 'Opponent connected' })).toBeInTheDocument();
    let dot = container.querySelector('[data-presence]')!;
    expect(dot.className).toContain('bg-success');
    expect(dot.className).not.toContain('animate-pulse');
    rerender(<PresenceDot presence="reconnecting" />);
    dot = container.querySelector('[data-presence]')!;
    expect(dot.getAttribute('data-presence')).toBe('reconnecting');
    expect(dot.className).toContain('animate-pulse');
    expect(dot.className).toContain('motion-reduce:animate-none');
  });

  it('opens the invite sheet when tapped', async () => {
    const onClick = vi.fn();
    renderRoom(<PresenceDot presence="waiting" onClick={onClick} />);
    await userEvent.click(screen.getByRole('button', { name: 'Waiting for opponent. Show invite' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('speaks German', () => {
    renderRoom(<PresenceDot presence="waiting" onClick={() => {}} />, 'de');
    expect(screen.getByRole('button', { name: 'Warte auf Gegner. Einladung zeigen' })).toBeInTheDocument();
  });
});

/* ---------------------------------------------------------------------------------------------- */
/* InviteSheet                                                                                      */
/* ---------------------------------------------------------------------------------------------- */

describe('InviteSheet', () => {
  it('shows the code, the invite link without moves or key, its QR code, and copies it', async () => {
    const nav = fakeNav(false);
    const onOpenChange = vi.fn();
    renderRoom(<InviteSheet open onOpenChange={onOpenChange} code="K7QW2M" presence="waiting" nav={nav} />);
    const sheet = screen.getByRole('dialog', { name: 'Invite your opponent' });
    expect(within(sheet).getByText('K7QW2M')).toBeInTheDocument();
    const field = within(sheet).getByRole('textbox', { name: 'Invite link' }) as HTMLInputElement;
    expect(field.value).toMatch(/#\/\?s=K7QW2M&o=r$/);
    expect(within(sheet).getByRole('img', { name: 'QR code of the link' })).toBeInTheDocument();
    expect(within(sheet).getByText('Waiting for opponent')).toBeInTheDocument();
    expect(within(sheet).queryByRole('button', { name: /share/i })).toBeNull(); // no share sheet here
    await userEvent.click(within(sheet).getByRole('button', { name: 'Copy link' }));
    expect(nav.copied).toEqual([field.value]);
    expect(await screen.findByText('Link copied!')).toBeInTheDocument();
    expect(within(sheet).queryByRole('button', { name: 'Connect manually' })).toBeNull();
    await userEvent.click(within(sheet).getByRole('button', { name: 'Close' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('uses the native share sheet with the room text', async () => {
    const nav = fakeNav(true);
    renderRoom(<InviteSheet open onOpenChange={() => {}} code="K7QW2M" link="https://x.test/#/?s=K7QW2M&o=r" nav={nav} />);
    await userEvent.click(screen.getByRole('button', { name: 'Share' }));
    expect(nav.shared).toEqual([{ title: 'Zhess', text: 'Join my chess game!', url: 'https://x.test/#/?s=K7QW2M&o=r' }]);
  });

  it('offers Connect manually with the calm reason when the 10-second rule says so', async () => {
    const connect = vi.fn();
    renderRoom(<InviteSheet open onOpenChange={() => {}} code="K7QW2M" manualCause="broker-unreachable" onConnectManually={connect} />);
    expect(screen.getByText('Could not reach the connection service.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Connect manually' }));
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('is not rendered while closed', () => {
    renderRoom(<InviteSheet open={false} onOpenChange={() => {}} code="K7QW2M" />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

/* ---------------------------------------------------------------------------------------------- */
/* ManualConnectSheet                                                                               */
/* ---------------------------------------------------------------------------------------------- */

describe('ManualConnectSheet', () => {
  const OFFER = 'https://x.test/#/?s=K7QW2M&o=r&x=OFFERVALUE';

  function Host({ initial, accept }: { initial: ManualView; accept: (t: string) => Promise<null | 'invalid'> }) {
    const [m, setM] = useState(initial);
    return (
      <ManualConnectSheet
        open
        onOpenChange={() => {}}
        manual={m}
        onAcceptAnswer={async (text) => {
          setM({ ...m, busy: true });
          const r = await accept(text);
          setM(r ? { ...m, busy: false, error: r } : { ...m, step: 'connecting', busy: false });
          return r;
        }}
        onStartOver={() => {}}
      />
    );
  }

  it('host: labels both steps, shows the offer link and QR, pastes the answer and connects', async () => {
    const accept = vi.fn(async (t: string) => (t.includes('y=') ? null : ('invalid' as const)));
    renderRoom(<Host initial={manual({ step: 'offer', role: 'host', link: OFFER })} accept={accept} />);
    const sheet = screen.getByRole('dialog', { name: 'Connect manually' });
    expect(within(sheet).getByText('Step 1 of 2')).toBeInTheDocument();
    expect(within(sheet).getByText('Step 2 of 2')).toBeInTheDocument();
    expect(within(sheet).getByText('Send this link to your opponent')).toBeInTheDocument();
    expect((within(sheet).getByRole('textbox', { name: 'Invite link' }) as HTMLInputElement).value).toBe(OFFER);
    expect(within(sheet).getByRole('img', { name: 'QR code of the link' })).toBeInTheDocument();

    const field = within(sheet).getByRole('textbox', { name: 'Answer link' });
    const connect = within(sheet).getByRole('button', { name: 'Connect' });
    expect(connect).toBeDisabled();
    await userEvent.type(field, 'nonsense');
    await userEvent.click(connect);
    expect(accept).toHaveBeenCalledWith('nonsense');
    expect(await within(sheet).findByRole('alert')).toHaveTextContent('This is not a Zhess answer link.');
    expect(field).toHaveAttribute('aria-invalid', 'true');

    await userEvent.clear(field);
    await userEvent.type(field, 'https://x.test/#/?s=K7QW2M&o=r&y=ANS{enter}');
    expect(accept).toHaveBeenLastCalledWith('https://x.test/#/?s=K7QW2M&o=r&y=ANS');
    expect(await within(sheet).findByText('Connecting…')).toBeInTheDocument();
    expect(within(sheet).queryByRole('textbox', { name: 'Answer link' })).toBeNull();
  });

  it('host: pasting a whole link connects at once', async () => {
    const accept = vi.fn(async () => null);
    renderRoom(<Host initial={manual({ step: 'offer', role: 'host', link: OFFER })} accept={accept} />);
    const field = screen.getByRole('textbox', { name: 'Answer link' });
    fireEvent.paste(field, { clipboardData: { getData: () => ' https://x.test/#/?y=ANS ' } });
    await waitFor(() => expect(accept).toHaveBeenCalledWith('https://x.test/#/?y=ANS'));
  });

  it('shows preparing, guest, connected, hand-over and error states', async () => {
    const startOver = vi.fn();
    const props = { open: true, onOpenChange: () => {}, onAcceptAnswer: async () => null, onStartOver: startOver };
    const { rerender } = renderRoom(<ManualConnectSheet {...props} manual={manual({ step: 'preparing', role: 'host' })} />);
    expect(screen.getByText('Preparing your link…')).toBeInTheDocument();

    rerender(<ManualConnectSheet {...props} manual={manual({ step: 'answer', role: 'guest', link: 'https://x.test/#/?s=K7QW2M&o=r&y=ANS' })} />);
    expect(screen.getByText('Step 2 of 2')).toBeInTheDocument();
    expect(screen.getByText('Send this link back to your opponent')).toBeInTheDocument();
    expect(screen.getByText('Waiting for your opponent…')).toBeInTheDocument();
    expect((screen.getByRole('textbox', { name: 'Invite link' }) as HTMLInputElement).value).toContain('y=ANS');

    rerender(<ManualConnectSheet {...props} manual={manual({ step: 'connected', role: 'guest' })} />);
    expect(screen.getByText('Connected')).toBeInTheDocument();

    rerender(<ManualConnectSheet {...props} manual={manual({ step: 'handover', role: 'host', handedOver: null, link: 'L?y=1' })} />);
    expect(screen.getByRole('dialog', { name: 'Answer link' })).toBeInTheDocument();
    expect(screen.getByText('Passing the link to your game…')).toBeInTheDocument();
    rerender(<ManualConnectSheet {...props} manual={manual({ step: 'handover', role: 'host', handedOver: true, link: 'L?y=1' })} />);
    expect(screen.getByText('Done. Go back to the tab with your game.')).toBeInTheDocument();
    rerender(<ManualConnectSheet {...props} manual={manual({ step: 'handover', role: 'host', handedOver: false, link: 'L?y=1' })} />);
    expect(screen.getByText('Copy this link and paste it into your waiting game.')).toBeInTheDocument();
    expect((screen.getByRole('textbox', { name: 'Invite link' }) as HTMLInputElement).value).toBe('L?y=1');
    expect(screen.queryByRole('img', { name: 'QR code of the link' })).toBeNull();

    rerender(<ManualConnectSheet {...props} manual={manual({ step: 'error', role: 'host', error: 'ice-failed' })} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Could not reach your opponent directly. Try another network.');
    await userEvent.click(screen.getByRole('button', { name: 'Start over' }));
    expect(startOver).toHaveBeenCalledTimes(1);

    rerender(<ManualConnectSheet {...props} manual={manual({ step: 'error', role: 'guest', error: 'invalid' })} />);
    expect(screen.queryByRole('button', { name: 'Start over' })).toBeNull();
  });

  it('speaks French with vous', () => {
    renderRoom(
      <ManualConnectSheet open onOpenChange={() => {}} manual={manual({ step: 'offer', role: 'host', link: OFFER })} onAcceptAnswer={async () => null} onStartOver={() => {}} />,
      'fr',
    );
    expect(screen.getByText('Envoyez ce lien à votre adversaire')).toBeInTheDocument();
    expect(screen.getByText('Étape 1 sur 2')).toBeInTheDocument();
  });
});

/* ---------------------------------------------------------------------------------------------- */
/* RequestToasts                                                                                    */
/* ---------------------------------------------------------------------------------------------- */

describe('RequestToasts', () => {
  it('shows an incoming draw offer with Decline and Accept, and answers it', async () => {
    const onReply = vi.fn();
    const { rerender } = renderRoom(<RequestToasts requests={{ incoming: 'draw' }} onReply={onReply} />);
    const t = await screen.findByRole('alertdialog', { name: 'Your opponent offers a draw' });
    await userEvent.click(within(t).getByRole('button', { name: 'Accept' }));
    expect(onReply).toHaveBeenCalledWith('draw', true);
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());

    rerender(<RequestToasts requests={{}} onReply={onReply} />);
    rerender(<RequestToasts requests={{ incoming: 'takeback' }} onReply={onReply} />);
    const t2 = await screen.findByRole('alertdialog', { name: 'Your opponent asks for a takeback' });
    await userEvent.click(within(t2).getByRole('button', { name: 'Decline' }));
    expect(onReply).toHaveBeenLastCalledWith('takeback', false);
  });

  it('asks to Allow a rejoin from a new device', async () => {
    const onReply = vi.fn();
    renderRoom(<RequestToasts requests={{ incoming: 'rejoin' }} onReply={onReply} />);
    const t = await screen.findByRole('alertdialog', { name: 'Opponent is rejoining from a new device' });
    await userEvent.click(within(t).getByRole('button', { name: 'Allow' }));
    expect(onReply).toHaveBeenCalledWith('rejoin', true);
  });

  it('withdraws the toast when the request lapses', async () => {
    const { rerender } = renderRoom(<RequestToasts requests={{ incoming: 'rematch' }} onReply={() => {}} />);
    expect(await screen.findByRole('alertdialog', { name: 'Your opponent wants a rematch' })).toBeInTheDocument();
    rerender(<RequestToasts requests={{}} onReply={() => {}} />);
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });

  // DESIGN 9.7: the requester sees a pending state on the button (undo, flag, overlay Rematch).
  // A toast here sat on the toolbar for as long as the request was open (Gate 3 finding), so this
  // test, which asserted that toast, now asserts its absence.
  it('shows no toast for an own request: its button carries the pending state', async () => {
    const { rerender } = renderRoom(<RequestToasts requests={{ outgoing: 'draw' }} onReply={() => {}} />);
    await act(async () => {});
    expect(screen.queryByText('Draw offered')).toBeNull();
    expect(screen.queryByText('Waiting for your opponent')).toBeNull();
    rerender(<RequestToasts requests={{ outgoing: 'takeback' }} onReply={() => {}} />);
    await act(async () => {});
    expect(screen.queryByText('Takeback requested')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('draws one frame, the toaster frame, around plain content (no card in a card)', async () => {
    renderRoom(<RequestToasts requests={{ incoming: 'takeback' }} onReply={() => {}} />);
    const content = await screen.findByRole('alertdialog', { name: 'Your opponent asks for a takeback' });
    expect(content).not.toHaveClass('toast');
    expect(content.className).not.toMatch(/\b(border|shadow|bg-card|rounded)/);
    const frame = content.closest('[data-sonner-toast]');
    expect(frame).not.toBeNull();
    expect(frame).toHaveClass('toast');
    expect(frame!.querySelectorAll('.toast')).toHaveLength(0);
  });

  it('speaks Spanish with tú', async () => {
    renderRoom(<RequestToasts requests={{ incoming: 'draw' }} onReply={() => {}} />, 'es');
    const t = await screen.findByRole('alertdialog', { name: 'Tu rival ofrece tablas' });
    expect(within(t).getByRole('button', { name: 'Aceptar' })).toBeInTheDocument();
    expect(within(t).getByRole('button', { name: 'Rechazar' })).toBeInTheDocument();
  });
});

/* ---------------------------------------------------------------------------------------------- */
/* RoomToasts                                                                                       */
/* ---------------------------------------------------------------------------------------------- */

function noticeSource() {
  const subs = new Set<(n: RoomNotice) => void>();
  let id = 0;
  return {
    onNotice: (cb: (n: RoomNotice) => void) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    emit: (kind: RoomNoticeKind, request?: RoomNotice['request']) =>
      act(() => {
        for (const cb of [...subs]) cb(request ? { id: ++id, kind, request } : { id: ++id, kind });
      }),
    count: () => subs.size,
  };
}

describe('RoomToasts', () => {
  it('shows each transition and sync notice as a one-line toast', async () => {
    const src = noticeSource();
    renderRoom(<RoomToasts onNotice={src.onNotice} onReply={() => {}} />);
    src.emit('opponent-joined');
    expect(await screen.findByText('Opponent joined')).toBeInTheDocument();
    src.emit('opponent-disconnected');
    expect(await screen.findByText('Opponent disconnected')).toBeInTheDocument();
    // Presence transitions share one toast: the latest replaces the earlier one.
    await waitFor(() => expect(screen.queryByText('Opponent joined')).toBeNull());
    src.emit('reconnected');
    expect(await screen.findByText('Reconnected')).toBeInTheDocument();
    src.emit('restored-from-opponent');
    expect(await screen.findByText('Game restored from opponent’s copy')).toBeInTheDocument();
    src.emit('request-declined', 'rematch');
    expect(await screen.findByText('Rematch declined')).toBeInTheDocument();
    src.emit('sync-error');
    expect(await screen.findByText('Could not sync this game with your opponent')).toBeInTheDocument();
  });

  it('runs the update check on a version mismatch and offers Reload', async () => {
    const src = noticeSource();
    const check = vi.fn();
    const reload = vi.fn();
    renderRoom(<RoomToasts onNotice={src.onNotice} onReply={() => {}} onUpdateCheck={check} onReload={reload} />);
    src.emit('version-mismatch');
    expect(check).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Your opponent uses another version. Reload to update.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('shows the calm ICE message once, with Connect manually, and drops it when live', async () => {
    const src = noticeSource();
    const connect = vi.fn();
    const { rerender } = renderRoom(<RoomToasts onNotice={src.onNotice} onReply={() => {}} onConnectManually={connect} />);
    src.emit('ice-failed');
    expect(await screen.findByText('Could not reach your opponent directly. Try another network.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Connect manually' }));
    expect(connect).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByText(/Could not reach your opponent/)).toBeNull());
    // Once only: a second ICE failure (or the same cause from useRoom) stays quiet.
    src.emit('ice-failed');
    rerender(<RoomToasts onNotice={src.onNotice} onReply={() => {}} onConnectManually={connect} manualCause="ice-failed" />);
    await act(async () => {});
    expect(screen.queryByText(/Could not reach your opponent/)).toBeNull();

    // The 10-second rule's own message; it goes away when the room is live.
    rerender(<RoomToasts onNotice={src.onNotice} onReply={() => {}} onConnectManually={connect} manualCause="timeout" />);
    expect(await screen.findByText('Still no connection to your opponent.')).toBeInTheDocument();
    rerender(<RoomToasts onNotice={src.onNotice} onReply={() => {}} onConnectManually={connect} manualCause={null} live />);
    await waitFor(() => expect(screen.queryByText('Still no connection to your opponent.')).toBeNull());
  });

  it('holds the failure message back while quiet and shows it afterwards if still owed', async () => {
    const src = noticeSource();
    const connect = vi.fn();
    const props = { onNotice: src.onNotice, onReply: () => {}, onConnectManually: connect };
    // A sheet is open (or this is a manual guest): the cause arrives but no toast covers the sheet.
    const { rerender } = renderRoom(<RoomToasts {...props} manualCause="broker-unreachable" quiet />);
    await act(async () => {});
    expect(screen.queryByText('Could not reach the connection service.')).toBeNull();
    // The sheet closes, the room is still not live: the message shows, with its button.
    rerender(<RoomToasts {...props} manualCause="broker-unreachable" />);
    expect(await screen.findByText('Could not reach the connection service.')).toBeInTheDocument();
    // A sheet opens over it: the message steps aside, and comes back when the sheet closes.
    rerender(<RoomToasts {...props} manualCause="broker-unreachable" quiet />);
    await waitFor(() => expect(screen.queryByText('Could not reach the connection service.')).toBeNull());
    rerender(<RoomToasts {...props} manualCause="broker-unreachable" />);
    expect(await screen.findByText('Could not reach the connection service.')).toBeInTheDocument();
    // Answered through its button: it does not come back after the manual sheet closes again.
    await userEvent.click(screen.getByRole('button', { name: 'Connect manually' }));
    expect(connect).toHaveBeenCalledTimes(1);
    rerender(<RoomToasts {...props} manualCause="broker-unreachable" quiet />);
    rerender(<RoomToasts {...props} manualCause="broker-unreachable" />);
    await waitFor(() => expect(screen.queryByText('Could not reach the connection service.')).toBeNull());
    await act(async () => {
      await new Promise((r) => setTimeout(r, 500));
    });
    expect(screen.queryByText('Could not reach the connection service.')).toBeNull();
  });

  it('an ICE failure while quiet waits; going live drops what is owed', async () => {
    const src = noticeSource();
    const props = { onNotice: src.onNotice, onReply: () => {}, onConnectManually: () => {} };
    const { rerender } = renderRoom(<RoomToasts {...props} quiet />);
    src.emit('ice-failed');
    await act(async () => {});
    expect(screen.queryByText(/Could not reach your opponent/)).toBeNull();
    rerender(<RoomToasts {...props} live quiet />);
    rerender(<RoomToasts {...props} live />);
    await act(async () => {});
    expect(screen.queryByText(/Could not reach your opponent/)).toBeNull();
  });

  it('shows no failure toast for a room without a broker (the invite sheet carries the button)', async () => {
    const src = noticeSource();
    renderRoom(<RoomToasts onNotice={src.onNotice} onReply={() => {}} manualCause="no-broker" onConnectManually={() => {}} />);
    await act(async () => {});
    expect(screen.queryByRole('button', { name: 'Connect manually' })).toBeNull();
  });

  it('unsubscribes on unmount', () => {
    const src = noticeSource();
    const { unmount } = renderRoom(<RoomToasts onNotice={src.onNotice} onReply={() => {}} />);
    expect(src.count()).toBe(1);
    unmount();
    expect(src.count()).toBe(0);
  });
});

/* ---------------------------------------------------------------------------------------------- */
/* RoomBanner                                                                                       */
/* ---------------------------------------------------------------------------------------------- */

describe('RoomBanner', () => {
  it('shows the other-tab state with Use here', async () => {
    const takeOver = vi.fn();
    renderRoom(<RoomBanner tab="other" phase="read-only" onTakeOver={takeOver} />);
    expect(screen.getByText('This room is open in another tab')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Use here' }));
    expect(takeOver).toHaveBeenCalledTimes(1);
  });

  it('shows version and denied states, and nothing while live or pending', async () => {
    const reload = vi.fn();
    const { rerender, container } = renderRoom(<RoomBanner tab="owner" phase="version" onReload={reload} />);
    await userEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(reload).toHaveBeenCalled();
    rerender(<RoomBanner tab="owner" phase="denied" />);
    expect(screen.getByText('Your opponent did not let this device in.')).toBeInTheDocument();
    rerender(<RoomBanner tab="owner" phase="live" />);
    expect(container.querySelector('[data-room-banner]')).toBeNull();
    rerender(<RoomBanner tab="pending" phase="read-only" />);
    expect(container.querySelector('[data-room-banner]')).toBeNull();
    rerender(<RoomBanner tab="handover" phase="read-only" />);
    expect(container.querySelector('[data-room-banner]')).toBeNull();
  });

  it('shows the joining message only after a moment', () => {
    vi.useFakeTimers();
    const { container } = renderRoom(<RoomBanner tab="owner" phase="joining" joiningDelayMs={1000} />);
    expect(container.querySelector('[data-room-banner]')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText('Asking your opponent for a seat…')).toBeInTheDocument();
  });
});

/* ---------------------------------------------------------------------------------------------- */
/* Wired together: useRoom over a fake controller                                                   */
/* ---------------------------------------------------------------------------------------------- */

function RoomScreen({ opts }: { opts: UseRoomOptions }) {
  const room = useRoom('K7QW2M', opts);
  const [invite, setInvite] = useState(false);
  const state = room.state;
  return (
    <div>
      {state && <PresenceDot presence={state.presence} onClick={() => setInvite(true)} />}
      <span data-testid="score">{`${room.score[0]} – ${room.score[1]}`}</span>
      <RoomToasts
        onNotice={room.onNotice}
        requests={state?.requests}
        onReply={room.reply}
        manualCause={room.manualCause}
        live={state?.live}
        onConnectManually={room.openManual}
      />
      <RoomBanner tab={room.tab} phase={state?.phase} onTakeOver={room.takeOver} />
      <InviteSheet open={invite} onOpenChange={setInvite} code="K7QW2M" presence={state?.presence} />
    </div>
  );
}

describe('room UI over useRoom', () => {
  it('renders presence, score, notices and requests of the controller and answers through it', async () => {
    const made: FakeController[] = [];
    const opts: UseRoomOptions = {
      broker: async () => ({ role: 'anchor', send() {}, onMessage() {}, onState() {}, close() {} }),
      locks: null,
      turnStorage: null,
      window: null,
      document: null,
      createController: (o: RoomControllerOptions) => {
        const c = createFakeController(o);
        made.push(c);
        return c;
      },
    };
    renderRoom(<RoomScreen opts={opts} />);
    const c = made[0];
    expect(screen.getByRole('button', { name: 'Waiting for opponent. Show invite' })).toBeInTheDocument();

    act(() => c.set({ presence: 'connected', live: true, phase: 'live', score: [2, 4], lastSeenAt: 1 }));
    expect(screen.getByRole('button', { name: 'Opponent connected. Show invite' })).toBeInTheDocument();
    expect(screen.getByTestId('score')).toHaveTextContent('1 – 2');

    act(() => c.notify('opponent-connected'));
    expect(await screen.findByText('Opponent connected', { selector: '[data-title]' })).toBeInTheDocument();

    act(() => c.set({ requests: { incoming: 'takeback' } }));
    const t = await screen.findByRole('alertdialog', { name: 'Your opponent asks for a takeback' });
    await userEvent.click(within(t).getByRole('button', { name: 'Accept' }));
    expect(c.reply).toHaveBeenCalledWith('takeback', true);
    act(() => c.set({ requests: {} }));

    await userEvent.click(screen.getByRole('button', { name: 'Opponent connected. Show invite' }));
    expect(screen.getByRole('dialog', { name: 'Invite your opponent' })).toBeInTheDocument();
  });
});
