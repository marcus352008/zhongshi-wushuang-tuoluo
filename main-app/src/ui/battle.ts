import type { AppState } from '../app/state';
import { SLOT_KEYS, type Loadout } from '../cards/types';
import {
  AIM_ARC,
  AIM_TURN_RATE,
  CPU_CASE_C_POWER,
  DASH_ENABLED,
  FIGHT_QUIZ_CHARGE,
  FIGHT_QUIZ_ENABLED,
  FIGHT_QUIZ_FIRST_SEC,
  FIGHT_QUIZ_INTERVAL_SEC,
  PHYS_DT,
  QUIZ_LAUNCH_ENABLED,
  ROUND_TIMEOUT_SEC,
  SPECIALS_ENABLED,
  SPECIAL_CHARGE_MAX,
  SPECIAL_CPU_DELAY_SEC,
  SWEET_BAND_MIN,
} from '../config/balance';
import { createRng } from '../core/rng';
import type { Vec2 } from '../core/vec';
import { cpuSteer } from '../game/cpu';
import { Match, type LaunchInput, type RoundResult } from '../game/match';
import {
  addCharge,
  applySpecial,
  chargeGainForSide,
  pickStrongest,
  skillTypeOf,
  type StrongestPick,
} from '../game/specials';
import type { Input } from '../input/input';
import { baseLaunchSpot, clampAim, defaultAim, randomAim } from '../launch/aim';
import { chargeRaw, inSweetBand, launchPowerFromRaw } from '../launch/charge';
import { dismissFightQuizOverlay, fightQuizOnce } from '../launch/fightQuiz';
import { dismissLaunchQuizOverlay, quizLaunch } from '../launch/quizLaunch';
import { deriveParams } from '../physics/derive';
import { createBody, World, type Body } from '../physics/world';
import type { PvpInputPacket, PvpSnapPacket, RoomEndMsg, SnapEvents } from '../pvp/client';
import type { FormLevel } from '../pvp/form';
import { SLOT_COLORS, type ArenaView } from '../render/arenaView';
import { fuse } from '../rules/fuse';
import { SpectateHost, spectateUrl } from '../spectate/spectate';
import type { Sfx } from '../audio/sfx';
import { h, hex, toast } from './dom';
import { modeLabel, pointsLine, roundTitle, SIDE_LABEL, SKILL_DESC, SKILL_LABEL } from './labels';

type Phase = 'launch' | 'quiz' | 'fight' | 'score';

const SCORE_PAUSE_SEC = 3;
const NET_SEND_INTERVAL_SEC = 0.05; // 20Hz 網路同步頻率
const PVP_LAUNCH_WAIT_MAX_SEC = 25; // 一方已發射後最多等對方 25 秒（含案Q 答題時間）

/** 0.5.12：S模式已取消；有開案Q 就一律要開局題（PvP／單機相同）。 */
function requiresLaunchQuiz(_pvp?: PvpBattleOptions): boolean {
  return QUIZ_LAUNCH_ENABLED;
}


export interface BattleCallbacks {
  onEnd(match: Match, pvpEnd?: RoomEndMsg): void;
  onReassemble(): void;
}

export interface PvpBattleOptions {
  roomCode: string;
  form: FormLevel;
  seat: 0 | 1;
  isHost: boolean;
  matchSeed: number;
  playerNames: [string, string];
  sendInput: (pkt: PvpInputPacket) => void;
  sendSnap: (snap: PvpSnapPacket) => void;
  sendForfeit: () => void;
  sendMatchEnd: (scores: [number, number], winnerSeat: 0 | 1 | null) => void;
}

export interface BattleBar {
  root: HTMLElement;
  status: HTMLElement;
  meter: HTMLElement;
  sweet: HTMLElement;
  fill: HTMLElement;
  charge: HTMLElement;
  dash: HTMLButtonElement;
  aimLeft: HTMLElement;
  aimRight: HTMLElement;
  special?: HTMLButtonElement | null;
}

interface SideSpecial {
  pick: StrongestPick | null;
  charge: number;
  cpuTimer: number;
}

export class Battle {
  readonly match: Match;
  private readonly mySeat: 0 | 1;
  private readonly oppSeat: 0 | 1;
  private readonly quizForm: FormLevel | null;
  private phase: Phase = 'launch';
  private aim: number;
  private remoteAim: number;
  private charging = false;
  private held = 0;
  private scoreTimer = 0;
  private acc = 0;
  private paused = false;
  /** 案Q 完成後固定的發射功率（>1 合法）。 */
  private quizPower: number | null = null;
  private quizBusy = false;
  private fightQuizTimer = 0;
  private fightQuizBusy = false;
  /** true until first fight MC of this round has been triggered. */
  private fightQuizAwaitFirst = true;
  /** 保證每回合至少見一題：本回合是否已成功彈出過 fight quiz。 */
  private fightQuizShownThisRound = false;
  /** 递增序號，防止跨回合 async resolve 污染新回合狀態。 */
  private fightQuizSeq = 0;
  /** 若短局提早分出勝負而尚未出題，暫存結算結果直至保底題完成。 */
  private pendingScoreResult: RoundResult | null = null;
  private spectateHost: SpectateHost | null = null;
  private shareEl: HTMLElement | null = null;
  private vfxEl: HTMLElement | null = null;
  private preview: [Body, Body];
  private overlay: HTMLElement;
  private top: HTMLElement;
  private banner: HTMLElement;
  private menu: HTMLElement | null = null;
  private cleanups: (() => void)[] = [];
  private specials: [SideSpecial, SideSpecial];
  private specialBtn: HTMLButtonElement | null = null;
  private specialMeterEls: [HTMLElement, HTMLElement] | null = null;
  private specialReadyEls: [HTMLElement, HTMLElement] | null = null;
  private portraitEls: [HTMLElement[], HTMLElement[]] = [[], []];
  lastLaunchFeedback = '';

  // ---- PvP 實時同步欄位 ----
  private netSeq = 0;
  private inputSendAccum = 0;
  private snapSendAccum = 0;
  private remoteSteer: Vec2 = { x: 0, z: 0 };
  private remoteEdges = { dash: false, special: false };
  private pendingLaunches: [LaunchInput | null, LaunchInput | null] = [null, null];
  private localLaunchCommitted = false;
  private launchWaitElapsed = 0;
  private pendingSnapEvents: SnapEvents = {};
  private lastAppliedSnapRound = 0;
  private lastAppliedScoreRound = 0;
  private endedNotified = false;

