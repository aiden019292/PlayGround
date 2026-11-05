import * as THREE from 'three';
import { createWorld, createEnemyModel, makeSkyFlash } from './world.js';
import { Effects } from './effects.js';
import { AudioSystem } from './audio.js';

const $ = (selector) => document.querySelector(selector);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (a, b, speed, dt) => lerp(a, b, 1 - Math.exp(-speed * dt));
const angleDamp = (a, b, speed, dt) => {
  let delta = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return a + delta * (1 - Math.exp(-speed * dt));
};
const PI = Math.PI;
const TAU = PI * 2;
const PLAY_RADIUS = 40.5;
const FLOOR_HEIGHT = 3.2;
const BUILD_COST = 10;

const WAVE_CONFIG = {
  1: { husk: 6 },
  2: { husk: 8, spitter: 2 },
  3: { husk: 9, spitter: 4, brute: 1 },
  4: { husk: 10, spitter: 5, brute: 2 },
  5: { husk: 8, spitter: 4, brute: 1, boss: 1 }
};

const ENEMY_STATS = {
  husk: { hp: 62, speed: 3.35, damage: 9, attackInterval: 1.0, radius: 0.48, score: 100, name: 'HUSK', color: '#ff7cac' },
  spitter: { hp: 48, speed: 2.25, damage: 8, attackInterval: 2.25, radius: 0.55, score: 150, name: 'SPITTER', color: '#bd74ff' },
  brute: { hp: 250, speed: 2.15, damage: 19, attackInterval: 1.25, radius: 0.82, score: 350, name: 'BRUTE', color: '#ff9b62' },
  boss: { hp: 840, speed: 1.95, damage: 27, attackInterval: 1.1, radius: 1.4, score: 1800, name: 'RIFT WARDEN', color: '#ffbd69' }
};

const BUILD_MATERIALS = {
  wood: { label: 'WOOD', hp: 220, body: '#a76a3b', trim: '#ffc17a', glow: '#ffc57d', metalness: 0.04, roughness: 0.82 },
  stone: { label: 'STONE', hp: 440, body: '#747b98', trim: '#d2dcf0', glow: '#c8d8ff', metalness: 0.05, roughness: 0.8 },
  metal: { label: 'METAL', hp: 720, body: '#3f7f8e', trim: '#83fff4', glow: '#7dfff4', metalness: 0.48, roughness: 0.38 }
};

