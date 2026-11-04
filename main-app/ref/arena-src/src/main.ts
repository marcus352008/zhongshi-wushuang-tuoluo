import './style.css';
import * as THREE from 'three';
import { Sfx } from './audio';
import { Bey } from './beyblade';
import { BEY_TYPES, MAX_SPIN, WINNING_SCORE, type BeyType } from './config';
import { Debris, Sparks } from './effects';
import { Input } from './input';
import { dash, stepPhysics, type PhysEvent } from './physics';
import { bowlHeight, createStadium } from './stadium';

type State = 'select' | 'ready' | 'battle' | 'roundEnd' | 'matchEnd';
type Finish = 'spin' | 'ringout' | 'burst' | 'draw';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const canvas = $<HTMLCanvasElement>('scene');
let renderer: THREE.WebGLRenderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
} catch {
  $('select').classList.add('hidden');
  $('error').classList.remove('hidden');
  throw new Error('WebGL unavailable');
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05070f);
scene.fog = new THREE.Fog(0x05070f, 22, 45);

const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 100);
const camBase = new THREE.Vector3(0, 11, 10);
const camTarget = new THREE.Vector3(0, 0.6, 0);

scene.add(new THREE.HemisphereLight(0x9fb8ff, 0x1a1030, 0.9));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(4, 14, 6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
const sc = sun.shadow.camera;
sc.left = sc.bottom = -9;
sc.right = sc.top = 9;
scene.add(sun);
const rimLight = new THREE.PointLight(0x5fd4ff, 30, 30);
rimLight.position.set(0, 6, -8);
scene.add(rimLight);

createStadium(scene);
const sparks = new Sparks();
scene.add(sparks.points);
const debris = new Debris();

const marker = new THREE.Mesh(
  new THREE.ConeGeometry(0.16, 0.32, 4).rotateX(Math.PI),
  new THREE.MeshBasicMaterial({ color: 0xffd23f }),
);
marker.visible = false;
scene.add(marker);

const sfx = new Sfx();
const input = new Input($('joystick'), $('knob'), $('action-btn'));
const isTouch = window.matchMedia('(pointer: coarse)').matches;

const ui = {
  hud: $('hud'),
  pName: $('p-name'),
  aName: $('a-name'),
  pKind: $('p-kind'),
  aKind: $('a-kind'),
  pFill: $('p-fill'),
  aFill: $('a-fill'),
  pSpin: $('p-spin'),
  aSpin: $('a-spin'),
  pScore: $('p-score'),
  aScore: $('a-score'),
  round: $('round-label'),
  banner: $('banner'),
  bannerTitle: $('banner-title'),
  bannerSub: $('banner-sub'),
  launch: $('launch'),
  launchHint: $('launch-hint'),
  meterFill: $('meter-fill'),
  dashInd: $('dash-ind'),
  dashFill: $('dash-fill'),
  touch: $('touch'),
  actionBtn: $('action-btn'),
  select: $('select'),
  cards: $('cards'),
  result: $('result'),
  resultEyebrow: $('result-eyebrow'),
  resultTitle: $('result-title'),
  resultSub: $('result-sub'),
  mute: $('mute-btn'),
};

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

let state: State = 'select';
let selected: BeyType = BEY_TYPES[0];
let player: Bey | null = null;
let ai: Bey | null = null;
let scores = { p: 0, a: 0 };
let round = 1;
let charging = false;
let chargeT = 0;
let roundTimer = 0;
let shake = 0;
let bannerTimer = 0;
let aiThink = 0;
const aiSteer = new THREE.Vector2();

function renderCards(): void {
  ui.cards.innerHTML = '';
  const maxOf = { attack: 1.6, defense: 1.6, stamina: 1.6, speed: 1.4 };
  for (const t of BEY_TYPES) {
    const card = document.createElement('button');
    card.className = 'card' + (t.id === selected.id ? ' selected' : '');
    card.style.setProperty('--accent', hex(t.color));
    card.style.setProperty('--accent2', hex(t.accent));
    const stats: [string, number][] = [
      ['Attack', t.attack / maxOf.attack],
      ['Defense', t.defense / maxOf.defense],
      ['Stamina', 1.0 / t.decay / maxOf.stamina],
      ['Speed', t.speed / maxOf.speed],
    ];
    card.innerHTML = `
      <div class="card-top"><div class="swatch"></div><div>
        <div class="card-name">${t.name}</div><div class="card-kind">${t.kind} type</div>
      </div></div>
      <p>${t.blurb}</p>
      ${stats
        .map(
          ([label, v]) =>
            `<div class="stat"><span>${label}</span><div class="stat-bar"><div style="width:${Math.min(100, v * 100).toFixed(0)}%"></div></div></div>`,
        )
        .join('')}`;
    card.addEventListener('click', () => {
      selected = t;
      renderCards();
    });
    ui.cards.appendChild(card);
  }
}

function showBanner(title: string, sub = '', duration = 1.6): void {
  ui.bannerTitle.textContent = title;
  ui.bannerSub.textContent = sub;
  ui.banner.classList.add('show');
  bannerTimer = duration;
}

function startMatch(): void {
  sfx.unlock();
  (document.activeElement as HTMLElement | null)?.blur();
  scores = { p: 0, a: 0 };
  round = 1;
  ui.select.classList.add('hidden');
  ui.result.classList.add('hidden');
  ui.hud.classList.remove('hidden');
  if (isTouch) ui.touch.classList.remove('hidden');
  startRound();
}

function startRound(): void {
  player?.dispose(scene);
  ai?.dispose(scene);
  debris.clear();

  const others = BEY_TYPES.filter((t) => t.id !== selected.id);
  const aiType = others[Math.floor(Math.random() * others.length)];
  player = new Bey(selected);
  ai = new Bey(aiType);

  const pa = (3 * Math.PI) / 4;
  const aa = -Math.PI / 4;
  player.pos.set(Math.cos(pa) * 4.2, Math.sin(pa) * 4.2);
  ai.pos.set(Math.cos(aa) * 4.2, Math.sin(aa) * 4.2);
  for (const b of [player, ai]) {
    b.spin = 0;
    b.dropOffset = 2.4;
    scene.add(b.root);
  }

  ui.pName.textContent = player.type.name;
  ui.aName.textContent = ai.type.name;
  ui.pKind.textContent = player.type.kind;
  ui.aKind.textContent = ai.type.kind;
  ui.pFill.style.background = `linear-gradient(90deg, ${hex(player.type.color)}, ${hex(player.type.accent)})`;
  ui.aFill.style.background = `linear-gradient(90deg, ${hex(ai.type.color)}, ${hex(ai.type.accent)})`;
  ui.round.textContent = `Round ${round} · First to ${WINNING_SCORE}`;
  updateScore();

  state = 'ready';
  charging = false;
  chargeT = 0;
  ui.meterFill.style.width = '0%';
  ui.launch.classList.remove('hidden');
  ui.dashInd.classList.add('hidden');
  ui.actionBtn.textContent = 'LAUNCH';
  ui.launchHint.innerHTML = isTouch
    ? 'Hold <b>LAUNCH</b> to charge, release in the gold zone'
    : 'Hold <kbd>Space</kbd> to charge, release in the gold zone';
  showBanner(`ROUND ${round}`, `${player.type.name} vs ${ai.type.name}`, 1.8);
  marker.visible = true;
}

function chargePower(): number {
  const p = (chargeT * 0.9) % 2;
  return p < 1 ? p : 2 - p;
}

function launch(power: number): void {
  if (!player || !ai) return;
  const perfect = power >= 0.92;
  const aiPower = 0.7 + Math.random() * 0.27;
  player.spin = MAX_SPIN * (perfect ? 1 : 0.5 + 0.45 * power);
  ai.spin = MAX_SPIN * (0.5 + 0.45 * aiPower);
  for (const b of [player, ai]) {
    b.launched = true;
    const a = Math.atan2(b.pos.y, b.pos.x);
    b.vel.set(-Math.sin(a) * 4 - Math.cos(a) * 1.5, Math.cos(a) * 4 - Math.sin(a) * 1.5);
  }
  state = 'battle';
  ui.launch.classList.add('hidden');
  ui.dashInd.classList.remove('hidden');
  ui.actionBtn.textContent = 'DASH';
  sfx.launch();
  shake = 0.25;
  showBanner('LET IT RIP!', perfect ? 'PERFECT LAUNCH!' : `Launch power ${Math.round(power * 100)}%`, 1.3);
  for (const b of [player, ai]) {
    sparks.emit(new THREE.Vector3(b.pos.x, bowlHeight(b.pos.length()) + 0.2, b.pos.y), 30, new THREE.Color(b.type.accent), 5);
  }
}

function updateScore(): void {
  ui.pScore.textContent = String(scores.p);
  ui.aScore.textContent = String(scores.a);
}

function endRound(winner: 'p' | 'a' | null, finish: Finish): void {
  state = 'roundEnd';
  roundTimer = 2.8;
  const pts = finish === 'spin' ? 1 : finish === 'draw' ? 0 : 2;
  if (winner) scores[winner] += pts;
  updateScore();
  const title = { spin: 'SPIN FINISH!', ringout: 'RING OUT!', burst: 'BURST FINISH!', draw: 'DRAW!' }[finish];
  const who = winner === 'p' ? 'You' : winner === 'a' ? 'CPU' : 'Nobody';
  showBanner(title, winner ? `${who} +${pts} point${pts > 1 ? 's' : ''}` : 'Both stopped spinning', 2.6);
  if (winner === 'p') sfx.win();
  else if (winner === 'a') sfx.lose();
}

function endMatch(): void {
  state = 'matchEnd';
  const won = scores.p > scores.a;
  ui.resultEyebrow.textContent = `Final score ${scores.p} : ${scores.a}`;
  ui.resultTitle.textContent = won ? 'VICTORY' : 'DEFEAT';
  ui.resultTitle.style.color = won ? 'var(--you)' : 'var(--cpu)';
  ui.resultSub.textContent = won
    ? `${selected.name} is the champion of the arena.`
    : `${ai?.type.name ?? 'The CPU'} took the match. Try a different launch or beyblade.`;
  ui.result.classList.remove('hidden');
  ui.touch.classList.add('hidden');
  ui.dashInd.classList.add('hidden');
  marker.visible = false;
}

function updateAI(dt: number): void {
  if (!player || !ai || !ai.active) return;
  aiThink -= dt;
  if (aiThink > 0) return;
  aiThink = 0.08;

  const target = player.pos.clone().addScaledVector(player.vel, 0.25);
  const toTarget = target.sub(ai.pos);
  const dist = toTarget.length();
  aiSteer.copy(toTarget.normalize());

  const defensive = ai.type.kind === 'Stamina' && ai.spin > player.spin + 10;
  if (defensive) aiSteer.multiplyScalar(-0.2);

  const r = ai.pos.length();
  if (r > 4.2) aiSteer.addScaledVector(ai.pos.clone().normalize(), -(r - 4.2) * 1.2);
  if (aiSteer.lengthSq() > 1) aiSteer.normalize();
  aiSteer.multiplyScalar(0.8);

  if (!defensive && dist < 3 && player.active && Math.random() < 0.12) {
    if (dash(ai, player.pos.clone().sub(ai.pos))) sfx.dash();
  }
}

function handleEvents(events: PhysEvent[]): void {
  for (const e of events) {
    if (e.kind === 'clash') {
      const k = Math.min(1, e.impact / 12);
      sparks.emit(e.point, Math.round(12 + k * 40), new THREE.Color(0xffc861), 4 + k * 6);
      shake = Math.max(shake, 0.08 + k * 0.35);
      sfx.clash(e.impact);
      if (state === 'battle') {
        for (const [victim, hitter] of [
          [e.a, e.b],
          [e.b, e.a],
        ] as const) {
          if (!victim.active) continue;
          const chance = ((e.impact - 9) * 0.015 * hitter.type.attack) / victim.type.burstResist;
          if (e.impact > 9 && victim.spinFrac < 0.3 && Math.random() < chance) {
            debris.add(victim.doBurst(scene), victim.vel);
            sparks.emit(e.point, 80, new THREE.Color(victim.type.accent), 9);
            shake = 0.6;
            sfx.burst();
            break;
          }
        }
      }
    } else if (e.kind === 'wall') {
      sparks.emit(e.point, Math.round(e.impact * 3), new THREE.Color(0x9fdcff), 3);
      sfx.wall(e.impact);
    } else if (e.kind === 'ringout') {
      sfx.ringOut();
      shake = Math.max(shake, 0.3);
    }
  }
}

function checkRoundEnd(): void {
  if (!player || !ai) return;
  const pOut = player.burst ? 'burst' : player.ringedOut ? 'ringout' : player.stopped ? 'spin' : null;
  const aOut = ai.burst ? 'burst' : ai.ringedOut ? 'ringout' : ai.stopped ? 'spin' : null;
  if (!pOut && !aOut) return;
  if (pOut && aOut) {
    if (pOut === 'spin' && aOut !== 'spin') endRound('p', aOut);
    else if (aOut === 'spin' && pOut !== 'spin') endRound('a', pOut);
    else endRound(null, 'draw');
  } else if (aOut) endRound('p', aOut);
  else if (pOut) endRound('a', pOut);
}

const FIXED = 1 / 120;
let acc = 0;
let last = performance.now();
const steerMap = new Map<Bey, THREE.Vector2>();

function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const edges = input.consume();

  if (state === 'ready' && player && ai) {
    if (edges.pressed) {
      sfx.unlock();
      charging = true;
      chargeT = 0;
    }
    if (charging) {
      chargeT += dt;
      ui.meterFill.style.width = `${(chargePower() * 100).toFixed(1)}%`;
      if (edges.released || !input.held) {
        charging = false;
        launch(chargePower());
      }
    }
  }

  if ((state === 'battle' || state === 'roundEnd') && player && ai) {
    const steer = state === 'battle' && player.active ? input.steer() : new THREE.Vector2();
    if (state === 'battle' && (edges.dash || edges.pressed)) {
      const dir = steer.lengthSq() > 0.01 ? steer : ai.pos.clone().sub(player.pos);
      if (dash(player, dir)) {
        sfx.dash();
        sparks.emit(new THREE.Vector3(player.pos.x, bowlHeight(player.pos.length()) + 0.2, player.pos.y), 14, new THREE.Color(player.type.accent), 3);
      }
    }
    updateAI(dt);
    steerMap.set(player, steer);
    steerMap.set(ai, state === 'battle' ? aiSteer : new THREE.Vector2());

    acc += dt;
    while (acc >= FIXED) {
      handleEvents(stepPhysics([player, ai], steerMap, FIXED));
      acc -= FIXED;
    }
    if (state === 'battle') checkRoundEnd();
    sfx.setHum(player.active ? player.spinFrac : 0);
  } else {
    sfx.setHum(0);
  }

  if (state === 'roundEnd') {
    roundTimer -= dt;
    if (roundTimer <= 0) {
      if (scores.p >= WINNING_SCORE || scores.a >= WINNING_SCORE) endMatch();
      else {
        round++;
        startRound();
      }
    }
  }

  for (const b of [player, ai]) {
    if (!b) continue;
    if (b.launched && b.dropOffset > 0) b.dropOffset = Math.max(0, b.dropOffset - dt * 12);
    if (!b.launched) b.dropOffset = 2.4 + Math.sin(now / 300) * 0.08;
    if (!b.burst) b.updateVisual(dt);
  }

  if (player && marker.visible) {
    const showMarker = !player.burst && state !== 'matchEnd';
    marker.visible = showMarker;
    marker.position.copy(player.root.position);
    marker.position.y += 1.25 + Math.sin(now / 180) * 0.08;
    marker.rotation.y += dt * 3;
  }

  debris.update(dt, (x, z) => {
    const r = Math.hypot(x, z);
    return r < 6 ? bowlHeight(r) : r < 7.4 ? bowlHeight(6) : -0.3;
  });
  sparks.update(dt);

  if (player && ai && state !== 'select') {
    ui.pFill.style.width = `${(player.spinFrac * 100).toFixed(1)}%`;
    ui.aFill.style.width = `${(ai.spinFrac * 100).toFixed(1)}%`;
    ui.pSpin.textContent = `${Math.round(player.spin * 120).toLocaleString()} RPM`;
    ui.aSpin.textContent = `${Math.round(ai.spin * 120).toLocaleString()} RPM`;
    ui.dashFill.style.width = `${((1 - player.dashCooldown / 1.4) * 100).toFixed(0)}%`;
  }

  if (bannerTimer > 0) {
    bannerTimer -= dt;
    if (bannerTimer <= 0) ui.banner.classList.remove('show');
  }

  const focus = new THREE.Vector3(0, 0.6, 0);
  if (player && ai && state !== 'select') {
    focus.x += (player.pos.x + ai.pos.x) * 0.12;
    focus.z += (player.pos.y + ai.pos.y) * 0.12;
  } else {
    focus.x = Math.sin(now / 4000) * 0.6;
  }
  camTarget.lerp(focus, 1 - Math.exp(-dt * 3));
  shake *= Math.exp(-dt * 6);
  const aspect = camera.aspect;
  const k = Math.max(1, 1.25 / aspect);
  camera.position.copy(camBase).multiplyScalar(k);
  if (state === 'select') {
    const a = now / 6000;
    camera.position.set(Math.sin(a) * 14 * k, 9 * k, Math.cos(a) * 14 * k);
  }
  camera.position.add(new THREE.Vector3((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake));
  camera.lookAt(camTarget);

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

function resize(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

window.addEventListener('resize', resize);
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyM') toggleMute();
  if (e.code === 'Enter' && state === 'select') startMatch();
});

function toggleMute(): void {
  sfx.setMuted(!sfx.muted);
  ui.mute.textContent = sfx.muted ? 'SOUND OFF' : 'SOUND ON';
}

ui.mute.addEventListener('click', (e) => {
  (e.currentTarget as HTMLElement).blur();
  toggleMute();
});
$('start-btn').addEventListener('click', startMatch);
$('rematch-btn').addEventListener('click', startMatch);
$('change-btn').addEventListener('click', () => {
  ui.result.classList.add('hidden');
  ui.hud.classList.add('hidden');
  player?.dispose(scene);
  ai?.dispose(scene);
  player = ai = null;
  debris.clear();
  marker.visible = false;
  state = 'select';
  renderCards();
  ui.select.classList.remove('hidden');
});

renderCards();
resize();
requestAnimationFrame(frame);
