/**
 * 案Q（答題定力）：發射前五題中史選擇題，答對數決定發射功率。
 * 全中 1.20（120%），部分按 QUIZ_POWER_BY_CORRECT 縮放。
 * 0.5.12：S模式已取消；開局一律 Case C／案Q。
 */
import {
  QUIZ_LAUNCH_ENABLED,
  QUIZ_POWER_BY_CORRECT,
  QUIZ_QUESTIONS_PER_MATCH,
  QUIZ_SEC_PER_Q,
} from '../config/balance';
import { pickQuestions, shuffleOptions, type QuizQuestion } from './quizBank';

export interface QuizLaunchOptions {
  /** 用於加權抽題的 loadout 人名（例如「項羽」「岳飛」）。 */
  loadoutNames?: string[];
  /** 覆寫每題限時（秒）。 */
  secPerQ?: number;
  /** 覆寫題數。 */
  count?: number;
  /** 覆寫隨機函式（測試用）。 */
  rng?: () => number;
}

/** 答對數 → 發射功率（0 題 → 0.25，5 題 → 1.20）。 */
export function powerFromCorrectCount(correct: number): number {
  const i = Math.max(0, Math.min(QUIZ_POWER_BY_CORRECT.length - 1, Math.floor(correct)));
  return QUIZ_POWER_BY_CORRECT[i];
}

interface OverlayHandle {
  root: HTMLElement;
  destroy(): void;
}

function buildOverlay(): OverlayHandle {
  const root = document.createElement('div');
  root.className = 'quiz-overlay';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', '案Q 答題定力');
  document.body.append(root);
  return {
    root,
    destroy() {
      root.remove();
    },
  };
}


/** Active launch-quiz abort (PvP snap may force fight mid-quiz). */
let activeLaunchAbort: ((power: number) => void) | null = null;

/** Remove 案Q overlay and resolve any in-flight quizLaunch promise. */
export function dismissLaunchQuizOverlay(resolvePower = 1): void {
  document.querySelectorAll('.quiz-overlay:not(.fight-quiz-overlay)').forEach((el) => el.remove());
  if (activeLaunchAbort) {
    const abort = activeLaunchAbort;
    activeLaunchAbort = null;
    abort(resolvePower);
  }
}

/**
 * 顯示案Q overlay，回傳 Promise<number>（發射功率）。
 * 若 QUIZ_LAUNCH_ENABLED 為 false，直接回傳 1。
 */
export function quizLaunch(opts: QuizLaunchOptions = {}): Promise<number> {
  if (!QUIZ_LAUNCH_ENABLED) return Promise.resolve(1);

  const count = opts.count ?? QUIZ_QUESTIONS_PER_MATCH;
  const secPerQ = opts.secPerQ ?? QUIZ_SEC_PER_Q;
  const rng = opts.rng ?? Math.random;
  const questions = pickQuestions(count, rng, opts.loadoutNames ?? [], 'launch');

  return new Promise<number>((resolve) => {
    const overlay = buildOverlay();
    const root = overlay.root;

    let qi = 0;
    let correct = 0;
    let timerId: number | null = null;
    let remaining = secPerQ;
    let locked = false;
    let settled = false;

    const clearTimer = () => {
      if (timerId !== null) {
        window.clearInterval(timerId);
        timerId = null;
      }
    };

    const settle = (power: number) => {
      if (settled) return;
      settled = true;
      clearTimer();
      if (activeLaunchAbort) activeLaunchAbort = null;
      overlay.destroy();
      resolve(power);
    };

    activeLaunchAbort = (power: number) => {
      settle(power);
    };

    const finish = () => {
      clearTimer();
      const power = powerFromCorrectCount(correct);
      // 顯示結果摘要，短暫停留後關閉。
      root.replaceChildren();
      const panel = document.createElement('div');
      panel.className = 'quiz-panel quiz-result';
      const seal = document.createElement('div');
      seal.className = 'quiz-seal';
      seal.textContent = '案Q';
      const title = document.createElement('div');
      title.className = 'quiz-result-title';
      title.textContent = `答對 ${correct} / ${questions.length} 題`;
      const powerLine = document.createElement('div');
      powerLine.className = 'quiz-result-power';
      powerLine.textContent = `發射功率 ${Math.round(power * 100)}%`;
      const hint = document.createElement('div');
      hint.className = 'quiz-result-hint';
      hint.textContent = correct === questions.length ? '全中！氣勢如虹，全力一擊！' : '定力已定，準備發射。';
      panel.append(seal, title, powerLine, hint);
      root.append(panel);
      window.setTimeout(() => {
        settle(power);
      }, 1100);
    };

    const renderQuestion = () => {
      if (qi >= questions.length) {
        finish();
        return;
      }
      const q: QuizQuestion = questions[qi];
      const { options, answer } = shuffleOptions(q, rng);
      remaining = secPerQ;
      locked = false;

      root.replaceChildren();
      const panel = document.createElement('div');
      panel.className = 'quiz-panel';

      const head = document.createElement('div');
      head.className = 'quiz-head';
      const seal = document.createElement('span');
      seal.className = 'quiz-seal';
      seal.textContent = '案Q';
      const progress = document.createElement('span');
      progress.className = 'quiz-progress';
      progress.textContent = `第 ${qi + 1} / ${questions.length} 題`;
      const clock = document.createElement('span');
      clock.className = 'quiz-clock';
      clock.textContent = `${remaining} 秒`;
      head.append(seal, progress, clock);

      const stem = document.createElement('div');
      stem.className = 'quiz-stem';
      stem.textContent = q.q;

      const opts = document.createElement('div');
      opts.className = 'quiz-options';

      const buttons: HTMLButtonElement[] = [];
      options.forEach((text, i) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'quiz-option';
        btn.textContent = `${'甲乙丙丁'[i]}、${text}`;
        btn.addEventListener('click', () => choose(i));
        opts.append(btn);
        buttons.push(btn);
      });

      panel.append(head, stem, opts);
      root.append(panel);

      const choose = (i: number) => {
        if (locked) return;
        locked = true;
        clearTimer();
        const isRight = i === answer;
        if (isRight) correct++;
        buttons.forEach((b, bi) => {
          b.disabled = true;
          if (bi === answer) b.classList.add('correct');
          else if (bi === i) b.classList.add('wrong');
        });
        window.setTimeout(() => {
          qi++;
          renderQuestion();
        }, 650);
      };

      clearTimer();
      timerId = window.setInterval(() => {
        remaining -= 1;
        clock.textContent = `${Math.max(0, remaining)} 秒`;
        if (remaining <= 0) {
          clearTimer();
          if (!locked) {
            locked = true;
            buttons.forEach((b, bi) => {
              b.disabled = true;
              if (bi === answer) b.classList.add('correct');
            });
            window.setTimeout(() => {
              qi++;
              renderQuestion();
            }, 650);
          }
        }
      }, 1000);
    };

    renderQuestion();
  });
}
