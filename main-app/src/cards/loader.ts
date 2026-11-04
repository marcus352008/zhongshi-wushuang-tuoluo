import { SLOT_KEYS, SLOT_NAMES, slotKeyOf, type Card, type SlotKey, type SlotName } from './types';

const NUMERIC_FIELDS = ['cost', 'atk', 'def', 'sta_decay', 'spd', 'mas', 'br'] as const;
const OPTIONAL_TEXT = ['rarity', 'era_role', 'main_label', 'sub_mod', 'lore_28'] as const;
const VALID_SLOTS = new Set<string>(Object.values(SLOT_NAMES));

export interface SkippedCard {
  id: string;
  reason: string;
}

export interface LoadReport {
  total: number;
  loaded: number;
  perSlot: Record<SlotKey, number>;
  skipped: SkippedCard[];
  distinctSubMods: string[];
}

export interface LoadResult {
  cards: Card[];
  report: LoadReport;
  source: 'cards_60.json' | 'cards_sample.json';
}

function toNumber(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '') return Number(v);
  return NaN;
}

function toText(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}

/** Pure parser: coerces string numerics, skips bad cards, never throws on card content. */
export function parseCards(raw: unknown): { cards: Card[]; report: LoadReport } {
  const list = Array.isArray(raw) ? raw : [];
  const cards: Card[] = [];
  const skipped: SkippedCard[] = [];

  list.forEach((item, index) => {
    if (typeof item !== 'object' || item === null) {
      skipped.push({ id: `#${index}`, reason: 'not an object' });
      return;
    }
    const r = item as Record<string, unknown>;
    const id = toText(r.id).trim();
    const name = toText(r.name).trim();
    if (!id || !name) {
      skipped.push({ id: id || `#${index}`, reason: 'missing id or name' });
      return;
    }
    const slot = toText(r.slot).trim();
    if (!VALID_SLOTS.has(slot)) {
      skipped.push({ id, reason: `invalid slot "${slot}"` });
      return;
    }
    const nums = {} as Record<(typeof NUMERIC_FIELDS)[number], number>;
    for (const f of NUMERIC_FIELDS) {
      const n = toNumber(r[f]);
      if (Number.isNaN(n)) {
        skipped.push({ id, reason: `field "${f}" is not a number (${JSON.stringify(r[f])})` });
        return;
      }
      nums[f] = n;
    }
    const text = {} as Record<(typeof OPTIONAL_TEXT)[number], string>;
    for (const f of OPTIONAL_TEXT) text[f] = toText(r[f]);
    cards.push({ id, name, slot: slot as SlotName, ...nums, ...text });
  });

  const perSlot = { A: 0, B: 0, C: 0 } as Record<SlotKey, number>;
  for (const c of cards) perSlot[slotKeyOf(c.slot)]++;
  const distinctSubMods = [...new Set(cards.map((c) => c.sub_mod.trim()).filter(Boolean))];

  return {
    cards,
    report: { total: list.length, loaded: cards.length, perSlot, skipped, distinctSubMods },
  };
}

export function printLoadReport(report: LoadReport, source: string): void {
  console.groupCollapsed(`[cards] ${source}: loaded ${report.loaded}/${report.total}`);
  console.log('per slot:', SLOT_KEYS.map((k) => `${k} ${SLOT_NAMES[k]}=${report.perSlot[k]}`).join(', '));
  if (report.skipped.length) {
    console.warn('skipped cards:');
    for (const s of report.skipped) console.warn(`  ${s.id}: ${s.reason}`);
  } else {
    console.log('skipped cards: none');
  }
  console.log(`distinct sub_mod strings (${report.distinctSubMods.length}):`);
  for (const s of report.distinctSubMods) console.log(`  ${s}`);
  console.groupEnd();
}

async function fetchJson(path: string): Promise<unknown | null> {
  try {
    const res = await fetch(path, { cache: 'no-store' });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** Loads public/cards_60.json; falls back to the sample deck when the real file is missing. */
export async function loadCards(base = import.meta.env.BASE_URL): Promise<LoadResult> {
  let source: LoadResult['source'] = 'cards_60.json';
  let raw = await fetchJson(`${base}cards_60.json`);
  if (raw === null) {
    source = 'cards_sample.json';
    raw = await fetchJson(`${base}cards_sample.json`);
  }
  if (raw === null) throw new Error('無法載入卡牌資料');
  const { cards, report } = parseCards(raw);
  printLoadReport(report, source);
  return { cards, report, source };
}
