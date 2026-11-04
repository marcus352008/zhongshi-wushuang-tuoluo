/**
 * Draw-app auth bridge (school Google email + GAS ActiveUser).
 * Compatible localStorage keys with draw-app where sensible.
 */
import { DRAW_BASE } from '../config/balance';
import {
  getHkClock,
  isLoginHoursOpen,
  MAINTENANCE_MSG,
} from './loginHours';

export const EMAIL_KEY = 'wushuang_draw_email';
export const PROOF_KEY = 'wushuang_draw_auth_proof';
export const GOOGLE_KEY = 'wushuang_draw_google_email';
export const PREVIEW_KEY = 'wushuang_battle_preview';
/** Battle session flag: logged in this session (avoids silent reuse of stale proof alone). */
export const SESSION_OK_KEY = 'wushuang_battle_auth_ok';

export interface AuthSession {
  email: string;
  googleEmail: string;
  token: string;
  /** True when health had no authBridge — email-only preview. */
  preview: boolean;
}

export interface HealthInfo {
  ok: boolean;
  authBridge: boolean;
  authBridgeUrl: string;
  version?: string;
}

export interface AuthProofMessage {
  type: 'wushuang-auth-bridge';
  ok?: boolean;
  match?: boolean;
  token?: string;
  typedEmail?: string;
  googleEmail?: string;
  error?: string;
}

export function loadStoredSession(): AuthSession | null {
  try {
    const email = (localStorage.getItem(EMAIL_KEY) || '').trim().toLowerCase();
    const token = localStorage.getItem(PROOF_KEY) || '';
    const googleEmail = (localStorage.getItem(GOOGLE_KEY) || '').trim().toLowerCase();
    const preview = localStorage.getItem(PREVIEW_KEY) === '1';
    if (!email) return null;
    if (preview) return { email, googleEmail: '', token: '', preview: true };
    if (token && googleEmail) return { email, googleEmail, token, preview: false };
    return null;
  } catch {
    return null;
  }
}

export function saveSession(s: AuthSession): void {
  try {
    localStorage.setItem(EMAIL_KEY, s.email);
    if (s.preview) {
      localStorage.setItem(PREVIEW_KEY, '1');
      localStorage.removeItem(PROOF_KEY);
      localStorage.removeItem(GOOGLE_KEY);
    } else {
      localStorage.removeItem(PREVIEW_KEY);
      localStorage.setItem(PROOF_KEY, s.token);
      localStorage.setItem(GOOGLE_KEY, s.googleEmail);
    }
    localStorage.setItem(SESSION_OK_KEY, '1');
  } catch {
    /* ignore */
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(PROOF_KEY);
    localStorage.removeItem(GOOGLE_KEY);
    localStorage.removeItem(PREVIEW_KEY);
    localStorage.removeItem(SESSION_OK_KEY);
  } catch {
    /* ignore */
  }
}

/** Headers for draw-app API calls (ASCII only). */
export function authHeaders(session: AuthSession | null): Record<string, string> {
  const h: Record<string, string> = { 'content-type': 'application/json' };
  if (!session?.email) return h;
  h['x-user-email'] = session.email;
  if (!session.preview && session.token && session.googleEmail) {
    h['x-auth-proof'] = `${session.email}|${session.googleEmail}|${session.token}`;
  }
  return h;
}

export async function fetchHealth(base = DRAW_BASE): Promise<HealthInfo> {
  const ctrl = new AbortController();
  const t = window.setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch(`${base}/api/health`, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`health HTTP ${res.status}`);
    const j = (await res.json()) as Record<string, unknown>;
    return {
      ok: !!j.ok,
      authBridge: !!j.authBridge,
      authBridgeUrl: typeof j.authBridgeUrl === 'string' ? j.authBridgeUrl : '',
      version: typeof j.version === 'string' ? j.version : undefined,
    };
  } finally {
    window.clearTimeout(t);
  }
}

/**
 * Open GAS ActiveUser popup; resolve with proof payload or reject with Traditional Chinese error.
 */
