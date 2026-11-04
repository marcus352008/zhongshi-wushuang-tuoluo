import { type AuthSession } from '../auth/drawAuth';
import { VERSION } from '../config/balance';
import {
  connectRoomWs,
  createRoom,
  fetchDailyPlays,
  fetchRosterClassName,
  joinRoom,
  type DailyPlaysInfo,
  type RoomConnection,
  type RoomStateMsg,
} from '../pvp/client';
import {
  resolvePlayerForm,
  saveFormOverride,
  type FormLevel,
  type FormResolution,
} from '../pvp/form';
import { mountLeaderboardPanel, type LeaderboardPanelHandle } from './leaderboard';

export interface ActivePvpSession {
  roomCode: string;
  role: 'host' | 'guest';
  form: FormLevel;
  state: RoomStateMsg | null;
  conn: RoomConnection;
}

export interface LobbyHooks {
  onCpu: () => void;
  onPvpStart: (room: ActivePvpSession) => void;
  onLogout: () => void;
}

export function mountLobby(
  root: HTMLElement,
  _app: unknown,
  session: AuthSession,
  hooks: LobbyHooks,
): () => void {
  root.innerHTML = '';

  let disposed = false;
  let activeConn: RoomConnection | null = null;
  let currentRoomState: RoomStateMsg | null = null;
  let currentRole: 'host' | 'guest' = 'host';
  let dailyQuota: DailyPlaysInfo = {
    ok: true,
    hkDate: '',
    used: 0,
    remaining: 3,
    limit: 3,
  };
  let rosterClass = '';
  let formRes: FormResolution = resolvePlayerForm(session.email, '');
  let lbHandle: LeaderboardPanelHandle | null = null;

  const wrap = document.createElement('div');
  wrap.style.cssText = [
    'position:fixed;inset:0;z-index:40;',
    'display:flex;align-items:flex-start;justify-content:center;',
    'background:radial-gradient(ellipse at 50% 20%, #1e1836 0%, #090812 75%);',
    'color:#f4f0ff;font-family:"Noto Sans TC","PingFang HK",sans-serif;',
    'padding:20px 16px;overflow-y:auto;',
  ].join('');

  const card = document.createElement('div');
  card.style.cssText = [
    'width:min(600px, 96vw);',
    'margin:auto 0;',
    'background:rgba(20, 16, 38, 0.94);',
    'border:1px solid rgba(255, 210, 110, 0.35);',
    'border-radius:18px;',
    'padding:22px 24px;',
    'box-shadow:0 20px 60px rgba(0,0,0,0.65);',
  ].join('');

  const mainSection = document.createElement('div');
  const lbContainer = document.createElement('div');
  card.append(mainSection, lbContainer);
  wrap.appendChild(card);
  root.appendChild(wrap);

  function setStatusMsg(text: string, isError = false): void {
    const el = mainSection.querySelector<HTMLElement>('#pvp-status-msg');
    if (!el) return;
    el.textContent = text;
    el.style.display = text ? 'block' : 'none';
    el.style.background = isError ? 'rgba(220, 50, 60, 0.18)' : 'rgba(90, 200, 140, 0.16)';
    el.style.borderColor = isError ? 'rgba(255, 100, 110, 0.5)' : 'rgba(110, 230, 160, 0.45)';
    el.style.color = isError ? '#ffb4b8' : '#b8f7d4';
  }

  function cleanupConn(): void {
    if (activeConn) {
      activeConn.sendLeave();
      activeConn.close();
      activeConn = null;
    }
    currentRoomState = null;
  }

  async function refreshQuota(): Promise<void> {
    try {
      const q = await fetchDailyPlays(session.email);
      if (disposed) return;
      if (q && typeof q.remaining === 'number') {
        dailyQuota = q;
        render();
      }
    } catch {
      /* ignore network hiccup */
    }
  }

  function enterRoomSocket(code: string, roleHint: 'host' | 'guest', form: FormLevel): void {
    cleanupConn();
    currentRole = roleHint;
    setStatusMsg('正在連線至對戰房間…', false);

    const conn = connectRoomWs(
      code,
      {
        email: session.email,
        form,
        name: session.email.split('@')[0],
        className: rosterClass,
        roleHint,
      },
      {
        onWelcome: (w) => {
          currentRole = w.role;
          setStatusMsg(
            w.role === 'host'
              ? '房間已建立！請將上方 5 位配對碼告訴同級同學。'
              : '已成功加入房間！等待房主開始對戰。',
            false,
          );
          render();
        },
        onState: (st) => {
          currentRoomState = st;
          if (st.you?.role) currentRole = st.you.role;
          render();
        },
        onStarted: (st) => {
          setStatusMsg(st.msg || '對戰開始！進入組裝畫面…', false);
          void refreshQuota();
          if (activeConn) {
            const passConn = activeConn;
            activeConn = null;
            lbHandle?.destroy();
            lbHandle = null;
            hooks.onPvpStart({
              roomCode: st.code,
              role: currentRole,
              form,
              state: currentRoomState,
              conn: passConn,
            });
          }
        },
        onToast: (t) => {
          setStatusMsg(t.msg, !!t.bad);
        },
        onFatal: (f) => {
          activeConn = null;
          currentRoomState = null;
          render();
          setStatusMsg(f.msg || '房間連線中斷。', true);
        },
        onClose: (ev) => {
          if (activeConn === conn && ev.code !== 1000) {
            activeConn = null;
            currentRoomState = null;
            render();
            if (ev.code !== 4403 && ev.code !== 4404 && ev.code !== 4001) {
              setStatusMsg('與房間的連線已中斷，請重新開房或入房。', true);
            }
          }
        },
      },
    );

    activeConn = conn;
    render();
  }

  function render(): void {
    if (disposed) return;
    const canPvp = formRes.canPvp && !!formRes.form;
    const quotaLeft = dailyQuota.remaining;
    const inRoom = !!activeConn;
    const phase = currentRoomState?.phase || 'lobby';
    const players = currentRoomState?.players || [];

    mainSection.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:14px;">
        <div>
          <div style="font-size:12px;color:#ffd26e;letter-spacing:1.5px;font-weight:700;">中史無雙陀螺 · 對戰大廳</div>
          <h2 style="margin:4px 0 0;font-size:24px;color:#fff;">選擇對戰模式</h2>
        </div>
        <div style="text-align:right;font-size:12px;color:#b9b2d8;">
          <div>${session.email}</div>
          <div style="margin-top:4px;">
            <span style="opacity:0.75;">v${VERSION}</span>
            <button id="btn-lobby-logout" style="margin-left:8px;background:transparent;border:1px solid rgba(255,255,255,0.25);color:#ddd;border-radius:6px;padding:2px 8px;font-size:11px;cursor:pointer;">登出</button>
          </div>
        </div>
      </div>

      <!-- 每日場次與年級資訊列 -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px;">
        <div style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.12);border-radius:12px;padding:12px;">
          <div style="font-size:12px;color:#b9b2d8;">今日雙人對戰剩餘場次</div>
          <div style="margin-top:4px;display:flex;align-items:baseline;gap:6px;">
            <span style="font-size:28px;font-weight:800;color:${quotaLeft > 0 ? '#ffd26e' : '#ff6b7a'};">${quotaLeft}</span>
            <span style="font-size:13px;color:#9e96bf;">/ ${dailyQuota.limit} 場（香港時間日切）</span>
          </div>
          <div style="font-size:11px;color:#8a82ab;margin-top:4px;">成功開打方扣 1 次；對電腦不扣次數</div>
        </div>

        <div style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.12);border-radius:12px;padding:12px;">
          <div style="font-size:12px;color:#b9b2d8;">所屬年級（同級方可對戰）</div>
          <div style="margin-top:6px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            ${
              canPvp
                ? `<span style="display:inline-block;background:#ffd26e;color:#1a1333;font-weight:800;padding:3px 10px;border-radius:99px;font-size:15px;">${formRes.form}</span>`
                : `<span style="display:inline-block;background:#ff5c6c;color:#fff;font-weight:700;padding:3px 10px;border-radius:99px;font-size:13px;">不適用 PvP</span>`
            }
            ${
              !rosterClass || formRes.isTeacher
                ? `<select id="sel-lobby-form" ${inRoom ? 'disabled' : ''} style="background:#151129;color:#fff;border:1px solid rgba(255,210,110,0.4);border-radius:8px;padding:4px 8px;font-size:13px;cursor:pointer;">
                    <option value="F1" ${formRes.form === 'F1' ? 'selected' : ''}>中一 (F1)</option>
                    <option value="F2" ${formRes.form === 'F2' ? 'selected' : ''}>中二 (F2)</option>
                    <option value="F3" ${formRes.form === 'F3' ? 'selected' : ''}>中三 (F3)</option>
                  </select>`
                : `<span style="font-size:12px;color:#b9b2d8;">班別：${rosterClass}</span>`
            }
          </div>
          <div style="font-size:11px;color:#8a82ab;margin-top:6px;">
            ${formRes.isTeacher ? '老師帳號（預設 F1，可切換年級測試）' : '只限初中 F1／F2／F3 同級實時配對'}
          </div>
        </div>
      </div>

      <!-- 狀態／錯誤訊息 -->
      <div id="pvp-status-msg" style="display:none;margin-bottom:14px;padding:10px 14px;border-radius:10px;border:1px solid transparent;font-size:13px;line-height:1.45;"></div>

      ${
        !canPvp && formRes.reason
          ? `<div style="margin-bottom:14px;padding:10px 14px;border-radius:10px;background:rgba(255,90,100,0.16);border:1px solid rgba(255,90,100,0.45);color:#ffb8c0;font-size:13px;">
              ${formRes.reason}
            </div>`
          : ''
      }

      ${
        !inRoom
          ? `
        <!-- 未入房：三大行動區 -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">
          <button id="btn-create-room" ${!canPvp || quotaLeft <= 0 ? 'disabled' : ''} style="
            padding:16px 14px;border-radius:14px;border:1px solid rgba(255,210,110,0.5);
            background:${!canPvp || quotaLeft <= 0 ? 'rgba(255,255,255,0.06)' : 'linear-gradient(135deg, #f5b942 0%, #d48817 100%)'};
            color:${!canPvp || quotaLeft <= 0 ? '#777' : '#18122b'};
            font-size:17px;font-weight:800;cursor:${!canPvp || quotaLeft <= 0 ? 'not-allowed' : 'pointer'};
            display:flex;flex-direction:column;align-items:center;gap:4px;
          ">
            <span>⚔️ 開房（建立配對碼）</span>
            <span style="font-size:11px;font-weight:600;opacity:0.85;">產生 5 位代碼邀請同級同學實時對戰</span>
          </button>

          <button id="btn-vs-cpu" style="
            padding:16px 14px;border-radius:14px;border:1px solid rgba(130,180,255,0.45);
            background:linear-gradient(135deg, #2b4c7e 0%, #1b2e4f 100%);
            color:#eef4ff;font-size:17px;font-weight:800;cursor:pointer;
            display:flex;flex-direction:column;align-items:center;gap:4px;
          ">
            <span>🤖 對電腦（練習）</span>
            <span style="font-size:11px;font-weight:500;color:#b8d0ff;">不限年級 · 不扣今日場次</span>
          </button>
        </div>

        <!-- 入房輸入區 -->
        <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.12);border-radius:14px;padding:14px;">
          <div style="font-size:13px;font-weight:700;margin-bottom:8px;color:#e2dcff;">🔑 輸入 5 位配對碼入房</div>
          <div style="display:flex;gap:10px;">
            <input
              id="inp-room-code"
              type="text"
              maxlength="5"
              placeholder="例如：8K3P9"
              ${!canPvp || quotaLeft <= 0 ? 'disabled' : ''}
              style="
                flex:1;background:#0e0b1c;border:1px solid rgba(255,210,110,0.45);
                border-radius:10px;padding:10px 14px;color:#ffd26e;
                font-size:22px;font-weight:800;letter-spacing:6px;text-transform:uppercase;
                text-align:center;outline:none;
              "
            />
            <button id="btn-join-room" ${!canPvp || quotaLeft <= 0 ? 'disabled' : ''} style="
              padding:0 22px;border-radius:10px;border:none;
              background:${!canPvp || quotaLeft <= 0 ? '#333' : '#6c5ce7'};
              color:${!canPvp || quotaLeft <= 0 ? '#777' : '#fff'};
              font-size:16px;font-weight:700;cursor:${!canPvp || quotaLeft <= 0 ? 'not-allowed' : 'pointer'};
            ">入房</button>
          </div>
        </div>
      `
          : `
        <!-- 已在房間內：顯示超大配對碼、玩家狀態與開始掣 -->
        <div style="background:rgba(255,210,110,0.07);border:2px solid rgba(255,210,110,0.55);border-radius:16px;padding:18px;text-align:center;margin-bottom:14px;">
          <div style="font-size:12px;color:#ffd26e;letter-spacing:1px;">房間配對碼（限 ${currentRoomState?.hostForm || formRes.form} 同級加入）</div>
          <div style="
            font-size:48px;font-weight:900;letter-spacing:10px;color:#ffffff;
            margin:8px 0;font-family:monospace;text-shadow:0 0 20px rgba(255,210,110,0.45);
          ">${activeConn?.code || '-----'}</div>
          <div style="font-size:12px;color:#c7c0e8;">
            狀態：${
              phase === 'lobby'
                ? '⏳ 等待第 2 位同級同學加入 (1/2)…'
                : phase === 'ready'
                  ? '✅ 2 人已到齊（Ready），可開始雙人對戰！'
                  : '🔥 對戰進行中'
            }
          </div>
        </div>

        <!-- 房間座位列表 -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px;">
          ${[0, 1]
            .map((idx) => {
              const p = players[idx];
              if (!p) {
                return `
                  <div style="background:rgba(255,255,255,0.03);border:1px dashed rgba(255,255,255,0.2);border-radius:12px;padding:12px;text-align:center;color:#7e779e;">
                    <div style="font-size:12px;">座位 ${idx + 1}</div>
                    <div style="margin-top:6px;font-size:14px;">等待加入…</div>
                  </div>
                `;
              }
              return `
                <div style="background:rgba(108,92,231,0.16);border:1px solid rgba(150,135,255,0.45);border-radius:12px;padding:12px;">
                  <div style="display:flex;justify-content:space-between;font-size:11px;color:#ffd26e;">
                    <span>${p.role === 'host' ? '👑 房主 (P1)' : '⚔️ 挑戰者 (P2)'}</span>
                    <span>${p.form}</span>
                  </div>
                  <div style="margin-top:4px;font-size:15px;font-weight:700;color:#fff;word-break:break-all;">${p.name}</div>
                  <div style="margin-top:2px;font-size:11px;color:${p.connected ? '#7bed9f' : '#ff6b81'};">
                    ${p.connected ? '● 在線' : '○ 離線'}
                  </div>
                </div>
              `;
            })
            .join('')}
        </div>

        <div style="display:flex;gap:10px;">
          <button id="btn-start-pvp" ${phase !== 'ready' ? 'disabled' : ''} style="
            flex:2;padding:14px;border-radius:12px;border:none;
            background:${phase === 'ready' ? 'linear-gradient(135deg, #2ed573 0%, #1eae53 100%)' : '#2f2b45'};
            color:${phase === 'ready' ? '#0b1f13' : '#7d7799'};
            font-size:16px;font-weight:800;cursor:${phase === 'ready' ? 'pointer' : 'not-allowed'};
          ">
            ${phase === 'ready' ? '🚀 開始雙人對戰（各扣 1 場）' : '等待對手到齊…'}
          </button>

          <button id="btn-leave-room" style="
            flex:1;padding:14px;border-radius:12px;border:1px solid rgba(255,110,120,0.45);
            background:rgba(255,80,90,0.12);color:#ffb0b8;font-size:14px;font-weight:700;cursor:pointer;
          ">離開房間</button>
        </div>
      `
      }
    `;

    // 綁定事件
    const btnLogout = mainSection.querySelector<HTMLButtonElement>('#btn-lobby-logout');
    btnLogout?.addEventListener('click', () => {
      cleanupConn();
      lbHandle?.destroy();
      lbHandle = null;
      hooks.onLogout();
    });

    const selForm = mainSection.querySelector<HTMLSelectElement>('#sel-lobby-form');
    selForm?.addEventListener('change', () => {
      const next = selForm.value as FormLevel;
      saveFormOverride(next);
      formRes = resolvePlayerForm(session.email, rosterClass, { overrideForm: next });
      render();
    });

    const btnCpu = mainSection.querySelector<HTMLButtonElement>('#btn-vs-cpu');
    btnCpu?.addEventListener('click', () => {
      cleanupConn();
      lbHandle?.destroy();
      lbHandle = null;
      hooks.onCpu();
    });

    const btnCreate = mainSection.querySelector<HTMLButtonElement>('#btn-create-room');
    btnCreate?.addEventListener('click', async () => {
      if (!formRes.canPvp || !formRes.form) {
        setStatusMsg(formRes.reason || '只限初中 F1–F3 建立房間。', true);
        return;
      }
      btnCreate.disabled = true;
      setStatusMsg('正在建立對戰房間…', false);
      try {
        const res = await createRoom(session.email, formRes.form);
        if (!res.ok || !res.roomCode) {
          setStatusMsg(res.error || '未能建立房間，請稍後再試。', true);
          btnCreate.disabled = false;
          return;
        }
        enterRoomSocket(res.roomCode, 'host', formRes.form);
      } catch {
        setStatusMsg('網絡錯誤，無法建立房間。', true);
        btnCreate.disabled = false;
      }
    });

    const inpCode = mainSection.querySelector<HTMLInputElement>('#inp-room-code');
    const btnJoin = mainSection.querySelector<HTMLButtonElement>('#btn-join-room');

    inpCode?.addEventListener('input', () => {
      inpCode.value = inpCode.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    });

    const doJoin = async (): Promise<void> => {
      if (!formRes.canPvp || !formRes.form) {
        setStatusMsg(formRes.reason || '只限初中 F1–F3 加入房間。', true);
        return;
      }
      const code = (inpCode?.value || '').trim().toUpperCase();
      if (code.length !== 5) {
        setStatusMsg('請輸入完整的 5 位配對碼。', true);
        return;
      }
      if (btnJoin) btnJoin.disabled = true;
      setStatusMsg(`正在檢查房間 ${code}…`, false);
      try {
        const res = await joinRoom(session.email, formRes.form, code);
        if (!res.ok || !res.roomCode) {
          setStatusMsg(res.error || '無法加入此房間。', true);
          if (btnJoin) btnJoin.disabled = false;
          return;
        }
        enterRoomSocket(res.roomCode, 'guest', formRes.form);
      } catch {
        setStatusMsg('網絡錯誤，無法加入房間。', true);
        if (btnJoin) btnJoin.disabled = false;
      }
    };

    btnJoin?.addEventListener('click', () => void doJoin());
    inpCode?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') void doJoin();
    });

    const btnStartPvp = mainSection.querySelector<HTMLButtonElement>('#btn-start-pvp');
    btnStartPvp?.addEventListener('click', () => {
      if (!activeConn) return;
      btnStartPvp.disabled = true;
      setStatusMsg('正在核對雙方今日場次並啟動對戰…', false);
      activeConn.sendStart();
    });

    const btnLeave = mainSection.querySelector<HTMLButtonElement>('#btn-leave-room');
    btnLeave?.addEventListener('click', () => {
      cleanupConn();
      render();
      setStatusMsg('已離開對戰房間。', false);
    });
  }

  // 初次渲染 + 掛載 Top 20 風雲榜面板
  render();
  lbHandle = mountLeaderboardPanel(lbContainer, {
    currentEmail: session.email,
    initialForm: 'ALL',
  });

  void refreshQuota();
  void fetchRosterClassName(session).then((cls) => {
    if (disposed || !cls) return;
    rosterClass = cls;
    formRes = resolvePlayerForm(session.email, cls);
    render();
  });

  // 必須回傳 cleanup：大廳係 position:fixed;z-index:40 全螢幕遮罩，
  // 若 showPvpAssemble／showCpuAssemble 嘅 clear() 清唔走，組裝／對戰畫面會被蓋住。
  return () => {
    if (disposed) return;
    disposed = true;
    cleanupConn();
    lbHandle?.destroy();
    lbHandle = null;
    wrap.remove();
  };
}
