import { SLOT_KEYS, SLOT_NAMES } from '../cards/types';
import type { Match } from '../game/match';
import { h } from './dom';
import { modeLabel, pointsLine, roundTitle, SIDE_LABEL, winByLabel, winnerLine } from './labels';

export const DISCLAIMER = '遊戲勝負≠歷史誰對誰錯';

export interface EndActions {
  rematch(): void;
  reassemble(): void;
  swap(): void;
}

export function mountEnd(root: HTMLElement, match: Match, actions: EndActions): () => void {
  const screen = h('div.screen');
  let loreShown = true;

  const loreSection = () => {
    if (!loreShown) {
      return h('button.btn', { onclick: () => ((loreShown = true), render()) }, '顯示人物小知識');
    }
    return h(
      'div',
      {},
      h(
        'div.lore',
        {},
        ...([0, 1] as const).map((s) =>
          h(
            'div.lore-col',
            {},
            h('h3', {}, `${SIDE_LABEL[s]}的陣容`),
            ...SLOT_KEYS.map((k) => {
              const c = match.sides[s].loadout[k];
              return h(
                'div.lore-item',
                {},
                h('h4', {}, `${c.name}（${c.era_role || SLOT_NAMES[k]}）`),
                h('p', {}, c.lore_28 || '（暫無簡介）'),
              );
            }),
          ),
        ),
      ),
      h('button.btn', { style: { marginTop: '8px' }, onclick: () => ((loreShown = false), render()) }, '略過人物小知識'),
    );
  };

  const render = () => {
    const w = match.winner;
    screen.replaceChildren(
      h(
        'div.screen-inner.end',
        {},
        h('div.winner', { style: { color: w === 0 ? 'var(--p1)' : w === 1 ? 'var(--p2)' : 'var(--text)' } }, winnerLine(w)),
        h('div.final-score', {}, `${match.scores[0]} : ${match.scores[1]}`),
        h('div.win-by', {}, winByLabel(match.winBy, match)),
        h(
          'div.round-list',
          {},
          `${modeLabel(match.mode)}　｜　` +
            match.results
              .map((r) => `第 ${r.round} 回合：${roundTitle(r)} ${pointsLine(r)}（${r.duration.toFixed(1)} 秒）`)
              .join('　'),
        ),
        h(
          'div.end-actions',
          {},
          h('button.btn.primary.big', { onclick: actions.rematch }, '再戰一次（同陣容）'),
          h('button.btn.big', { onclick: actions.reassemble }, '重新組裝'),
          h('button.btn.big', { onclick: actions.swap }, '互換陣容再戰'),
        ),
        loreSection(),
      ),
      h('div.disclaimer', { role: 'note' }, DISCLAIMER),
    );
  };

  render();
  root.append(screen);
  return () => screen.remove();
}