export function runAuthBridge(typedEmail: string, authBridgeUrl: string): Promise<AuthProofMessage> {
  return new Promise((resolve, reject) => {
    const origin = window.location.origin;
    const url =
      authBridgeUrl +
      (authBridgeUrl.includes('?') ? '&' : '?') +
      'typedEmail=' +
      encodeURIComponent(typedEmail) +
      '&returnOrigin=' +
      encodeURIComponent(origin);
    const popupWin = window.open(url, 'wushuang_auth_bridge', 'width=480,height=640');
    if (!popupWin) {
      reject(
        new Error(
          '請允許彈出視窗。若曾空白：請先用學校 Google 帳單獨開核對頁完成授權，再返嚟登入。',
        ),
      );
      return;
    }
    const popup: Window = popupWin;
    let done = false;
    let gotMessage = false;
    let closeGraceTimer: number | null = null;

    const finishReject = (err: Error) => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      window.clearInterval(closedPoll);
      if (closeGraceTimer !== null) window.clearTimeout(closeGraceTimer);
      window.removeEventListener('message', onMsg);
      reject(err);
    };

    const finishResolve = (d: AuthProofMessage) => {
      if (done) return;
      done = true;
      gotMessage = true;
      window.clearTimeout(timer);
      window.clearInterval(closedPoll);
      if (closeGraceTimer !== null) window.clearTimeout(closeGraceTimer);
      window.removeEventListener('message', onMsg);
      try {
        popup.close();
      } catch {
        /* ignore */
      }
      resolve(d);
    };

    const timer = window.setTimeout(() => {
      if (done || gotMessage) return;
      try {
        popup.close();
      } catch {
        /* ignore */
      }
      finishReject(new Error('Google 登入核對逾時。請用學校帳單獨開啟核對連結完成授權後再試。'));
    }, 45000);

    const closedPoll = window.setInterval(() => {
      if (done || gotMessage) return;
      try {
        if (popup.closed) {
          window.clearInterval(closedPoll);
          if (closeGraceTimer !== null) return;
          closeGraceTimer = window.setTimeout(() => {
            if (done || gotMessage) return;
            window.clearTimeout(timer);
            window.removeEventListener('message', onMsg);
            done = true;
            reject(new Error('核對視窗已關閉，請再試登入。'));
          }, 800);
        }
      } catch {
        /* ignore */
      }
    }, 400);

    function onMsg(ev: MessageEvent) {
      if (done) return;
      const d = ev?.data as AuthProofMessage | undefined;
      if (!d || d.type !== 'wushuang-auth-bridge') return;
      gotMessage = true;
      if (closeGraceTimer !== null) {
        window.clearTimeout(closeGraceTimer);
        closeGraceTimer = null;
      }
      window.clearTimeout(timer);
      window.clearInterval(closedPoll);
      window.removeEventListener('message', onMsg);
      try {
        popup.close();
      } catch {
        /* ignore */
      }
      if (d.ok && d.match && d.token) {
        finishResolve(d);
      } else {
        done = true;
        reject(
          new Error(
            (d && d.error) ||
              '輸入帳號與 Google 帳號不符，無法登入。若彈窗空白，請先單獨開核對頁授權。',
          ),
        );
      }
    }
    window.addEventListener('message', onMsg);
  });
}

function isValidSchoolEmail(email: string): boolean {
  const e = email.trim().toLowerCase();
  if (!e || e.length > 120) return false;
  // Basic email shape; school domains preferred but not hard-blocked for preview.
  return /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(e);
}

export interface LoginScreenResult {
  session: AuthSession;
}

/**
 * Traditional Chinese login screen (edict / scroll cover). Resolves when login succeeds.
 */
