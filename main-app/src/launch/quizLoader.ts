/**
 * Load launch (shared) and graded fight quiz banks (F1/F2/F3) from static JSON (synced from Sheet at deploy).
 * Sheet tabs on Flash Card spreadsheet (1vZpNVqC_JyyFIFHjzV5SdoV9--lj8wx5mZMhg6CPotc):
 * - 開局題 (gid 1206463554)   → /quiz_launch.json (共用案Q)
 * - 對戰題F1 (gid 1656037532) → /quiz_fight_f1.json
 * - 對戰題F2 (gid 939586596)  → /quiz_fight_f2.json
 * - 對戰題F3 (gid 2082948485) → /quiz_fight_f3.json
 */
import {
  parseQuizQuestions,
  setQuizBank,
  type QuizBankKind,
  type QuizQuestion,
} from './quizBank';

const URLS: Record<QuizBankKind, string> = {
  launch: '/quiz_launch.json',
  fight_f1: '/quiz_fight_f1.json',
  fight_f2: '/quiz_fight_f2.json',
  fight_f3: '/quiz_fight_f3.json',
  fight: '/quiz_fight.json',
};

async function fetchBank(kind: QuizBankKind): Promise<QuizQuestion[] | null> {
  try {
    const res = await fetch(URLS[kind], { cache: 'no-cache' });
    if (!res.ok) {
      if (kind !== 'fight') {
        console.warn(`[quizLoader] ${kind} (${URLS[kind]}): HTTP ${res.status}`);
      }
      return null;
    }
    const raw = await res.json();
    return parseQuizQuestions(raw);
  } catch (e) {
    if (kind !== 'fight') {
      console.warn(`[quizLoader] ${kind}:`, e);
    }
    return null;
  }
}

export interface QuizBanksLoadReport {
  launch: number;
  fight_f1: number;
  fight_f2: number;
  fight_f3: number;
  fight: number;
  source: 'json' | 'fallback';
}

/**
 * 並行載入開局題與 F1/F2/F3 分級儲力題；
 * 任何單一 JSON 缺失或題數不足時，該分級自動保留內置或 F1 fallback，永不拋錯阻斷開機。
 */
export async function loadQuizBanksFromSheetSync(): Promise<QuizBanksLoadReport> {
  const [launch, f1, f2, f3, genericFight] = await Promise.all([
    fetchBank('launch'),
    fetchBank('fight_f1'),
    fetchBank('fight_f2'),
    fetchBank('fight_f3'),
    fetchBank('fight'),
  ]);

  let usedJson = false;
  const report: QuizBanksLoadReport = {
    launch: 0,
    fight_f1: 0,
    fight_f2: 0,
    fight_f3: 0,
    fight: 0,
    source: 'fallback',
  };

  if (launch && setQuizBank('launch', launch)) {
    report.launch = launch.length;
    usedJson = true;
  }

  // 先處理通用 fight fallback（若無 quiz_fight.json 但有 f1，亦可用 f1 作未知年級 CPU 練習之基底）
  if (genericFight && setQuizBank('fight', genericFight)) {
    report.fight = genericFight.length;
    usedJson = true;
  } else if (f1 && setQuizBank('fight', f1)) {
    report.fight = f1.length;
  }

  // 嚴格獨立載入 F1 / F2 / F3 分級題庫
  if (f1 && setQuizBank('fight_f1', f1)) {
    report.fight_f1 = f1.length;
    usedJson = true;
  }
  if (f2 && setQuizBank('fight_f2', f2)) {
    report.fight_f2 = f2.length;
    usedJson = true;
  }
  if (f3 && setQuizBank('fight_f3', f3)) {
    report.fight_f3 = f3.length;
    usedJson = true;
  }

  report.source = usedJson ? 'json' : 'fallback';
  return report;
}