  constructor(
    private app: AppState,
    private view: ArenaView,
    private sfx: Sfx,
    private input: Input,
    private bar: BattleBar,
    overlayRoot: HTMLElement,
    loadouts: [Loadout, Loadout],
    private cb: BattleCallbacks,
    private pvp?: PvpBattleOptions,
    cpuPlayerForm?: FormLevel | null,
  ) {
    this.mySeat = pvp ? pvp.seat : 0;
    this.oppSeat = this.mySeat === 0 ? 1 : 0;
    this.quizForm = pvp ? pvp.form : (cpuPlayerForm ?? null);
    this.aim = defaultAim(this.mySeat);
    this.remoteAim = defaultAim(this.oppSeat);

    const rng = pvp ? createRng(pvp.matchSeed) : app.rng.fork();
    // 0.5.12：永遠 Case C（S模式已取消）
    this.match = new Match(loadouts, 'C', rng);
    this.preview = ([0, 1] as const).map((s) =>
      createBody(deriveParams(fuse(loadouts[s]), CPU_CASE_C_POWER), baseLaunchSpot(s), { x: 0, z: 0 }),
    ) as [Body, Body];
    view.setSides([this.match.sides[0].fused, this.match.sides[1].fused]);

    this.specials = [
      { pick: SPECIALS_ENABLED ? pickStrongest(loadouts[0]) : null, charge: 0, cpuTimer: 0 },
      { pick: SPECIALS_ENABLED ? pickStrongest(loadouts[1]) : null, charge: 0, cpuTimer: 0 },
    ];
    view.setSideNames([this.playerLabel(0), this.playerLabel(1)]);

    const roomParam = app.params.room ?? (pvp ? pvp.roomCode : undefined);
    this.spectateHost = new SpectateHost(roomParam ?? undefined);
    this.shareEl = h(
      'div.spectate-share',
      {},
      h('span', {}, pvp ? `對戰房 ${pvp.roomCode}（${pvp.form}）` : `觀戰碼 ${this.spectateHost.room}`),
      h(
        'button.btn.spectate-copy',
        {
          type: 'button',
          onclick: () => {
            const url = spectateUrl(this.spectateHost!.room);
            void navigator.clipboard?.writeText(url).catch(() => undefined);
            toast('已複製觀戰連結');
          },
        },
        '複製觀戰連結',
      ),
    );

    this.overlay = h('div');
    this.top = h('div.battle-top');
    this.banner = h('div.round-banner.hidden');
    this.overlay.append(this.top, this.banner);
    if (this.shareEl) this.overlay.append(this.shareEl);
    overlayRoot.append(this.overlay);

    bar.root.classList.remove('hidden');
    bar.sweet.style.left = `${SWEET_BAND_MIN * 100}%`;
    bar.sweet.style.width = `${(1 - SWEET_BAND_MIN) * 100}%`;
    bar.dash.disabled = !DASH_ENABLED;
    input.reset();

    this.specialBtn = bar.special ?? null;
    if (this.specialBtn) {
      this.specialBtn.classList.toggle('hidden', !SPECIALS_ENABLED);
      this.specialBtn.disabled = true;
      this.specialBtn.textContent = '特技';
    }

    const canvas = view.canvas;
    let dragging = false;
    const aimAt = (e: PointerEvent) => {
      if (this.localLaunchCommitted) return;
      const p = view.pickGround(e.clientX, e.clientY);
      if (!p) return;
      const from = baseLaunchSpot(this.mySeat);
      this.aim = clampAim(this.mySeat, Math.atan2(p.z - from.z, p.x - from.x));
    };
    const down = (e: PointerEvent) => {
      if (this.phase !== 'launch' || this.paused || this.localLaunchCommitted) return;
      dragging = true;
      aimAt(e);
    };
    const move = (e: PointerEvent) => dragging && aimAt(e);
    const up = () => (dragging = false);
    canvas.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    this.cleanups.push(() => {
      canvas.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    });
    this.cleanups.push(app.onChange(() => this.syncMode()));

    view.resetTops();
    this.enterLaunch();
  }

  // =========================================================================
  // PvP 網路封包接收處理
  // =========================================================================

  receiveRemoteInput(pkt: PvpInputPacket & { seat: 0 | 1 }): void {
    if (!this.pvp || pkt.seat === this.mySeat) return;

    if (pkt.steer) {
      this.remoteSteer = {
        x: Math.max(-1, Math.min(1, Number(pkt.steer.x) || 0)),
        z: Math.max(-1, Math.min(1, Number(pkt.steer.z) || 0)),
      };
    }
    if (typeof pkt.aim === 'number' && Number.isFinite(pkt.aim)) {
      this.remoteAim = clampAim(this.oppSeat, pkt.aim);
    }
    if (pkt.edges) {
      if (pkt.edges.dash) this.remoteEdges.dash = true;
      if (pkt.edges.special) this.remoteEdges.special = true;
    }
    if (typeof pkt.quizCharge === 'number' && pkt.quizCharge > 0 && this.pvp.isHost && SPECIALS_ENABLED) {
      this.specials[pkt.seat].charge = addCharge(this.specials[pkt.seat].charge, pkt.quizCharge);
      this.updateSpecialHud();
    }
    if (pkt.launch) {
      this.pendingLaunches[pkt.seat] = {
        aim: clampAim(pkt.seat, Number(pkt.launch.aim) || defaultAim(pkt.seat)),
        power: Math.max(0.1, Math.min(1.25, Number(pkt.launch.power) || CPU_CASE_C_POWER)),
      };
      if (this.pvp.isHost && this.phase === 'launch') {
        this.tryHostBeginRound();
      }
    }
  }

