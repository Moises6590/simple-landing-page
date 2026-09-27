# Simple Landing Page

Basic landing page project using HTML and CSS, created to learn Git and evolve into a back-end application.

## About

This project was created to practice HTML, CSS, Git and GitHub.

## Technologies

- HTML5
- CSS3

## How to run

Clone the repository:

```bash
git clone https://github.com/Moises6590/simple-landing-page.git


## Game: Lâmina Rubra (hack & slash)

A browser hack & slash lives in [`game/`](game/). Open `game/index.html` in any modern browser (no build step, no dependencies).

- Smooth movement: fixed 120 Hz simulation with render interpolation, acceleration/friction, input buffering, animation canceling (dash out of attacks, attack out of dash).
- Combat: 3-hit light combo with lunge and aim assist, charged heavy spin, dash with i-frames (last-moment dodge triggers slow motion), timed parry that stuns enemies and reflects arrows, backstab and stun crits, hitstop, screen shake, combo multiplier.
- Enemy AI: an attack "director" hands out attack tokens so enemies take turns and surround the player in slots; Soldiers, Archers (predictive aim, keep distance, seek line of sight), Brutes (unparryable slam, charge that stuns them against pillars and hurts allies) and Assassins (flank behind you, dodge your attacks). Every 5th wave brings a champion.
- Controls: keyboard + mouse on PC (WASD, J/click, K/right click, Space, L); virtual joystick and buttons on touch screens.

### 3D version

[`game3d/`](game3d/) keeps the exact same simulation, combat and enemy AI and renders it in 3D with [Three.js](https://threejs.org/) (loaded from cdnjs, so it needs an internet connection):

- Articulated characters (shoulder, elbow, hand, hip, knee) animated procedurally from the simulation state: walk cycle from real velocity, sword arcs that follow the hit arc, wind-ups, stagger, stun, death falls.
- Distinct gear per class: knight with runic sword, buckler, crested helm and cape; soldier with kettle helm and round shield; hooded archer with bow, nocked arrow and quiver; horned brute with spiked war hammer; masked assassin with twin daggers and glowing eyes; crowned champion.
- Torch-lit arena with walls, columns, rune circle and shadows; ground telegraphs, slash trails, particles and the same HUD.
- **Third-person camera** over the right shoulder (mouse with pointer lock / arrow keys on PC, drag on the right half of the screen on touch), camera-relative movement, and camera collision with walls and columns. Enemies between the camera and the player fade out; red arrows at the screen edge warn about attacks coming from outside the view.
- Rigged, animated characters from the CC0 [KayKit](https://kaylousberg.com) Adventurers and Skeletons packs and an arena built from the CC0 KayKit Dungeon Remastered pack (tiles, fence, walls, columns, torches, barrels, banners), drawn with instancing. Attack clips are scrubbed by the simulation so the weapon crosses on the hit frame. See [`game3d/assets/CREDITS.md`](game3d/assets/CREDITS.md).
- Extra combat systems (3D only): **target lock** (Q/Tab), **dash attack** (attack right after a dash), **charged heavy** (hold for 3 levels), **execution** on stunned enemies, and a **Fury** meter (R) that unleashes three shockwaves.
- **Performance governor**: measures real FPS and lowers render resolution, then point lights and shadows, to stay above 40 FPS; press F to show the FPS counter. Characters share one skeleton per model, shaders are precompiled on load and the simulation avoids per-frame allocations.
- The models are fetched over HTTP, so serve the folder instead of double-clicking the file (e.g. `npx serve .` and open `/game3d/`). Opened via `file://`, the game still runs with the built-in procedural characters and arena.

### Combat feel (both versions)

- **Local hitstop:** a hit freezes only the attacker and the victim for a few milliseconds; everyone else keeps moving.
- **Hit-confirm cancels:** after landing a hit you can dash or parry from the middle of the swing; on a whiff the recovery locks for a short moment.
- **Hit reactions on every hit:** enemies that don't stagger (brutes, assassins with poise left) still jolt in the hit direction.
