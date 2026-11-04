import type { AppState } from '../app/state';
import { SLOT_KEYS, SLOT_NAMES, type Card, type Loadout, type SlotKey } from '../cards/types';
import { ASSEMBLE_TIMER_SEC, DRAW_BASE, MAX_COST, SPECIALS_ENABLED, SUB_MOD_ENABLED } from '../config/balance';
import { pickStrongest, skillTypeOf } from '../game/specials';
import { fuse } from '../rules/fuse';
import { allValidLoadouts, candidateBlockReasons, validateLoadout } from '../rules/validateLoadout';
import { SLOT_COLORS } from '../render/arenaView';
import { h, hex, toast } from './dom';
import { SKILL_DESC, SKILL_LABEL } from './labels';
import { radarSvg } from './radar';

const SLOT_ROLE: Record<SlotKey, string> = { A: '攻擊層・主攻擊', B: '防禦環・主防禦／重量', C: '驅動軸・主續航／速度' };

export function cardStatsLine(c: Card): string {
  return `攻${c.atk.toFixed(2)} 防${c.def.toFixed(2)} 耗${c.sta_decay.toFixed(2)}\n速${c.spd.toFixed(2)} 重${c.mas.toFixed(2)} 抗${c.br.toFixed(2)}`;
}

export interface AssembleOpts {
  /** Retry ownership fetch (shown when ownershipStatus === 'error'). */
  onRetryOwned?: () => void | Promise<void>;
}