  receiveSnap(snap: PvpSnapPacket): void {
    if (!this.pvp || this.pvp.isHost) return;

    if (typeof snap.hostAim === 'number') {
      this.remoteAim = clampAim(0, snap.hostAim);
    }

    if (Array.isArray(snap.scores) && snap.scores.length === 2) {
      this.match.scores = [Number(snap.scores[0]) || 0, Number(snap.scores[1]) || 0];
    }

    if (Array.isArray(snap.specialCharge) && snap.specialCharge.length === 2) {
      this.specials[0].charge = Number(snap.specialCharge[0]) || 0;
      this.specials[1].charge = Number(snap.specialCharge[1]) || 0;
      this.updateSpecialHud();
    }

    if (snap.phase === 'fight' && snap.round > this.lastAppliedSnapRound) {
      this.lastAppliedSnapRound = snap.round;
      this.fightQuizSeq += 1;
      dismissFightQuizOverlay();
      dismissLaunchQuizOverlay();
      this.quizBusy = false;
      this.localLaunchCommitted = false;
      this.match.round = snap.round;
      this.match.roundTime = snap.roundTime || 0;

      if (!this.match.world) {
        const b0 = createBody(
          deriveParams(this.match.sides[0].fused, CPU_CASE_C_POWER),
          baseLaunchSpot(0),
          { x: 0, z: 0 },
        );
        const b1 = createBody(
          deriveParams(this.match.sides[1].fused, CPU_CASE_C_POWER),
          baseLaunchSpot(1),
          { x: 0, z: 0 },
        );
        this.match.world = new World([b0, b1], this.match.rng);
      }

      this.phase = 'fight';
      this.fightQuizTimer = 0;
      this.fightQuizBusy = false;
      this.fightQuizAwaitFirst = true;
      this.fightQuizShownThisRound = false;
      this.pendingScoreResult = null;
      this.view.showAim(null);
      this.banner.classList.add('hidden');
      this.renderTop();
    }

    if (snap.bodies && this.match.world) {
      for (const s of [0, 1] as const) {
        const src = snap.bodies[s];
        const dst = this.match.world.bodies[s];
        if (!src || !dst) continue;
        dst.pos.x = src.pos.x;
        dst.pos.z = src.pos.z;
        dst.vel.x = src.vel.x;
        dst.vel.z = src.vel.z;
        dst.spin = src.spin;
        if (src.spin0 > 0) dst.params.spin0 = src.spin0;
        dst.out = src.out;
      }
      this.match.roundTime = snap.roundTime;
    }

    if (snap.events) {
      if (snap.events.launch && this.match.world) {
        this.view.launchFx(this.match.world.bodies);
        this.sfx.launch();
      }
      if (snap.events.clash && snap.events.clash > 0) {
        this.sfx.clash(snap.events.clash);
      }
      if (snap.events.wall && snap.events.wall > 0) {
        this.sfx.wall(snap.events.wall);
      }
      if (snap.events.ringOut) {
        this.sfx.ringOut();
      }
      if (snap.events.specialActivated && this.match.world) {
        const sp = snap.events.specialActivated;
        const body = this.match.world.bodies[sp.seat];
        if (body) {
          this.playSpecialVfx(sp.seat, sp.skill, sp.cardName, body);
          this.sfx.launch();
        }
      }
    }

    if (snap.roundResult && snap.roundResult.round > this.lastAppliedScoreRound) {
      this.lastAppliedScoreRound = snap.roundResult.round;
      this.match.results.push(snap.roundResult);
      this.enterScore(snap.roundResult);
    }
  }

  receiveMatchEnd(endMsg: RoomEndMsg): void {
    if (this.endedNotified) return;
    this.endedNotified = true;
    this.fightQuizSeq += 1;
    dismissFightQuizOverlay();
    this.closeMenu();
    if (Array.isArray(endMsg.scores) && endMsg.scores.length === 2) {
      this.match.scores = [Number(endMsg.scores[0]) || 0, Number(endMsg.scores[1]) || 0];
    }
    if (endMsg.reason === 'forfeit') {
      toast(endMsg.msg || '對戰因棄權結束');
    }
    this.cb.onEnd(this.match, endMsg);
  }

  // =========================================================================
  // 核心對戰狀態機
  // =========================================================================

  private syncMode(): void {
    if (this.phase === 'launch' && !this.charging && !this.localLaunchCommitted) {
      this.match.mode = 'C';
      this.quizPower = null;
    }
    this.renderTop();
  }

  private enterLaunch(): void {
    this.fightQuizSeq += 1;
    dismissFightQuizOverlay();
    dismissLaunchQuizOverlay();
    this.phase = 'launch';
    this.match.mode = 'C';
    this.aim = defaultAim(this.mySeat);
    this.remoteAim = defaultAim(this.oppSeat);
    this.charging = false;
    this.held = 0;
    this.quizPower = null;
    this.quizBusy = false;
    this.fightQuizTimer = 0;
    this.fightQuizBusy = false;
    this.fightQuizAwaitFirst = true;
    this.fightQuizShownThisRound = false;
    this.pendingScoreResult = null;
    this.pendingLaunches = [null, null];
    this.localLaunchCommitted = false;
    this.launchWaitElapsed = 0;
    this.view.resetTops();
    this.banner.classList.add('hidden');
    this.renderTop();
    this.showBanner(`第 ${this.match.round + 1} 回合`, '', `${this.match.scores[0]} : ${this.match.scores[1]}`);
    window.setTimeout(() => this.phase === 'launch' && this.banner.classList.add('hidden'), 1400);
    // 0.5.12：進發射階段即自動出開局題（S模式已取消，單機／PvP 一律）
    if (requiresLaunchQuiz(this.pvp)) {
      window.setTimeout(() => {
        if (
          this.phase === 'launch' &&
          this.quizPower === null &&
          !this.quizBusy &&
          !this.localLaunchCommitted
        ) {
          void this.runQuiz();
        }
      }, 200);
    }
  }

