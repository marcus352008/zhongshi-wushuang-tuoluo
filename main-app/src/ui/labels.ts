import type { Match, RoundResult, Side, WinBy } from '../game/match';
import type { SkillType } from '../game/specials';

export const SIDE_LABEL = ['你', '電腦'] as const;

/** 特技名稱（繁中）。 */
export const SKILL_LABEL: Record<SkillType, string> = {
  attack: '強攻',
  guard: '鐵壁',
  heal: '回血',
};

/** 特技一句說明。 */
export const SKILL_DESC: Record<SkillType, string> = {
  attack: '三秒內擊退力大增，並朝對手衝刺。',
  guard: '三秒內抗擊力大增，受擊減免。',
  heal: '立即回復部分轉速。',
};

export function roundTitle(r: RoundResult): string {
  switch (r.reason) {
    case 'ringOut':
      return '擊出場外！';
    case 'spinOut':
      return '轉速耗盡！';
    case 'timeout':
      return r.winner === null ? '時間到：轉速相同' : '時間到：轉速較高';
    case 'double':
      return r.winner === null ? '同時出局：平手' : '同時出局：比較餘轉';
  }
}

export function pointsLine(r: RoundResult): string {
  if (r.winner === null) return `雙方各得 ${r.points[0]} 分`;
  return `${SIDE_LABEL[r.winner]} +${r.points[r.winner]} 分`;
}

export function winByLabel(winBy: WinBy, match: Match): string {
  if (winBy === 'ring') return '擊出場外';
  if (winBy === 'spin') {
    const w = match.winner;
    const last = [...match.results].reverse().find((r) => r.winner === w);
    return last?.reason === 'timeout' ? '時間到：轉速較高' : '轉速勝';
  }
  if (winBy === 'burst') return '爆裂';
  return '平手';
}

export function winnerLine(w: Side | null): string {
  return w === null ? '平手' : w === 0 ? '你獲勝！' : '電腦獲勝';
}

/** 模式標籤：S模式已取消（0.5.12）；C＋案Q＝Q模式（答題定力）；C＝蓄力。 */
export function modeLabel(_m: 'C' | 'S', quizEnabled = false): string {
  if (quizEnabled) return 'Q模式（答題定力）';
  return 'C模式（蓄力）';
}