/** Assemble screen. Calls onStart with a validated loadout. Returns a cleanup function. */
export function mountAssemble(
  root: HTMLElement,
  app: AppState,
  onStart: (l: Loadout) => void,
  opts: AssembleOpts = {},
): () => void {
  let active: SlotKey = SLOT_KEYS.find((k) => !app.player[k]) ?? 'A';
  let timerLeft = ASSEMBLE_TIMER_SEC;
  let timerId = 0;
  const screen = h('div.screen');
  root.append(screen);

  const blockReasons = (slot: SlotKey, c: Card): string[] => {
    const reasons = candidateBlockReasons(app.player, slot, c);
    if (!app.settings.unlockAll && !app.ownedIds.has(c.id)) reasons.unshift('尚未擁有此卡');
    return reasons;
  };

  const start = () => {
    const v = validateLoadout(app.player);
    if (!v.ok) {
      toast(v.errors[0].message);
      return;
    }
    cleanup();
    onStart(app.player as Loadout);
  };

  const autoFillAndStart = () => {
    const pool = app.settings.unlockAll ? app.cards : app.cards.filter((c) => app.ownedIds.has(c.id));
    const options = allValidLoadouts(pool).filter((l) => SLOT_KEYS.every((k) => !app.player[k] || app.player[k]!.id === l[k].id));
    const pick = options.length ? app.rng.pick(options) : null;
    if (pick) app.player = { ...pick };
    toast('時間到！已自動補齊陣容');
    start();
  };

  const syncTimer = () => {
    window.clearInterval(timerId);
    timerId = 0;
    if (!app.settings.assembleTimer) return;
    timerLeft = ASSEMBLE_TIMER_SEC;
    timerId = window.setInterval(() => {
      timerLeft--;
      const t = screen.querySelector('.timer');
      if (t) t.textContent = `剩餘 ${timerLeft} 秒`;
      if (timerLeft <= 0) autoFillAndStart();
    }, 1000);
  };

  const render = () => {
    const v = validateLoadout(app.player);
    const complete = SLOT_KEYS.every((k) => app.player[k]);
    const fused = complete ? fuse(app.player as Loadout) : null;
    const strongest = complete && SPECIALS_ENABLED ? pickStrongest(app.player as Loadout) : null;

    const slots = h(
      'div.slots',
      {},
      ...SLOT_KEYS.map((k) => {
        const c = app.player[k];
        const btn = h(
          'button.slot',
          {
            class: k === active ? 'active' : '',
            style: { '--slot-color': hex(SLOT_COLORS[k]) },
            onclick: () => {
              active = k;
              render();
            },
          },
          h('div.slot-head', {}, h('span.slot-dot'), `${k}・${SLOT_NAMES[k]}（${SLOT_ROLE[k]}）`),
          c ? h('div.slot-name', {}, `${c.name}`, h('span.card-cost', { style: { marginLeft: '8px' } }, `費 ${c.cost}`)) : h('div.slot-name.empty', {}, '未選擇（點此選擇）'),
          c && c.era_role ? h('div.era-tag', {}, c.era_role) : null,
        );
        btn.style.setProperty('--slot-color', hex(SLOT_COLORS[k]));
        return btn;
      }),
    );

    const pool = app.cards.filter((c) => {
      if (c.slot !== SLOT_NAMES[active]) return false;
      if (app.settings.unlockAll) return true;
      return app.ownedIds.has(c.id);
    });
    const grid = h(
      'div.pool',
      {},
      ...pool.map((c) => {
        const reasons = blockReasons(active, c);
        const selected = app.player[active]?.id === c.id;
        const blocked = !selected && reasons.length > 0;
        return h(
          'button.card',
          {
            class: `${selected ? 'selected' : ''} ${blocked ? 'blocked' : ''}`,
            'aria-disabled': blocked ? 'true' : undefined,
            onclick: () => {
              if (selected) {
                delete app.player[active];
              } else if (blocked) {
                toast(`不能選擇 ${c.name}：${reasons.join('；')}`);
                return;
              } else {
                app.player[active] = c;
                const next = SLOT_KEYS.find((k) => !app.player[k]);
                if (next) active = next;
              }
              render();
            },
          },
          h('div.card-top', {}, h('span.card-name', {}, c.name), h('span.card-cost', {}, `費 ${c.cost}`)),
          c.era_role ? h('div.card-era', {}, c.era_role) : null,
          h(
            'div.badges',
            {},
            h('span.badge', { title: SKILL_DESC[skillTypeOf(c)] }, `特技：${SKILL_LABEL[skillTypeOf(c)]}`),
            c.main_label ? h('span.badge', {}, c.main_label) : null,
            c.rarity ? h('span.badge.rarity', {}, c.rarity) : null,
          ),
          h('div.card-stats', { style: { whiteSpace: 'pre' } }, cardStatsLine(c)),
          c.sub_mod ? h('div.submod', {}, `特效（未啟用）${c.sub_mod}`) : null,
        );
      }),
    );
    if (!SUB_MOD_ENABLED) grid.dataset.submod = 'off';
    if (pool.length === 0 && !app.settings.unlockAll) {
      const slotMsg =
        app.ownershipStatus === 'loading'
          ? '正在載入擁有卡…'
          : app.ownershipStatus === 'error'
            ? '擁有卡尚未載入成功。請按上方「重新載入擁有卡」，或請老師開啟「全部解鎖（測試）」。'
            : '此槽未有擁有卡。請到抽卡 App 抽取對應部件，或請老師開啟「全部解鎖（測試）」。';
      grid.append(h('div.box', { style: { gridColumn: '1 / -1' } }, slotMsg));
    }

    const optToggle = (key: 'unlockAll' | 'assembleTimer', label: string) =>
      h(
        'button.toggle',
        {
          'aria-pressed': String(app.settings[key]),
          onclick: () => {
            app.set(key, !app.settings[key]);
            if (key === 'assembleTimer') syncTimer();
            if (key === 'unlockAll') {
              for (const k of SLOT_KEYS) {
                const c = app.player[k];
                if (c && !app.settings.unlockAll && !app.ownedIds.has(c.id)) delete app.player[k];
              }
            }
            render();
          },
        },
        `${label}：${app.settings[key] ? '開' : '關'}`,
      );

    const nameInput = h('input.name-input', {
      type: 'text',
      maxlength: '8',
      placeholder: '輸入短名字（最多八字）',
      value: app.playerName,
      'aria-label': '玩家名字',
      oninput: (e: Event) => {
        const target = e.target as HTMLInputElement;
        app.setPlayerName(target.value);
      },
    });

    const side = h(
      'div.side',
      {},
      h(
        'div.box',
        {},
        h('div.name-row', {}, h('label.name-label', {}, '玩家名字'), nameInput),
        h('div.cost-line', { class: v.totalCost > MAX_COST ? 'over' : '' }, `總費用 ${v.totalCost} / ${MAX_COST}`),
        h('div', { style: { display: 'grid', placeItems: 'center' } }, radarSvg(fused)),
        v.errors.length ? h('ul.errors', {}, ...v.errors.map((e) => h('li', {}, e.message))) : h('div', { style: { color: 'var(--ok)', marginTop: '6px' } }, '陣容有效，可以開始！'),
        strongest
          ? h(
              'div.strongest-box',
              {},
              h('div.strongest-title', {}, '本局主將特技（由最強武將決定）'),
              h(
                'div.strongest-name',
                {},
                `最強武將：${strongest.card.name}（${SLOT_NAMES[strongest.slot]}・${strongest.slot}）`,
              ),
              h(
                'div.strongest-skill',
                { title: SKILL_DESC[strongest.skill] },
                `本局特技：${SKILL_LABEL[strongest.skill]} — ${SKILL_DESC[strongest.skill]}`,
              ),
            )
          : null,
      ),
      h(
        'div.box',
        {},
        h('div.opt-row', {}, optToggle('unlockAll', '全部解鎖（測試）'), optToggle('assembleTimer', '60秒計時')),
        app.settings.assembleTimer ? h('div.timer', { style: { marginTop: '8px' } }, `剩餘 ${timerLeft} 秒`) : null,
      ),
      h('button.btn.primary.big', { disabled: !v.ok, onclick: start }, '開始'),
    );

    screen.replaceChildren(
      h(
        'div.screen-inner',
        {},
        h('h1', {}, '中史無雙陀螺'),
        h('p.subtitle', {}, '組裝你的陀螺：三個部件各代表一位歷史人物。數值為倍率，1.0 為基準。'),
        app.authSession?.preview
          ? h('div.preview-badge-inline', {}, '預覽模式（未通過 Google 核對）')
          : null,
        (() => {
          if (app.settings.unlockAll) return null;
          if (app.ownershipStatus === 'loading') {
            return h(
              'div.box.empty-owned',
              { style: { borderColor: 'rgba(130,180,255,0.55)', marginBottom: '12px', color: '#d8e6ff' } },
              h('div', {}, '正在載入你的擁有卡…'),
            );
          }
          if (app.ownershipStatus === 'error') {
            const kept = app.ownedIds.size > 0;
            return h(
              'div.box.empty-owned',
              { style: { borderColor: 'var(--bad)', marginBottom: '12px', color: '#ffc9c9' } },
              h(
                'div',
                {},
                app.ownershipError || '載入擁有卡失敗。',
                kept ? `（仍顯示上次成功載入的 ${app.ownedIds.size} 張卡）` : '',
              ),
              h(
                'div',
                { style: { display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '10px' } },
                opts.onRetryOwned
                  ? h(
                      'button.btn.primary',
                      {
                        type: 'button',
                        onclick: () => {
                          void opts.onRetryOwned?.();
                        },
                      },
                      '重新載入擁有卡',
                    )
                  : null,
                h(
                  'a.btn',
                  {
                    href: DRAW_BASE,
                    target: '_blank',
                    rel: 'noopener',
                    style: { display: 'inline-block', textDecoration: 'none' },
                  },
                  '前往抽卡 App',
                ),
              ),
            );
          }
          if (app.ownershipStatus === 'empty' || app.ownedIds.size === 0) {
            return h(
              'div.box.empty-owned',
              { style: { borderColor: 'var(--bad)', marginBottom: '12px', color: '#ffc9c9' } },
              h('div', {}, '你未有擁有卡。請先到抽卡 App 溫習／抽卡，再返嚟組裝。'),
              h(
                'a.btn.primary',
                {
                  href: DRAW_BASE,
                  target: '_blank',
                  rel: 'noopener',
                  style: { display: 'inline-block', marginTop: '10px', textDecoration: 'none' },
                },
                '前往抽卡 App',
              ),
            );
          }
          return null;
        })(),
        app.source === 'cards_sample.json'
          ? h('div.box', { style: { borderColor: 'var(--bad)', marginBottom: '12px', color: '#ffc9c9' } }, '找不到 cards_60.json，現正使用示範卡組（cards_sample.json）。請把正式卡牌檔放到 public/ 資料夾。')
          : null,
        h(
          'div.assemble',
          {},
          slots,
          h('div', {}, h('div.pool-head', {}, h('h2', {}, `選擇「${SLOT_NAMES[active]}」（${pool.length} 張）`)), grid),
          side,
        ),
      ),
    );
  };

  const unsub = app.onChange(render);
  const cleanup = () => {
    window.clearInterval(timerId);
    unsub();
    screen.remove();
  };
  render();
  syncTimer();
  return cleanup;
}