const canvas = $('#game-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.65));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.13;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

// Detect software rasterizers so screenshots and low-powered browsers stay smooth.
let gpuName = '';
try {
  const gl = renderer.getContext();
  const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
  gpuName = debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : '';
} catch {}
const softwareRenderer = /swiftshader|llvmpipe|software|mesa offscreen/i.test(gpuName);
if (softwareRenderer) {
  renderer.shadowMap.enabled = false;
  renderer.setPixelRatio(1);
  document.documentElement.classList.add('low-fx');
}

const scene = new THREE.Scene();
const world = createWorld(scene, renderer);
const camera = world.camera;
const effects = new Effects(scene, renderer);
const audio = new AudioSystem();

const el = {
  hud: $('#hud'),
  menu: $('#menu'),
  pause: $('#pauseOverlay'),
  end: $('#endOverlay'),
  loading: $('#loading'),
  waveChip: $('#waveChip'),
  phaseLabel: $('#phaseLabel'),
  waveTimer: $('#waveTimer'),
  wavePips: $('#wavePips'),
  healthFill: $('#healthFill'),
  healthValue: $('#healthValue'),
  coreFill: $('#coreFill'),
  coreValue: $('#coreValue'),
  resWood: $('#resWood'),
  resStone: $('#resStone'),
  resMetal: $('#resMetal'),
  objectiveText: $('#objectiveText'),
  hostileCount: $('#hostileCount'),
  crosshair: $('#crosshair'),
  buildHint: $('#buildHint'),
  buildTray: $('#buildTray'),
  fireBtn: $('#fireBtn'),
  fireBtnLabel: $('#fireBtnLabel'),
  fireBtnSub: $('#fireBtnSub'),
  buildBtn: $('#buildBtn'),
  buildBtnLabel: $('#buildBtnLabel'),
  jumpBtn: $('#jumpBtn'),
  joystick: $('#joystick'),
  joystickKnob: $('#joystickKnob'),
  hint: $('#hint'),
  hintText: $('#hintText'),
  banner: $('#waveBanner'),
  bannerTop: $('#bannerTop'),
  bannerMain: $('#bannerMain'),
  bannerSub: $('#bannerSub'),
  toast: $('#toast'),
  damageFlash: $('#damageFlash'),
  healFlash: $('#healFlash'),
  endTitle: $('#endTitle'),
  endCopy: $('#endCopy'),
  endEyebrow: $('#endEyebrow'),
  resultGrade: $('#resultGrade'),
  statWave: $('#statWave'),
  statKills: $('#statKills'),
  statBuilds: $('#statBuilds'),
  statHarvest: $('#statHarvest'),
  statScore: $('#statScore'),
  endPanel: $('.end-panel'),
  soundBtns: [$('#soundBtn'), $('#menuSoundBtn')]
};

const keys = new Set();
const joystick = { x: 0, y: 0, pointerId: null, radius: 34 };
const look = { pointerId: null, x: 0, y: 0 };

const game = {
  phase: 'menu',
  paused: false,
  wave: 0,
  completedWaves: 0,
  prepTimer: 18,
  clearTimer: 0,
  waveResolving: false,
  resolveTimer: 0,
  coreHealth: 1000,
  maxCoreHealth: 1000,
  materials: { wood: 120, stone: 80, metal: 40 },
  kills: 0,
  harvest: 0,
  buildsPlaced: 0,
  score: 0,
  enemies: [],
  pending: [],
  projectiles: [],
  builds: [],
  buildAnims: [],
  buildMode: false,
  piece: 'wall',
  material: 'wood',
  fireHeld: false,
  placeHeld: false,
  fireCooldown: 0,
  placeCooldown: 0,
  time: 0,
  elapsed: 0,
  shake: 0,
  hitStop: 0,
  bannerTimer: 0,
  toastTimer: 0,
  intro: 0,
  tutorialTime: 0,
  tutorialStage: 0,
  waveTotal: 0,
  waveSpawned: 0,
  lastDamageAt: 0,
  aimAssist: true,
  endShown: false,
  spawnSerial: 0
};

const player = {
  pos: new THREE.Vector3(0, 0, 12.5),
  vel: new THREE.Vector3(),
  yaw: 0,
  pitch: -0.08,
  grounded: true,
  health: 100,
  maxHealth: 100,
  walkPhase: 0,
  recoil: 0,
  hurtTilt: 0,
  rebound: 0
};

let ghost = null;
const buildTargets = [];
const enemyProxies = [];
const raycaster = new THREE.Raycaster();
raycaster.camera = camera;
const tempVec = new THREE.Vector3();
const tempVec2 = new THREE.Vector3();
const tempQuat = new THREE.Quaternion();
let toastTimeout = null;
let lastHud = {};
let audioReady = false;
let frameCount = 0;

// ---------- HUD ----------
function buildPips() {
  el.wavePips.innerHTML = '';
  for (let i = 0; i < 5; i++) {
    const pip = document.createElement('span');
    pip.className = 'wave-pip';
    el.wavePips.appendChild(pip);
  }
}
buildPips();

function updateHud(force = false) {
  const hp = Math.max(0, player.health) / player.maxHealth;
  const core = Math.max(0, game.coreHealth) / game.maxCoreHealth;
  el.healthFill.style.transform = `scaleX(${clamp(hp, 0, 1)})`;
  el.coreFill.style.transform = `scaleX(${clamp(core, 0, 1)})`;
  el.healthValue.textContent = Math.ceil(Math.max(0, player.health));
  el.coreValue.textContent = Math.ceil(Math.max(0, game.coreHealth));

  for (const [key, node] of [['wood', el.resWood], ['stone', el.resStone], ['metal', el.resMetal]]) {
    const value = game.materials[key];
    const target = node.querySelector('b');
    if (lastHud[key] !== value || force) {
      target.textContent = value;
      lastHud[key] = value;
    }
  }

  let timerText = '0:00';
  let phaseText = 'PREPARE';
  let objective = 'FORTIFY THE RIFT CORE';
  let hostile = 0;

  if (game.phase === 'prep') {
    const seconds = Math.max(0, Math.ceil(game.prepTimer));
    timerText = `0:${String(seconds).padStart(2, '0')}`;
    phaseText = `WAVE ${game.wave} IN`;
    objective = game.wave === 1 ? 'BUILD YOUR DEFENSES' : 'FORTIFY • HARVEST • PREPARE';
    hostile = game.enemies.length + game.pending.length;
  } else if (game.phase === 'wave') {
    hostile = game.enemies.length + game.pending.length;
    timerText = game.enemies.some((e) => e.type === 'boss') ? 'BOSS' : `${hostile} LEFT`;
    phaseText = `WAVE ${game.wave}`;
    objective = game.enemies.some((e) => e.type === 'boss') ? 'BRING DOWN THE RIFT WARDEN' : 'DEFEND THE RIFT CORE';
  } else if (game.phase === 'cleared') {
    timerText = 'CLEAR';
    phaseText = `WAVE ${game.wave} CLEARED`;
    objective = 'REGROUP • REBUILD • RELOAD';
    hostile = 0;
  } else if (game.phase === 'victory') {
    timerText = 'HELD';
    phaseText = 'RIFT SECURE';
    objective = 'THE STORM IS BROKEN';
    hostile = 0;
  } else if (game.phase === 'defeat') {
    timerText = 'LOST';
    phaseText = 'RIFT COLLAPSED';
    objective = 'SIGNAL LOST';
    hostile = 0;
  } else {
    timerText = '—';
    phaseText = 'STANDBY';
    objective = 'AWAITING DEPLOYMENT';
  }

  if (lastHud.timer !== timerText) {
    el.waveTimer.textContent = timerText;
    lastHud.timer = timerText;
  }
  if (lastHud.phase !== phaseText) {
    el.phaseLabel.textContent = phaseText;
    lastHud.phase = phaseText;
  }
  if (lastHud.objective !== objective) {
    el.objectiveText.textContent = objective;
    lastHud.objective = objective;
  }
  const hostileText = game.phase === 'wave' ? `${hostile} HOSTILES` : game.phase === 'prep' ? 'BUILD PHASE' : game.phase === 'cleared' ? 'BREATHE' : '';
  if (lastHud.hostile !== hostileText) {
    el.hostileCount.textContent = hostileText;
    lastHud.hostile = hostileText;
  }

  const pips = el.wavePips.children;
  for (let i = 0; i < pips.length; i++) {
    pips[i].classList.toggle('on', i < game.completedWaves);
    pips[i].classList.toggle('boss', i === 4 && game.wave === 5 && game.phase === 'wave');
  }

  if (game.phase === 'wave' && (hostile <= 3 || game.enemies.some((e) => e.type === 'boss'))) {
    el.waveChip.classList.add('alert');
  } else {
    el.waveChip.classList.remove('alert');
  }
}

function flashElement(node) {
  if (!node) return;
  node.classList.remove('flash');
  void node.offsetWidth;
  node.classList.add('flash');
  setTimeout(() => node.classList.remove('flash'), 190);
}

function pickupGain(type, amount) {
  const chip = type === 'wood' ? el.resWood : type === 'stone' ? el.resStone : el.resMetal;
  flashElement(chip);
  const pop = document.createElement('div');
  pop.className = `gain-pop ${type}`;
  pop.textContent = `+${amount} ${type.toUpperCase()}`;
  el.hud.appendChild(pop);
  setTimeout(() => pop.remove(), 900);
}

function showToast(text, danger = false, duration = 1900) {
  clearTimeout(toastTimeout);
  el.toast.textContent = text;
  el.toast.classList.toggle('danger', danger);
  el.toast.classList.add('show');
  toastTimeout = setTimeout(() => el.toast.classList.remove('show'), duration);
}

function showHint(text, sticky = false) {
  el.hintText.textContent = text;
  el.hint.classList.remove('hide');
  if (sticky) el.hint.dataset.sticky = '1';
  else delete el.hint.dataset.sticky;
}

function hideHint() {
  el.hint.classList.add('hide');
}

function showBanner(top, main, sub, duration = 2.7) {
  el.bannerTop.textContent = top;
  el.bannerMain.textContent = main;
  el.bannerSub.textContent = sub;
  el.banner.classList.add('show');
  game.bannerTimer = duration;
}

function hideBanner() {
  el.banner.classList.remove('show');
}

function damageFlash() {
  el.damageFlash.classList.remove('flash');
  void el.damageFlash.offsetWidth;
  el.damageFlash.classList.add('flash');
}

function healFlash() {
  el.healFlash.classList.remove('flash');
  void el.healFlash.offsetWidth;
  el.healFlash.classList.add('flash');
}

// ---------- Game flow ----------
function beginRun() {
  audio.init();
  audioReady = true;
  resetRun();
  el.menu.classList.add('is-hidden');
  el.pause.classList.add('is-hidden');
  el.end.classList.add('is-hidden');
  el.hud.classList.remove('is-hidden');
  game.initialized = true;
  game.phase = 'prep';
  game.wave = 1;
  game.completedWaves = 0;
  game.prepTimer = 20;
  game.intro = 1;
  game.tutorialTime = 0;
  game.tutorialStage = 0;
  updateBuildUi();
  showBanner('WAVE 1 // PREPARE', 'RAISE THE WALLS', '20 SECONDS BEFORE THE STORM', 3.6);
  showHint('MOVE WITH THE LEFT STICK • DRAG TO LOOK');
  updateHud(true);
  audio.wave();
  setTimeout(() => showToast('SHOOT GLOWING NODES TO HARVEST MATERIALS', false, 2600), 4300);
}

function resetRun() {
  clearEnemies();
  clearProjectiles();
  clearBuilds();
  game.pending.length = 0;
  game.phase = 'prep';
  game.paused = false;
  game.wave = 1;
  game.completedWaves = 0;
  game.prepTimer = 20;
  game.clearTimer = 0;
  game.waveResolving = false;
  game.resolveTimer = 0;
  game.coreHealth = game.maxCoreHealth;
  game.materials = { wood: 120, stone: 80, metal: 40 };
  game.kills = 0;
  game.harvest = 0;
  game.buildsPlaced = 0;
  game.score = 0;
  game.buildMode = false;
  game.piece = 'wall';
  game.material = 'wood';
  game.fireHeld = false;
  game.placeHeld = false;
  game.fireCooldown = 0;
  game.placeCooldown = 0;
  game.shake = 0;
  game.bannerTimer = 0;
  game.toastTimer = 0;
  game.tutorialTime = 0;
  game.tutorialStage = 0;
  game.waveTotal = 0;
  game.waveSpawned = 0;
  game.lastDamageAt = 0;
  game.endShown = false;
  game.spawnSerial = 0;
  player.pos.set(0, 0, 12.5);
  player.vel.set(0, 0, 0);
  player.yaw = 0;
  player.pitch = -0.08;
  player.grounded = true;
  player.health = player.maxHealth;
  player.recoil = 0;
  player.hurtTilt = 0;
  player.rebound = 0;
  world.player.group.position.copy(player.pos);
  world.player.group.rotation.y = 0;
  world.player.gun.rotation.set(0, 0, 0);
  world.core.setHealth(1);
  world.resetResources();
  effects.clear();
  hideBanner();
  hideHint();
  el.end.classList.add('is-hidden');
  el.pause.classList.add('is-hidden');
  el.hud.classList.remove('is-hidden');
  el.toast.classList.remove('show');
  el.damageFlash.classList.remove('flash');
  el.healFlash.classList.remove('flash');
  updateBuildUi();
  updateHud(true);
  updateCamera(1 / 60, true);
}

function startPrep(wave) {
  if (game.phase === 'victory' || game.phase === 'defeat') return;
  game.phase = 'prep';
  game.wave = wave;
  game.completedWaves = Math.max(game.completedWaves, wave - 1);
  game.prepTimer = wave === 1 ? 20 : 18;
  game.waveTotal = 0;
  game.waveSpawned = 0;
  game.waveResolving = false;
  game.resolveTimer = 0;
  game.buildMode = false;
  game.fireHeld = false;
  game.placeHeld = false;
  updateBuildUi();
  showBanner(`WAVE ${wave} // PREPARE`, wave === 5 ? 'THE WARDEN AWAKENS' : 'FORTIFY THE CORE', `${wave === 1 ? 20 : 18} SECONDS TO BUILD`, 3.2);
  showHint(wave === 1 ? 'OPEN BUILD AND RAISE WALLS AROUND THE CORE' : 'REPAIR YOUR FORT • GATHER MATERIALS • HOLD THE LINE');
  updateHud(true);
  if (wave === 5) setTimeout(() => showToast('⚠ RIFT WARDEN DETECTED — PROTECT THE CORE', true, 3000), 2100);
}

function completeWave() {
  game.completedWaves = game.wave;
  if (game.wave >= 5) {
    finishRun(true);
    return;
  }
  game.phase = 'cleared';
  game.clearTimer = 5;
  game.waveResolving = false;
  game.materials.wood = Math.min(999, game.materials.wood + 35);
  game.materials.stone = Math.min(999, game.materials.stone + 30);
  game.materials.metal = Math.min(999, game.materials.metal + 25);
  player.health = Math.min(player.maxHealth, player.health + 28);
  healFlash();
  audio.waveClear();
  showBanner(`WAVE ${game.wave} // CLEARED`, 'THE RIFT HOLDS', '+35 WOOD  +30 STONE  +25 METAL', 3.8);
  showToast('STRUCTURES REINFORCED FOR THE NEXT ASSAULT', false, 2400);
  updateHud(true);
}

function finishRun(victory) {
  if (game.endShown) return;
  game.phase = victory ? 'victory' : 'defeat';
  game.endShown = true;
  game.fireHeld = false;
  game.placeHeld = false;
  game.buildMode = false;
  updateBuildUi();
  const grade = victory
    ? game.coreHealth > 700 ? 'S' : game.coreHealth > 400 ? 'A' : 'B'
    : game.wave >= 4 ? 'C' : game.wave >= 2 ? 'D' : 'D';
  el.endPanel.classList.toggle('result-win', victory);
  el.endTitle.textContent = victory ? 'RIFT HELD' : game.coreHealth <= 0 ? 'THE CORE FELL' : 'SIGNAL LOST';
  el.endCopy.textContent = victory
    ? 'Five waves. One last light. The storm broke against your walls.'
    : game.coreHealth <= 0
      ? 'The storm swallowed the core. Build tighter. Shoot faster. Return.'
      : 'You fell, but the rift remembers. Rebuild and try again.';
  el.endEyebrow.innerHTML = `<span></span> ${victory ? 'STORM BROKEN' : 'RIFT COLLAPSED'}`;
  el.resultGrade.innerHTML = `<b>${grade}</b>`;
  el.statWave.textContent = `${game.wave}/5`;
  el.statKills.textContent = game.kills;
  el.statBuilds.textContent = game.buildsPlaced;
  el.statHarvest.textContent = game.harvest;
  game.score = Math.round(game.kills * 120 + game.buildsPlaced * 25 + game.harvest * 2 + game.completedWaves * 620 + game.coreHealth * 0.4);
  el.statScore.textContent = String(game.score).padStart(5, '0');
  setTimeout(() => {
    if (!game.endShown) return;
    el.end.classList.remove('is-hidden');
    hideBanner();
    hideHint();
  }, 750);
  if (victory) audio.victory(); else audio.defeat();
  updateHud(true);
}

function togglePause(force) {
  if (!['prep', 'wave', 'cleared'].includes(game.phase)) return;
  const next = typeof force === 'boolean' ? force : !game.paused;
  game.paused = next;
  game.fireHeld = false;
  game.placeHeld = false;
  el.fireBtn.classList.remove('fire-active');
  if (next) {
    el.pause.classList.remove('is-hidden');
    audio.ui();
  } else {
    el.pause.classList.add('is-hidden');
    audio.ui();
  }
}

function goToMenu() {
  resetRun();
  game.phase = 'menu';
  game.paused = false;
  game.intro = 0;
  el.hud.classList.add('is-hidden');
  el.pause.classList.add('is-hidden');
  el.end.classList.add('is-hidden');
  el.endPanel.classList.remove('result-win');
  el.menu.classList.remove('is-hidden');
  el.healthFill.style.transform = 'scaleX(1)';
  el.coreFill.style.transform = 'scaleX(1)';
  hideBanner();
  hideHint();
  game.endShown = false;
  updateHud(true);
}

// ---------- UI interactions ----------
el.fireBtn.addEventListener('pointerdown', (event) => {
  event.preventDefault();
  if (game.phase !== 'prep' && game.phase !== 'wave' && game.phase !== 'cleared') return;
  if (game.buildMode) {
    game.placeHeld = true;
    attemptBuild();
    game.placeCooldown = 0.25;
  } else {
    game.fireHeld = true;
    el.fireBtn.classList.add('fire-active');
    shoot();
  }
});
function releaseFire(event) {
  if (event) event.preventDefault();
  game.fireHeld = false;
  game.placeHeld = false;
  el.fireBtn.classList.remove('fire-active');
}
el.fireBtn.addEventListener('pointerup', releaseFire);
el.fireBtn.addEventListener('pointercancel', releaseFire);
el.fireBtn.addEventListener('pointerleave', releaseFire);

el.jumpBtn.addEventListener('pointerdown', (event) => {
  event.preventDefault();
  requestJump();
});

el.buildBtn.addEventListener('pointerdown', (event) => {
  event.preventDefault();
  toggleBuildMode();
});

el.pauseBtn = $('#pauseBtn');
$('#pauseBtn').addEventListener('click', () => togglePause());
$('#soundBtn').addEventListener('click', toggleSound);
$('#menuSoundBtn').addEventListener('click', toggleSound);
$('#deployBtn').addEventListener('click', beginRun);
$('#howBtn').addEventListener('click', () => {
  $('#howPanel').classList.add('open');
  $('#howPanel').setAttribute('aria-hidden', 'false');
  audio.init();
  audio.ui();
});
$('#howClose').addEventListener('click', () => {
  $('#howPanel').classList.remove('open');
  $('#howPanel').setAttribute('aria-hidden', 'true');
});
$('#resumeBtn').addEventListener('click', () => togglePause(false));
$('#restartBtn').addEventListener('click', () => {
  beginRun();
});
$('#quitBtn').addEventListener('click', () => goToMenu());
$('#playAgainBtn').addEventListener('click', () => beginRun());
$('#backMenuBtn').addEventListener('click', () => goToMenu());

function toggleSound() {
  if (!audioReady) {
    audio.init();
    audioReady = true;
  }
  audio.setMuted(!audio.muted);
  for (const btn of el.soundBtns) btn.classList.toggle('muted', audio.muted);
  audio.ui();
}

document.querySelectorAll('.piece-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    game.piece = btn.dataset.piece;
    document.querySelectorAll('.piece-btn').forEach((b) => b.classList.toggle('selected', b === btn));
    rebuildGhost();
    audio.ui();
  });
});

