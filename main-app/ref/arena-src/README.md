# Beyblade Arena (mini test build)

A small 3D beyblade battle game that runs in the browser. It's built with Three.js, TypeScript, and Vite. This first slice is a single-player match against a CPU opponent in one bowl stadium.

## Features

- Three beyblades with different stats: **Storm Striker** (Attack), **Iron Bastion** (Defense), and **Eternal Lotus** (Stamina).
- A timed launch: hold to charge the power meter, then release. Releasing in the gold zone gives a perfect launch with full spin.
- Steering and a dash, which costs some spin and has a short cooldown.
- Custom physics: the bowl pulls you toward the center, beyblades orbit and wobble as they lose spin, and collisions knock back, drain spin, and throw sparks.
- Three ways to finish a round: **Spin finish** (1 pt), **Ring out** through the red exit pockets (2 pts), and **Burst** (2 pts). First to 3 points wins.
- Sound effects made with WebAudio, plus touch controls (a joystick and an action button) on phones and tablets.

## Controls

| Action | Keyboard | Touch |
| --- | --- | --- |
| Steer | WASD / arrow keys | Left joystick |
| Charge + launch | Hold and release Space | Hold and release LAUNCH |
| Dash | Shift or J (or tap Space in battle) | DASH button |
| Mute | M | Sound button |

## Run locally

```bash
npm install
npm run dev      # http://localhost:47321
```

Production build:

```bash
npm run build
npm run preview  # http://localhost:47322
```

## Project layout

- `src/main.ts`: game state machine (select, launch, battle, round end, match end), CPU opponent, camera, and HUD
- `src/physics.ts`: bowl forces, walls and exit pockets, collisions, and dash
- `src/beyblade.ts`: beyblade model, spin and wobble visuals, ring-out and burst
- `src/stadium.ts`: stadium geometry and bowl height functions
- `src/effects.ts`: sparks and burst debris
- `src/audio.ts`: synthesized sound effects
- `src/input.ts`: keyboard and touch input
- `src/config.ts`: tuning constants and beyblade stats