  private portraitRail(s: 0 | 1): HTMLElement {
    const els: HTMLElement[] = [];
    const strongest = this.specials[s].pick;
    const rail = h(
      'div.portrait-rail',
      { class: s === 0 ? 'left side-rail' : 'right side-rail' },
      ...SLOT_KEYS.map((k) => {
        const c = this.match.sides[s].loadout[k];
        const skill = skillTypeOf(c);
        const isBest = !!strongest && strongest.slot === k;
        const img = h('img.portrait-img', {
          src: `/card-art/${c.id}.png`,
          alt: c.name,
          loading: 'lazy',
          onerror: (e: Event) => {
            const target = e.target as HTMLImageElement;
            target.style.display = 'none';
            const fallback = target.nextElementSibling as HTMLElement | null;
            if (fallback) fallback.classList.remove('hidden');
          },
        });
        const fallback = h(
          'span.portrait-fallback.hidden',
          { style: { background: hex(SLOT_COLORS[k]) } },
          c.name.slice(0, 1),
        );
        const art = h('div.portrait-art', {}, img, fallback);
        const nameEl = h('div.portrait-name', {}, c.name);
        const fmt = (n: number) => (Number.isFinite(n) ? n.toFixed(2) : '—');
        const stats = h(
          'div.portrait-stats',
          {},
          h('span', {}, `攻${fmt(c.atk)}`),
          h('span', {}, `防${fmt(c.def)}`),
          h('span', {}, `續${fmt(c.sta_decay)}`),
          h('span', {}, `速${fmt(c.spd)}`),
          h('span', {}, `穩${fmt(c.mas)}`),
          h('span', {}, `爆${fmt(c.br)}`),
        );
        const cardSkill = skill;
        const activeSkill = isBest && strongest ? strongest.skill : cardSkill;
        const skillLabelText = isBest
          ? `★ 本局特技：${SKILL_LABEL[activeSkill]}`
          : `傾向：${SKILL_LABEL[cardSkill]}（副將）`;
        const skillTooltip = isBest
          ? `【本局發動特技】${SKILL_LABEL[activeSkill]}：${SKILL_DESC[activeSkill]}`
          : `【副將未啟用】單卡傾向為${SKILL_LABEL[cardSkill]}，本局特技由最強武將（${strongest ? strongest.card.name : '—'}）決定`;
        const skillEl = h(
          'div.portrait-skill',
          { title: skillTooltip },
          skillLabelText,
        );
        const cell = h(
          'div.portrait-cell',
          {
            class: [
              s === 0 ? 'p1' : 'p2',
              isBest ? 'strongest' : '',
            ]
              .filter(Boolean)
              .join(' '),
            title: `${c.name}（${k}）・${skillLabelText}`,
          },
          art,
          h('div.portrait-meta', {}, nameEl, stats, skillEl),
        );
        els.push(cell);
        return cell;
      }),
    );
    this.portraitEls[s] = els;
    return rail;
  }

  private playerLabel(s: 0 | 1): string {
    if (this.pvp) {
      const base = this.pvp.playerNames[s] || (s === 0 ? '房主' : '挑戰者');
      return s === this.mySeat ? `${base}（你）` : base;
    }
    if (s === 0) return this.app.playerName || '玩家';
    const cpu = this.match.sides[1].loadout;
    const strongest = this.specials[1].pick;
    return strongest ? `對手・${strongest.card.name}` : `對手（${cpu.A.name}）`;
  }

  private renderTop(): void {
    const team = (s: 0 | 1) => {
      const name = h('span.player-name', { class: s === 0 ? 'p1' : 'p2' }, this.playerLabel(s));
      const meter = h('div.special-meter', { class: s === 0 ? 'p1' : 'p2' });
      const fill = h('div.special-meter-fill');
      meter.append(fill);
      const ready = h('div.special-ready.hidden', {}, '特技就緒');
      if (!this.specialMeterEls) this.specialMeterEls = [meter, meter];
      else this.specialMeterEls[s] = meter;
      if (!this.specialReadyEls) this.specialReadyEls = [ready, ready];
      else this.specialReadyEls[s] = ready;
      const pick = this.specials[s].pick;
      const skillTag = pick
        ? h(
            'span.skill-tag',
            {
              class: s === 0 ? 'p1' : 'p2',
              title: `本局特技由最強武將「${pick.card.name}（${pick.slot}）」決定：${SKILL_DESC[pick.skill]}`,
            },
            `${SKILL_LABEL[pick.skill]}（${pick.card.name}）`,
          )
        : null;
      return h(
        'div.team',
        { class: s === 0 ? 'team-p1' : 'team-p2' },
        h('span.side-chip', { class: s === 0 ? 'p1' : 'p2' }, SIDE_LABEL[s]),
        h('div.team-meta', {}, name, skillTag, meter, ready),
      );
    };
    const leftRail = this.portraitRail(0);
    const rightRail = this.portraitRail(1);
    const gradeSuffix = this.quizForm ? `・${this.quizForm}題庫` : '';
    this.top.replaceChildren(
      team(0),
      h('span.team-score', {}, `${this.match.scores[0]} : ${this.match.scores[1]}`),
      team(1),
      h('span.mode-tag', {}, `${modeLabel(this.match.mode, QUIZ_LAUNCH_ENABLED)}${gradeSuffix}`),
    );
    this.overlay.querySelectorAll('.side-portraits').forEach((n) => n.remove());
    this.overlay.append(
      h('div.side-portraits.left', {}, leftRail),
      h('div.side-portraits.right', {}, rightRail),
    );
    this.view.setSideNames([this.playerLabel(0), this.playerLabel(1)]);
    this.updateSpecialHud();
  }

  private updateSpecialHud(): void {
    if (!SPECIALS_ENABLED) return;
    for (const s of [0, 1] as const) {
      const meter = this.specialMeterEls?.[s];
      const ready = this.specialReadyEls?.[s];
      const fill = meter?.querySelector('.special-meter-fill') as HTMLElement | null;
      if (fill) fill.style.width = `${Math.min(100, this.specials[s].charge * 100)}%`;
      const isReady = this.specials[s].charge >= SPECIAL_CHARGE_MAX - 1e-6;
      if (ready) ready.classList.toggle('hidden', !isReady);
      if (meter) meter.classList.toggle('full', isReady);
    }
    if (this.specialBtn) {
      const mySpec = this.specials[this.mySeat];
      const ready = mySpec.charge >= SPECIAL_CHARGE_MAX - 1e-6 && this.phase === 'fight';
      this.specialBtn.disabled = !ready;
      this.specialBtn.classList.toggle('special-ready', ready);
      const pick = mySpec.pick;
      this.specialBtn.textContent = pick
        ? `特技・${SKILL_LABEL[pick.skill]}（${pick.card.name}）`
        : '特技';
    }
  }

  private flashPortrait(s: 0 | 1): void {
    const pick = this.specials[s].pick;
    if (!pick) return;
    const idx = SLOT_KEYS.indexOf(pick.slot);
    const cell = this.portraitEls[s][idx];
    if (!cell) return;
    cell.classList.remove('flash');
    void cell.offsetWidth;
    cell.classList.add('flash');
    window.setTimeout(() => cell.classList.remove('flash'), 900);
  }

