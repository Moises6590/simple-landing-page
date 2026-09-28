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

### Campaign: *As Cinzas de Ferrumbra* (3D, build 6)

The 3D version is now a full game with a story, told only through subtitles (no voiced lines). The story bible is in [`docs/NARRATIVA.md`](docs/NARRATIVA.md).

- **Story:** Selen Varga, the last sworn blade of the Ordem da Lâmina Rubra, against Vezmir Caldaço, o Fundidor de Almas. There is a prologue, six chapters in three acts with a twist in chapter IV, and an epilogue.
- **Maps:** dense maps with tall cover (blocks bullets and bolts) and low cover (the Magma Bombard fires over it). They also have lava rivers, Seiva fonts, hidden embers (+max HP), an altar with relics and an exit that opens when the chapter is cleared.
- **Enemies:**
  - Ossário (melee, surrounds you and waits for its turn);
  - Besteiro and Arcabuzeiro (pick firing positions with line of sight and retreat to reload behind cover);
  - Sussurro (stays cloaked until you are busy);
  - Rompe-Muralha (charges);
  - Bombarda de Magma (lob shot that leaves burning pools);
  - Vespa de Latão (flying drone that marks and dives);
  - the two-phase boss.
- **Ambushes:** enemies wait buried, cloaked or on the ceiling. Encounters run squad tactics:
  - baits that lure you into a pincer;
  - flanking pincers;
  - a melee rush when you hide from the shooters;
  - regrouping with the shooters when the squad is losing.
- **Navigation:** a navigation grid with a flow field and A* moves the enemies around obstacles.
- **Healing:** Seiva flasks (H / SEIVA button). Kills refill them, and standing at a Seiva font heals you.
- **Relics:** 14 relics, each with a memory of a fallen oath-bearer. You choose one per chapter at the altar.
- **Rest of the game:** Codex, chapter select, a survival mode (Provação das Cinzas), graphics options and saved progress.
- **Graphics presets:** Baixa, Média, Alta and Ultra. Ultra adds bloom, full shadows and more lights.

### Builds (Windows / Android / single HTML)

The [`tools/`](tools/) folder turns `game3d/` into one self-contained `index.html`, with Three.js, models and code embedded and no network needed. It then packages that page:

```bash
cd tools && npm install
npm run standalone     # dist/lamina-rubra.html
npm run desktop        # Windows portable .exe with Electron (desktop/release/), Ultra by default
npm run android        # Android APK with Capacitor (needs the Android SDK and ANDROID_HOME); landscape, immersive, Média by default
```

There is also a light Windows build of about 4 MB in `tools/desktop-lite/`. It uses Neutralino and the system WebView2:

```bash
node standalone.mjs desktop && cd desktop-lite && node build.mjs && npx @neutralinojs/neu build
```

### Build 7: heróis, armas e combate mais fundo

- **Quatro heróis jogáveis**, cada um com passiva, dois especiais e uma Arte do Juramento:
  - Selen Varga (espada e broquel, especialista em aparar);
  - Orsa Brunhald (machado; não é interrompida durante golpes pesados; agarra e arremessa);
  - Ilan Vesper (adagas; três esquivas seguidas; dano dobrado pelas costas; marca alvos);
  - Aurel Cinzafria (magia de brasa e gelo, Muralha de Cinza).

  Orsa, Ilan e Aurel são resgatados durante a campanha.
- **Doze armas**, três por herói. Cada arma muda o conjunto de golpes. Elas são forjadas e temperadas na **Figueira** com Cinzas, ganhas por abates, estilo e nota do capítulo.
- **Defesa:**
  - toque para aparar e segure para bloquear (gasta fôlego; sem fôlego a guarda quebra);
  - **Resposta**: contra-ataque logo depois de um aparo;
  - **Brecha**: a esquiva perfeita deixa os inimigos lentos por 1 s;
  - esquiva com deslize duas vezes mais longo;
  - projéteis rebatidos vão para onde você mira.
- **Ataque:**
  - golpe atrasado (leve, leve, pausa, leve);
  - ramificações leve→pesado: lançar, quebra-guarda e estocada;
  - malabarismo no ar e golpe que crava o inimigo no chão;
  - bomba de brasa;
  - execuções que mudam com o lugar: contra a parede, na lava, pelas costas e no chão, com câmera de cinema.
- **Inimigos:**
  - sequências de 1 a 3 golpes, fintas, investida em corrida, derrubar e levantar;
  - chute quando o jogador chega perto demais;
  - leitura de hábitos: lado preferido da esquiva, aparo em excesso, esconder-se;
  - formações (muralha de escudos, um segura enquanto outro ataca pelas costas);
  - moral que quebra quando o líder cai;
  - três novos tipos: Escudeiro, Granadeiro e Capelão (este reergue os mortos não executados);
  - cinco chefes intermediários com nome.
- **Cenário interativo:**
  - barris de pólvora que explodem em cadeia;
  - colunas rachadas que tombam com golpe pesado;
  - Bombarda que pode ser tomada;
  - lâminas giratórias;
  - portões que fecham a arena.
- **Medidor de estilo** de D até "Brasa Viva", com multiplicador de pontos, e dicas de controle na primeira vez que cada mecânica aparece.
- **Animações**: uma biblioteca única de animações compartilhada por todos os personagens, porque os KayKit usam o mesmo esqueleto. São 60 animações, e os modelos ficaram menores que antes.
