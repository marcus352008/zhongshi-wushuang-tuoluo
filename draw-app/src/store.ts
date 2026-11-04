/**
 * DrawLog／擁有卡存儲
 * - 有 DRAW_KV → 用 KV
 * - 否則 memory（單 isolate；dev／mock 夠用）
 * Sheets 寫入見 sheets.ts（要 SA）
 */

export type DrawLogEntry = {
  drawId: string;
  email: string;
  drawnAt: string; // ISO with +08:00 preferred
  cardId: string;
  cardName: string;
  slot: string;
  cost: number;
  isDuplicate: boolean;
  creditedSecBefore: number;
  entitledBefore: number;
  source: "flashcard_10min";
};

export interface DrawStore {
  listDraws(email: string): Promise<DrawLogEntry[]>;
  countDraws(email: string): Promise<number>;
  appendDraw(entry: DrawLogEntry): Promise<void>;
  ownedIds(email: string): Promise<Set<string>>;
  collection(email: string): Promise<
    { cardId: string; firstDrawnAt: string; count: number }[]
  >;
}

const mem = new Map<string, DrawLogEntry[]>();

function keyEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function createMemoryStore(): DrawStore {
  return {
    async listDraws(email) {
      return [...(mem.get(keyEmail(email)) || [])].reverse();
    },
    async countDraws(email) {
      return (mem.get(keyEmail(email)) || []).length;
    },
    async appendDraw(entry) {
      const k = keyEmail(entry.email);
      const arr = mem.get(k) || [];
      arr.push(entry);
      mem.set(k, arr);
    },
    async ownedIds(email) {
      const set = new Set<string>();
      for (const e of mem.get(keyEmail(email)) || []) set.add(e.cardId);
      return set;
    },
    async collection(email) {
      const map = new Map<string, { cardId: string; firstDrawnAt: string; count: number }>();
      for (const e of mem.get(keyEmail(email)) || []) {
        const cur = map.get(e.cardId);
        if (!cur) {
          map.set(e.cardId, {
            cardId: e.cardId,
            firstDrawnAt: e.drawnAt,
            count: 1,
          });
        } else {
          cur.count += 1;
        }
      }
      return [...map.values()].sort((a, b) => a.cardId.localeCompare(b.cardId));
    },
  };
}

/** KV：每 user 一 key `drawlog:{email}` → JSON array */
export function createKvStore(kv: KVNamespace): DrawStore {
  const key = (email: string) => `drawlog:${keyEmail(email)}`;
  async function load(email: string): Promise<DrawLogEntry[]> {
    const raw = await kv.get(key(email));
    if (!raw) return [];
    try {
      return JSON.parse(raw) as DrawLogEntry[];
    } catch {
      return [];
    }
  }
  return {
    async listDraws(email) {
      return [...(await load(email))].reverse();
    },
    async countDraws(email) {
      return (await load(email)).length;
    },
    async appendDraw(entry) {
      const arr = await load(entry.email);
      arr.push(entry);
      await kv.put(key(entry.email), JSON.stringify(arr));
    },
    async ownedIds(email) {
      const set = new Set<string>();
      for (const e of await load(email)) set.add(e.cardId);
      return set;
    },
    async collection(email) {
      const map = new Map<string, { cardId: string; firstDrawnAt: string; count: number }>();
      for (const e of await load(email)) {
        const cur = map.get(e.cardId);
        if (!cur) {
          map.set(e.cardId, {
            cardId: e.cardId,
            firstDrawnAt: e.drawnAt,
            count: 1,
          });
        } else {
          cur.count += 1;
        }
      }
      return [...map.values()].sort((a, b) => a.cardId.localeCompare(b.cardId));
    },
  };
}

export function newDrawId(): string {
  return `d_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** HK ISO-ish timestamp */
export function nowHkIso(): string {
  const d = new Date();
  // format as Asia/Hong_Kong offset +08:00
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value || "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}+08:00`;
}
