import './ui/style.css';
import { AppState } from './app/state';
import { clearSession, mountLoginScreen, type AuthSession } from './auth/drawAuth';
import { Sfx } from './audio/sfx';
import { loadCards } from './cards/loader';
import { fetchOwnedCards } from './cards/ownership';
import type { Loadout } from './cards/types';
import { VERSION } from './config/balance';
import { parseParams } from './core/params';
import { randomSeed } from './core/rng';
import { pickCpuLoadout } from './game/cpu';
import type { Match } from './game/match';
import { Input } from './input/input';
import { loadQuizBanksFromSheetSync } from './launch/quizLoader';
import {
  loadoutFromCardIds,
  serializeLoadoutIds,
  type RoomEndMsg,
  type RoomMatchReadyMsg,
} from './pvp/client';
import { resolvePlayerForm, type FormLevel } from './pvp/form';
import { enterBattleFullscreen, exitBattleFullscreen, installLeaveGuards } from './pvp/fullscreen';
import { ArenaView } from './render/arenaView';
import { mountSpectateView } from './spectate/spectate';
import { mountAssemble } from './ui/assemble';
import { Battle } from './ui/battle';
import { h, toast } from './ui/dom';
import { mountEnd } from './ui/end';
import { mountLeaderboardPanel } from './ui/leaderboard';
import { mountLobby, type ActivePvpSession } from './ui/lobby';
import { mountToggles } from './ui/toggles';

const $ = (id: string) => document.getElementById(id)!;