  private tryActivateSpecial(s: 0 | 1): boolean {
    if (!SPECIALS_ENABLED) return false;
    const info = this.specials[s];
    if (!info.pick || info.charge < SPECIAL_CHARGE_MAX - 1e-6) return false;
    const world = this.match.world;
    if (!world || this.phase !== 'fight') return false;
    const body = world.bodies[s];
    const opp = world.bodies[1 - s];
    if (!body || body.out) return false;
    const ok = applySpecial(body, opp, info.pick.skill, world.time);
    if (!ok) return false;
    info.charge = 0;
    info.cpuTimer = 0;
    this.playSpecialVfx(s, info.pick.skill, info.pick.card.name, body);
    this.sfx.launch();
    this.updateSpecialHud();
    if (this.pvp?.isHost) {
      this.pendingSnapEvents.specialActivated = {
        seat: s,
        skill: info.pick.skill,
        cardName: info.pick.card.name,
      };
    }
    return true;
  }

  private playSpecialVfx(s: 0 | 1, skill: 'attack' | 'guard' | 'heal', name: string, body: Body): void {
    this.flashPortrait(s);
    this.view.emitSpecialBurst(skill, body);

    const tintClass =
      skill === 'attack' ? 'special-tint-atk' : skill === 'guard' ? 'special-tint-guard' : 'special-tint-heal';
    this.vfxEl?.remove();
    const flash = h('div.special-screen-flash', { class: tintClass });
    const banner = h(
      'div.special-vfx-banner',
      { class: tintClass },
      `${name}・${SKILL_LABEL[skill]}！`,
    );
    flash.append(banner);
    document.body.append(flash);
    this.vfxEl = flash;
    const pick = this.specials[s].pick;
    if (pick) {
      const idx = SLOT_KEYS.indexOf(pick.slot);
      const cell = this.portraitEls[s][idx];
      if (cell) {
        cell.classList.remove('special-burst');
        void cell.offsetWidth;
        cell.classList.add('special-burst');
        window.setTimeout(() => cell.classList.remove('special-burst'), 1200);
      }
    }
    window.setTimeout(() => {
      flash.remove();
      if (this.vfxEl === flash) this.vfxEl = null;
    }, 1100);
  }

  /**
   * 0.5.2-pvp-grade-quiz：對戰儲力題嚴格按 this.quizForm（F1 / F2 / F3）抽取對應分級題庫。
   */
  private async runFightQuiz(): Promise<void> {
    if (this.fightQuizBusy || this.phase !== 'fight' || !FIGHT_QUIZ_ENABLED) return;
    this.fightQuizBusy = true;
    this.fightQuizAwaitFirst = false;
    this.fightQuizShownThisRound = true;
    this.fightQuizTimer = 0;
    const seq = ++this.fightQuizSeq;
    const names = SLOT_KEYS.map((k) => this.match.sides[this.mySeat].loadout[k].name);

    try {
      this.sfx.clash(0.35);
    } catch {
      /* ignore audio errors */
    }

    try {
      const result = await fightQuizOnce({
        loadoutNames: names,
        form: this.quizForm,
        chargeOnCorrect: FIGHT_QUIZ_CHARGE,
        mountEl: this.overlay.parentElement ?? document.getElementById('screens') ?? document.body,
      });
      if (seq !== this.fightQuizSeq) return;
      if (result.correct && result.charge > 0 && SPECIALS_ENABLED) {
        if (this.pvp && !this.pvp.isHost) {
          this.specials[this.mySeat].charge = addCharge(this.specials[this.mySeat].charge, result.charge);
          this.updateSpecialHud();
          this.pvp.sendInput({
            seq: ++this.netSeq,
            quizCharge: result.charge,
          });
        } else {
          this.specials[this.mySeat].charge = addCharge(this.specials[this.mySeat].charge, result.charge);
          this.updateSpecialHud();
        }
      }
    } catch {
      /* never soft-lock */
    } finally {
      if (seq === this.fightQuizSeq) {
        this.fightQuizBusy = false;
        this.fightQuizTimer = 0;
        this.paused = false;
        if (this.pendingScoreResult && this.phase === 'fight') {
          const pending = this.pendingScoreResult;
          this.pendingScoreResult = null;
          this.enterScore(pending);
        } else if (
          FIGHT_QUIZ_ENABLED &&
          this.phase === 'fight' &&
          !this.pendingScoreResult &&
          FIGHT_QUIZ_INTERVAL_SEC <= 0
        ) {
          void this.runFightQuiz();
        }
      }
    }
  }

  private postSpectate(): void {
    if (!this.spectateHost) return;
    const world = this.match.world;
    const spinFrac = (s: 0 | 1): number => {
      if (!world) return 1;
      const b = world.bodies[s];
      if (!b || b.out) return 0;
      return Math.max(0, Math.min(1, b.spin / Math.max(1e-6, b.params.spin0)));
    };
    const hint = (s: 0 | 1): string => {
      const pk = this.specials[s].pick;
      if (!pk) return '—';
      const ready = this.specials[s].charge >= SPECIAL_CHARGE_MAX - 1e-6 ? '就緒' : '蓄力中';
      return `${pk.card.name}・${SKILL_LABEL[pk.skill]}（${ready}）`;
    };
    this.spectateHost.post({
      phase: this.phase,
      scores: [this.match.scores[0], this.match.scores[1]],
      round: this.match.round,
      names: [this.playerLabel(0), this.playerLabel(1)],
      spin: [spinFrac(0), spinFrac(1)],
      charge: [this.specials[0].charge, this.specials[1].charge],
      skillHints: [hint(0), hint(1)],
      status: this.bar.status.textContent || '',
      out: [!!(world && world.bodies[0]?.out), !!(world && world.bodies[1]?.out)],
    });
  }

  private showBanner(big: string, sub: string, score?: string): void {
    this.banner.replaceChildren(h('div.big', {}, big));
    if (score) this.banner.append(h('div.score', {}, score));
    if (sub) this.banner.append(h('div.sub', {}, sub));
    this.banner.classList.remove('hidden');
  }

  private fire(playerPower: number): void {
    if (!this.pvp) {
      this.fightQuizSeq += 1;
      dismissFightQuizOverlay();
      const cpuPower = CPU_CASE_C_POWER;
      this.match.beginRound([
        { aim: this.aim, power: playerPower },
        { aim: randomAim(1, this.match.rng), power: cpuPower },
      ]);
      this.phase = 'fight';
      this.acc = 0;
      this.fightQuizTimer = 0;
      this.fightQuizBusy = false;
      this.fightQuizAwaitFirst = true;
      this.fightQuizShownThisRound = false;
      this.pendingScoreResult = null;
      this.quizPower = null;
      this.view.showAim(null);
      this.view.launchFx(this.match.world!.bodies);
      this.sfx.launch();
      this.banner.classList.add('hidden');
      this.updateSpecialHud();
      return;
    }

    if (this.localLaunchCommitted) return;
    this.localLaunchCommitted = true;
    const myLaunch: LaunchInput = {
      aim: clampAim(this.mySeat, this.aim),
      power: playerPower,
    };
    this.pendingLaunches[this.mySeat] = myLaunch;
    this.pvp.sendInput({
      seq: ++this.netSeq,
      aim: myLaunch.aim,
      launch: {
        round: this.match.round + 1,
        aim: myLaunch.aim,
        power: myLaunch.power,
      },
    });
    this.view.showAim(null);
    this.bar.status.textContent = '已鎖定發射角度與功率，等待對手完成答題與發射…';

    if (this.pvp.isHost) {
      this.tryHostBeginRound();
    }
  }