export function mountLoginScreen(root: HTMLElement): Promise<LoginScreenResult> {
  return new Promise((resolve) => {
    const screen = document.createElement('div');
    screen.className = 'screen login-screen';
    root.append(screen);

    const stored = loadStoredSession();
    let busy = false;

    const fetchAccess = async (): Promise<{ open: boolean; message: string; timeLabel: string }> => {
      try {
        const ctrl = new AbortController();
        const t = window.setTimeout(() => ctrl.abort(), 8000);
        const res = await fetch('/api/access', { signal: ctrl.signal, cache: 'no-store' });
        window.clearTimeout(t);
        if (!res.ok) throw new Error(`access HTTP ${res.status}`);
        const j = (await res.json()) as Record<string, unknown>;
        const open = !!j.loginOpen;
        const message =
          typeof j.message === 'string' && j.message
            ? j.message
            : open
              ? ''
              : MAINTENANCE_MSG;
        const timeLabel =
          typeof j.hkTime === 'string' && j.hkTime
            ? j.hkTime
            : getHkClock().timeLabel;
        return { open, message, timeLabel };
      } catch {
        // Fall back to client HKT clock if Worker unreachable.
        const open = isLoginHoursOpen();
        return {
          open,
          message: open ? '' : MAINTENANCE_MSG,
          timeLabel: getHkClock().timeLabel,
        };
      }
    };

    const render = async (error = '', previewBadge = false) => {
      screen.replaceChildren();

      const stage = document.createElement('div');
      stage.className = 'edict-stage';

      const scroll = document.createElement('div');
      scroll.className = 'edict-scroll';

      const rodTop = document.createElement('div');
      rodTop.className = 'edict-rod edict-rod-top';
      rodTop.setAttribute('aria-hidden', 'true');

      const body = document.createElement('div');
      body.className = 'edict-body';

      const coverWrap = document.createElement('div');
      coverWrap.className = 'edict-cover-wrap';
      const cover = document.createElement('img');
      cover.className = 'edict-cover';
      cover.src = '/cover-title.jpg';
      cover.alt = '中史無雙陀螺';
      cover.decoding = 'async';
      coverWrap.append(cover);

      const seal = document.createElement('div');
      seal.className = 'edict-seal';
      seal.textContent = 'WY';
      seal.setAttribute('aria-hidden', 'true');

      const sub = document.createElement('p');
      sub.className = 'subtitle edict-subtitle';
      sub.textContent = '請用學校 Google 電郵登入，方可組裝與對戰。';

      const table = document.createElement('div');
      table.className = 'login-table';

      const form = document.createElement('form');
      form.className = 'login-form';
      form.setAttribute('novalidate', '');

      const label = document.createElement('label');
      label.className = 'login-label';
      label.htmlFor = 'login-email';
      label.textContent = '學校電郵';

      const input = document.createElement('input');
      input.id = 'login-email';
      input.className = 'login-email';
      input.type = 'email';
      input.autocomplete = 'username';
      input.placeholder = '例如 student@wahyan.edu.hk';
      input.value = stored?.email ?? '';
      input.required = true;

      const btn = document.createElement('button');
      btn.type = 'submit';
      btn.className = 'btn primary big login-enter';
      btn.textContent = '進入';
      btn.disabled = busy;

      const err = document.createElement('div');
      err.className = 'login-error';
      err.setAttribute('role', 'alert');
      err.textContent = error;

      const badge = document.createElement('div');
      badge.className = 'preview-badge';
      badge.textContent = '預覽';
      if (!previewBadge) badge.classList.add('hidden');

      const hint = document.createElement('p');
      hint.className = 'login-hint';
      hint.textContent =
        '正式課堂會彈出 Google 核對視窗；若無法彈窗，請允許此網站開啟彈出視窗。';

      const maint = document.createElement('div');
      maint.className = 'login-maintenance';
      maint.setAttribute('role', 'status');

      const hoursNote = document.createElement('p');
      hoursNote.className = 'login-hours-note';

      form.append(label, input, btn);
      if (error) form.append(err);
      table.append(form);

      body.append(coverWrap, seal, sub, badge, table, hint, maint, hoursNote);

      const rodBot = document.createElement('div');
      rodBot.className = 'edict-rod edict-rod-bottom';
      rodBot.setAttribute('aria-hidden', 'true');

      scroll.append(rodTop, body, rodBot);
      stage.append(scroll);
      screen.append(stage);

      const access = await fetchAccess();
      hoursNote.textContent = `香港時間 ${access.timeLabel}　開放：07:00–23:00`;

      if (!access.open) {
        input.disabled = true;
        btn.disabled = true;
        form.classList.add('login-form-locked');
        table.classList.add('login-table-locked');
        maint.textContent = access.message || MAINTENANCE_MSG;
        maint.classList.add('visible');
        hint.textContent = '維護期間請稍後再來。課堂時段每日上午 7 時至下午 11 時開放登入。';
        return;
      }

      input.focus();
      form.addEventListener('submit', (ev) => {
        ev.preventDefault();
        void doLogin(input.value.trim().toLowerCase());
      });
    };

    const doLogin = async (email: string) => {
      if (busy) return;
      if (!isValidSchoolEmail(email)) {
        void render('請輸入有效的電郵地址（例如 school@wahyan.edu.hk）。');
        return;
      }

      // Dual gate: client clock + Worker /api/access
      if (!isLoginHoursOpen()) {
        void render(MAINTENANCE_MSG);
        return;
      }
      const access = await fetchAccess();
      if (!access.open) {
        void render(access.message || MAINTENANCE_MSG);
        return;
      }

      busy = true;
      await render('', false);
      const status = document.createElement('div');
      status.className = 'login-status';
      status.textContent = '正在核對登入……';
      screen.querySelector('.login-form')?.append(status);

      try {
        // Re-check just before auth bridge (anti clock-skew / overnight tab).
        const access2 = await fetchAccess();
        if (!access2.open) {
          busy = false;
          void render(access2.message || MAINTENANCE_MSG);
          return;
        }

        let health: HealthInfo;
        try {
          health = await fetchHealth();
        } catch {
          busy = false;
          void render('無法連接抽卡伺服器，請檢查網絡後再試。');
          return;
        }

        if (!health.authBridge || !health.authBridgeUrl) {
          const session: AuthSession = {
            email,
            googleEmail: '',
            token: '',
            preview: true,
          };
          saveSession(session);
          busy = false;
          screen.remove();
          resolve({ session });
          return;
        }

        const statusEl = screen.querySelector('.login-status');
        if (statusEl) statusEl.textContent = '請在彈出視窗用學校 Google 帳號完成核對……';
        const proof = await runAuthBridge(email, health.authBridgeUrl);
        const googleEmail = (proof.googleEmail || '').trim().toLowerCase();
        const token = proof.token || '';
        if (!token || !googleEmail) {
          throw new Error('核對未完成，請再試一次。');
        }

        // Final gate after popup returns.
        const access3 = await fetchAccess();
        if (!access3.open) {
          clearSession();
          busy = false;
          void render(access3.message || MAINTENANCE_MSG);
          return;
        }

        const session: AuthSession = {
          email,
          googleEmail,
          token,
          preview: false,
        };
        saveSession(session);
        busy = false;
        screen.remove();
        resolve({ session });
      } catch (e) {
        busy = false;
        clearSession();
        const msg = e instanceof Error ? e.message : '登入失敗，請再試。';
        void render(msg);
      }
    };

    void render();
  });
}