document.querySelectorAll('.mat-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    game.material = btn.dataset.mat;
    document.querySelectorAll('.mat-btn').forEach((b) => b.classList.toggle('selected', b === btn));
    rebuildGhost();
    audio.ui();
  });
});

// ---------- Input ----------
window.addEventListener('keydown', (event) => {
  const key = event.key.toLowerCase();
  if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(key)) event.preventDefault();
  keys.add(key);
  if (key === 'b' && (game.phase === 'prep' || game.phase === 'wave' || game.phase === 'cleared')) toggleBuildMode();
  if (key === 'f' && !event.repeat && !game.buildMode) {
    game.fireHeld = true;
    el.fireBtn.classList.add('fire-active');
  }
  if (key === ' ' && !event.repeat) requestJump();
  if (key === 'escape') {
    if (!$('#howPanel').classList.contains('open')) togglePause();
    else $('#howClose').click();
  }
  if (key === '1') selectPiece('wall');
  if (key === '2') selectPiece('floor');
  if (key === '3') selectPiece('ramp');
  if (key === 'q') cycleMaterial();
  if (key === 'r' && game.buildMode) attemptBuild();
});
window.addEventListener('keyup', (event) => {
  const key = event.key.toLowerCase();
  keys.delete(key);
  if (key === 'f') {
    game.fireHeld = false;
    el.fireBtn.classList.remove('fire-active');
  }
});

function selectPiece(piece) {
  if (!['wall', 'floor', 'ramp'].includes(piece)) return;
  game.piece = piece;
  document.querySelectorAll('.piece-btn').forEach((b) => b.classList.toggle('selected', b.dataset.piece === piece));
  rebuildGhost();
}

function cycleMaterial() {
  const order = ['wood', 'stone', 'metal'];
  const next = order[(order.indexOf(game.material) + 1) % 3];
  game.material = next;
  document.querySelectorAll('.mat-btn').forEach((b) => b.classList.toggle('selected', b.dataset.mat === next));
  rebuildGhost();
  audio.ui();
}

canvas.addEventListener('pointerdown', (event) => {
  if (!(game.phase === 'prep' || game.phase === 'wave' || game.phase === 'cleared') || game.paused) return;
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  look.pointerId = event.pointerId;
  look.x = event.clientX;
  look.y = event.clientY;
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener('pointermove', (event) => {
  if (event.pointerId !== look.pointerId) return;
  const dx = event.clientX - look.x;
  const dy = event.clientY - look.y;
  look.x = event.clientX;
  look.y = event.clientY;
  player.yaw -= dx * 0.0042;
  player.pitch = clamp(player.pitch - dy * 0.0036, -0.66, 0.42);
});
function endLook(event) {
  if (event.pointerId === look.pointerId) look.pointerId = null;
}
canvas.addEventListener('pointerup', endLook);
canvas.addEventListener('pointercancel', endLook);

function joyStart(event) {
  if (!(game.phase === 'prep' || game.phase === 'wave' || game.phase === 'cleared') || game.paused) return;
  event.preventDefault();
  joystick.pointerId = event.pointerId;
  el.joystick.classList.add('active');
  el.joystick.setPointerCapture(event.pointerId);
  updateJoystick(event);
}
function joyMove(event) {
  if (event.pointerId !== joystick.pointerId) return;
  event.preventDefault();
  updateJoystick(event);
}
function joyEnd(event) {
  if (event.pointerId !== joystick.pointerId) return;
  joystick.pointerId = null;
  joystick.x = 0;
  joystick.y = 0;
  el.joystick.classList.remove('active');
  el.joystickKnob.style.transform = 'translate(0px, 0px)';
}
function updateJoystick(event) {
  const rect = el.joystick.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  let dx = event.clientX - cx;
  let dy = event.clientY - cy;
  const max = joystick.radius;
  const dist = Math.hypot(dx, dy);
  if (dist > max) {
    dx = dx / dist * max;
    dy = dy / dist * max;
  }
  joystick.x = dx / max;
  joystick.y = -dy / max;
  const dead = 0.12;
  if (Math.abs(joystick.x) < dead) joystick.x = 0;
  if (Math.abs(joystick.y) < dead) joystick.y = 0;
  el.joystickKnob.style.transform = `translate(${dx}px, ${dy}px)`;
}
el.joystick.addEventListener('pointerdown', joyStart);
el.joystick.addEventListener('pointermove', joyMove);
el.joystick.addEventListener('pointerup', joyEnd);
el.joystick.addEventListener('pointercancel', joyEnd);
el.joystick.addEventListener('pointerleave', (event) => {
  if (event.pointerId === joystick.pointerId && event.buttons === 0) joyEnd(event);
});

function requestJump() {
  if (game.phase !== 'prep' && game.phase !== 'wave' && game.phase !== 'cleared') return;
  if (game.paused || !player.grounded) return;
  player.vel.y = 8.3;
  player.grounded = false;
  audio.jump();
}

// ---------- Build system ----------
function toggleBuildMode() {
  if (!(game.phase === 'prep' || game.phase === 'wave' || game.phase === 'cleared') || game.paused) return;
  game.buildMode = !game.buildMode;
  if (game.buildMode) {
    game.fireHeld = false;
    el.fireBtn.classList.remove('fire-active');
    if (!ghost) rebuildGhost();
    if (ghost) ghost.visible = true;
    showHint('DRAG TO AIM • HOLD PLACE TO BUILD');
  } else {
    game.placeHeld = false;
    if (ghost) ghost.visible = false;
    showHint(game.wave >= 2 ? 'PROTECT THE CORE • SHOOT THE HOSTILES' : 'SHOOT GLOWING NODES TO HARVEST');
  }
  updateBuildUi();
  audio.ui();
}

function updateBuildUi() {
  el.hud.classList.toggle('build-mode', game.buildMode);
  el.buildBtnLabel.textContent = game.buildMode ? 'EXIT' : 'BUILD';
  el.fireBtnLabel.textContent = game.buildMode ? 'PLACE' : 'FIRE';
  el.fireBtnSub.textContent = game.buildMode ? 'HOLD' : 'HOLD';
  el.crosshair.classList.toggle('hidden', game.buildMode);
  if (!game.buildMode) {
    game.placeHeld = false;
    el.fireBtn.classList.remove('fire-active');
  }
  document.querySelectorAll('.piece-btn').forEach((b) => b.classList.toggle('selected', b.dataset.piece === game.piece));
  document.querySelectorAll('.mat-btn').forEach((b) => b.classList.toggle('selected', b.dataset.mat === game.material));
}

function rebuildGhost() {
  if (ghost) {
    scene.remove(ghost);
    disposeObject(ghost);
    ghost = null;
  }
  ghost = makeBuildPiece(game.piece, game.material, true);
  ghost.visible = game.buildMode;
  scene.add(ghost);
  applyGhostTint('#75fff6');
}

function makeBuildPiece(piece, materialKey, isGhost = false) {
  const material = BUILD_MATERIALS[materialKey];
  const group = new THREE.Group();
  const ghostMat = isGhost ? new THREE.MeshBasicMaterial({ color: '#75fff6', transparent: true, opacity: 0.19, depthWrite: false, side: THREE.DoubleSide }) : null;
  const ghostLine = isGhost ? new THREE.LineBasicMaterial({ color: '#bafff8', transparent: true, opacity: 0.65, depthWrite: false }) : null;
  const mats = [];
  let bodyMat;
  let trimMat;

  if (!isGhost) {
    bodyMat = new THREE.MeshStandardMaterial({
      color: material.body,
      roughness: material.roughness,
      metalness: material.metalness,
      flatShading: false
    });
    trimMat = new THREE.MeshStandardMaterial({
      color: material.trim,
      emissive: material.trim,
      emissiveIntensity: 0.38,
      roughness: 0.32,
      metalness: 0.55
    });
    mats.push(bodyMat, trimMat);
  }

  function addMesh(geometry, trim = false) {
    const mesh = new THREE.Mesh(geometry, isGhost ? ghostMat : trim ? trimMat : bodyMat);
    mesh.castShadow = !isGhost;
    mesh.receiveShadow = !isGhost;
    group.add(mesh);
    return mesh;
  }

  function addBox(w, h, d, x, y, z, trim = false, rotZ = 0) {
    const mesh = addMesh(new THREE.BoxGeometry(w, h, d), trim);
    mesh.position.set(x, y, z);
    mesh.rotation.z = rotZ;
    return mesh;
  }

  let mainMesh;
  if (piece === 'wall') {
    mainMesh = addBox(4, 3.2, 0.22, 0, 0, 0);
    addBox(0.16, 3.22, 0.3, -1.9, 0, 0.02, true);
    addBox(0.16, 3.22, 0.3, 1.9, 0, 0.02, true);
    addBox(4.06, 0.15, 0.3, 0, 1.53, 0.02, true);
    addBox(4.06, 0.15, 0.3, 0, -1.53, 0.02, true);
    addBox(5.02, 0.075, 0.07, 0, 0, 0.15, true, 0.62);
    addBox(5.02, 0.075, 0.07, 0, 0, 0.15, true, -0.62);
    addBox(1.1, 0.32, 0.03, 0, 0.72, 0.135, true);
  } else if (piece === 'floor') {
    mainMesh = addBox(4, 0.2, 4, 0, 0, 0);
    addBox(4.08, 0.08, 0.12, 0, 0.11, -1.95, true);
    addBox(4.08, 0.08, 0.12, 0, 0.11, 1.95, true);
    addBox(0.12, 0.08, 3.82, -1.95, 0.11, 0, true);
    addBox(0.12, 0.08, 3.82, 1.95, 0.11, 0, true);
    addBox(4.1, 0.04, 0.06, 0, 0.12, 0, true);
  } else {
    const slab = new THREE.Group();
    slab.rotation.x = Math.atan2(FLOOR_HEIGHT, 4);
    const slabMesh = new THREE.Mesh(new THREE.BoxGeometry(4, 0.22, 5.12), isGhost ? ghostMat : bodyMat);
    slabMesh.castShadow = !isGhost;
    slabMesh.receiveShadow = !isGhost;
    slab.add(slabMesh);
    mainMesh = slabMesh;

    // Side rails and traction strips sit on the sloped slab.
    const railGeo = new THREE.BoxGeometry(0.14, 0.18, 5.18);
    for (let s = -1; s <= 1; s += 2) {
      const rail = new THREE.Mesh(railGeo, isGhost ? ghostMat : trimMat);
      rail.position.set(1.86 * s, 0.13, 0);
      rail.castShadow = !isGhost;
      slab.add(rail);
    }
    for (let i = 0; i < 5; i++) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(3.7, 0.045, 0.09), isGhost ? ghostMat : trimMat);
      strip.position.set(0, 0.13, -1.85 + i * 0.92);
      slab.add(strip);
    }
    group.add(slab);
  }

  if (isGhost) {
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(mainMesh.geometry), ghostLine);
    edges.position.copy(mainMesh.position);
    edges.rotation.copy(mainMesh.rotation);
    edges.scale.copy(mainMesh.scale);
    mainMesh.parent.add(edges);
    edges.userData.isGhostEdge = true;
    mats.push(ghostMat, ghostLine);
  } else {
    group.userData.mainMaterial = bodyMat;
    group.userData.trimMaterial = trimMat;
  }

  group.userData.materials = mats;
  group.userData.mainMesh = mainMesh;
  return group;
}

