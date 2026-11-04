#!/usr/bin/env node
/**
 * Sync public/quiz_launch.json + quiz_fight_f1.json + quiz_fight_f2.json + quiz_fight_f3.json
 * from Flash Card Sheet tabs (1vZpNVqC_JyyFIFHjzV5SdoV9--lj8wx5mZMhg6CPotc).
 *
 * Sheet tabs & gids:
 *   開局題   (gid 1206463554) -> public/quiz_launch.json (共用案Q)
 *   對戰題F1 (gid 1656037532) -> public/quiz_fight_f1.json
 *   對戰題F2 (gid 939586596)  -> public/quiz_fight_f2.json
 *   對戰題F3 (gid 2082948485) -> public/quiz_fight_f3.json
 *
 * Usage:
 *   node scripts/sync-quiz-from-sheet.mjs --from-seed
 *   node scripts/sync-quiz-from-sheet.mjs
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHEET_ID = '1vZpNVqC_JyyFIFHjzV5SdoV9--lj8wx5mZMhg6CPotc';

const TABS = {
  launch: { title: '開局題', gid: '1206463554', out: 'public/quiz_launch.json' },
  fight_f1: { title: '對戰題F1', gid: '1656037532', out: 'public/quiz_fight_f1.json' },
  fight_f2: { title: '對戰題F2', gid: '939586596', out: 'public/quiz_fight_f2.json' },
  fight_f3: { title: '對戰題F3', gid: '2082948485', out: 'public/quiz_fight_f3.json' },
};

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQ = false;
        }
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQ = true;
    } else if (c === ',') {
      row.push(cur);
      cur = '';
    } else if (c === '\n') {
      row.push(cur);
      rows.push(row);
      row = [];
      cur = '';
    } else if (c === '\r') {
      continue;
    } else {
      cur += c;
    }
  }
  if (cur.length || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows;
}

function rowsToQuestions(rows) {
  if (!rows.length) return [];
  const header = rows[0].map((h) => String(h ?? '').trim().toLowerCase());
  const idx = (name) => header.indexOf(name);
  const iId = idx('id');
  const iQ = idx('q');
  const i0 = idx('opt0');
  const i1 = idx('opt1');
  const i2 = idx('opt2');
  const i3 = idx('opt3');
  const iAns = idx('answer');
  const iTags = idx('tags');

  const out = [];
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    if (!cells || cells.every((c) => !String(c ?? '').trim())) continue;
    const id = String(cells[iId] ?? '').trim();
    const q = String(cells[iQ] ?? '').trim();
    const options = [i0, i1, i2, i3].map((i) => String(cells[i] ?? '').trim());
    const answer = Number(cells[iAns]);
    const tags = String(cells[iTags] ?? '')
      .split(/[,，]/)
      .map((t) => t.trim())
      .filter(Boolean);
    if (!id || !q || options.some((o) => !o) || ![0, 1, 2, 3].includes(answer)) continue;
    out.push({ id, q, options, answer, tags });
  }
  return out;
}

async function fetchTab({ title, gid }) {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(title)}&gid=${encodeURIComponent(gid)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`gviz ${title} (gid=${gid}): HTTP ${res.status}`);
  const text = await res.text();
  if (text.trimStart().startsWith('<!DOCTYPE') || text.includes('Sign in')) {
    throw new Error(
      `gviz ${title}: Sheet 尚未公開讀取（收到 HTML 登入頁）。請使用 --from-seed 或透過 Coder MCP 同步後再 redeploy。`,
    );
  }
  return rowsToQuestions(parseCsv(text));
}

function findSeedFile() {
  const candidates = [
    join(ROOT, '_sheet_quiz/quiz_seed.json'),
    join(ROOT, '_pvp/fight_quiz_seed_60.json'),
    join(ROOT, 'public/quiz_launch.json'),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

const fromSeed = process.argv.includes('--from-seed');
mkdirSync(join(ROOT, 'public'), { recursive: true });

if (fromSeed) {
  const seedPath = findSeedFile();
  if (!seedPath) {
    throw new Error('找不到種子檔（_sheet_quiz/quiz_seed.json 或 _pvp/fight_quiz_seed_60.json）');
  }
  const seed = JSON.parse(readFileSync(seedPath, 'utf8'));
  const jsonText = JSON.stringify(seed, null, 2);
  writeFileSync(join(ROOT, TABS.launch.out), jsonText);
  writeFileSync(join(ROOT, TABS.fight_f1.out), jsonText);
  writeFileSync(join(ROOT, TABS.fight_f2.out), jsonText);
  writeFileSync(join(ROOT, TABS.fight_f3.out), jsonText);
  writeFileSync(join(ROOT, 'public/quiz_fight.json'), jsonText);
  console.log(`[sync-quiz] wrote launch + fight_f1/f2/f3 + fight from seed (${seed.length} questions)`);
  process.exit(0);
}

const [launch, fightF1, fightF2, fightF3] = await Promise.all([
  fetchTab(TABS.launch),
  fetchTab(TABS.fight_f1),
  fetchTab(TABS.fight_f2),
  fetchTab(TABS.fight_f3),
]);

writeFileSync(join(ROOT, TABS.launch.out), JSON.stringify(launch, null, 2));
writeFileSync(join(ROOT, TABS.fight_f1.out), JSON.stringify(fightF1, null, 2));
writeFileSync(join(ROOT, TABS.fight_f2.out), JSON.stringify(fightF2, null, 2));
writeFileSync(join(ROOT, TABS.fight_f3.out), JSON.stringify(fightF3, null, 2));
// 保留 quiz_fight.json 作通用 fallback（預設同步自 F1）
writeFileSync(join(ROOT, 'public/quiz_fight.json'), JSON.stringify(fightF1, null, 2));

console.log('[sync-quiz] synced:', {
  launch: launch.length,
  fight_f1: fightF1.length,
  fight_f2: fightF2.length,
  fight_f3: fightF3.length,
});
