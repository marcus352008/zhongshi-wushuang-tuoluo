/**
 * Fight-phase continuous MC charge: one question overlay at a time; correct → addCharge.
 * Inspired by quizLaunch.ts; does not replace 案Q launch quiz.
 * 0.5.2-pvp-grade-quiz: 依玩家／房間年級（F1 / F2 / F3）嚴格抽取對應分級儲力題庫。
 */
import {
  FIGHT_QUIZ_CHARGE,
  FIGHT_QUIZ_ENABLED,
  FIGHT_QUIZ_TIMEOUT_SEC,
} from '../config/balance';
import {
  fightBankKindForForm,
  pickQuestions,
  shuffleOptions,
  type QuizBankKind,
  type QuizGradeForm,
} from './quizBank';

export interface FightQuizOptions {
  loadoutNames?: string[];
  /** 玩家／對戰房年級（F1 / F2 / F3）；決定抽取 fight_f1 / fight_f2 / fight_f3。 */
  form?: QuizGradeForm | null;
  /** 可選顯式指定題庫種類（若未傳則由 form 自動決定）。 */
  bank?: QuizBankKind;
  timeoutSec?: number;
  chargeOnCorrect?: number;
  rng?: () => number;
  /** Optional mount container (defaults to #screens or document.body). */
  mountEl?: HTMLElement | null;
  /** Optional open/close hooks（fight phase 唔再靠呢度 pause）。 */
  onOpen?: () => void;
  onClose?: () => void;
}

export interface FightQuizResult {
  correct: boolean;
  charge: number;
  timedOut: boolean;
}

/** Active instance cleanup handle so round transitions never leave orphan timers or hung promises. */
let activeAbort: (() => void) | null = null;

/**
 * Safely dismiss any active fight quiz overlay, clear its interval/timeout, and resolve its promise.
 */
export function dismissFightQuizOverlay(): void {
  if (activeAbort) {
    const fn = activeAbort;
    activeAbort = null;
    fn();
  }
  document.querySelectorAll('.fight-quiz-overlay').forEach((el) => el.remove());
}

/**
 * Show one MC overlay from the grade-specific fight bank. Always resolves; auto-closes on timeout.
 */
export function fightQuizOnce(opts: FightQuizOptions = {}): Promise<FightQuizResult> {
  if (!FIGHT_QUIZ_ENABLED) {
    return Promise.resolve({ correct: false, charge: 0, timedOut: false });
  }

  dismissFightQuizOverlay();

  const timeoutSec = opts.timeoutSec ?? FIGHT_QUIZ_TIMEOUT_SEC;
  const chargeAmt = opts.chargeOnCorrect ?? FIGHT_QUIZ_CHARGE;
  const rng = opts.rng ?? Math.random;
  const targetBank: QuizBankKind = opts.bank ?? fightBankKindForForm(opts.form);
  const [q] = pickQuestions(1, rng, opts.loadoutNames ?? [], targetBank);
  if (!q) {
    return Promise.resolve({ correct: false, charge: 0, timedOut: false });
  }
  const { options, answer } = shuffleOptions(q, rng);

  return new Promise((resolve) => {
    opts.onOpen?.();

    const host =
      opts.mountEl ??
      document.getElementById('screens') ??
      document.body;

    const root = document.createElement('div');
    root.className = 'quiz-overlay fight-quiz-overlay fight-quiz-attention';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'false');
    root.setAttribute('aria-label', '對戰答題儲力');
    host.append(root);

    let remaining = timeoutSec;
    let locked = false;
    let settled = false;
    let timerId: number | null = null;
    let closeTimeoutId: number | null = null;

    const onKey = (e: KeyboardEvent) => {
      if (locked) return;
      const idx = ['1', '2', '3', '4'].indexOf(e.key);
      if (idx >= 0) {
        e.preventDefault();
        choose(idx);
      }
    };
    window.addEventListener('keydown', onKey);

    const destroy = (result: FightQuizResult) => {
      if (settled) return;
      settled = true;
      if (activeAbort === abortNow) {
        activeAbort = null;
      }
      if (timerId !== null) {
        window.clearInterval(timerId);
        timerId = null;
      }
      if (closeTimeoutId !== null) {
        window.clearTimeout(closeTimeoutId);
        closeTimeoutId = null;
      }
      window.removeEventListener('keydown', onKey);
      root.remove();
      opts.onClose?.();
      resolve(result);
    };

    const abortNow = () => {
      locked = true;
      destroy({ correct: false, charge: 0, timedOut: true });
    };
    activeAbort = abortNow;

    const panel = document.createElement('div');
    panel.className = 'quiz-panel fight-quiz-panel';

    const head = document.createElement('div');
    head.className = 'quiz-head';

    const seal = document.createElement('span');
    seal.className = 'quiz-seal fight-quiz-seal';
    seal.textContent = opts.form ? `儲力題・${opts.form}` : '儲力題';

    const progress = document.createElement('span');
    progress.className = 'quiz-progress fight-quiz-progress';
    const pct = Math.round(chargeAmt * 100);
    progress.textContent = `⚡ 對戰答題・答啱 +${pct}% 特技儲力`;

    const clock = document.createElement('span');
    clock.className = 'quiz-clock fight-quiz-clock';
    clock.textContent = `⏱ ${remaining} 秒`;

    head.append(seal, progress, clock);

    const stem = document.createElement('div');
    stem.className = 'quiz-stem';
    stem.textContent = q.q;

    const optsEl = document.createElement('div');
    optsEl.className = 'quiz-options fight-quiz-options';
    const buttons: HTMLButtonElement[] = [];

    const choose = (i: number) => {
      if (locked || settled) return;
      locked = true;
      if (timerId !== null) {
        window.clearInterval(timerId);
        timerId = null;
      }
      const isRight = i === answer;
      clock.textContent = isRight ? `✓ 儲力 +${pct}%` : '✗ 答錯';
      clock.classList.toggle('is-correct', isRight);
      clock.classList.toggle('is-wrong', !isRight);

      buttons.forEach((b, bi) => {
        b.disabled = true;
        if (bi === answer) b.classList.add('correct');
        else if (bi === i) b.classList.add('wrong');
      });
      closeTimeoutId = window.setTimeout(() => {
        destroy({
          correct: isRight,
          charge: isRight ? chargeAmt : 0,
          timedOut: false,
        });
      }, 380);
    };

    options.forEach((text, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'quiz-option fight-quiz-option';
      btn.textContent = `${'甲乙丙丁'[i]}、${text}`;
      btn.addEventListener('click', () => choose(i));
      optsEl.append(btn);
      buttons.push(btn);
    });

    panel.append(head, stem, optsEl);
    root.append(panel);

    window.setTimeout(() => {
      root.classList.remove('fight-quiz-attention');
    }, 900);

    timerId = window.setInterval(() => {
      remaining -= 1;
      clock.textContent = `⏱ ${Math.max(0, remaining)} 秒`;
      if (remaining <= 3) {
        clock.classList.add('is-urgent');
      }
      if (remaining <= 0 && !locked) {
        locked = true;
        if (timerId !== null) {
          window.clearInterval(timerId);
          timerId = null;
        }
        clock.textContent = '⏱ 逾時';
        buttons.forEach((b, bi) => {
          b.disabled = true;
          if (bi === answer) b.classList.add('correct');
        });
        closeTimeoutId = window.setTimeout(() => {
          destroy({ correct: false, charge: 0, timedOut: true });
        }, 320);
      }
    }, 1000);
  });
}
