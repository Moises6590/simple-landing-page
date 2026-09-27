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