function applyGhostTint(color) {
  if (!ghost) return;
  ghost.traverse((obj) => {
    if (obj.isMesh && obj.material && obj.material !== undefined && obj.material.transparent) obj.material.color.set(color);
    if (obj.isLineSegments) obj.material.color.set(color);
  });
}

function buildBounds(piece, center, yaw, level) {
  if (piece === 'wall') {
    const alongX = Math.abs(Math.cos(yaw)) > 0.5;
    const halfX = alongX ? 2.02 : 0.18;
    const halfZ = alongX ? 0.18 : 2.02;
    return {
      minX: center.x - halfX,
      maxX: center.x + halfX,
      minZ: center.z - halfZ,
      maxZ: center.z + halfZ,
      minY: level,
      maxY: level + 3.2
    };
  }
  if (piece === 'floor') {
    return {
      minX: center.x - 2,
      maxX: center.x + 2,
      minZ: center.z - 2,
      maxZ: center.z + 2,
      minY: level,
      maxY: level + 0.2
    };
  }
  return {
    minX: center.x - 2,
    maxX: center.x + 2,
    minZ: center.z - 2,
    maxZ: center.z + 2,
    minY: level,
    maxY: level + 3.2
  };
}

function placementForCurrentAim() {
  const level = Math.round(player.pos.y / FLOOR_HEIGHT) * FLOOR_HEIGHT;
  const yaw = Math.round(player.yaw / (PI / 2)) * (PI / 2);
  const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  const center = new THREE.Vector3(
    player.pos.x + forward.x * 4.2,
    level + (game.piece === 'wall' ? 1.6 : game.piece === 'floor' ? 0.1 : 1.6),
    player.pos.z + forward.z * 4.2
  );
  const bounds = buildBounds(game.piece, center, yaw, level);
  const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  return {
    piece: game.piece,
    material: game.material,
    level,
    yaw,
    forward,
    right,
    center,
    bounds
  };
}

function circleIntersectsBounds(x, z, r, bounds) {
  const nx = clamp(x, bounds.minX, bounds.maxX);
  const nz = clamp(z, bounds.minZ, bounds.maxZ);
  return (x - nx) ** 2 + (z - nz) ** 2 < r * r;
}

function boundsOverlap(a, b) {
  return a.minX < b.maxX - 0.02 && a.maxX > b.minX + 0.02 &&
    a.minZ < b.maxZ - 0.02 && a.maxZ > b.minZ + 0.02 &&
    a.minY < b.maxY - 0.02 && a.maxY > b.minY + 0.02;
}

function validatePlacement(placement) {
  const cost = BUILD_COST;
  if (game.materials[placement.material] < cost) return { valid: false, reason: `NEED ${cost} ${BUILD_MATERIALS[placement.material].label}` };
  const center = placement.center;
  if (Math.hypot(center.x, center.z) > PLAY_RADIUS - 2.4) return { valid: false, reason: 'EDGE OF THE RIFT' };
  if (circleIntersectsBounds(0, 0, 5.0, placement.bounds)) return { valid: false, reason: 'TOO CLOSE TO THE CORE' };
  if (circleIntersectsBounds(player.pos.x, player.pos.z, 0.52, placement.bounds) &&
      player.pos.y + 1.8 > placement.bounds.minY && player.pos.y < placement.bounds.maxY) {
    return { valid: false, reason: 'PLAYER IN THE WAY' };
  }
  for (const build of game.builds) {
    if (boundsOverlap(placement.bounds, build.bounds)) return { valid: false, reason: 'OVERLAPS A STRUCTURE' };
  }
  for (const node of world.resources) {
    if (!node.active) continue;
    const radius = node.type === 'wood' ? 1.8 : 1.4;
    if (circleIntersectsBounds(node.home.x, node.home.z, radius, placement.bounds)) return { valid: false, reason: 'BLOCKED BY DEBRIS' };
  }
  return { valid: true, reason: '' };
}

function updateGhost() {
  if (!ghost || !game.buildMode) return;
  const placement = placementForCurrentAim();
  const validity = validatePlacement(placement);
  ghost.position.copy(placement.center);
  ghost.rotation.y = placement.yaw;
  applyGhostTint(validity.valid ? '#75fff6' : '#ff5c73');
  el.buildHint.classList.toggle('invalid', !validity.valid);
  const material = BUILD_MATERIALS[placement.material];
  el.buildHint.textContent = validity.valid
    ? `${placement.piece.toUpperCase()} · ${BUILD_COST} ${material.label}`
    : validity.reason;
  return { placement, validity };
}

function attemptBuild(silent = false) {
  if (!game.buildMode) return false;
  const result = updateGhost();
  if (!result) return false;
  if (!result.validity.valid) {
    if (!silent) {
      audio.deny();
      game.shake = Math.max(game.shake, 0.08);
      showToast(result.validity.reason, true, 1200);
    }
    return false;
  }
  const { placement } = result;
  game.materials[placement.material] -= BUILD_COST;
  createBuild(placement);
  game.buildsPlaced++;
  game.fireCooldown = Math.max(game.fireCooldown, 0.08);
  audio.build();
  updateHud();
  return true;
}

function createBuild(placement) {
  const material = BUILD_MATERIALS[placement.material];
  const group = makeBuildPiece(placement.piece, placement.material, false);
  group.position.copy(placement.center);
  group.rotation.y = placement.yaw;
  group.scale.setScalar(0.01);
  scene.add(group);

  const build = {
    piece: placement.piece,
    material: placement.material,
    level: placement.level,
    yaw: placement.yaw,
    center: placement.center.clone(),
    bounds: placement.bounds,
    hp: material.hp,
    maxHp: material.hp,
    group,
    mainMesh: group.userData.mainMesh,
    mainMaterial: group.userData.mainMaterial,
    trimMaterial: group.userData.trimMaterial,
    baseColor: new THREE.Color(material.body),
    flash: 0,
    anim: 0,
    dead: false,
    forward: placement.forward.clone(),
    right: placement.right.clone()
  };
  build.mainMesh.userData.gameHit = { kind: 'build', ref: build };
  game.builds.push(build);
  buildTargets.push(build.mainMesh);
  game.buildAnims.push(build);
  effects.ring(new THREE.Vector3(placement.center.x, placement.level + 0.04, placement.center.z), material.glow, 2.6, 0.45);
  effects.emit(new THREE.Vector3(placement.center.x, placement.level + 0.5, placement.center.z), material.glow, 13, { speed: 3.4, life: 0.55, size: 0.15, gravity: 3 });
  return build;
}

function damageBuild(build, amount) {
  if (!build || build.dead) return;
  build.hp -= amount;
  build.flash = 0.12;
  effects.emit(build.center, build.material === 'wood' ? '#ffc47a' : build.material === 'stone' ? '#d8e4ff' : '#7dfff4', 5, { speed: 2.3, life: 0.3, size: 0.1 });
  if (build.hp <= 0) {
    destroyBuild(build);
  } else {
    const ratio = clamp(build.hp / build.maxHp, 0, 1);
    build.mainMaterial.color.copy(build.baseColor).lerp(new THREE.Color('#201421'), (1 - ratio) * 0.55);
  }
}

function destroyBuild(build) {
  if (build.dead) return;
  build.dead = true;
  const color = build.material === 'wood' ? '#c28145' : build.material === 'stone' ? '#9ba7c6' : '#58c7cd';
  effects.emit(build.center, color, 28, { speed: 7, life: 0.8, size: 0.26, gravity: 10, spread: 1.2 });
  effects.ring(new THREE.Vector3(build.center.x, build.center.y, build.center.z), '#ff8eae', 4, 0.55);
  audio.build();
  game.shake = Math.max(game.shake, 0.12);
  scene.remove(build.group);
  disposeObject(build.group);
  const idx = game.builds.indexOf(build);
  if (idx >= 0) game.builds.splice(idx, 1);
  const tidx = buildTargets.indexOf(build.mainMesh);
  if (tidx >= 0) buildTargets.splice(tidx, 1);
}

function clearBuilds() {
  for (const build of game.builds) {
    scene.remove(build.group);
    disposeObject(build.group);
  }
  game.builds.length = 0;
  buildTargets.length = 0;
  game.buildAnims.length = 0;
}

function disposeObject(object) {
  object.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
      else obj.material.dispose();
    }
  });
}