  private tryHostBeginRound(forceFallback = false): void {
    if (!this.pvp || !this.pvp.isHost || this.phase !== 'launch') return;
    let l0 = this.pendingLaunches[0];
    let l1 = this.pendingLaunches[1];

    if (!l0 || !l1) {
      if (!forceFallback) return;
      if (!l0) l0 = { aim: clampAim(0, this.aim), power: CPU_CASE_C_POWER };
      if (!l1) l1 = { aim: clampAim(1, this.remoteAim), power: CPU_CASE_C_POWER };
    }

    this.fightQuizSeq += 1;
    dismissFightQuizOverlay();
    dismissLaunchQuizOverlay();
    this.match.beginRound([l0, l1]);
    this.phase = 'fight';
    this.acc = 0;
    this.fightQuizTimer = 0;
    this.fightQuizBusy = false;
    this.fightQuizAwaitFirst = true;
    this.fightQuizShownThisRound = false;
    this.pendingScoreResult = null;
    this.quizPower = null;
    this.localLaunchCommitted = false;
    this.launchWaitElapsed = 0;
    this.view.showAim(null);
    this.view.launchFx(this.match.world!.bodies);
    this.sfx.launch();
    this.banner.classList.add('hidden');
    this.updateSpecialHud();

    this.pendingSnapEvents.launch = true;
    this.broadcastHostSnap(null);
  }

  private broadcastHostSnap(roundResult: RoundResult | null): void {
    if (!this.pvp || !this.pvp.isHost) return;
    const world = this.match.world;
    const bodies: PvpSnapPacket['bodies'] = world
      ? [
          {
            pos: { x: world.bodies[0].pos.x, z: world.bodies[0].pos.z },
            vel: { x: world.bodies[0].vel.x, z: world.bodies[0].vel.z },
            spin: world.bodies[0].spin,
            spin0: world.bodies[0].params.spin0,
            out: world.bodies[0].out,
          },
          {
            pos: { x: world.bodies[1].pos.x, z: world.bodies[1].pos.z },
            vel: { x: world.bodies[1].vel.x, z: world.bodies[1].vel.z },
            spin: world.bodies[1].spin,
            spin0: world.bodies[1].params.spin0,
            out: world.bodies[1].out,
          },
        ]
      : null;

    const hasEvents =
      this.pendingSnapEvents.launch ||
      this.pendingSnapEvents.clash ||
      this.pendingSnapEvents.wall ||
      this.pendingSnapEvents.ringOut ||
      this.pendingSnapEvents.specialActivated;

    const pkt: PvpSnapPacket = {
      seq: ++this.netSeq,
      tHost: Date.now(),
      phase: this.phase,
      round: this.match.round,
      roundTime: this.match.roundTime,
      scores: [this.match.scores[0], this.match.scores[1]],
      mode: this.match.mode,
      bodies,
      specialCharge: [this.specials[0].charge, this.specials[1].charge],
      hostAim: this.aim,
      events: hasEvents ? { ...this.pendingSnapEvents } : undefined,
      roundResult,
    };

    this.pendingSnapEvents = {};
    this.pvp.sendSnap(pkt);
  }

  /** 案Q：非 S 且 QUIZ_LAUNCH_ENABLED 時，先答題再瞄準發射（開局題全校共用 launch bank）。 */
  private async runQuiz(): Promise<void> {
    if (this.quizBusy || this.localLaunchCommitted) return;
    this.quizBusy = true;
    this.phase = 'quiz';
    this.charging = false;
    this.held = 0;
    this.view.showAim(null);
    this.bar.status.textContent = '案Q：答題定力，答對越多，發射功率越高。';
    this.bar.fill.style.width = '0%';
    this.bar.fill.classList.remove('sweet');
    this.bar.charge.textContent = '答題中';
    const names = SLOT_KEYS.map((k) => this.match.sides[this.mySeat].loadout[k].name);
    try {
      const power = await quizLaunch({ loadoutNames: names });
      this.quizPower = power;
      this.lastLaunchFeedback = `案Q 功率 ${Math.round(power * 100)}%`;
    } catch {
      this.quizPower = 1;
      this.lastLaunchFeedback = '案Q 略過，功率 100%';
    } finally {
      this.quizBusy = false;
      if (this.phase === 'quiz') {
        this.phase = 'launch';
      }
      this.bar.charge.textContent = '發射';
      this.input.reset();
    }
  }

  private enterScore(r: RoundResult): void {
    dismissFightQuizOverlay();
    this.pendingScoreResult = null;
    this.phase = 'score';
    this.scoreTimer = SCORE_PAUSE_SEC;
    this.renderTop();
    this.showBanner(roundTitle(r), pointsLine(r), `${this.match.scores[0]} : ${this.match.scores[1]}`);
    this.sfx.setHum(0);
    if (r.winner === this.mySeat) this.sfx.win();
    else if (r.winner === this.oppSeat) this.sfx.lose();
  }

  private openMenu(): void {
    if (this.menu) return this.closeMenu();

    if (this.pvp) {
      let confirmStep = false;
      const forfeitBtn = h(
        'button.btn.big',
        {
          style: { borderColor: '#ff6b81', color: '#ffb8c0', marginTop: '10px' },
          onclick: () => {
            if (!confirmStep) {
              confirmStep = true;
              forfeitBtn.textContent = '⚠️ 確定棄權？（將直接判負）';
              forfeitBtn.style.background = '#c0392b';
              forfeitBtn.style.color = '#fff';
              return;
            }
            this.closeMenu();
            this.pvp?.sendForfeit();
          },
        },
        '🏳️ 棄權認輸',
      );

      this.menu = h(
        'div.menu-overlay',
        {},
        h(
          'div.menu-panel',
          {},
          h('h1', {}, '對戰選單'),
          h('p.subtitle', { style: { marginBottom: '14px' } }, '實時雙人對戰進行中，背景不會暫停。'),
          h('button.btn.primary.big', { onclick: () => this.closeMenu() }, '繼續對戰'),
          forfeitBtn,
        ),
      );
      document.body.append(this.menu);
      return;
    }

    this.paused = true;
    this.menu = h(
      'div.menu-overlay',
      {},
      h(
        'div.menu-panel',
        {},
        h('h1', {}, '暫停'),
        h('button.btn.primary.big', { onclick: () => this.closeMenu() }, '繼續'),
        h('button.btn.big', { onclick: () => this.cb.onReassemble() }, '重新組裝'),
      ),
    );
    document.body.append(this.menu);
  }

