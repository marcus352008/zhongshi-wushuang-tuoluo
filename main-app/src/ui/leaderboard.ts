import { fetchLeaderboard, type LeaderboardRow } from '../pvp/client';
import type { FormLevel } from '../pvp/form';

export interface LeaderboardPanelOptions {
  currentEmail: string;
  initialForm?: FormLevel | 'ALL';
  compact?: boolean;
}

export interface LeaderboardPanelHandle {
  refresh: (forceFresh?: boolean) => Promise<void>;
  destroy: () => void;
}

function escapeHtml(raw: string): string {
  return String(raw ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function displayNameOf(row: LeaderboardRow): string {
  const n = (row.name || '').trim();
  if (n) return n;
  return (row.email || '').split('@')[0] || '同學';
}

function rankBadgeHtml(rank: number): string {
  if (rank === 1) return '<span style="font-size:16px;" title="第 1 名">🥇</span>';
  if (rank === 2) return '<span style="font-size:16px;" title="第 2 名">🥈</span>';
  if (rank === 3) return '<span style="font-size:16px;" title="第 3 名">🥉</span>';
  return `<span style="display:inline-block;min-width:22px;text-align:center;font-weight:700;color:#9e96bf;">${rank}</span>`;
}

export function mountLeaderboardPanel(
  container: HTMLElement,
  opts: LeaderboardPanelOptions,
): LeaderboardPanelHandle {
  let activeFilter: FormLevel | 'ALL' = opts.initialForm ?? 'ALL';
  let loading = false;
  let rows: LeaderboardRow[] = [];
  let errorMsg = '';
  let degraded = false;
  let disposed = false;

  const myEmail = (opts.currentEmail || '').trim().toLowerCase();

  const root = document.createElement('div');
  root.style.cssText = [
    'background:rgba(14, 11, 28, 0.85);',
    'border:1px solid rgba(255, 210, 110, 0.35);',
    'border-radius:14px;',
    opts.compact ? 'padding:12px 14px;' : 'padding:14px 16px;',
    'margin-top:14px;',
    'text-align:left;',
  ].join('');
  container.appendChild(root);

  async function load(forceFresh = false): Promise<void> {
    if (disposed) return;
    loading = true;
    errorMsg = '';
    render();
    try {
      const formParam = activeFilter === 'ALL' ? null : activeFilter;
      const res = await fetchLeaderboard(formParam, forceFresh);
      if (disposed) return;
      loading = false;
      if (!res.ok) {
        errorMsg = res.error || '暫時無法載入排行榜，請稍後再試。';
        rows = [];
      } else {
        rows = Array.isArray(res.rows) ? res.rows : [];
        degraded = !!res.degraded;
      }
      render();
    } catch {
      if (disposed) return;
      loading = false;
      errorMsg = '網絡連線異常，無法讀取排行榜。';
      rows = [];
      render();
    }
  }

  function render(): void {
    if (disposed) return;

    const tabs: { key: FormLevel | 'ALL'; label: string }[] = [
      { key: 'ALL', label: '全校 Top 20' },
      { key: 'F1', label: '中一 (F1)' },
      { key: 'F2', label: '中二 (F2)' },
      { key: 'F3', label: '中三 (F3)' },
    ];

    const tabsHtml = tabs
      .map((t) => {
        const active = activeFilter === t.key;
        return `<button type="button" data-lb-tab="${t.key}" style="
          padding:5px 11px;border-radius:99px;font-size:12px;font-weight:700;cursor:pointer;
          border:1px solid ${active ? '#ffd26e' : 'rgba(255,255,255,0.16)'};
          background:${active ? '#ffd26e' : 'rgba(255,255,255,0.05)'};
          color:${active ? '#18122b' : '#d2cbe8'};
        ">${t.label}</button>`;
      })
      .join('');

    let bodyHtml = '';
    if (loading) {
      bodyHtml = `
        <div style="padding:22px 12px;text-align:center;color:#b9b2d8;font-size:13px;">
          ⏳ 正在載入風雲榜排行資料…
        </div>
      `;
    } else if (errorMsg) {
      bodyHtml = `
        <div style="padding:18px 12px;text-align:center;color:#ffb4b8;font-size:13px;">
          ⚠️ ${escapeHtml(errorMsg)}
        </div>
      `;
    } else if (rows.length === 0) {
      bodyHtml = `
        <div style="padding:20px 12px;text-align:center;color:#9e96bf;font-size:13px;">
          ${
            degraded
              ? '目前尚未連接排行榜資料庫，完成雙人對戰後將自動累計戰績。'
              : '目前尚無對戰排行紀錄，快開房進行第一場雙人對戰吧！'
          }
        </div>
      `;
    } else {
      const trs = rows
        .map((r, idx) => {
          const rank = r.rank ?? idx + 1;
          const isMe = r.email.toLowerCase() === myEmail;
          const nameText = escapeHtml(displayNameOf(r));
          const clsText = escapeHtml(r.className || r.form || '—');
          const rowBg = isMe
            ? 'rgba(255, 210, 110, 0.18)'
            : idx % 2 === 0
              ? 'rgba(255, 255, 255, 0.02)'
              : 'transparent';
          const borderLeft = isMe ? '3px solid #ffd26e' : '3px solid transparent';

          return `
            <tr style="background:${rowBg};border-left:${borderLeft};">
              <td style="padding:7px 8px;text-align:center;white-space:nowrap;">${rankBadgeHtml(rank)}</td>
              <td style="padding:7px 8px;font-weight:${isMe ? '800' : '600'};color:${isMe ? '#ffd26e' : '#f4f0ff'};word-break:break-all;">
                ${nameText}
                ${isMe ? '<span style="margin-left:5px;font-size:10px;background:#ffd26e;color:#18122b;padding:1px 6px;border-radius:99px;font-weight:800;">你</span>' : ''}
              </td>
              <td style="padding:7px 8px;text-align:center;color:#b9b2d8;font-size:12px;white-space:nowrap;">${clsText}</td>
              <td style="padding:7px 8px;text-align:right;font-weight:800;color:#7bed9f;white-space:nowrap;">${r.wins} 勝</td>
              <td style="padding:7px 8px;text-align:right;color:#ff9aa2;font-size:12px;white-space:nowrap;">${r.losses} 敗</td>
            </tr>
          `;
        })
        .join('');

      bodyHtml = `
        <div style="max-height:${opts.compact ? '220px' : '260px'};overflow-y:auto;border-radius:8px;border:1px solid rgba(255,255,255,0.08);">
          <table style="width:100%;border-collapse:collapse;font-size:13px;">
            <thead>
              <tr style="background:rgba(255,255,255,0.06);color:#b9b2d8;font-size:11px;position:sticky;top:0;">
                <th style="padding:6px 8px;text-align:center;width:44px;">名次</th>
                <th style="padding:6px 8px;text-align:left;">同學</th>
                <th style="padding:6px 8px;text-align:center;width:72px;">班別/年級</th>
                <th style="padding:6px 8px;text-align:right;width:58px;">勝場</th>
                <th style="padding:6px 8px;text-align:right;width:58px;">敗場</th>
              </tr>
            </thead>
            <tbody>
              ${trs}
            </tbody>
          </table>
        </div>
      `;
    }

    root.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px;">
        <div style="display:flex;align-items:center;gap:6px;">
          <span style="font-size:16px;">🏆</span>
          <span style="font-size:14px;font-weight:800;color:#ffd26e;">無雙風雲榜（頭 20 名）</span>
          <span style="font-size:11px;color:#8a82ab;">先比勝場 · 同分少敗優先</span>
        </div>
        <button type="button" id="btn-lb-refresh" ${loading ? 'disabled' : ''} style="
          background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.2);
          color:#e2dcff;border-radius:8px;padding:4px 10px;font-size:11px;cursor:pointer;
        ">🔄 重新整理</button>
      </div>

      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;">
        ${tabsHtml}
      </div>

      ${bodyHtml}
    `;

    root.querySelector<HTMLButtonElement>('#btn-lb-refresh')?.addEventListener('click', () => {
      void load(true);
    });

    root.querySelectorAll<HTMLButtonElement>('[data-lb-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const next = btn.getAttribute('data-lb-tab') as FormLevel | 'ALL';
        if (next && next !== activeFilter) {
          activeFilter = next;
          void load(false);
        }
      });
    });
  }

  void load(false);

  return {
    refresh: (forceFresh = true) => load(forceFresh),
    destroy: () => {
      disposed = true;
      root.remove();
    },
  };
}