// ---------- Shooting / aiming ----------
function cameraForward(target = new THREE.Vector3()) {
  const cp = Math.cos(player.pitch);
  return target.set(-Math.sin(player.yaw) * cp, Math.sin(player.pitch), -Math.cos(player.yaw) * cp).normalize();
}

function shoot() {
  if (game.buildMode || game.paused) return;
  if (!['prep', 'wave', 'cleared'].includes(game.phase)) return;
  if (game.fireCooldown > 0) return;
  game.fireCooldown = 0.13;
  const origin = camera.position.clone();
  const forward = cameraForward(new THREE.Vector3());
  let aimPoint = null;
  let assistType = null;

  // Generous aim magnetism keeps touch play fluid without hiding the challenge.
  let bestScore = 0.982;
  let bestEnemy = null;
  for (const enemy of game.enemies) {
    if (enemy.dead || enemy.spawnT > 0) continue;
    const center = tempVec.set(enemy.model.group.position.x, enemy.model.group.position.y + (enemy.type === 'boss' ? 2.1 : enemy.type === 'brute' ? 1.5 : 1.15), enemy.model.group.position.z);
    const delta = tempVec2.copy(center).sub(origin);
    const distance = delta.length();
    if (distance > 52) continue;
    const dot = forward.dot(delta.normalize());
    const score = dot + (enemy.type === 'boss' ? 0.006 : 0);
    if (dot > bestScore && score > bestScore) {
      bestScore = score;
      aimPoint = center.clone();
      bestEnemy = enemy;
    }
  }

  if (!bestEnemy) {
    bestScore = 0.985;
    for (const node of world.resources) {
      if (!node.active) continue;
      const center = tempVec.set(node.home.x, 1.1, node.home.z);
      const delta = tempVec2.copy(center).sub(origin);
      const distance = delta.length();
      if (distance > 40) continue;
      const dot = forward.dot(delta.normalize());
      if (dot > bestScore) {
        bestScore = dot;
        aimPoint = center.clone();
        assistType = 'resource';
      }
    }
  }

  const aimDir = aimPoint ? aimPoint.clone().sub(origin).normalize() : forward.clone();
  aimDir.x += (Math.random() - 0.5) * 0.004;
  aimDir.y += (Math.random() - 0.5) * 0.004;
  aimDir.z += (Math.random() - 0.5) * 0.004;
  aimDir.normalize();
  raycaster.set(origin, aimDir);
  raycaster.far = 60;

  const targets = [...enemyProxies, ...buildTargets, ...world.resourceMeshes];
  const hits = raycaster.intersectObjects(targets, true);
  let endpoint = origin.clone().addScaledVector(aimDir, 58);
  let hitInfo = null;
  let hitPoint = endpoint;
  for (const hit of hits) {
    const info = resolveHit(hit.object);
    if (!info) continue;
    if (info.kind === 'enemy' && (info.ref.dead || info.ref.spawnT > 0)) continue;
    if (info.kind === 'resource' && !info.ref.active) continue;
    if (info.kind === 'build' && info.ref.dead) continue;
    hitInfo = info;
    hitPoint = hit.point.clone();
    endpoint = hitPoint;
    break;
  }

  const muzzlePos = world.player.muzzle.getWorldPosition(new THREE.Vector3());
  effects.tracer(muzzlePos, endpoint, 0x87fff6);
  effects.flash(muzzlePos, 0xbafff8, 1.0, 0.1);
  effects.emit(muzzlePos, '#8afff6', 3, { speed: 2.6, life: 0.18, size: 0.1, gravity: 0 });
  audio.shot();
  player.recoil = 1;
  game.shake = Math.max(game.shake, 0.04);

  if (!hitInfo) {
    // Fall back to an impact on the island surface so shots feel grounded.
    if (aimDir.y < -0.001 && origin.y > 0) {
      const t = -origin.y / aimDir.y;
      if (t > 0 && t < 60) hitPoint = origin.clone().addScaledVector(aimDir, t);
    }
    effects.emit(hitPoint, '#a7d8de', 5, { speed: 2.4, life: 0.3, size: 0.09, gravity: 4 });
    return;
  }

  if (hitInfo.kind === 'enemy') {
    damageEnemy(hitInfo.ref, 18, hitPoint);
  } else if (hitInfo.kind === 'resource') {
    harvestNode(hitInfo.ref, hitPoint);
  } else if (hitInfo.kind === 'build') {
    effects.emit(hitPoint, '#9be9e5', 4, { speed: 2, life: 0.25, size: 0.08, gravity: 2 });
  }
}

function resolveHit(object) {
  let node = object;
  while (node) {
    if (node.userData && node.userData.gameHit) return node.userData.gameHit;
    node = node.parent;
  }
  return null;
}

function harvestNode(node, hitPoint) {
  if (!node.active) return;
  node.hp -= 1;
  game.materials[node.type] = Math.min(999, game.materials[node.type] + node.yield);
  game.harvest += node.yield;
  const color = node.type === 'wood' ? '#ffc477' : node.type === 'stone' ? '#ff9bdc' : '#7bfff6';
  effects.emit(hitPoint, color, 9, { speed: 3.4, life: 0.48, size: 0.14, gravity: 4 });
  audio.harvest();
  pickupGain(node.type, node.yield);
  game.shake = Math.max(game.shake, 0.025);
  if (node.hp <= 0) {
    node.active = false;
    node.group.visible = false;
    node.respawnAt = game.time + 34 + Math.random() * 12;
    effects.ring(new THREE.Vector3(node.home.x, 0.25, node.home.z), color, 4.2, 0.65);
    effects.emit(new THREE.Vector3(node.home.x, 1.2, node.home.z), color, 30, { speed: 6, life: 0.9, size: 0.22, gravity: 7 });
    audio.pickup();
    showToast(`NODE DEPLETED — ${node.yield * node.maxHp} ${node.type.toUpperCase()} HARVESTED`, false, 1500);
  }
  updateHud();
}

// ---------- Waves & enemies ----------
function startWave(wave) {
  if (game.phase === 'victory' || game.phase === 'defeat') return;
  game.phase = 'wave';
  game.wave = wave;
  game.waveSpawned = 0;
  game.pending.length = 0;
  game.waveResolving = false;
  game.resolveTimer = 0;
  hideHint();
  const config = WAVE_CONFIG[wave] || WAVE_CONFIG[5];
  const queue = [];
  let time = 0.4;
  for (const [type, count] of Object.entries(config)) {
    for (let i = 0; i < count; i++) queue.push(type);
  }
  // Shuffle regular enemies but keep the boss as the final entrance.
  const boss = queue.filter((t) => t === 'boss');
  const regular = queue.filter((t) => t !== 'boss');
  for (let i = regular.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [regular[i], regular[j]] = [regular[j], regular[i]];
  }
  const ordered = [...regular, ...boss];
  ordered.forEach((type, index) => {
    time += type === 'boss' ? 2.4 : 0.78 + Math.random() * 0.62;
    game.pending.push({ type, delay: time, initial: index === 0 ? 0.3 : 0 });
  });
  game.waveTotal = ordered.length;
  showBanner(`WAVE ${wave} // INCOMING`, wave === 5 ? 'THE RIFT WARDEN' : 'HOSTILES DETECTED', wave === 5 ? 'DEFEND THE CORE AT ALL COSTS' : 'HOLD THE LINE', 2.6);
  if (wave === 5) makeSkyFlash(world, 1.1);
  audio.wave();
  showHint(wave === 5 ? 'BOSS INBOUND • STACK WALLS • KEEP MOVING' : 'SHOOT HOSTILES • REBUILD BROKEN WALLS');
  updateHud(true);
}

function updateWave(dt) {
  if (game.phase !== 'wave') return;

  if (game.pending.length) {
    const activeCount = game.enemies.length;
    for (let i = game.pending.length - 1; i >= 0; i--) {
      const entry = game.pending[i];
      entry.delay -= dt;
      entry.initial = Math.max(0, entry.initial - dt);
      if (entry.delay <= 0 && entry.initial <= 0) {
        if (activeCount >= 15) {
          entry.delay = 0.8;
          continue;
        }
        game.pending.splice(i, 1);
        spawnEnemy(entry.type);
        game.waveSpawned++;
      }
    }
  }

  if (!game.pending.length && !game.enemies.length && !game.waveResolving) {
    game.waveResolving = true;
    game.resolveTimer = 1.3;
  }
  if (game.waveResolving) {
    game.resolveTimer -= dt;
    if (game.resolveTimer <= 0) {
      game.waveResolving = false;
      completeWave();
    }
  }
}

function spawnEnemy(type) {
  const stats = ENEMY_STATS[type];
  const angle = Math.random() * TAU;
  let radius = 33 + Math.random() * 5;
  let x = Math.cos(angle) * radius;
  let z = Math.sin(angle) * radius;
  // Don't materialize directly behind the player's toes.
  if (Math.hypot(x - player.pos.x, z - player.pos.z) < 8) {
    const alt = angle + PI;
    x = Math.cos(alt) * radius;
    z = Math.sin(alt) * radius;
  }

  const model = createEnemyModel(type, Math.random);
  model.group.position.set(x, 0, z);
  model.group.scale.setScalar(0.01);
  model.group.rotation.y = Math.atan2(-player.pos.x + x, -player.pos.z + z);
  scene.add(model.group);

  const proxyRadius = type === 'boss' ? 1.75 : type === 'brute' ? 1.0 : type === 'spitter' ? 0.62 : 0.6;
  const proxy = new THREE.Mesh(
    new THREE.SphereGeometry(proxyRadius, 6, 5),
    new THREE.MeshBasicMaterial()
  );
  proxy.visible = false;
  proxy.position.y = type === 'boss' ? 2.0 : type === 'brute' ? 1.45 : type === 'spitter' ? 1.35 : 1.15;
  model.group.add(proxy);

  const waveScale = 1 + Math.max(0, game.wave - 1) * 0.045;
  const enemy = {
    id: ++game.spawnSerial,
    type,
    stats,
    model,
    proxy,
    position: model.group.position,
    health: stats.hp * waveScale,
    maxHealth: stats.hp * waveScale,
    speed: stats.speed * (1 + Math.max(0, game.wave - 1) * 0.018),
    damage: stats.damage,
    radius: stats.radius,
    attackInterval: stats.attackInterval,
    attackCd: 0.55 + Math.random() * 0.45,
    fireCd: 1.2 + Math.random() * 1.2,
    spawnT: 1.0,
    bob: Math.random() * TAU,
    aggro: type === 'boss' ? 'core' : Math.random() < 0.4 ? 'player' : 'core',
    strafe: (Math.random() < 0.5 ? -1 : 1) * (0.6 + Math.random() * 0.7),
    strafeTimer: 0,
    dead: false,
    flash: 0,
    knockback: new THREE.Vector3(),
    attacking: null
  };
  proxy.userData.gameHit = { kind: 'enemy', ref: enemy };
  enemyProxies.push(proxy);
  game.enemies.push(enemy);

  model.healthBar.visible = true;
  model.healthFill.scale.x = model.healthBarWidth;
  model.healthFill.material.color.set('#ff5c9b');

  const portal = new THREE.Vector3(x, 0.25, z);
  effects.ring(portal, type === 'boss' ? '#ffbf69' : '#ff79b5', type === 'boss' ? 9 : 3.8, 0.8);
  effects.emit(new THREE.Vector3(x, 1, z), type === 'boss' ? '#ffbf69' : '#e766a7', type === 'boss' ? 45 : 20, { speed: 6, life: 0.75, size: 0.22, gravity: 2 });
  effects.flash(new THREE.Vector3(x, 1.2, z), type === 'boss' ? '#ffbf69' : '#ff79b5', type === 'boss' ? 8 : 3, 0.4);
  if (type === 'boss') {
    game.shake = 0.5;
    showToast('⚠ RIFT WARDEN HAS ENTERED THE ARENA', true, 2800);
  } else if (type === 'spitter' && game.wave === 2) {
    showToast('RANGED SPITTERS INBOUND — BREAK LINE OF SIGHT', false, 2400);
  } else if (type === 'brute' && game.wave === 3) {
    showToast('BRUTE DETECTED — ITS HITS HURT WALLS', true, 2400);
  }
  updateHud(true);
}

