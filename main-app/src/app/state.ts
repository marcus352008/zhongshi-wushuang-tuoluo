import type { Card, Loadout, PartialLoadout } from '../cards/types';
import type { LoadResult } from '../cards/loader';
import { Rng } from '../core/rng';
import type { AuthSession } from '../auth/drawAuth';
import type { UrlParams } from '../core/params';

export interface Settings {
  /** Always false — S模式已取消（0.5.12）。 */
  modeS: boolean;
  qc: boolean;
  /** 「低畫質」 Chromebook mode; high quality is the default. */
  lowGfx: boolean;
  muted: boolean;
  unlockAll: boolean;
  assembleTimer: boolean;
}

/** Ownership fetch lifecycle for assemble UI (error ≠ empty). */
export type OwnershipStatus = 'loading' | 'ok' | 'empty' | 'error';

type Listener = () => void;

const PLAYER_NAME_KEY = 'wushuang.playerName';
const DEFAULT_PLAYER_NAME = '玩家';

function loadPlayerName(): string {
  try {
    const v = localStorage.getItem(PLAYER_NAME_KEY);
    if (v && v.trim()) return v.trim().slice(0, 8);
  } catch {
    /* localStorage 不可用時忽略 */
  }
  return DEFAULT_PLAYER_NAME;
}

export class AppState {
  readonly cards: Card[];
  readonly source: LoadResult['source'];
  readonly params: UrlParams;
  readonly seed: number;
  /** Session RNG; every match forks its own stream from it. */
  readonly rng: Rng;
  settings: Settings;
  ownedIds = new Set<string>();
  /** Distinguishes load failure from a true empty collection. */
  ownershipStatus: OwnershipStatus = 'loading';
  ownershipError: string | null = null;
  authSession: AuthSession | null = null;
  player: PartialLoadout = {};
  cpu: Loadout | null = null;
  /** 玩家短名字（預設「玩家」，最多 8 字）。 */
  playerName = loadPlayerName();
  private listeners = new Set<Listener>();

  constructor(load: LoadResult, params: UrlParams, seed: number) {
    this.cards = load.cards;
    this.source = load.source;
    this.params = params;
    this.seed = seed;
    this.rng = new Rng(seed);
    this.settings = {
      modeS: false,
      qc: params.qc,
      lowGfx: false,
      muted: false,
      unlockAll: false, // teacher demo can toggle; students use owned cards
      assembleTimer: false,
    };
  }

  card(id: string): Card | undefined {
    return this.cards.find((c) => c.id === id);
  }

  set<K extends keyof Settings>(key: K, value: Settings[K]): void {
    this.settings = { ...this.settings, [key]: value };
    this.listeners.forEach((l) => l());
  }

  setOwnershipLoading(): void {
    this.ownershipStatus = 'loading';
    this.ownershipError = null;
    this.listeners.forEach((l) => l());
  }

  /**
   * Apply a successful ownership fetch. Empty ids → status `empty`.
   */
  applyOwnedSuccess(ids: string[]): void {
    this.ownedIds = new Set(ids);
    this.ownershipStatus = ids.length === 0 ? 'empty' : 'ok';
    this.ownershipError = null;
    this.listeners.forEach((l) => l());
  }

  /**
   * Apply a failed ownership fetch without wiping a previously successful set.
   */
  applyOwnedFailure(message: string): void {
    this.ownershipStatus = 'error';
    this.ownershipError = message;
    // Keep prior ownedIds if any — do NOT silent-clear to empty.
    this.listeners.forEach((l) => l());
  }

  setPlayerName(name: string): void {
    const trimmed = name.trim().slice(0, 8);
    this.playerName = trimmed || DEFAULT_PLAYER_NAME;
    try {
      localStorage.setItem(PLAYER_NAME_KEY, this.playerName);
    } catch {
      /* localStorage 不可用時忽略 */
    }
    this.listeners.forEach((l) => l());
  }

  onChange(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
}
