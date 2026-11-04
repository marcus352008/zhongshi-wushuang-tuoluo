import { toast } from '../ui/dom';

/**
 * 嘗試進入瀏覽器全螢幕模式；若因手勢限制失敗則顯示繁中提示，不阻斷對戰。
 */
export async function enterBattleFullscreen(target: HTMLElement = document.documentElement): Promise<boolean> {
  try {
    if (document.fullscreenElement) return true;
    const el = target as HTMLElement & {
      webkitRequestFullscreen?: () => Promise<void>;
    };
    if (typeof el.requestFullscreen === 'function') {
      await el.requestFullscreen();
      return true;
    }
    if (typeof el.webkitRequestFullscreen === 'function') {
      await el.webkitRequestFullscreen();
      return true;
    }
    return false;
  } catch {
    toast('未能自動切換全螢幕，請點擊頂部「全螢幕模式」按鈕以獲得最佳對戰視野。');
    return false;
  }
}

export async function exitBattleFullscreen(): Promise<void> {
  try {
    if (document.fullscreenElement && typeof document.exitFullscreen === 'function') {
      await document.exitFullscreen();
    }
  } catch {
    /* ignore */
  }
}

export interface LeaveGuardOptions {
  onFullscreenExit?: () => void;
}

/**
 * 安裝對戰中途防離開守門員：
 * 1. beforeunload 關閉或重新整理分頁警告
 * 2. popstate 攔截瀏覽器「上一頁」返回鍵
 * 3. fullscreenchange 偵測退出全螢幕並顯示頂部一鍵恢復橫幅
 * 回傳 teardown 清理函式（於完場結算時呼叫）。
 */
export function installLeaveGuards(opts: LeaveGuardOptions = {}): () => void {
  let active = true;
  let fsWarnBanner: HTMLElement | null = null;

  const removeFsBanner = () => {
    fsWarnBanner?.remove();
    fsWarnBanner = null;
  };

  const showFsBanner = () => {
    if (!active || document.fullscreenElement || fsWarnBanner) return;
    const bar = document.createElement('div');
    bar.style.cssText = [
      'position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:120;',
      'background:rgba(180,30,45,0.95);border:1px solid #ffd26e;border-radius:99px;',
      'padding:6px 16px;color:#fff;font-size:12px;font-weight:700;',
      'display:flex;align-items:center;gap:10px;box-shadow:0 6px 20px rgba(0,0,0,0.55);',
    ].join('');
    const span = document.createElement('span');
    span.textContent = '⚠️ 雙人對戰進行中，建議保持全螢幕模式以免誤觸離開';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = '恢復全螢幕';
    btn.style.cssText =
      'background:#ffd26e;color:#1a1333;border:none;border-radius:99px;padding:3px 10px;font-size:11px;font-weight:800;cursor:pointer;';
    btn.addEventListener('click', () => {
      void enterBattleFullscreen().then((ok) => {
        if (ok) removeFsBanner();
      });
    });
    bar.append(span, btn);
    document.body.appendChild(bar);
    fsWarnBanner = bar;
  };

  const onBeforeUnload = (e: BeforeUnloadEvent) => {
    if (!active) return;
    e.preventDefault();
    e.returnValue = '雙人對戰正在進行中，現在離開將會視為棄權落敗！';
    return e.returnValue;
  };

  // 推入一筆 history state 以攔截手機／Chromebook 返回鍵
  try {
    history.pushState({ wushuangPvpGuard: true }, '', location.href);
  } catch {
    /* ignore */
  }

  const onPopState = () => {
    if (!active) return;
    try {
      history.pushState({ wushuangPvpGuard: true }, '', location.href);
    } catch {
      /* ignore */
    }
    toast('對戰進行中無法返回上一頁！如需認輸請按 Esc 選擇「棄權」。');
  };

  const onFullscreenChange = () => {
    if (!active) return;
    if (!document.fullscreenElement) {
      opts.onFullscreenExit?.();
      showFsBanner();
    } else {
      removeFsBanner();
    }
  };

  window.addEventListener('beforeunload', onBeforeUnload);
  window.addEventListener('popstate', onPopState);
  document.addEventListener('fullscreenchange', onFullscreenChange);

  // 若開戰初時未處於全螢幕，顯示提示橫幅方便學生一鍵點擊進入
  window.setTimeout(() => {
    if (active && !document.fullscreenElement) {
      showFsBanner();
    }
  }, 800);

  return () => {
    active = false;
    removeFsBanner();
    window.removeEventListener('beforeunload', onBeforeUnload);
    window.removeEventListener('popstate', onPopState);
    document.removeEventListener('fullscreenchange', onFullscreenChange);
  };
}