function updateEnemies(dt) {
  for (let i = game.enemies.length - 1; i >= 0; i--) {
    const enemy = game.enemies[i];
    if (enemy.dead) {
      removeEnemy(enemy);
      continue;
    }
    const group = enemy.model.group;
    if (enemy.spawnT > 0) {
      enemy.spawnT -= dt;
      const p = 1 - Math.max(0, enemy.spawnT);
      const scale = p < 0.72 ? p / 0.72 * 0.88 : 0.88 + (p - 0.72) / 0.28 * 0.12;
      group.scale.setScalar(scale);
      group.position.y = Math.sin(p * PI) * 0.3;
      if (enemy.spawnT <= 0) {
        group.scale.setScalar(1);
        group.position.y = 0;
      }
      continue;
    }

    enemy.attackCd -= dt;
    enemy.fireCd -= dt;
    enemy.flash = Math.max(0, enemy.flash - dt);
    const bob = Math.sin(game.time * (enemy.type === 'spitter' ? 2.4 : 4.2) + enemy.bob);
    if (enemy.type === 'spitter') {
      group.position.y = 0.22 + bob * 0.12;
    } else {
      group.position.y = 0;
    }

    let targetPos;
    const distToPlayer = Math.hypot(player.pos.x - group.position.x, player.pos.z - group.position.z);
    if (enemy.type === 'boss') enemy.aggro = 'core';
    else if (distToPlayer < 7 && enemy.type !== 'spitter') enemy.aggro = 'player';
    if (player.health <= 0) enemy.aggro = 'core';
    if (enemy.aggro === 'player') targetPos = tempVec.set(player.pos.x, 0, player.pos.z);
    else targetPos = tempVec.set(0, 0, 0);

    const dx = targetPos.x - group.position.x;
    const dz = targetPos.z - group.position.z;
    const distance = Math.hypot(dx, dz) || 1;
    const dirX = dx / distance;
    const dirZ = dz / distance;
    group.rotation.y = angleDamp(group.rotation.y, Math.atan2(-dirX, -dirZ), 8, dt);

    const isRanged = enemy.type === 'spitter';
    const targetCore = enemy.aggro !== 'player';
    const stopDistance = isRanged ? 11.5 : targetCore ? 6.15 : 1.45;

    if (isRanged) {
      if (distance > stopDistance + 1.2) {
        moveEnemy(enemy, dirX, dirZ, dt, 1);
      } else if (distance < stopDistance - 2.2) {
        moveEnemy(enemy, -dirX, -dirZ, dt, 0.55);
      } else {
        enemy.strafeTimer -= dt;
        if (enemy.strafeTimer < 0) {
          enemy.strafeTimer = 1.6 + Math.random() * 2.4;
          enemy.strafe *= -1;
        }
        moveEnemy(enemy, -dirZ * enemy.strafe, dirX * enemy.strafe, dt, 0.35);
      }
      if (enemy.fireCd <= 0) {
        enemy.fireCd = enemy.stats.attackInterval * (0.8 + Math.random() * 0.35);
        fireEnemyProjectile(enemy);
      }
    } else if (distance > stopDistance) {
      moveEnemy(enemy, dirX, dirZ, dt, 1);
    }

    // Wall blocking & attacks.
    const blocked = findBlockingWall(group.position.x, group.position.z, enemy.radius + 0.1, group.position.y);
    if (blocked) {
      enemy.attacking = blocked;
      if (enemy.attackCd <= 0) {
        enemy.attackCd = enemy.attackInterval;
        damageBuild(blocked, enemy.damage * 1.7);
        effects.emit(new THREE.Vector3(group.position.x, 1.2, group.position.z), '#ff9bb6', 6, { speed: 2, life: 0.3, size: 0.1 });
        audio.shieldHit();
      }
    } else if (targetCore && distance < stopDistance + 0.35) {
      if (enemy.attackCd <= 0) {
        enemy.attackCd = enemy.attackInterval;
        damageCore(enemy.damage * 0.85);
        effects.ring(new THREE.Vector3(0, 0.7, 0), '#ff5c73', 6.5, 0.45);
        audio.shieldHit();
      }
    } else if (!targetCore && distToPlayer < 1.8) {
      if (enemy.attackCd <= 0) {
        enemy.attackCd = enemy.attackInterval;
        damagePlayer(enemy.damage);
        effects.emit(tempVec.set(player.pos.x, 1, player.pos.z), '#ff6c8b', 8, { speed: 3.5, life: 0.4, size: 0.12 });
        audio.damage();
      }
    }

    // Enemy limb animation.
    const movingSpeed = enemy.attacking || distance < stopDistance ? 0.4 : 1;
    const walk = game.time * 7.2 + enemy.bob;
    if (enemy.model.leftLeg) enemy.model.leftLeg.rotation.x = Math.sin(walk) * 0.5 * movingSpeed;
    if (enemy.model.rightLeg) enemy.model.rightLeg.rotation.x = -Math.sin(walk) * 0.5 * movingSpeed;
    if (enemy.model.leftArm) enemy.model.leftArm.rotation.x = -Math.sin(walk) * 0.34 * movingSpeed;
    if (enemy.model.rightArm) enemy.model.rightArm.rotation.x = Math.sin(walk) * 0.34 * movingSpeed;
    if (enemy.model.torso) {
      enemy.model.torso.rotation.z = Math.sin(walk * 0.5) * 0.035;
      enemy.model.torso.rotation.x = enemy.attacking ? -0.14 : 0;
    }
    for (const floater of enemy.model.floaters) {
      if (!floater.mesh) continue;
      floater.mesh.rotation[floater.axis] += dt * floater.speed;
    }
    if (enemy.attacking) enemy.attacking = null;

    const ratio = clamp(enemy.health / enemy.maxHealth, 0, 1);
    enemy.model.healthFill.scale.x = Math.max(0.001, enemy.model.healthBarWidth * ratio);
    enemy.model.healthFill.material.color.set(ratio > 0.5 ? '#ff5c9b' : ratio > 0.25 ? '#ffbf69' : '#ff4b56');
    enemy.model.healthBar.visible = ratio < 0.999;

    // Keep all enemies on the island.
    const r = Math.hypot(group.position.x, group.position.z);
    if (r > PLAY_RADIUS - 1.5) {
      group.position.x *= (PLAY_RADIUS - 1.5) / r;
      group.position.z *= (PLAY_RADIUS - 1.5) / r;
    }
  }
}

function moveEnemy(enemy, dirX, dirZ, dt, speedScale) {
  const group = enemy.model.group;
  const step = enemy.speed * speedScale * dt;
  const nx = group.position.x + dirX * step;
  const nz = group.position.z + dirZ * step;
  if (findBlockingWall(nx, nz, enemy.radius, group.position.y)) {
    return false;
  }
  group.position.x = nx;
  group.position.z = nz;
  return true;
}

function findBlockingWall(x, z, radius, feetY) {
  for (const build of game.builds) {
    if (build.dead || build.piece !== 'wall') continue;
    if (feetY < build.bounds.maxY - 0.06 && feetY + 2 > build.bounds.minY) {
      if (circleIntersectsBounds(x, z, radius, build.bounds)) return build;
    }
  }
  return null;
}

function fireEnemyProjectile(enemy) {
  const origin = enemy.model.group.position.clone();
  origin.y += enemy.type === 'boss' ? 2.1 : 1.35;
  const target = enemy.aggro === 'player'
    ? new THREE.Vector3(player.pos.x, player.pos.y + 1.0, player.pos.z)
    : new THREE.Vector3(0, 1.7, 0);
  const dir = target.clone().sub(origin).normalize();
  const count = enemy.type === 'boss' ? 3 : 1;
  for (let i = 0; i < count; i++) {
    const spread = (i - (count - 1) / 2) * 0.16;
    const rotated = dir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), spread);
    spawnProjectile(origin, rotated, enemy.type === 'boss' ? 16 : 8, enemy.type === 'boss' ? 0.22 : 0.14, enemy.type === 'boss' ? '#ffbf69' : '#d38aff');
  }
  audio.tone({ freq: 330, freqEnd: 140, type: 'sawtooth', duration: 0.2, volume: 0.035 });
}

function spawnProjectile(origin, dir, damage, radius, color) {
  const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 2.4, roughness: 0.2, metalness: 0.2 });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 8, 7), mat);
  mesh.position.copy(origin);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: world.glows,
    color,
    transparent: true,
    opacity: 0.75,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  }));
  glow.scale.setScalar(radius * 7);
  mesh.add(glow);
  scene.add(mesh);
  game.projectiles.push({
    mesh,
    velocity: dir.clone().multiplyScalar(13.5),
    damage,
    radius,
    life: 5.5,
    coreDamage: damage * 1.2
  });
}