  private closeMenu(): void {
    this.menu?.remove();
    this.menu = null;
    this.paused = false;
    this.input.reset();
  }

  update(dt: number): void {
    const edges = this.input.consume();
    if (edges.menu) this.openMenu();
    if (!this.pvp && this.paused) {
      this.render(0);
      return;
    }

    const bar = this.bar;
    if (this.phase === 'quiz') {
      bar.aimLeft.classList.add('hidden');
      bar.aimRight.classList.add('hidden');
      bar.meter.classList.add('hidden');
      if (this.pvp?.isHost && (this.pendingLaunches[0] || this.pendingLaunches[1])) {
        this.launchWaitElapsed += dt;
        if (this.launchWaitElapsed >= PVP_LAUNCH_WAIT_MAX_SEC) {
          this.tryHostBeginRound(true);
        }
      }
      this.render(0);
      return;
    }

    if (this.phase === 'launch') {
      if (!this.localLaunchCommitted) {
        this.aim = clampAim(this.mySeat, this.aim + this.input.aimTurn() * AIM_TURN_RATE * dt);
      }

      if (this.pvp) {
        this.inputSendAccum += dt;
        if (this.inputSendAccum >= NET_SEND_INTERVAL_SEC) {
          this.inputSendAccum = 0;
          if (this.pvp.isHost) {
            this.broadcastHostSnap(null);
          } else {
            this.pvp.sendInput({ seq: ++this.netSeq, aim: this.aim });
          }
        }
        if (this.pvp.isHost && (this.pendingLaunches[0] || this.pendingLaunches[1])) {
          this.launchWaitElapsed += dt;
          if (this.launchWaitElapsed >= PVP_LAUNCH_WAIT_MAX_SEC) {
            this.tryHostBeginRound(true);
          }
        }
      }

      bar.aimLeft.classList.toggle('hidden', this.localLaunchCommitted);
      bar.aimRight.classList.toggle('hidden', this.localLaunchCommitted);
      bar.meter.classList.remove('hidden');

      if (this.localLaunchCommitted) {
        bar.charge.textContent = '等待對手';
        bar.status.textContent = '已鎖定發射！正在等待對手完成答題與發射…';
      } else if (QUIZ_LAUNCH_ENABLED) {
        bar.sweet.classList.add('hidden');
        bar.charge.textContent = '發射';
        if (this.quizPower === null) {
          bar.fill.style.width = '0%';
          bar.fill.classList.remove('sweet');
          bar.status.textContent = '案Q：按「發射」或空白鍵，先答五題中史選擇題，答對越多功率越高。';
          if (edges.chargePressed) void this.runQuiz();
        } else {
          const pct = Math.round(this.quizPower * 100);
          bar.fill.style.width = `${Math.min(100, this.quizPower * 100)}%`;
          bar.fill.classList.toggle('sweet', this.quizPower >= 1);
          bar.status.textContent = `案Q 定力 ${pct}%：用 ◄ ►／搖桿／拖曳瞄準，按「發射」或空白鍵即射。`;
          if (edges.chargePressed) {
            this.lastLaunchFeedback = `案Q 功率 ${pct}%`;
            this.fire(this.quizPower);
          }
        }
      } else {
        bar.charge.textContent = '蓄力';
        bar.sweet.classList.remove('hidden');
        if (edges.chargePressed) {
          this.charging = true;
          this.held = 0;
        }
        if (this.charging) {
          this.held += dt;
          const raw = chargeRaw(this.held);
          bar.fill.style.width = `${raw * 100}%`;
          bar.fill.classList.toggle('sweet', inSweetBand(raw));
          bar.status.textContent = inSweetBand(raw) ? '在綠色區放開＝全力發射！' : '蓄力中……';
          if (edges.chargeReleased || !this.input.charging) {
            this.charging = false;
            const power = launchPowerFromRaw(raw);
            this.lastLaunchFeedback = inSweetBand(raw) ? '完美發射！功率 1.00' : `發射功率 ${power.toFixed(2)}`;
            this.fire(power);
          }
        } else {
          bar.fill.style.width = '0%';
          bar.fill.classList.remove('sweet');
          bar.status.textContent = '用 ◄ ►／搖桿／拖曳瞄準，按住「蓄力」或空白鍵，放開發射';
        }
      }
    }

    if (this.phase === 'fight') {
      bar.aimLeft.classList.add('hidden');
      bar.aimRight.classList.add('hidden');
      bar.meter.classList.add('hidden');
      bar.charge.textContent = '蓄力';
      const world = this.match.world!;
      const localSteer = this.input.steer();

      if (this.pvp && !this.pvp.isHost) {
        this.inputSendAccum += dt;
        const hasInstantEdge = edges.dash || edges.special;
        if (hasInstantEdge || this.inputSendAccum >= NET_SEND_INTERVAL_SEC) {
          this.inputSendAccum = 0;
          this.pvp.sendInput({
            seq: ++this.netSeq,
            steer: localSteer,
            edges: hasInstantEdge ? { dash: edges.dash, special: edges.special } : undefined,
          });
        }
      } else {
        const steer: [Vec2, Vec2] = this.pvp
          ? [localSteer, this.remoteSteer]
          : [localSteer, cpuSteer(world.bodies[1], world.bodies[0])];

        const shouldStep = this.pvp ? true : !this.pendingScoreResult;

        if (shouldStep) {
          if (edges.dash && DASH_ENABLED) {
            const s = steer[0];
            const dir =
              Math.hypot(s.x, s.z) > 0.1
                ? s
                : { x: world.bodies[1].pos.x - world.bodies[0].pos.x, z: world.bodies[1].pos.z - world.bodies[0].pos.z };
            world.dash(0, dir);
          }
          if (edges.special) this.tryActivateSpecial(0);

          if (this.pvp) {
            if (this.remoteEdges.dash && DASH_ENABLED) {
              const s1 = steer[1];
              const dir1 =
                Math.hypot(s1.x, s1.z) > 0.1
                  ? s1
                  : { x: world.bodies[0].pos.x - world.bodies[1].pos.x, z: world.bodies[0].pos.z - world.bodies[1].pos.z };
              world.dash(1, dir1);
            }
            if (this.remoteEdges.special) {
              this.tryActivateSpecial(1);
            }
            this.remoteEdges.dash = false;
            this.remoteEdges.special = false;
          }

          let roundFinishedResult: RoundResult | null = null;
          this.acc += dt;
          while (this.acc >= PHYS_DT && this.phase === 'fight' && (this.pvp || !this.pendingScoreResult)) {
            this.acc -= PHYS_DT;
            const { step, result } = this.match.tick(steer);
            this.view.onStep(step);
            for (const c of step.collisions) {
              const clashMag = (c.received[0] + c.received[1]) * 1.5;
              this.sfx.clash(clashMag);
              this.pendingSnapEvents.clash = Math.max(this.pendingSnapEvents.clash ?? 0, clashMag);
              if (SPECIALS_ENABLED) {
                this.specials[0].charge = addCharge(
                  this.specials[0].charge,
                  chargeGainForSide(c.received[0], c.received[1]),
                );
                this.specials[1].charge = addCharge(
                  this.specials[1].charge,
                  chargeGainForSide(c.received[1], c.received[0]),
                );
              }
            }
            for (const w of step.walls) {
              this.sfx.wall(w.impact * 2);
              this.pendingSnapEvents.wall = Math.max(this.pendingSnapEvents.wall ?? 0, w.impact * 2);
            }
            if (step.newlyOut.some((i) => world.bodies[i].out === 'ring')) {
              this.sfx.ringOut();
              this.pendingSnapEvents.ringOut = true;
            }
            if (result) {
              roundFinishedResult = result;
              if (!this.pvp && FIGHT_QUIZ_ENABLED && !this.fightQuizShownThisRound) {
                this.pendingScoreResult = result;
                this.fightQuizTimer = 0;
                void this.runFightQuiz();
              } else {
                this.enterScore(result);
              }
            }
          }

          if (this.pvp?.isHost) {
            this.snapSendAccum += dt;
            if (roundFinishedResult || this.snapSendAccum >= NET_SEND_INTERVAL_SEC) {
              this.snapSendAccum = 0;
              this.broadcastHostSnap(roundFinishedResult);
            }
          }
        }

        if (!this.pvp && SPECIALS_ENABLED && this.phase === 'fight' && !this.pendingScoreResult) {
          const cpu = this.specials[1];
          if (cpu.charge >= SPECIAL_CHARGE_MAX - 1e-6) {
            cpu.cpuTimer += dt;
            if (cpu.cpuTimer >= SPECIAL_CPU_DELAY_SEC) this.tryActivateSpecial(1);
          } else {
            cpu.cpuTimer = 0;
          }
        }
      }

      const myBody = world.bodies[this.mySeat];
      this.sfx.setHum(myBody.out || this.pendingScoreResult ? 0 : Math.max(0, myBody.spin) / myBody.params.spin0);
      const left = Math.max(0, ROUND_TIMEOUT_SEC - this.match.roundTime);
      const specialHint = SPECIALS_ENABLED
        ? this.specials[this.mySeat].charge >= SPECIAL_CHARGE_MAX - 1e-6
          ? '　｜　特技就緒：按「特技」或 E 發動'
          : ''
        : '';
      bar.status.textContent = this.pendingScoreResult
        ? '勝負已分！完成下方「儲力題」即可累計特技儲力進入結算'
        : `${this.lastLaunchFeedback}　｜　剩餘 ${Math.ceil(left)} 秒　｜　WASD／搖桿 微調方向${specialHint}`;
      this.updateSpecialHud();

      if (FIGHT_QUIZ_ENABLED && !this.fightQuizBusy && this.phase === 'fight' && !this.pendingScoreResult) {
        this.fightQuizTimer += dt;
        const need = this.fightQuizAwaitFirst ? FIGHT_QUIZ_FIRST_SEC : Math.max(0, FIGHT_QUIZ_INTERVAL_SEC);
        if (this.fightQuizTimer >= need) {
          this.fightQuizTimer = 0;
          void this.runFightQuiz();
        }
      }
      this.postSpectate();
    }

    if (this.phase === 'score') {
      this.scoreTimer -= dt;
      bar.status.textContent = '回合結束';
      if (this.scoreTimer <= 0) {
        if (this.match.over) {
          dismissFightQuizOverlay();
          if (this.pvp) {
            if (this.pvp.isHost && !this.endedNotified) {
              this.endedNotified = true;
              this.pvp.sendMatchEnd(this.match.scores, this.match.winner);
              this.cb.onEnd(this.match, {
                t: 'end',
                reason: 'normal',
                winnerSeat: this.match.winner,
                scores: [this.match.scores[0], this.match.scores[1]],
                msg: '雙人對戰完場！',
              });
            }
          } else {
            this.cb.onEnd(this.match);
          }
          return;
        }
        this.enterLaunch();
      }
    }

    this.render(dt);
  }

  private render(dt: number): void {
    const gapT = this.match.world ? this.match.world.time : 0;
    this.view.setGapSpin(gapT);
    if (this.phase === 'launch') {
      this.view.update(this.preview, dt, true);
      if (!this.localLaunchCommitted) {
        this.view.showAim(baseLaunchSpot(this.mySeat), this.aim, defaultAim(this.mySeat), AIM_ARC);
      } else {
        this.view.showAim(null);
      }
    } else if (this.match.world) {
      this.view.update(this.match.world.bodies, dt);
    }
  }

  dispose(): void {
    this.fightQuizSeq += 1;
    dismissFightQuizOverlay();
    this.closeMenu();
    this.spectateHost?.dispose();
    this.spectateHost = null;
    this.vfxEl?.remove();
    this.vfxEl = null;
    this.cleanups.forEach((c) => c());
    this.overlay.remove();
    this.view.showAim(null);
    this.view.hideTops();
    this.bar.root.classList.add('hidden');
    if (this.specialBtn) {
      this.specialBtn.classList.add('hidden');
      this.specialBtn.disabled = true;
    }
  }
}
