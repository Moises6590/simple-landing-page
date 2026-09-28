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
- Realistic-proportion characters assembled at runtime from the CC0 [Quaternius](https://quaternius.com) base characters, fantasy outfits and medieval weapons, animated with motion-capture clips from the Universal Animation Library 1 and 2 (build 9), and a realistic castle arena (build 10) modeled in-game with CC0 Poly Haven photo-scanned PBR textures and scanned rocks, drawn with instancing. Attack clips are scrubbed by the simulation so the weapon crosses on the hit frame. See [`game3d/assets/CREDITS.md`](game3d/assets/CREDITS.md).
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

### Build 8: trilha sonora, efeitos gravados e gráficos de PC

- **Trilha orquestral** de Kevin MacLeod (CC BY 4.0, créditos na tela final e em `game3d/assets/CREDITS.md`):
  - cada capítulo tem uma faixa de exploração e outra de combate, com crossfade quando o esquadrão aparece;
  - o chefe tem duas faixas (uma por fase);
  - menu, Figueira, prólogo, resultado e créditos têm música própria.
- **Efeitos gravados** (CC0, Kenney e OpenGameArt): 42 tipos com variações e tom aleatório, som estéreo pela posição do inimigo e passos que acompanham a velocidade. Os sons sintetizados ficaram como reserva.
- **Gráficos em Alta e Ultra:**
  - iluminação por HDRI de um lugar real em cada capítulo (Poly Haven);
  - oclusão de ambiente GTAO no Ultra;
  - antisserrilhado MSAA;
  - correção de cor e vinheta por capítulo; a Brecha e a vida baixa mudam as cores.
- **Partículas com textura** (Kenney): fumaça e marcas de queimado nas explosões, poeira nas quedas e esquivas, faíscas nos bloqueios, círculos mágicos, geada, brasas subindo da lava, chamas nas tochas e cinzas flutuando no ar.
- **Opções**: volume da música e dos efeitos.
- **Pacotes**: `tools/standalone.mjs` gera uma pasta (página + `assets_*.js` + `audio/music`). Os pacotes prontos ficam em [`releases/`](releases/).

### Build 9: personagens realistas e movimentos de captura

- **Corpos realistas**: cada personagem é montado na hora a partir de um corpo-base (rosto, olhos, sobrancelhas), uma roupa modular e cabelo, todos religados a um único esqueleto de 65 ossos. Roupas tingidas por personagem: Selen em carmesim, Orsa em ferro, Ilan em preto-noite com capuz, Aurel em azul de arquivista. Os Ossários têm pele de cinza e olhos em brasa.
- **Movimentos de captura (mocap)**: os golpes vêm de clipes gravados com atores. O combo de espada são três golpes que emendam num único clipe, e as armas pesadas usam um combo pesado em quatro tempos. Também foram gravados a investida, a estocada, o golpe de baixo para cima (lançar), o empurrão de escudo (quebra-guarda), os socos, a esquiva rolando, dano no peito e na cabeça, a queda, o levantar, o beber, o arremesso e a magia. A simulação continua mandando no tempo, e cada nome de movimento aponta para um trecho do clipe, com marcas medidas pelo pico de velocidade das mãos e dos pés.
- **Corpo que acompanha o movimento**: no passo lateral o corpo gira para a direção do passo, na ré o andar toca ao contrário, e a esquiva rola na direção do deslize. Os golpes giratórios dão a volta inteira.
- **Armas nas mãos**: espada e escudo, montante, machados, adagas, arco, cajado com brasa, varinha e tomo, presos no osso da mão com empunhadura e orientação por arma. O arcabuz fica na mão do Arcabuzeiro.

### Build 10: cenário realista

- **Texturas fotográficas PBR** (Poly Haven, CC0): cada superfície tem cor, relevo e oclusão/aspereza escaneados. Há lajes de mosteiro na arena, terra com pedras nos corredores, pedra bruta nas muralhas e colunas, blocos nos rodapés e parapeitos, tábuas velhas nos barris e caixotes, e ferro enferrujado nas ferragens.
- **Arquitetura modelada no jogo** com as mesmas medidas das peças antigas (o montador de mapas não mudou):
  - muralhas com rodapé, cornija e ameias, nichos em arco com porta de madeira e contrafortes;
  - colunas com base e capitel, parapeitos baixos com postes;
  - grade de ferro nos portões, tochas de ferro e estandartes de tecido com brasão.
- **Objetos**: barris de aduelas curvas com aros, pilhas de barris, barril deitado no berço, caixotes com moldura e travessa, baú com cintas, moedas e entulho com rochas escaneadas.
- **Muros do mapa sob medida**: os muros e parapeitos que bloqueiam a passagem são gerados no tamanho exato de cada obstáculo, com a textura na escala real, e reunidos numa só malha por material.
- As texturas ocupam uma escala fixa em metros em todas as peças, então pedra e madeira têm o mesmo tamanho em qualquer lugar.

### Build 11: qualidade máxima e downloads

- **Personagens em qualidade total**: malhas completas (sem redução de polígonos) e texturas em 2K (cabelo em 1K), inclusive os tingimentos das roupas.
- **Cenário em 2K**: as texturas fotográficas de pedra, terra, madeira e ferro passaram de 1K para 2K.
- **Trilha na qualidade original** (160 kb/s) no Windows e na web.
- **Android ajustado ao celular**: o empacotador reduz as texturas para 1K e os personagens para menos polígonos só no APK, porque o celular não tem memória de vídeo para tudo em 2K.
- **Downloads pelo GitHub Releases**: o workflow `pacotes.yml` compila o APK e o pacote do Windows nos servidores do GitHub e publica na Release `build-N`. Links fixos para a versão mais recente estão em [`releases/LEIA-ME.md`](releases/LEIA-ME.md). O APK usa uma assinatura fixa, então cada versão instala por cima da anterior.

### Build 12: objetivos por capítulo, vozes gravadas e movimento mais natural

- **Objetivos claros em cada capítulo**, mostrados num rastreador no topo (com progresso) e marcados no mundo por um feixe de luz, um losango sobre o alvo e uma seta dourada com a distância quando o alvo está fora da tela:
  - **I · Fossas de Treino:** vencer os guardas, **quebrar as três correntes do Sino dos Mortos** (enquanto o sino toca, mortos continuam levantando; quando cala, eles caem) e derrotar o Sargento Ossívio.
  - **II · Muralha dos Arcabuzes:** vencer a emboscada, **sabotar três depósitos de pólvora** (ficar no círculo sem inimigos dentro; cada depósito explode) e **arrombar a jaula** onde Orsa está presa.
  - **III · Fundição Viva:** **fechar três comportas de ferro**, e cada uma esfria um rio de lava e abre caminho. Depois, derrotar o Fornalheiro Gorvan.
  - **IV · Ninho de Latão:** **destruir as colmeias** que soltam vespas, **recolher três registros de cobre** (que contam o plano de Vezmir), investigar o altar e derrotar a Irmã Engrenagem.
  - **V · Salão dos Juramentos Partidos:** **recuperar as armaduras de Brand, Iolanda e Garrão**, **reacender o Braseiro do Juramento** resistindo no círculo e derrotar o Carrasco de Brasa.
  - **VI · Coração da Forja:** na segunda fase, Vezmir fica **preso a três correntes em brasa** e não sofre dano até elas serem quebradas.
- **Vozes gravadas por pessoas** para cada herói e cada tipo de inimigo: esforço no golpe, grito no golpe forte e nos especiais, dor, morte, alerta ao descobrir o jogador, risadas das Sussurros e cânticos do Capelão e de Vezmir. São cerca de 300 gravações de 14 autores (CC0, CC BY e CC BY-SA). Nenhuma fala com palavras: todo corte passou por reconhecimento de fala e os que tinham palavras foram descartados. Carregam por capítulo, só as vozes que o mapa usa.
- **Movimento mais natural por cima da captura:**
  - a cadência dos passos acompanha a velocidade real (andar, trotar e correr foram medidos pelo passo dos pés), sem o pé patinar, com troca de marcha suave;
  - cabeça, pescoço e tronco viram para o alvo (o jogador para o inimigo, os inimigos para o jogador);
  - o corpo inclina ao arrancar, frear e fazer curva;
  - quem está de emboscada fica agachado, e golpe pesado joga o inimigo para trás com a reação de impacto.
- A segunda fase de Vezmir sempre acontece, mesmo com golpes muito fortes.