function updateProjectiles(dt) {
  for (let i = game.projectiles.length - 1; i >= 0; i--) {
    const projectile = game.projectiles[i];
    projectile.life -= dt;
    const mesh = projectile.mesh;
    mesh.position.addScaledVector(projectile.velocity, dt);
    mesh.rotation.x += dt * 6;
    mesh.rotation.y += dt * 4;
    effects.emitTrail(mesh.position, '#d287ff', 1, 0.11);

    let remove = projectile.life <= 0;
    if (mesh.position.y < 0.1 && mesh.position.y > -2) {
      effects.emit(mesh.position, '#d28cff', 12, { speed: 3, life: 0.35, size: 0.12, gravity: 5 });
      remove = true;
    }
    if (!remove && Math.hypot(mesh.position.x - player.pos.x, mesh.position.z - player.pos.z) < 0.72 &&
        Math.abs(mesh.position.y - (player.pos.y + 1)) < 0.9) {
      damagePlayer(projectile.damage);
      effects.emit(mesh.position, '#ff6d92', 13, { speed: 3, life: 0.4, size: 0.14 });
      remove = true;
    }
    if (!remove && Math.hypot(mesh.position.x, mesh.position.z) < 4.8 && mesh.position.y < 5.4 && mesh.position.y > 0.5) {
      damageCore(projectile.coreDamage);
      effects.emit(mesh.position, '#ff819d', 15, { speed: 3, life: 0.4, size: 0.14 });
      remove = true;
    }
    if (!remove) {
      for (const build of game.builds) {
        if (build.dead || build.piece !== 'wall') continue;
        const b = build.bounds;
        if (mesh.position.x > b.minX - 0.2 && mesh.position.x < b.maxX + 0.2 &&
            mesh.position.z > b.minZ - 0.2 && mesh.position.z < b.maxZ + 0.2 &&
            mesh.position.y > b.minY && mesh.position.y < b.maxY) {
          damageBuild(build, projectile.damage);
          effects.emit(mesh.position, '#cd92ff', 12, { speed: 2.5, life: 0.35, size: 0.12 });
          remove = true;
          break;
        }
      }
    }
    if (remove) {
      scene.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
      game.projectiles.splice(i, 1);
    }
  }
}

function clearProjectiles() {
  for (const p of game.projectiles) {
    scene.remove(p.mesh);
    p.mesh.geometry.dispose();
    p.mesh.material.dispose();
  }
  game.projectiles.length = 0;
}

function damageEnemy(enemy, amount, point) {
  if (enemy.dead) return;
  enemy.health -= amount;
  enemy.flash = 0.12;
  enemy.model.root.scale.setScalar(enemy.model.scale * 1.035);
  setTimeout(() => {
    if (!enemy.dead) enemy.model.root.scale.setScalar(enemy.model.scale);
  }, 55);
  hitMarker();
  audio.hit();
  effects.emit(point, '#ff9ac0', 7, { speed: 3.2, life: 0.35, size: 0.13, gravity: 2 });
  effects.flash(point, '#ff8cb6', 1.0, 0.1);
  game.score += 2;
  if (enemy.health <= 0) {
    enemy.dead = true;
    killEnemy(enemy, point);
  } else if (Math.random() < 0.28) {
    enemy.aggro = 'player';
  }
}

function killEnemy(enemy, point) {
  const pos = enemy.model.group.position.clone();
  pos.y += enemy.type === 'boss' ? 2.2 : 1.2;
  effects.emit(pos, enemy.type === 'boss' ? '#ffbf69' : '#ff6fa4', enemy.type === 'boss' ? 70 : 30, {
    speed: enemy.type === 'boss' ? 10 : 6.5,
    life: enemy.type === 'boss' ? 1.3 : 0.8,
    size: enemy.type === 'boss' ? 0.32 : 0.22,
    gravity: 7
  });
  effects.ring(new THREE.Vector3(pos.x, 0.3, pos.z), enemy.type === 'boss' ? '#ffbf69' : '#ff77af', enemy.type === 'boss' ? 12 : 4, 0.7);
  effects.flash(pos, enemy.type === 'boss' ? '#ffe0a3' : '#ffb0c9', enemy.type === 'boss' ? 5 : 1.7, 0.25);
  audio.crit();
  game.kills++;
  game.score += enemy.stats.score;

  const dropType = ['wood', 'stone', 'metal'][Math.floor(Math.random() * 3)];
  const amount = enemy.type === 'boss' ? 90 : enemy.type === 'brute' ? 25 : 7;
  game.materials[dropType] = Math.min(999, game.materials[dropType] + amount);
  game.harvest += amount;
  pickupGain(dropType, amount);

  if (enemy.type === 'boss') {
    game.shake = 0.65;
    makeSkyFlash(world, 1.4);
    showToast('RIFT WARDEN ELIMINATED — THE STORM BREAKS', false, 3200);
  }
  removeEnemy(enemy, true);
}

function removeEnemy(enemy, alreadyDead = false) {
  if (enemy.removed) return;
  enemy.removed = true;
  scene.remove(enemy.model.group);
  disposeObject(enemy.model.group);
  const idx = game.enemies.indexOf(enemy);
  if (idx >= 0) game.enemies.splice(idx, 1);
  const pidx = enemyProxies.indexOf(enemy.proxy);
  if (pidx >= 0) enemyProxies.splice(pidx, 1);
}

function clearEnemies() {
  for (const enemy of game.enemies) {
    scene.remove(enemy.model.group);
    disposeObject(enemy.model.group);
  }
  game.enemies.length = 0;
  enemyProxies.length = 0;
}

function hitMarker() {
  el.crosshair.classList.remove('hit');
  void el.crosshair.offsetWidth;
  el.crosshair.classList.add('hit');
}

// ---------- Player damage ----------
function damagePlayer(amount) {
  if (game.phase === 'victory' || game.phase === 'defeat') return;
  player.health -= amount;
  game.lastDamageAt = game.time;
  player.hurtTilt = 1;
  game.shake = Math.max(game.shake, 0.28);
  damageFlash();
  audio.damage();
  if (player.health <= 0) {
    player.health = 0;
    updateHud();
    finishRun(false);
  }
}

function damageCore(amount) {
  if (game.phase !== 'wave') return;
  game.coreHealth = Math.max(0, game.coreHealth - amount);
  world.core.setHealth(game.coreHealth / game.maxCoreHealth);
  if (game.coreHealth <= 0) {
    finishRun(false);
  }
}