async function boot(): Promise<void> {
  $('version').textContent = `v${VERSION}`;
  const params = parseParams();

  try {
    const quizLoad = await loadQuizBanksFromSheetSync();
    console.info('[quiz]', quizLoad);
  } catch (e) {
    console.warn('[quiz] load failed; using built-in bank', e);
  }

  // P0-3: teacher spectate — skip login/assemble; read-only HUD.
  if (params.spectate) {
    mountSpectateView($('screens'), params.spectate);
    return;
  }

  let load;
  try {
    load = await loadCards();
  } catch (e) {
    $('screens').append(
      h('div.screen', {}, h('div.screen-inner', {}, h('h1', {}, '載入失敗'), h('p.subtitle', {}, String(e)))),
    );
    return;
  }
  const app = new AppState(load, params, params.seed ?? randomSeed());

  // P0-1: login before lobby/assemble/battle
  let session: AuthSession;
  try {
    const login = await mountLoginScreen($('screens'));
    session = login.session;
  } catch (e) {
    $('screens').append(
      h('div.screen', {}, h('div.screen-inner', {}, h('h1', {}, '登入失敗'), h('p.subtitle', {}, String(e)))),
    );
    return;
  }
  app.authSession = session;
  app.playerName = session.email.split('@')[0] || '玩家';
  if (session.preview) {
    $('version').textContent = `v${VERSION}　預覽`;
  }

  // P0-2: owned cards from collection API (failure ≠ empty owned set)
  const refreshOwned = async (opts?: { quiet?: boolean }): Promise<boolean> => {
    app.setOwnershipLoading();
    const result = await fetchOwnedCards(app.cards, { email: session.email, session });
    if (result.ok) {
      app.applyOwnedSuccess(result.ids);
      return true;
    }
    console.warn('[ownership]', result.kind, result.message);
    app.applyOwnedFailure(result.message);
    if (!opts?.quiet) {
      const kept = app.ownedIds.size > 0 ? `（仍保留上次 ${app.ownedIds.size} 張）` : '';
      toast(`${result.message}${kept}`);
    }
    return false;
  };

  await refreshOwned();

  const view = new ArenaView($('stage'), !app.settings.lowGfx);
  const sfx = new Sfx();
  const unlockAudio = () => sfx.unlock();
  window.addEventListener('pointerdown', unlockAudio);
  window.addEventListener('keydown', unlockAudio);
  app.onChange(() => {
    if (view.hiQuality === app.settings.lowGfx) view.setQuality(!app.settings.lowGfx);
    if (sfx.muted !== app.settings.muted) sfx.setMuted(app.settings.muted);
  });
  mountToggles($('top-right'), app, ['lowGfx', 'muted']);

  const input = new Input({
    joystick: $('joystick'),
    knob: $('knob'),
    charge: $('charge-btn'),
    dash: $('dash-btn'),
    aimLeft: $('aim-left'),
    aimRight: $('aim-right'),
    special: $('special-btn'),
  });
  const bar = {
    root: $('bottom-bar'),
    status: $('bar-status'),
    meter: $('charge-meter'),
    sweet: $('sweet-band'),
    fill: $('charge-fill'),
    charge: $('charge-btn'),
    dash: $('dash-btn') as HTMLButtonElement,
    aimLeft: $('aim-left'),
    aimRight: $('aim-right'),
    special: $('special-btn') as HTMLButtonElement,
  };

  let battle: Battle | null = null;
  let unmount: (() => void) | null = null;
  let pvpBanner: HTMLElement | null = null;
  let activePvp: ActivePvpSession | null = null;
  let teardownGuards: (() => void) | null = null;

  const clearLeaveGuards = () => {
    teardownGuards?.();
    teardownGuards = null;
  };

  const clear = () => {
    unmount?.();
    unmount = null;
    battle?.dispose();
    battle = null;
  };

  const removePvpBanner = () => {
    pvpBanner?.remove();
    pvpBanner = null;
  };

  const setBar = (visible: boolean) => $('version').classList.toggle('no-bar', !visible);

  const showLobby = () => {
    clear();
    clearLeaveGuards();
    removePvpBanner();
    void exitBattleFullscreen();
    setBar(false);
    if (activePvp) {
      try {
        activePvp.conn.sendLeave();
        activePvp.conn.close();
      } catch {
        /* ignore */
      }
      activePvp = null;
    }
    $('screens').innerHTML = '';
    unmount = mountLobby($('screens'), app, session, {
      onCpu: () => {
        showCpuAssemble();
      },
      onPvpStart: (room) => {
        showPvpAssemble(room);
      },
      onLogout: () => {
        clearSession();
        location.reload();
      },
    });
  };

  // =========================================================================
  // 1) 單機 VS CPU 路徑（完整保留，並套用玩家所屬年級儲力題庫）
  // =========================================================================

  const showCpuAssemble = () => {
    void (async () => {
      clear();
      clearLeaveGuards();
      removePvpBanner();
      setBar(false);
      activePvp = null;
      $('screens').innerHTML = '';
      $('screens').append(
        h(
          'div.screen',
          {},
          h('div.screen-inner', {}, h('p.subtitle', {}, '正在載入你的擁有卡…')),
        ),
      );

      await refreshOwned({ quiet: false });

      const resolvedForm = resolvePlayerForm(session.email).form;
      $('screens').innerHTML = '';

      pvpBanner = h(
        'div',
        {
          style: {
            position: 'fixed',
            top: '10px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: '90',
            background: 'rgba(20, 16, 38, 0.92)',
            border: '1px solid rgba(130, 180, 255, 0.45)',
            borderRadius: '99px',
            padding: '5px 16px',
            color: '#d8e6ff',
            fontSize: '12px',
            fontWeight: '700',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
          },
        },
        h(
          'span',
          {},
          `🤖 單人練習模式（對電腦・不扣場次${resolvedForm ? `・${resolvedForm}儲力題` : ''}）`,
        ),
        h(
          'button',
          {
            type: 'button',
            style: {
              background: '#2b4c7e',
              border: '1px solid rgba(255,255,255,0.25)',
              color: '#fff',
              borderRadius: '99px',
              padding: '2px 10px',
              fontSize: '11px',
              cursor: 'pointer',
            },
            onclick: () => showLobby(),
          },
          '返回大廳',
        ),
      );
      document.body.appendChild(pvpBanner);

      unmount = mountAssemble(
        $('screens'),
        app,
        (player) => {
          removePvpBanner();
          app.cpu = pickCpuLoadout(app.cards, app.rng, params.cpu);
          startCpuBattle([player, app.cpu]);
        },
        {
          onRetryOwned: async () => {
            await refreshOwned({ quiet: false });
          },
        },
      );
    })();
  };

  const startCpuBattle = (loadouts: [Loadout, Loadout]) => {
    clear();
    removePvpBanner();
    setBar(true);
    const playerForm = resolvePlayerForm(session.email).form;
    battle = new Battle(
      app,
      view,
      sfx,
      input,
      bar,
      $('screens'),
      loadouts,
      {
        onReassemble: () => showCpuAssemble(),
        onEnd: (match) => {
          clear();
          setBar(false);
          unmount = mountEnd($('screens'), match, {
            rematch: () => startCpuBattle(loadouts),
            reassemble: () => showCpuAssemble(),
            swap: () => {
              app.player = { ...loadouts[1] };
              app.cpu = loadouts[0];
              startCpuBattle([loadouts[1], loadouts[0]]);
            },
          });
        },
      },
      undefined,
      playerForm,
    );
  };

  // =========================================================================
  // 2) 真雙人 PvP 路徑（組裝交換 → 全螢幕防離開 → 同級題庫 → 完場 +60s & 風雲榜）
  // =========================================================================

  const showPvpEndScreen = (
    match: Match,
    mySeat: 0 | 1,
    names: [string, string],
    roomForm: FormLevel,
    endMsg?: RoomEndMsg,
  ) => {
    clear();
    clearLeaveGuards();
    removePvpBanner();
    void exitBattleFullscreen();
    setBar(false);

    const scores: [number, number] = endMsg?.scores ?? [match.scores[0], match.scores[1]];
    const winnerSeat: 0 | 1 | null =
      endMsg && (endMsg.winnerSeat === 0 || endMsg.winnerSeat === 1 || endMsg.winnerSeat === null)
        ? endMsg.winnerSeat
        : match.winner;

    const iWon = winnerSeat === mySeat;
    const isDraw = winnerSeat === null;
    const headline = isDraw ? '平手！' : iWon ? '🏆 你獲勝了！' : '惜敗！再接再厲';
    const subline =
      endMsg?.reason === 'forfeit'
        ? endMsg.msg
        : `${names[0]}（房主） ${scores[0]} : ${scores[1]} ${names[1]}（挑戰者）`;

    const lbWrap = h('div', { style: { marginBottom: '18px' } });

    const screen = h(
      'div.screen',
      {},
      h(
        'div.screen-inner',
        { style: { maxWidth: '580px', textAlign: 'center', margin: '0 auto' } },
        h('h1', { style: { fontSize: '34px', marginBottom: '6px' } }, headline),
        h('p.subtitle', { style: { fontSize: '15px', color: '#ffd26e', marginBottom: '14px' } }, subline),
        h(
          'div.box',
          { style: { marginBottom: '12px', padding: '14px' } },
          h('div', { style: { fontSize: '13px', color: '#b9b2d8' } }, `最終比數（進行了 ${match.round} 回合）`),
          h(
            'div',
            { style: { fontSize: '38px', fontWeight: '900', margin: '6px 0', color: '#fff' } },
            `${scores[0]} : ${scores[1]}`,
          ),
          h(
            'div',
            { style: { fontSize: '12px', color: '#9e96bf' } },
            `P1：${names[0]}（${match.sides[0].loadout.A.name}・${match.sides[0].loadout.B.name}・${match.sides[0].loadout.C.name}）`,
          ),
          h(
            'div',
            { style: { fontSize: '12px', color: '#9e96bf', marginTop: '4px' } },
            `P2：${names[1]}（${match.sides[1].loadout.A.name}・${match.sides[1].loadout.B.name}・${match.sides[1].loadout.C.name}）`,
          ),
        ),
        h(
          'div.box',
          {
            style: {
              marginBottom: '14px',
              padding: '10px 14px',
              borderColor: 'rgba(110, 230, 160, 0.45)',
              background: 'rgba(46, 213, 115, 0.12)',
              color: '#b8f7d4',
              fontSize: '13px',
              fontWeight: '700',
            },
          },
          '📚 完成雙人對戰獎勵：系統已為雙方自動記錄 Flash 溫習時間 +60 秒，並更新無雙風雲榜！',
        ),
        lbWrap,
        h(
          'button.btn.primary.big',
          {
            onclick: () => showLobby(),
          },
          '返回對戰大廳',
        ),
      ),
    );

    $('screens').replaceChildren(screen);

    const lbHandle = mountLeaderboardPanel(lbWrap, {
      currentEmail: session.email,
      initialForm: roomForm || 'ALL',
      compact: true,
    });
    // 背景 waitUntil 寫入 Sheet 約需 1~2 秒，延遲觸發一次 fresh 讀取以反映本場最新勝敗
    const syncTimer = window.setTimeout(() => {
      void lbHandle.refresh(true);
    }, 1800);

    unmount = () => {
      window.clearTimeout(syncTimer);
      lbHandle.destroy();
      screen.remove();
    };
  };

  const startPvpBattle = (pvpRoom: ActivePvpSession, readyMsg: RoomMatchReadyMsg) => {
    const r0 = loadoutFromCardIds(app.cards, readyMsg.loadouts[0]);
    const r1 = loadoutFromCardIds(app.cards, readyMsg.loadouts[1]);
    if (!r0.ok || !r1.ok) {
      const errText = !r0.ok ? r0.error : !r1.ok ? r1.error : '未知卡牌錯誤';
      toast(`無法還原對戰陣容：${errText}`);
      showLobby();
      return;
    }

    clear();
    removePvpBanner();
    setBar(true);

    void enterBattleFullscreen();
    clearLeaveGuards();
    teardownGuards = installLeaveGuards();

    const mySeat: 0 | 1 = pvpRoom.role === 'host' ? 0 : 1;
    const isHost = mySeat === 0;
    const names: [string, string] = [
      readyMsg.players[0]?.name || '房主',
      readyMsg.players[1]?.name || '挑戰者',
    ];

    battle = new Battle(
      app,
      view,
      sfx,
      input,
      bar,
      $('screens'),
      [r0.loadout, r1.loadout],
      {
        onReassemble: () => {
          /* PvP 對戰中禁止重新組裝 */
        },
        onEnd: (match, endMsg) => {
          showPvpEndScreen(match, mySeat, names, pvpRoom.form, endMsg);
        },
      },
      {
        roomCode: pvpRoom.roomCode,
        form: pvpRoom.form,
        seat: mySeat,
        isHost,
        matchSeed: readyMsg.matchSeed,
        playerNames: names,
        sendInput: (pkt) => pvpRoom.conn.sendInput(pkt),
        sendSnap: (snap) => pvpRoom.conn.sendSnap(snap),
        sendForfeit: () => pvpRoom.conn.sendForfeit(),
        sendMatchEnd: (scores, winnerSeat) => pvpRoom.conn.sendMatchEnd(scores, winnerSeat),
      },
    );
  };

  const showPvpAssemble = (pvpRoom: ActivePvpSession) => {
    void (async () => {
    clear();
    removePvpBanner();
    setBar(false);
    activePvp = pvpRoom;
    $('screens').innerHTML = '';
    $('screens').append(
      h(
        'div.screen',
        {},
        h('div.screen-inner', {}, h('p.subtitle', {}, '正在載入你的擁有卡…')),
      ),
    );

    clearLeaveGuards();
    teardownGuards = installLeaveGuards();

    await refreshOwned({ quiet: false });
    $('screens').innerHTML = '';

    const opp = pvpRoom.state?.players.find((p) => p.email !== session.email);
    const oppName = opp ? opp.name : '同級同學';

    pvpBanner = h(
      'div',
      {
        style: {
          position: 'fixed',
          top: '10px',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: '90',
          background: 'rgba(20, 16, 38, 0.95)',
          border: '1px solid #ffd26e',
          borderRadius: '99px',
          padding: '6px 18px',
          color: '#ffd26e',
          fontSize: '13px',
          fontWeight: '700',
          boxShadow: '0 6px 20px rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
        },
      },
      h(
        'span',
        { id: 'pvp-assemble-status' },
        `⚔️ 房間 ${pvpRoom.roomCode}（${pvpRoom.form} 題庫）· 對手：${oppName} · 請組裝出戰陀螺`,
      ),
    );
    document.body.appendChild(pvpBanner);

    pvpRoom.conn.setCallbacks({
      onState: (st) => {
        pvpRoom.state = st;
        const other = st.players.find((p) => p.email !== session.email);
        const statusEl = document.getElementById('pvp-assemble-status');
        if (statusEl && other) {
          statusEl.textContent = other.loadoutReady
            ? `⚔️ 房間 ${pvpRoom.roomCode}（${pvpRoom.form}）· 對手 ${other.name} 已完成組裝，等你出戰！`
            : `⚔️ 房間 ${pvpRoom.roomCode}（${pvpRoom.form}）· 對手 ${other.name} 正在組裝中…`;
        }
      },
      onMatchReady: (readyMsg) => {
        startPvpBattle(pvpRoom, readyMsg);
      },
      onInput: (pkt) => {
        battle?.receiveRemoteInput(pkt);
      },
      onSnap: (snap) => {
        battle?.receiveSnap(snap);
      },
      onEnd: (endMsg) => {
        if (battle) {
          battle.receiveMatchEnd(endMsg);
        } else {
          toast(endMsg.msg || '對手已棄權，對戰結束！');
          showLobby();
        }
      },
      onToast: (t) => {
        toast(t.msg);
      },
      onFatal: (f) => {
        toast(f.msg || '房間連線中斷');
        showLobby();
      },
    });

    unmount = mountAssemble(
      $('screens'),
      app,
      (playerLoadout) => {
      const ids = serializeLoadoutIds(playerLoadout);
      pvpRoom.conn.sendLoadout(ids);

      let forfeitConfirm = false;
      const forfeitBtn = h(
        'button.btn',
        {
          style: { marginTop: '18px', borderColor: '#ff6b81', color: '#ffb8c0' },
          onclick: () => {
            if (!forfeitConfirm) {
              forfeitConfirm = true;
              forfeitBtn.textContent = '⚠️ 確定棄權認輸？（將直接判負）';
              forfeitBtn.style.background = '#c0392b';
              forfeitBtn.style.color = '#fff';
              return;
            }
            pvpRoom.conn.sendForfeit();
          },
        },
        '🏳️ 棄權認輸',
      );

      const waitScreen = h(
        'div.screen',
        {},
        h(
          'div.screen-inner',
          { style: { maxWidth: '480px', textAlign: 'center', margin: '0 auto' } },
          h('h1', {}, '已鎖定出戰陀螺！'),
          h(
            'p.subtitle',
            {},
            `你的陣容：${playerLoadout.A.name}・${playerLoadout.B.name}・${playerLoadout.C.name}`,
          ),
          h(
            'div.box',
            { style: { padding: '20px', marginTop: '14px' } },
            h('div', { style: { fontSize: '18px', fontWeight: '700', color: '#ffd26e' } }, '⏳ 正在等待對手完成組裝…'),
            h(
              'div',
              { style: { fontSize: '13px', color: '#b9b2d8', marginTop: '8px' } },
              `本場採用 ${pvpRoom.form} 專屬儲力題庫；完場後雙方各獲 Flash 溫習 +60 秒並計入風雲榜。`,
            ),
          ),
          forfeitBtn,
        ),
      );
      $('screens').replaceChildren(waitScreen);
      unmount = () => waitScreen.remove();
    },
      {
        onRetryOwned: async () => {
          await refreshOwned({ quiet: false });
        },
      },
    );
    })();
  };

  // =========================================================================
  // 3) 主遊戲迴圈 + 切分頁背景 Keepalive
  // =========================================================================

  let last = performance.now();
  const stepLoop = (now: number) => {
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    if (battle) {
      battle.update(dt);
    } else {
      input.consume();
      sfx.setHum(0);
    }
  };

  const loop = (now: number) => {
    stepLoop(now);
    view.render();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  window.setInterval(() => {
    if (document.visibilityState === 'hidden' && battle) {
      stepLoop(performance.now());
    }
  }, 50);

  showLobby();
}

void boot();
