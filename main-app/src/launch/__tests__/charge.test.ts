import { describe, expect, it } from 'vitest';
import {
  CHARGE_RAMP_SEC,
  QUIZ_POWER_BY_CORRECT,
  QUIZ_SEC_PER_Q,
  SWEET_BAND_MIN,
} from '../../config/balance';
import { chargeRaw, inSweetBand, launchPowerFromRaw } from '../charge';
import { powerFromCorrectCount } from '../quizLaunch';
import { pickQuestions, QUIZ_BANK, shuffleOptions, parseQuizQuestions, setQuizBank, resetQuizBanksToFallback, getQuizBank } from '../quizBank';

describe('Case C charge', () => {
  it('ramps 0 → 1 over 1.5 s then holds at 1 (no overflow, no cycling)', () => {
    expect(CHARGE_RAMP_SEC).toBe(1.5);
    expect(chargeRaw(0)).toBe(0);
    expect(chargeRaw(0.75)).toBeCloseTo(0.5, 10);
    expect(chargeRaw(1.5)).toBe(1);
    expect(chargeRaw(3)).toBe(1);
    expect(chargeRaw(60)).toBe(1);
  });

  it('sweet band [0.85, 1.0] gives full power, otherwise raw', () => {
    expect(SWEET_BAND_MIN).toBe(0.85);
    expect(inSweetBand(0.849)).toBe(false);
    expect(launchPowerFromRaw(0.849)).toBeCloseTo(0.849, 10);
    expect(launchPowerFromRaw(0.85)).toBe(1);
    expect(launchPowerFromRaw(0.93)).toBe(1);
    expect(launchPowerFromRaw(1)).toBe(1);
    expect(launchPowerFromRaw(0.3)).toBeCloseTo(0.3, 10);
  });
});

describe('案Q 功率表', () => {
  it('答對數 → 功率符合 Marcus 表（0→0.25 … 5→1.20）', () => {
    expect(QUIZ_POWER_BY_CORRECT).toEqual([0.25, 0.4, 0.55, 0.7, 0.95, 1.2]);
    expect(powerFromCorrectCount(0)).toBe(0.25);
    expect(powerFromCorrectCount(1)).toBe(0.4);
    expect(powerFromCorrectCount(2)).toBe(0.55);
    expect(powerFromCorrectCount(3)).toBe(0.7);
    expect(powerFromCorrectCount(4)).toBe(0.95);
    expect(powerFromCorrectCount(5)).toBe(1.2);
  });

  it('全中允許 >1（1.20），不 clamp 到 1', () => {
    expect(powerFromCorrectCount(5)).toBeGreaterThan(1);
  });

  it('越界答對數被夾住', () => {
    expect(powerFromCorrectCount(-3)).toBe(0.25);
    expect(powerFromCorrectCount(99)).toBe(1.2);
  });

  it('每題限時在 8–12 秒之間（Chromebook 友善）', () => {
    expect(QUIZ_SEC_PER_Q).toBeGreaterThanOrEqual(8);
    expect(QUIZ_SEC_PER_Q).toBeLessThanOrEqual(12);
  });
});

describe('案Q 題庫', () => {
  it('至少 20 題，且每題 4 選 1、答案索引合法', () => {
    expect(QUIZ_BANK.length).toBeGreaterThanOrEqual(20);
    for (const q of QUIZ_BANK) {
      expect(q.options.length).toBe(4);
      expect(q.answer).toBeGreaterThanOrEqual(0);
      expect(q.answer).toBeLessThanOrEqual(3);
      expect(q.q.length).toBeGreaterThan(0);
    }
  });

  it('抽 5 題不重複', () => {
    const picked = pickQuestions(5, () => 0.42);
    expect(picked.length).toBe(5);
    const ids = new Set(picked.map((q) => q.id));
    expect(ids.size).toBe(5);
  });

  it('loadout 人名加權：項羽應優先抽到綁定項羽的題', () => {
    const picked = pickQuestions(5, () => 0.01, ['項羽']);
    expect(picked.some((q) => q.tags.includes('項羽'))).toBe(true);
  });

  it('洗選項後答案索引仍指向正確文字', () => {
    const q = QUIZ_BANK[0];
    const { options, answer } = shuffleOptions(q, () => 0.7);
    expect(options[answer]).toBe(q.options[q.answer]);
  });
});

describe('Sheet quiz parse / runtime banks', () => {
  it('parseQuizQuestions accepts JSON QuizQuestion shape', () => {
    const parsed = parseQuizQuestions([
      { id: 't1', q: '題?', options: ['a', 'b', 'c', 'd'], answer: 2, tags: ['測'] },
      { id: 'bad', q: '', options: ['a', 'b', 'c', 'd'], answer: 0, tags: [] },
    ]);
    expect(parsed.length).toBe(1);
    expect(parsed[0].answer).toBe(2);
  });

  it('parseQuizQuestions accepts sheet opt0–opt3 rows', () => {
    const parsed = parseQuizQuestions([
      { id: 's1', q: '問', opt0: 'A', opt1: 'B', opt2: 'C', opt3: 'D', answer: '1', tags: '甲,乙' },
    ]);
    expect(parsed[0].options[1]).toBe('B');
    expect(parsed[0].tags).toEqual(['甲', '乙']);
  });

  it('setQuizBank fight with <1 valid keeps fallback; launch needs ≥5', () => {
    resetQuizBanksToFallback();
    const before = getQuizBank('fight').length;
    expect(setQuizBank('fight', [])).toBe(false);
    expect(getQuizBank('fight').length).toBe(before);
    const five = QUIZ_BANK.slice(0, 5);
    expect(setQuizBank('launch', five)).toBe(true);
    expect(getQuizBank('launch').length).toBe(5);
    resetQuizBanksToFallback();
  });

  it('pickQuestions bank=fight uses fight runtime bank', () => {
    resetQuizBanksToFallback();
    const one = [{ id: 'only', q: '獨?', options: ['a', 'b', 'c', 'd'] as [string, string, string, string], answer: 0 as const, tags: [] }];
    expect(setQuizBank('fight', one)).toBe(true);
    const picked = pickQuestions(1, () => 0.5, [], 'fight');
    expect(picked[0].id).toBe('only');
    resetQuizBanksToFallback();
  });
});