// ---------- Player movement & camera ----------
function updatePlayer(dt) {
  if (!['prep', 'wave', 'cleared'].includes(game.phase) || game.paused) return;

  let inputX = joystick.x;
  let inputY = joystick.y;
  if (keys.has('w') || keys.has('arrowup')) inputY += 1;
  if (keys.has('s') || keys.has('arrowdown')) inputY -= 1;
  if (keys.has('d') || keys.has('arrowright')) inputX += 1;
  if (keys.has('a') || keys.has('arrowleft')) inputX -= 1;

  const inputLength = Math.hypot(inputX, inputY);
  if (inputLength > 1) {
    inputX /= inputLength;
    inputY /= inputLength;
  }

  const forward = tempVec.set(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
  const right = tempVec2.set(Math.cos(player.yaw), 0, -Math.sin(player.yaw));
  const wishX = forward.x * inputY + right.x * inputX;
  const wishZ = forward.z * inputY + right.z * inputX;
  const wishLength = Math.hypot(wishX, wishZ);
  const speed = (game.buildMode ? 6.5 : 7.25) * (player.grounded ? 1 : 0.82);
  const targetX = wishLength > 0.001 ? wishX / Math.max(1, wishLength) * speed : 0;
  const targetZ = wishLength > 0.001 ? wishZ / Math.max(1, wishLength) * speed : 0;

  player.vel.x = damp(player.vel.x, targetX, player.grounded ? 16 : 6, dt);
  player.vel.z = damp(player.vel.z, targetZ, player.grounded ? 16 : 6, dt);
  player.vel.y -= 24 * dt;

  player.pos.x += player.vel.x * dt;
  player.pos.z += player.vel.z * dt;
  player.pos.y += player.vel.y * dt;

  resolvePlayerWallCollisions();

  // The core platform is solid; orbit it rather than clipping through.
  const coreDist = Math.hypot(player.pos.x, player.pos.z);
  if (coreDist < 5.25) {
    const nx = coreDist ? player.pos.x / coreDist : 1;
    const nz = coreDist ? player.pos.z / coreDist : 0;
    player.pos.x = nx * 5.25;
    player.pos.z = nz * 5.25;
  }

  // Keep the player on the island.
  const radius = Math.hypot(player.pos.x, player.pos.z);
  if (radius > PLAY_RADIUS - 0.8) {
    player.pos.x *= (PLAY_RADIUS - 0.8) / radius;
    player.pos.z *= (PLAY_RADIUS - 0.8) / radius;
  }

  const ground = surfaceHeightAt(player.pos.x, player.pos.z, player.pos.y + 0.25);
  if (player.pos.y <= ground + 0.03 && player.vel.y <= 0) {
    player.pos.y = ground;
    player.vel.y = 0;
    player.grounded = true;
  } else {
    player.grounded = false;
  }
  if (player.pos.y < 0) {
    player.pos.y = 0;
    player.vel.y = 0;
    player.grounded = true;
  }

  world.player.group.position.copy(player.pos);
  world.player.group.rotation.y = angleDamp(world.player.group.rotation.y, player.yaw, 14, dt);
  world.player.group.rotation.z = damp(world.player.group.rotation.z, -inputX * 0.065, 9, dt);

  // Animate runner.
  const planarSpeed = Math.hypot(player.vel.x, player.vel.z);
  player.walkPhase += dt * (4.6 + planarSpeed * 1.05);
  const stride = Math.min(1, planarSpeed / 6.5);
  world.player.leftLeg.rotation.x = Math.sin(player.walkPhase) * 0.62 * stride;
  world.player.rightLeg.rotation.x = -Math.sin(player.walkPhase) * 0.62 * stride;
  world.player.leftArm.rotation.x = -Math.sin(player.walkPhase) * 0.42 * stride;
  player.recoil = Math.max(0, player.recoil - dt * 9);
  world.player.gun.position.z = -0.22 + player.recoil * 0.12;
  world.player.gun.rotation.x = -player.recoil * 0.14;
  world.player.visor.material.emissiveIntensity = 1.45 + Math.sin(game.time * 3) * 0.16;
  world.player.shadow.position.y = -player.pos.y + 0.028;
  world.player.shadow.scale.setScalar(clamp(1 - (player.pos.y - 0.1) * 0.04, 0.65, 1));

  player.hurtTilt = Math.max(0, player.hurtTilt - dt * 3.2);
  world.player.group.rotation.z += player.hurtTilt * 0.05;

  // Health slowly recovers during downtime, never mid-firefight.
  if (game.time - game.lastDamageAt > 6.5 && player.health > 0 && player.health < player.maxHealth) {
    player.health = Math.min(player.maxHealth, player.health + dt * 2.3);
  }
}

function resolvePlayerWallCollisions() {
  for (let pass = 0; pass < 2; pass++) {
    for (const build of game.builds) {
      if (build.dead || build.piece !== 'wall') continue;
      const b = build.bounds;
      if (player.pos.y >= b.maxY - 0.05 || player.pos.y + 1.65 <= b.minY) continue;
      const nx = clamp(player.pos.x, b.minX, b.maxX);
      const nz = clamp(player.pos.z, b.minZ, b.maxZ);
      let dx = player.pos.x - nx;
      let dz = player.pos.z - nz;
      const d2 = dx * dx + dz * dz;
      const r = 0.48;
      if (d2 >= r * r) continue;
      if (d2 > 0.00001) {
        const d = Math.sqrt(d2);
        player.pos.x = nx + (dx / d) * r;
        player.pos.z = nz + (dz / d) * r;
      } else {
        const left = Math.abs(player.pos.x - b.minX);
        const right = Math.abs(b.maxX - player.pos.x);
        const front = Math.abs(player.pos.z - b.minZ);
        const back = Math.abs(b.maxZ - player.pos.z);
        const min = Math.min(left, right, front, back);
        if (min === left) player.pos.x = b.minX - r;
        else if (min === right) player.pos.x = b.maxX + r;
        else if (min === front) player.pos.z = b.minZ - r;
        else player.pos.z = b.maxZ + r;
      }
    }
  }
}

function surfaceHeightAt(x, z, feetY) {
  let height = 0;
  for (const build of game.builds) {
    if (build.dead) continue;
    if (build.piece === 'floor') {
      if (x > build.bounds.minX && x < build.bounds.maxX && z > build.bounds.minZ && z < build.bounds.maxZ) {
        const top = build.level + 0.2;
        if (top <= feetY + 0.82 && top > height) height = top;
      }
    } else if (build.piece === 'ramp') {
      const relX = x - build.center.x;
      const relZ = z - build.center.z;
      const along = relX * build.forward.x + relZ * build.forward.z;
      const lateral = relX * build.right.x + relZ * build.right.z;
      if (Math.abs(lateral) < 1.95 && along > -2 && along < 2) {
        const t = (along + 2) / 4;
        const rampY = build.level + t * FLOOR_HEIGHT;
        if (rampY <= feetY + 0.86 && rampY > height) height = rampY;
      }
    }
  }
  return height;
}

function updateCamera(dt, snap = false) {
  const forward = cameraForward(new THREE.Vector3());
  const right = tempVec2.set(Math.cos(player.yaw), 0, -Math.sin(player.yaw));
  const focus = new THREE.Vector3(player.pos.x, player.pos.y + 1.5, player.pos.z);
  let desired = focus.clone()
    .addScaledVector(forward, -6.25)
    .addScaledVector(right, 0.52);
  desired.y += 0.37;

  // Pull the camera in when a wall is behind the player.
  if (game.builds.length) {
    const dir = desired.clone().sub(focus);
    const dist = dir.length();
    if (dist > 0.2) {
      dir.normalize();
      raycaster.set(focus, dir);
      raycaster.far = dist;
      const hits = raycaster.intersectObjects(buildTargets, false);
      if (hits.length && hits[0].distance < dist) {
        desired.copy(focus).addScaledVector(dir, Math.max(1.2, hits[0].distance - 0.24));
        desired.y += 0.15;
      }
    }
  }
  desired.y = Math.max(desired.y, player.pos.y + 0.58);

  const posAlpha = snap ? 1 : game.intro > 0 ? 1 - Math.exp(-dt * 4.4) : 1 - Math.exp(-dt * 12.5);
  camera.position.lerp(desired, posAlpha);
  if (game.intro > 0) game.intro = Math.max(0, game.intro - dt);

  if (game.shake > 0.001) {
    const amount = game.shake * 0.17;
    camera.position.x += (Math.random() - 0.5) * amount;
    camera.position.y += (Math.random() - 0.5) * amount * 0.6;
    camera.position.z += (Math.random() - 0.5) * amount;
    game.shake = Math.max(0, game.shake - dt * 2.2);
  }

  const lookTarget = camera.position.clone().addScaledVector(forward, 28);
  camera.lookAt(lookTarget);
  const targetFov = window.innerHeight > window.innerWidth * 1.15 ? 68 : window.innerWidth < 700 ? 64 : 61;
  if (Math.abs(camera.fov - targetFov) > 0.02) {
    camera.fov = damp(camera.fov, targetFov, 6, dt);
    camera.updateProjectionMatrix();
  }
}

// ---------- Ambient resources & structures ----------
function updateResources(dt) {
  for (const node of world.resources) {
    if (!node.active && game.time >= node.respawnAt) {
      node.active = true;
      node.hp = node.maxHp;
      node.group.visible = true;
      node.group.scale.setScalar(0.01);
      node.spawnAnim = 0;
      effects.ring(new THREE.Vector3(node.home.x, 0.2, node.home.z), node.type === 'wood' ? '#ffc477' : node.type === 'stone' ? '#ff8bd2' : '#61fff3', 3, 0.55);
    }
    if (node.active && node.spawnAnim !== undefined && node.spawnAnim < 0.45) {
      node.spawnAnim += dt;
      const t = clamp(node.spawnAnim / 0.45, 0, 1);
      const scale = t < 0.8 ? t / 0.8 : 0.8 + (t - 0.8) / 0.2 * 0.2;
      node.group.scale.setScalar(scale);
    }
    if (node.active && node.marker) {
      node.marker.rotation.z += dt * 0.2;
    }
  }
}

function updateBuilds(dt) {
  for (let i = game.buildAnims.length - 1; i >= 0; i--) {
    const build = game.buildAnims[i];
    build.anim += dt;
    const t = clamp(build.anim / 0.22, 0, 1);
    const overshoot = t < 0.82 ? t / 0.82 : 0.82 + Math.sin((t - 0.82) / 0.18 * PI * 0.5) * 0.18;
    build.group.scale.setScalar(overshoot);
    if (build.anim >= 0.28) {
      build.group.scale.setScalar(1);
      if (i >= 0) game.buildAnims.splice(i, 1);
    }
  }
  for (const build of game.builds) {
    if (build.flash > 0) build.flash -= dt;
    if (build.mainMaterial) {
      const flash = clamp(build.flash / 0.12, 0, 1);
      build.mainMaterial.emissive.setRGB(flash * 0.85, flash * 0.25, flash * 0.35);
    }
  }
}

function updateTutorial(dt) {
  if (game.phase !== 'prep' || game.wave !== 1) return;
  game.tutorialTime += dt;
  if (game.tutorialStage === 0 && game.tutorialTime > 4.8) {
    game.tutorialStage = 1;
    showHint('AIM AT GLOWING RESOURCES AND FIRE TO HARVEST');
  } else if (game.tutorialStage === 1 && game.tutorialTime > 9.4) {
    game.tutorialStage = 2;
    if (!game.buildMode) showHint('OPEN BUILD • RAISE WALLS AROUND THE RIFT CORE');
  } else if (game.tutorialStage === 2 && game.tutorialTime > 14.2) {
    game.tutorialStage = 3;
    if (!game.buildMode) showHint('HOLD PLACE TO TURBO-BUILD • PROTECT THE CORE');
  }
}

// ---------- Game update ----------
function updateGame(dt) {
  if (!['prep', 'wave', 'cleared'].includes(game.phase)) return;
  game.time += dt;
  game.elapsed += dt;

  game.fireCooldown = Math.max(0, game.fireCooldown - dt);
  game.placeCooldown = Math.max(0, game.placeCooldown - dt);

  if (game.phase === 'prep') {
    game.prepTimer -= dt;
    updateTutorial(dt);
    if (game.prepTimer <= 0) startWave(game.wave);
  } else if (game.phase === 'wave') {
    updateWave(dt);
  } else if (game.phase === 'cleared') {
    game.clearTimer -= dt;
    if (game.clearTimer <= 0) startPrep(game.wave + 1);
  }

  updatePlayer(dt);
  updateCamera(dt);
  updateResources(dt);
  updateBuilds(dt);
  updateEnemies(dt);
  updateProjectiles(dt);

  if (game.buildMode) {
    updateGhost();
    if (game.placeHeld && game.placeCooldown <= 0) {
      attemptBuild(true);
      game.placeCooldown = 0.26;
    }
  } else if (game.fireHeld) {
    shoot();
  }

  if (game.bannerTimer > 0) {
    game.bannerTimer -= dt;
    if (game.bannerTimer <= 0) hideBanner();
  }

  if (game.phase === 'wave' && game.enemies.length === 0 && game.pending.length === 0 && !game.waveResolving) {
    // Safety net in case a wave was cleared during a phase transition.
    game.waveResolving = true;
    game.resolveTimer = 0.7;
  }
  if (game.waveResolving && game.phase === 'wave') {
    game.resolveTimer -= dt;
    if (game.resolveTimer <= 0) {
      game.waveResolving = false;
      completeWave();
    }
  }

  updateHud();
}

// ---------- Render loop ----------
let lastFrame = performance.now();
let worldTime = 0;
let firstFrame = true;

function animate(now) {
  requestAnimationFrame(animate);
  const dt = Math.min(0.075, Math.max(0.001, (now - lastFrame) / 1000));
  lastFrame = now;
  worldTime += dt;
  frameCount++;

  if (game.phase === 'menu') {
    world.update(dt, worldTime);
    world.menuCamera(worldTime);
    effects.update(dt);
  } else if (game.paused) {
    world.update(dt * 0.12, worldTime);
    effects.update(dt * 0.5);
  } else if (['prep', 'wave', 'cleared'].includes(game.phase)) {
    world.update(dt, worldTime);
    updateGame(dt);
    effects.update(dt);
  } else {
    world.update(dt * 0.55, worldTime);
    effects.update(dt);
  }

  renderer.render(scene, camera);

  if (firstFrame) {
    firstFrame = false;
    setTimeout(() => el.loading.classList.add('gone'), 160);
  }
}

function resize() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.65));
  renderer.setSize(width, height);
  camera.aspect = width / height;
  camera.fov = height > width * 1.15 ? 68 : width < 700 ? 64 : 61;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 160));

document.addEventListener('visibilitychange', () => {
  if (document.hidden && ['prep', 'wave', 'cleared'].includes(game.phase) && !game.paused) togglePause(true);
});

window.addEventListener('contextmenu', (event) => event.preventDefault());

// Initial presentation.
resize();
rebuildGhost();
world.menuCamera(0);
updateHud(true);

// Tiny test/debug handle, useful for deterministic screenshots and QA.
window.__riftwright = {
  game,
  player,
  world,
  renderer,
  scene,
  camera,
  beginRun,
  startWave,
  spawnEnemy,
  attemptBuild,
  toggleBuildMode,
  selectPiece,
  updateCamera,
  setPiece: (piece) => selectPiece(piece),
  setMaterial: (material) => {
    game.material = material;
    document.querySelectorAll('.mat-btn').forEach((b) => b.classList.toggle('selected', b.dataset.mat === material));
    rebuildGhost();
  },
  spawnTestWave: () => {
    game.phase = 'prep';
    game.prepTimer = 999;
    startWave(1);
  }
};

requestAnimationFrame((time) => {
  lastFrame = time;
  animate(time);
});



