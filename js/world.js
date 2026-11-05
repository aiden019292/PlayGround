import * as THREE from 'three';

const PI = Math.PI;
const TAU = Math.PI * 2;
const UP = new THREE.Vector3(0, 1, 0);
let sharedEnemyGlow = null;

function mulberry32(seed) {
  return function () {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function makeGlowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.18, 'rgba(255,255,255,.9)');
  g.addColorStop(0.5, 'rgba(255,255,255,.22)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}

function makeGridTexture() {
  const size = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  const bg = ctx.createRadialGradient(512, 512, 30, 512, 512, 560);
  bg.addColorStop(0, '#26294a');
  bg.addColorStop(0.55, '#1c203d');
  bg.addColorStop(0.88, '#14172e');
  bg.addColorStop(1, '#0d1022');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);

  const rand = mulberry32(44);
  for (let i = 0; i < 900; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = rand() * 2.2;
    ctx.fillStyle = `rgba(${110 + rand() * 60},${130 + rand() * 45},${180 + rand() * 50},${0.025 + rand() * 0.055})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
  }

  // Subtle build-grid pattern, brighter near the middle.
  for (let i = 0; i <= 16; i++) {
    const p = (i / 16) * size;
    const major = i % 4 === 0;
    ctx.strokeStyle = major ? 'rgba(91,239,229,.16)' : 'rgba(115,164,200,.075)';
    ctx.lineWidth = major ? 2 : 1;
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, size);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, p);
    ctx.lineTo(size, p);
    ctx.stroke();
  }

  const vignette = ctx.createRadialGradient(512, 512, 180, 512, 512, 520);
  vignette.addColorStop(0, 'rgba(3,6,18,0)');
  vignette.addColorStop(0.74, 'rgba(3,6,18,.15)');
  vignette.addColorStop(1, 'rgba(3,6,18,.72)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

const skyVertex = `
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const skyFragment = `
  varying vec3 vDir;
  uniform float uTime;
  uniform float uFlash;
  uniform vec3 uTop;
  uniform vec3 uHorizon;
  uniform vec3 uGlow;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  void main() {
    vec3 d = normalize(vDir);
    float h = clamp(d.y * 0.5 + 0.5, 0.0, 1.0);
    float horizonMix = smoothstep(0.42, 0.0, abs(d.y));
    vec3 col = mix(uHorizon, uTop, smoothstep(0.48, 1.0, h));
    col = mix(col, uGlow, horizonMix * 0.3);

    // Cheap, wide aurora ribbons.
    float az = atan(d.z, d.x);
    float ribbon = sin(az * 3.0 + d.y * 10.0 + uTime * 0.035);
    ribbon += sin(az * 5.0 - d.y * 7.0 - uTime * 0.021) * 0.55;
    ribbon = smoothstep(0.72, 1.45, ribbon) * smoothstep(0.02, 0.34, d.y) * smoothstep(0.85, 0.36, d.y);
    col += mix(vec3(0.03, 0.25, 0.32), vec3(0.28, 0.05, 0.24), smoothstep(0.0, 0.8, ribbon)) * ribbon * 0.22;

    // Static star field with a subtle twinkle.
    vec2 sp = floor(d.xz * 250.0);
    float star = step(0.9965, hash(sp)) * smoothstep(0.48, 0.82, h);
    float twinkle = 0.68 + 0.32 * sin(uTime * 1.4 + hash(sp) * 21.0);
    col += vec3(0.66, 0.9, 1.0) * star * twinkle * 0.8;

    // Soft lower cloud haze.
    float haze = smoothstep(0.35, 0.0, abs(d.y + 0.02));
    col = mix(col, vec3(0.19, 0.11, 0.26), haze * 0.2);

    col += uFlash * vec3(0.23, 0.48, 0.58);
    gl_FragColor = vec4(col, 1.0);
  }
`;

export function createWorld(scene, renderer) {
  const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 420);
  const glows = makeGlowTexture();
  const rand = mulberry32(7713);
  const animated = [];
  const skyUniforms = {
    uTime: { value: 0 },
    uFlash: { value: 0 },
    uTop: { value: new THREE.Color('#070b27') },
    uHorizon: { value: new THREE.Color('#3d3561') },
    uGlow: { value: new THREE.Color('#ba5d81') }
  };

  scene.background = new THREE.Color('#090c22');
  scene.fog = new THREE.FogExp2('#232044', 0.0095);

  // ---------- Sky & distant world ----------
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(300, 24, 16),
    new THREE.ShaderMaterial({
      uniforms: skyUniforms,
      vertexShader: skyVertex,
      fragmentShader: skyFragment,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false
    })
  );
  sky.renderOrder = -100;
  scene.add(sky);

  const distantRift = new THREE.Group();
  distantRift.position.set(-58, 48, -145);
  distantRift.rotation.z = -0.2;
  const riftOuter = new THREE.Mesh(
    new THREE.TorusGeometry(22, 1.1, 8, 80),
    new THREE.MeshBasicMaterial({ color: '#e8659a', transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })
  );
  const riftInner = new THREE.Mesh(
    new THREE.TorusGeometry(19.8, 0.35, 6, 80),
    new THREE.MeshBasicMaterial({ color: '#7ffbf2', transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })
  );
  const riftCore = new THREE.Mesh(
    new THREE.CircleGeometry(19.2, 64),
    new THREE.MeshBasicMaterial({ color: '#4b1c59', transparent: true, opacity: 0.38, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })
  );
  riftCore.position.z = -0.5;
  distantRift.add(riftCore, riftOuter, riftInner);
  scene.add(distantRift);
  animated.push((t) => {
    distantRift.rotation.z = -0.2 + Math.sin(t * 0.07) * 0.05;
    riftOuter.material.opacity = 0.45 + Math.sin(t * 0.9) * 0.08;
    riftInner.material.opacity = 0.58 + Math.sin(t * 1.2 + 2) * 0.1;
  });

  // Far-off monolith arch.
  const arch = new THREE.Group();
  const archMat = new THREE.MeshStandardMaterial({ color: '#161a37', roughness: 0.9, flatShading: true, fog: true });
  const pillarGeo = new THREE.CylinderGeometry(1.5, 3.5, 30, 5, 1);
  const leftPillar = new THREE.Mesh(pillarGeo, archMat);
  leftPillar.position.set(-17, 0, 0);
  leftPillar.rotation.z = 0.05;
  const rightPillar = leftPillar.clone();
  rightPillar.position.x = 17;
  rightPillar.rotation.z = -0.03;
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(38, 4, 4), archMat);
  lintel.position.y = 14;
  lintel.rotation.z = 0.018;
  arch.add(leftPillar, rightPillar, lintel);
  arch.position.set(62, -6, -95);
  arch.rotation.y = -0.3;
  scene.add(arch);

  const islands = new THREE.Group();
  scene.add(islands);
  const rockPalette = [new THREE.MeshStandardMaterial({ color: '#1c1b36', roughness: 0.95, flatShading: true }), new THREE.MeshStandardMaterial({ color: '#24203d', roughness: 0.88, flatShading: true })];
  for (let i = 0; i < 10; i++) {
    const angle = (i / 10) * TAU + rand() * 0.35;
    const radius = 66 + rand() * 52;
    const group = new THREE.Group();
    group.position.set(Math.cos(angle) * radius, -10 + rand() * 32, Math.sin(angle) * radius);
    const size = 5 + rand() * 11;
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(size, size * 0.9, 2.5, 7, 1), rockPalette[i % 2]);
    cap.position.y = 0;
    const bottom = new THREE.Mesh(new THREE.ConeGeometry(size * 0.85, size * (1.5 + rand()), 7, 2), rockPalette[(i + 1) % 2]);
    bottom.rotation.z = PI;
    bottom.position.y = -size * (0.75 + rand() * 0.3);
    group.add(cap, bottom);
    for (let j = 0; j < 3; j++) {
      const shard = new THREE.Mesh(
        new THREE.ConeGeometry(0.45 + rand() * 0.6, 1.6 + rand() * 3.2, 4),
        new THREE.MeshStandardMaterial({ color: j === 0 ? '#7be7de' : '#493c72', emissive: j === 0 ? '#164c58' : '#100a2a', roughness: 0.5, flatShading: true })
      );
      shard.position.set((rand() - 0.5) * size, 1.5 + rand() * 2.4, (rand() - 0.5) * size);
      shard.rotation.z = (rand() - 0.5) * 0.4;
      group.add(shard);
    }
    group.userData.baseY = group.position.y;
    group.userData.phase = rand() * TAU;
    islands.add(group);
    animated.push((t) => {
      group.position.y = group.userData.baseY + Math.sin(t * 0.22 + group.userData.phase) * 1.2;
      group.rotation.y += 0.00018;
    });
  }

  // ---------- Lighting ----------
  const hemi = new THREE.HemisphereLight('#8bbdda', '#22162e', 1.3);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight('#ffc8a1', 2.35);
  sun.position.set(-24, 38, 20);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -34;
  sun.shadow.camera.right = 34;
  sun.shadow.camera.top = 34;
  sun.shadow.camera.bottom = -34;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 90;
  sun.shadow.bias = -0.0007;
  sun.shadow.normalBias = 0.025;
  scene.add(sun);

  const fill = new THREE.DirectionalLight('#5d80ff', 0.65);
  fill.position.set(22, 12, -25);
  scene.add(fill);

  const stormLight = new THREE.PointLight('#e85f9e', 38, 105, 1.6);
  stormLight.position.set(-68, 42, -128);
  scene.add(stormLight);

  // ---------- Island ----------
  const island = new THREE.Group();
  scene.add(island);

  const gridTexture = makeGridTexture();
  const groundMaterial = new THREE.MeshStandardMaterial({
    color: '#ffffff',
    map: gridTexture,
    roughness: 0.92,
    metalness: 0.04
  });
  const cliffMaterial = new THREE.MeshStandardMaterial({
    color: '#26233f',
    roughness: 0.97,
    metalness: 0.02,
    flatShading: true
  });
  const deepMaterial = new THREE.MeshStandardMaterial({
    color: '#12132a',
    roughness: 1,
    flatShading: true
  });

  const top = new THREE.Mesh(new THREE.CylinderGeometry(43, 41, 2.2, 56, 1), [cliffMaterial, groundMaterial, deepMaterial]);
  top.position.y = -1.1;
  top.receiveShadow = true;
  island.add(top);

  const edgeRing = new THREE.Mesh(
    new THREE.TorusGeometry(42.4, 0.32, 5, 80),
    new THREE.MeshStandardMaterial({ color: '#343354', roughness: 0.8, metalness: 0.2, emissive: '#1a3d45', emissiveIntensity: 0.55 })
  );
  edgeRing.rotation.x = PI / 2;
  edgeRing.position.y = 0.04;
  island.add(edgeRing);

  const cliffLayers = [
    { rTop: 40.8, rBottom: 38.5, y: -3.4, h: 3.6, mat: cliffMaterial },
    { rTop: 37.5, rBottom: 33.6, y: -8.6, h: 7.5, mat: deepMaterial },
    { rTop: 31, rBottom: 25.5, y: -16.2, h: 9.5, mat: cliffMaterial },
    { rTop: 22, rBottom: 13.5, y: -25, h: 11, mat: deepMaterial },
    { rTop: 10, rBottom: 1.2, y: -34.5, h: 12, mat: cliffMaterial }
  ];
  for (const layer of cliffLayers) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(layer.rTop, layer.rBottom, layer.h, 18, 1), layer.mat);
    mesh.position.y = layer.y;
    mesh.receiveShadow = true;
    island.add(mesh);
  }

  // Ice-like crystals beneath the island.
  for (let i = 0; i < 9; i++) {
    const angle = rand() * TAU;
    const radius = 7 + rand() * 24;
    const crystal = new THREE.Mesh(
      new THREE.ConeGeometry(0.8 + rand() * 1.4, 5 + rand() * 9, 4),
      new THREE.MeshStandardMaterial({
        color: '#61407a',
        emissive: '#a13d82',
        emissiveIntensity: 0.45,
        roughness: 0.3,
        metalness: 0.2,
        flatShading: true
      })
    );
    crystal.position.set(Math.cos(angle) * radius, -28 - rand() * 10, Math.sin(angle) * radius);
    crystal.rotation.z = PI + (rand() - 0.5) * 0.5;
    island.add(crystal);
  }

  // Build grid lines.
  const gridPositions = [];
  for (let i = -40; i <= 40; i += 4) {
    gridPositions.push(-40, 0.018, i, 40, 0.018, i);
    gridPositions.push(i, 0.018, -40, i, 0.018, 40);
  }
  const gridGeometry = new THREE.BufferGeometry();
  gridGeometry.setAttribute('position', new THREE.Float32BufferAttribute(gridPositions, 3));
  const gridLines = new THREE.LineSegments(gridGeometry, new THREE.LineBasicMaterial({ color: '#65e9de', transparent: true, opacity: 0.11, depthWrite: false }));
  island.add(gridLines);

  // Scattered surface stones and crystal clusters.
  const stoneGeo = new THREE.DodecahedronGeometry(1, 0);
  const stoneMat = new THREE.MeshStandardMaterial({ color: '#303351', roughness: 0.95, flatShading: true });
  const stoneInstances = new THREE.InstancedMesh(stoneGeo, stoneMat, 70);
  stoneInstances.castShadow = true;
  stoneInstances.receiveShadow = true;
  const dummy = new THREE.Object3D();
  for (let i = 0; i < 70; i++) {
    const angle = rand() * TAU;
    const radius = 15 + rand() * 27;
    const scale = 0.3 + rand() * 1.1;
    dummy.position.set(Math.cos(angle) * radius, 0.1 + scale * 0.2, Math.sin(angle) * radius);
    dummy.rotation.set(rand() * PI, rand() * PI, rand() * PI);
    dummy.scale.set(scale * (0.6 + rand()), scale * 0.7, scale);
    dummy.updateMatrix();
    stoneInstances.setMatrixAt(i, dummy.matrix);
  }
  stoneInstances.instanceMatrix.needsUpdate = true;
  island.add(stoneInstances);

  const crystalMatPink = new THREE.MeshStandardMaterial({ color: '#d6528a', emissive: '#8d1d59', emissiveIntensity: 0.55, roughness: 0.35, metalness: 0.15, flatShading: true });
  const crystalMatCyan = new THREE.MeshStandardMaterial({ color: '#4ad9ce', emissive: '#167f7d', emissiveIntensity: 0.45, roughness: 0.35, metalness: 0.15, flatShading: true });
  const crystalGeo = new THREE.ConeGeometry(0.35, 1.9, 4);
  for (let i = 0; i < 14; i++) {
    const angle = rand() * TAU;
    const radius = 9 + rand() * 31;
    const group = new THREE.Group();
    group.position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
    const count = 2 + Math.floor(rand() * 3);
    for (let j = 0; j < count; j++) {
      const crystal = new THREE.Mesh(crystalGeo, rand() > 0.66 ? crystalMatPink : crystalMatCyan);
      crystal.position.set((rand() - 0.5) * 1.5, 0.65 + rand() * 0.6, (rand() - 0.5) * 1.5);
      crystal.rotation.z = (rand() - 0.5) * 0.5;
      crystal.rotation.y = rand() * PI;
      crystal.scale.setScalar(0.45 + rand() * 0.65);
      crystal.castShadow = true;
      group.add(crystal);
    }
    group.userData.phase = rand() * TAU;
    island.add(group);
    animated.push((t) => {
      group.rotation.y = Math.sin(t * 0.2 + group.userData.phase) * 0.08;
    });
  }

  // Strong rim light at the core side.
  const rim = new THREE.PointLight('#ff6fa5', 18, 30, 2);
  rim.position.set(18, 8, -12);
  scene.add(rim);

  // ---------- Rift Core ----------
  const core = buildCore(scene, glows);
  animated.push(core.animate);

  // ---------- Resource nodes ----------
  const resources = [];
  const resourceMeshes = [];
  function addResource(type, x, z, rotation = 0) {
    const node = createResourceNode(type, rand);
    node.group.position.set(x, 0, z);
    node.group.rotation.y = rotation;
    node.home = new THREE.Vector3(x, 0, z);
    node.rotationY = rotation;
    node.group.userData.gameHit = { kind: 'resource', ref: node };
    node.active = true;
    node.respawnAt = 0;
    node.hp = node.maxHp;
    node.material = type;
    node.scale = 1;
    scene.add(node.group);
    resources.push(node);
    resourceMeshes.push(node.group);
    return node;
  }

  const resourceLayout = [
    ['wood', -14, 4], ['wood', 15, 6], ['wood', -24, -8], ['wood', 26, -9],
    ['wood', -8, -21], ['wood', 9, -24], ['wood', -31, 12], ['wood', 31, 17],
    ['stone', -19, -14], ['stone', 20, -16], ['stone', -30, -18], ['stone', 33, -2],
    ['stone', 4, 27], ['stone', -13, 25], ['stone', 32, -22],
    ['metal', 12, 24], ['metal', -22, 20], ['metal', 24, -26], ['metal', -36, 1],
    ['metal', -5, 33], ['metal', 36, 24], ['metal', -33, -24]
  ];
  resourceLayout.forEach(([type, x, z], i) => addResource(type, x + (rand() - 0.5) * 2, z + (rand() - 0.5) * 2, rand() * TAU));

  // A few small extra wood nodes.
  addResource('wood', -3, -32, rand() * TAU);
  addResource('stone', 39, 5, rand() * TAU);

  // ---------- Ambient motes ----------
  const moteCount = 260;
  const motePositions = new Float32Array(moteCount * 3);
  const motePhase = new Float32Array(moteCount);
  for (let i = 0; i < moteCount; i++) {
    const angle = rand() * TAU;
    const radius = 6 + rand() * 40;
    motePositions[i * 3] = Math.cos(angle) * radius;
    motePositions[i * 3 + 1] = 0.3 + rand() * 11;
    motePositions[i * 3 + 2] = Math.sin(angle) * radius;
    motePhase[i] = rand() * TAU;
  }
  const moteGeo = new THREE.BufferGeometry();
  moteGeo.setAttribute('position', new THREE.BufferAttribute(motePositions, 3));
  const motes = new THREE.Points(moteGeo, new THREE.PointsMaterial({
    color: '#8ef9f0',
    size: 0.18,
    map: glows,
    transparent: true,
    opacity: 0.45,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true
  }));
  motes.frustumCulled = false;
  scene.add(motes);

  // ---------- Player ----------
  const player = createPlayer();
  player.group.position.set(0, 0, 12.5);
  player.group.rotation.y = 0;
  scene.add(player.group);

  // ---------- A few prop flags/totems ----------
  const totems = new THREE.Group();
  const totemMat = new THREE.MeshStandardMaterial({ color: '#1a2340', roughness: 0.7, metalness: 0.2 });
  const totemGlow = new THREE.MeshBasicMaterial({ color: '#5cefe5' });
  for (let i = 0; i < 5; i++) {
    const angle = (i / 5) * TAU + 0.4;
    const radius = 34;
    const group = new THREE.Group();
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.25, 3.4, 0.25), totemMat);
    post.position.y = 1.7;
    const top = new THREE.Mesh(new THREE.OctahedronGeometry(0.45, 0), new THREE.MeshBasicMaterial({ color: i % 2 ? '#ff6b9d' : '#5cefe5', transparent: true, opacity: 0.9 }));
    top.position.y = 3.7;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.035, 4, 16), totemGlow);
    ring.position.y = 2.9;
    ring.rotation.x = PI / 2;
    group.add(post, top, ring);
    group.position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
    group.userData.phase = rand() * TAU;
    totems.add(group);
    animated.push((t) => {
      top.rotation.y = t * 0.8 + group.userData.phase;
      ring.rotation.z = t * 0.3;
    });
  }
  scene.add(totems);

  // Menu camera state.
  const menuCamPos = new THREE.Vector3();
  const menuTarget = new THREE.Vector3(0, 2.3, 0);
  const menuLook = new THREE.Vector3();
  const menuForward = new THREE.Vector3();
  const menuRight = new THREE.Vector3();

  function update(dt, time) {
    skyUniforms.uTime.value = time;
    skyUniforms.uFlash.value = Math.max(0, skyUniforms.uFlash.value - dt * 1.8);
    if (Math.random() < dt * 0.055) skyUniforms.uFlash.value = 0.15 + Math.random() * 0.35;
    for (const fn of animated) fn(time, dt);
    core.animate(time, dt);

    // Drift motes.
    const positions = moteGeo.attributes.position.array;
    for (let i = 0; i < moteCount; i++) {
      positions[i * 3 + 1] += (0.21 + (i % 5) * 0.02) * dt;
      positions[i * 3] += Math.sin(time * 0.24 + motePhase[i]) * dt * 0.09;
      positions[i * 3 + 2] += Math.cos(time * 0.19 + motePhase[i]) * dt * 0.08;
      if (positions[i * 3 + 1] > 12.5) positions[i * 3 + 1] = 0.2;
    }
    moteGeo.attributes.position.needsUpdate = true;

    // Resources slowly breathe.
    for (const node of resources) {
      if (node.active && node.glow) {
        node.glow.material.opacity = 0.35 + Math.sin(time * 2.2 + node.home.x) * 0.12;
      }
    }
  }

  function menuCamera(time) {
    const angle = 0.62 + Math.sin(time * 0.055) * 0.62;
    const radius = 29 + Math.sin(time * 0.11) * 1.6;
    menuCamPos.set(Math.cos(angle) * radius, 9.6 + Math.sin(time * 0.15) * 0.7, Math.sin(angle) * radius);
    camera.position.copy(menuCamPos);

    // On wide screens the copy sits on the left, so nudge the framing until the
    // rift core lands in the open space on the right third of the viewport.
    const aspect = camera.aspect || 1;
    const wide = THREE.MathUtils.clamp((aspect - 1.05) * 0.9, 0, 1);
    menuForward.copy(menuTarget).sub(menuCamPos).normalize();
    menuRight.crossVectors(menuForward, camera.up).normalize();
    menuLook.copy(menuTarget).addScaledVector(menuRight, -8.4 * wide);
    camera.lookAt(menuLook);
    camera.fov = 55 - wide * 2;
    camera.updateProjectionMatrix();
  }

  function resetResources() {
    for (const node of resources) {
      node.active = true;
      node.hp = node.maxHp;
      node.group.visible = true;
      node.group.scale.setScalar(1);
      node.group.rotation.y = node.rotationY;
      node.group.scale.setScalar(1);
      node.spawnAnim = 1;
      node.respawnAt = 0;
    }
  }

  return {
    camera,
    player,
    core,
    resources,
    resourceMeshes,
    update,
    menuCamera,
    resetResources,
    sun,
    skyUniforms,
    glows
  };
}

function buildCore(scene, glows) {
  const group = new THREE.Group();
  group.position.set(0, 0, 0);
  scene.add(group);

  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(5.1, 5.7, 0.45, 10),
    new THREE.MeshStandardMaterial({ color: '#171c36', roughness: 0.55, metalness: 0.65, flatShading: true })
  );
  base.position.y = 0.22;
  base.receiveShadow = true;
  base.castShadow = true;
  group.add(base);

  const topDisc = new THREE.Mesh(
    new THREE.CylinderGeometry(4.45, 4.8, 0.18, 24),
    new THREE.MeshStandardMaterial({ color: '#273353', roughness: 0.35, metalness: 0.8, emissive: '#113b48', emissiveIntensity: 0.5 })
  );
  topDisc.position.y = 0.51;
  topDisc.receiveShadow = true;
  group.add(topDisc);

  const runeGeo = new THREE.RingGeometry(2.9, 2.96, 48);
  const runes = new THREE.Mesh(runeGeo, new THREE.MeshBasicMaterial({ color: '#6cf8ef', transparent: true, opacity: 0.85, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
  runes.rotation.x = -PI / 2;
  runes.position.y = 0.61;
  group.add(runes);

  const runeInner = new THREE.Mesh(new THREE.RingGeometry(1.1, 1.16, 36), new THREE.MeshBasicMaterial({ color: '#ff7ba8', transparent: true, opacity: 0.8, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
  runeInner.rotation.x = -PI / 2;
  runeInner.position.y = 0.62;
  group.add(runeInner);

  const pylonMat = new THREE.MeshStandardMaterial({ color: '#222b49', roughness: 0.45, metalness: 0.7 });
  const pylonGlow = new THREE.MeshStandardMaterial({ color: '#5cefe5', emissive: '#25b5b3', emissiveIntensity: 2, roughness: 0.2 });
  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * TAU + PI / 4;
    const pylon = new THREE.Group();
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.38, 2.35, 0.38), pylonMat);
    leg.position.y = 1.45;
    leg.castShadow = true;
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.22, 0.7), pylonMat);
    foot.position.y = 0.45;
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.35, 0.04), pylonGlow);
    bar.position.set(0, 1.6, 0.2);
    pylon.add(leg, foot, bar);
    pylon.position.set(Math.cos(angle) * 3.7, 0.15, Math.sin(angle) * 3.7);
    pylon.rotation.y = -angle;
    group.add(pylon);
  }

  const crystalGroup = new THREE.Group();
  crystalGroup.position.y = 3.75;
  group.add(crystalGroup);

  const crystalMat = new THREE.MeshStandardMaterial({
    color: '#73fff6',
    emissive: '#1bd7d0',
    emissiveIntensity: 1.25,
    roughness: 0.12,
    metalness: 0.35,
    flatShading: true
  });
  const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(1.25, 0), crystalMat);
  crystal.scale.y = 1.8;
  crystal.castShadow = true;
  crystalGroup.add(crystal);

  const outer = new THREE.Mesh(
    new THREE.IcosahedronGeometry(2.25, 1),
    new THREE.MeshBasicMaterial({ color: '#6ffbf3', wireframe: true, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  crystalGroup.add(outer);

  const innerCrystal = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.54, 0),
    new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending })
  );
  crystalGroup.add(innerCrystal);

  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glows,
    color: '#54fff2',
    transparent: true,
    opacity: 0.48,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  }));
  halo.scale.setScalar(9.5);
  crystalGroup.add(halo);

  const rings = [];
  for (let i = 0; i < 2; i++) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(2.9 + i * 0.65, 0.035, 4, 64),
      new THREE.MeshBasicMaterial({ color: i ? '#ff6b9d' : '#9ffff8', transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    ring.rotation.x = PI / 2 + i * 0.6;
    ring.rotation.y = i * 0.8;
    crystalGroup.add(ring);
    rings.push(ring);
  }

  const shards = [];
  for (let i = 0; i < 5; i++) {
    const shard = new THREE.Mesh(new THREE.TetrahedronGeometry(0.16 + Math.random() * 0.15), new THREE.MeshBasicMaterial({ color: i % 2 ? '#ff8db2' : '#82fff6', transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending }));
    crystalGroup.add(shard);
    shards.push({ mesh: shard, angle: (i / 5) * TAU, radius: 2.3 + Math.random() * 1.1, speed: 0.3 + Math.random() * 0.3, y: (Math.random() - 0.5) * 2.4 });
  }

  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.24, 0.7, 7.2, 12, 1, true),
    new THREE.MeshBasicMaterial({ color: '#60fff4', transparent: true, opacity: 0.055, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  beam.position.y = 3.6;
  group.add(beam);

  const light = new THREE.PointLight('#58fff0', 24, 24, 1.7);
  light.position.y = 4;
  group.add(light);

  const shield = new THREE.Mesh(
    new THREE.TorusGeometry(5.2, 0.06, 4, 64),
    new THREE.MeshBasicMaterial({ color: '#75fff6', transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  shield.rotation.x = PI / 2;
  shield.position.y = 0.68;
  group.add(shield);

  function animate(time, dt) {
    crystalGroup.position.y = 3.75 + Math.sin(time * 1.35) * 0.13;
    crystal.rotation.y = time * 0.42;
    crystal.rotation.x = Math.sin(time * 0.32) * 0.1;
    outer.rotation.y = -time * 0.18;
    outer.rotation.z = time * 0.08;
    innerCrystal.rotation.y = -time * 0.9;
    halo.material.opacity = 0.56 + Math.sin(time * 1.6) * 0.1;
    rings[0].rotation.z = time * 0.4;
    rings[1].rotation.z = -time * 0.27;
    rings[0].rotation.x = PI / 2 + Math.sin(time * 0.5) * 0.2;
    runes.rotation.z = time * 0.14;
    runeInner.rotation.z = -time * 0.23;
    shield.rotation.z = time * 0.1;
    shield.material.opacity = 0.25 + Math.sin(time * 1.2) * 0.13;
    light.intensity = 22 + Math.sin(time * 2.1) * 4;
    for (const shard of shards) {
      const a = shard.angle + time * shard.speed;
      shard.mesh.position.set(Math.cos(a) * shard.radius, shard.y + Math.sin(time * 1.2 + shard.angle) * 0.3, Math.sin(a) * shard.radius);
      shard.mesh.rotation.x += dt * 2;
      shard.mesh.rotation.y += dt * 1.5;
    }
  }

  return {
    group,
    crystalGroup,
    crystal,
    shield,
    light,
    animate,
    position: new THREE.Vector3(0, 0, 0),
    setHealth(fraction) {
      const safe = Math.max(0.01, fraction);
      shield.material.color.set(safe > 0.55 ? '#75fff6' : safe > 0.25 ? '#ffbf69' : '#ff5c73');
      shield.material.opacity = 0.22 + safe * 0.35;
      light.color.set(safe > 0.55 ? '#58fff0' : safe > 0.25 ? '#ffbf69' : '#ff5c73');
    }
  };
}

function createPlayer() {
  const group = new THREE.Group();
  const jacket = new THREE.MeshStandardMaterial({ color: '#29c7c0', roughness: 0.7, metalness: 0.08 });
  const jacketDark = new THREE.MeshStandardMaterial({ color: '#126d83', roughness: 0.8 });
  const pants = new THREE.MeshStandardMaterial({ color: '#171c2d', roughness: 0.9 });
  const skin = new THREE.MeshStandardMaterial({ color: '#e7b18e', roughness: 0.85 });
  const visorMat = new THREE.MeshStandardMaterial({ color: '#bafff8', emissive: '#35e6dd', emissiveIntensity: 1.6, roughness: 0.2, metalness: 0.5 });
  const accentMat = new THREE.MeshStandardMaterial({ color: '#ffac5c', emissive: '#ff7b2c', emissiveIntensity: 0.7, roughness: 0.5 });
  const gunMat = new THREE.MeshStandardMaterial({ color: '#1e283f', roughness: 0.4, metalness: 0.75 });
  const gunGlow = new THREE.MeshBasicMaterial({ color: '#63fff5' });

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.33, 0.56, 4, 8), jacket);
  torso.position.y = 1.16;
  torso.castShadow = true;
  group.add(torso);

  const chest = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.33, 0.3), jacketDark);
  chest.position.set(0, 1.32, 0.05);
  chest.castShadow = true;
  group.add(chest);

  const sash = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.36, 0.38), accentMat);
  sash.position.set(0.13, 1.18, 0.02);
  sash.rotation.z = -0.16;
  group.add(sash);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.235, 12, 10), skin);
  head.position.y = 1.73;
  head.castShadow = true;
  group.add(head);

  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.255, 12, 8, 0, TAU, 0, PI * 0.62), jacketDark);
  helmet.position.y = 1.78;
  helmet.rotation.x = -0.1;
  helmet.castShadow = true;
  group.add(helmet);

  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.31, 0.105, 0.08), visorMat);
  visor.position.set(0, 1.75, -0.215);
  visor.rotation.x = -0.1;
  group.add(visor);

  const visorGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeGlowTexture(), color: '#62fff5', transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending }));
  visorGlow.scale.setScalar(0.7);
  visorGlow.position.set(0, 1.75, -0.34);
  group.add(visorGlow);

  const backpack = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.62, 0.24), jacketDark);
  backpack.position.set(0, 1.16, 0.31);
  backpack.castShadow = true;
  group.add(backpack);

  const packLight = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.2, 0.05), accentMat);
  packLight.position.set(-0.12, 1.25, 0.45);
  group.add(packLight);

  function makeLeg(side) {
    const pivot = new THREE.Group();
    pivot.position.set(0.17 * side, 0.78, 0);
    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.105, 0.42, 3, 6), pants);
    leg.position.y = -0.3;
    leg.castShadow = true;
    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.14, 0.31), jacketDark);
    boot.position.set(0, -0.6, -0.05);
    boot.castShadow = true;
    pivot.add(leg, boot);
    group.add(pivot);
    return pivot;
  }

  function makeArm(side) {
    const pivot = new THREE.Group();
    pivot.position.set(0.43 * side, 1.4, 0);
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.085, 0.42, 3, 6), jacket);
    arm.position.y = -0.26;
    arm.castShadow = true;
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.09, 7, 6), skin);
    hand.position.y = -0.52;
    pivot.add(arm, hand);
    group.add(pivot);
    return pivot;
  }

  const leftLeg = makeLeg(-1);
  const rightLeg = makeLeg(1);
  const leftArm = makeArm(-1);
  const rightArm = makeArm(1);

  const gun = new THREE.Group();
  gun.position.set(0.38, 1.26, -0.22);
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.17, 0.62), gunMat);
  body.position.z = -0.24;
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.06, 0.56, 8), gunMat);
  barrel.rotation.x = PI / 2;
  barrel.position.z = -0.66;
  const energy = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.055, 0.35), gunGlow);
  energy.position.set(0, 0.1, -0.28);
  const muzzle = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.02, 4, 12), gunGlow);
  muzzle.position.z = -0.95;
  gun.add(body, barrel, energy, muzzle);
  gun.traverse((obj) => { if (obj.isMesh) obj.castShadow = true; });
  group.add(gun);
  rightArm.rotation.x = -1.12;
  rightArm.rotation.z = -0.18;

  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.55, 24),
    new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.2, depthWrite: false })
  );
  shadow.rotation.x = -PI / 2;
  shadow.position.y = 0.025;
  group.add(shadow);

  return {
    group,
    torso,
    head,
    visor,
    leftLeg,
    rightLeg,
    leftArm,
    rightArm,
    gun,
    muzzle,
    shadow,
    bob: 0,
    walk: 0
  };
}

export function createEnemyModel(type, rand = Math.random) {
  const group = new THREE.Group();
  const isBrute = type === 'brute';
  const isBoss = type === 'boss';
  const isSpitter = type === 'spitter';
  const scale = isBoss ? 2.0 : isBrute ? 1.4 : isSpitter ? 1.0 : 1.08;

  const bodyMat = new THREE.MeshStandardMaterial({
    color: isSpitter ? '#523b93' : isBrute ? '#7b4b74' : '#5b3f96',
    roughness: 0.72,
    metalness: 0.1,
    flatShading: true,
    emissive: isBoss ? '#9c2049' : isSpitter ? '#4a1d7a' : '#3c1c68',
    emissiveIntensity: isBoss ? 1.0 : 0.72
  });
  const armorMat = new THREE.MeshStandardMaterial({
    color: isBrute ? '#a06b94' : '#8268bb',
    roughness: 0.5,
    metalness: 0.28,
    flatShading: true
  });
  const glowMat = new THREE.MeshBasicMaterial({ color: isBoss ? '#ffcf7d' : '#ff70ab' });
  const eyeMat = new THREE.MeshBasicMaterial({ color: '#fff5fb' });

  const root = new THREE.Group();
  root.scale.setScalar(scale);
  group.add(root);

  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(isSpitter ? 0.5 : 0.55, 16),
    new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.25, depthWrite: false })
  );
  shadow.rotation.x = -PI / 2;
  shadow.position.y = 0.02;
  group.add(shadow);

  let torso;
  let head;
  let leftArm;
  let rightArm;
  let leftLeg;
  let rightLeg;
  let floaters = [];

  if (isSpitter) {
    torso = new THREE.Mesh(new THREE.OctahedronGeometry(0.46, 1), bodyMat);
    torso.position.y = 1.35;
    torso.castShadow = true;
    root.add(torso);

    const shell = new THREE.Mesh(
      new THREE.TorusGeometry(0.65, 0.045, 4, 24),
      new THREE.MeshBasicMaterial({ color: '#bd6aff', transparent: true, opacity: 0.48, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    shell.rotation.x = PI / 2;
    shell.position.y = 1.35;
    root.add(shell);
    floaters.push({ mesh: shell, speed: 1.2, axis: 'z' });

    const shell2 = shell.clone();
    shell2.rotation.set(0.6, 0.3, 0);
    shell2.scale.setScalar(1.18);
    root.add(shell2);
    floaters.push({ mesh: shell2, speed: -0.8, axis: 'y' });

    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 7), eyeMat);
    eye.position.set(0, 1.38, -0.41);
    root.add(eye);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.065, 6, 5), new THREE.MeshBasicMaterial({ color: '#140b22' }));
    pupil.position.set(0, 1.38, -0.55);
    root.add(pupil);

    for (let i = 0; i < 4; i++) {
      const tentacle = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.75, 4), bodyMat);
      tentacle.position.set(Math.cos(i / 4 * TAU) * 0.3, 0.88, Math.sin(i / 4 * TAU) * 0.3);
      tentacle.rotation.z = Math.cos(i / 4 * TAU) * 0.55;
      tentacle.rotation.x = Math.sin(i / 4 * TAU) * 0.55;
      root.add(tentacle);
    }
    const light = new THREE.PointLight('#b766ff', 3, 4, 2);
    light.position.y = 1.35;
    root.add(light);
  } else {
    torso = new THREE.Mesh(new THREE.IcosahedronGeometry(isBoss ? 0.7 : 0.54, 1), bodyMat);
    torso.position.y = isBoss ? 1.75 : 1.28;
    torso.scale.set(1, 1.22, 0.84);
    torso.castShadow = true;
    root.add(torso);

    const chestPlate = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.5, 0.18), armorMat);
    chestPlate.position.set(0, 1.3, -0.32);
    chestPlate.castShadow = true;
    root.add(chestPlate);

    const coreCrack = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.24, 0.04), glowMat);
    coreCrack.position.set(0, 1.31, -0.42);
    root.add(coreCrack);
    const backRune = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.06, 0.05), glowMat);
    backRune.position.set(0, 1.44, 0.38);
    backRune.rotation.z = 0.22;
    root.add(backRune);
    const backRune2 = backRune.clone();
    backRune2.position.y = 1.28;
    backRune2.rotation.z = -0.22;
    root.add(backRune2);

    head = new THREE.Mesh(new THREE.IcosahedronGeometry(isBoss ? 0.42 : 0.3, 1), bodyMat);
    head.position.y = isBoss ? 2.48 : 1.88;
    head.castShadow = true;
    root.add(head);

    const eyeL = new THREE.Mesh(new THREE.SphereGeometry(isBoss ? 0.07 : 0.045, 7, 6), eyeMat);
    eyeL.position.set(-0.12, isBoss ? 2.51 : 1.91, -0.26);
    const eyeR = eyeL.clone();
    eyeR.position.x = 0.12;
    root.add(eyeL, eyeR);

    // Horns.
    const hornMat = new THREE.MeshStandardMaterial({ color: '#2b1d45', roughness: 0.72, metalness: 0.15, flatShading: true });
    for (let s = -1; s <= 1; s += 2) {
      const horn = new THREE.Mesh(new THREE.ConeGeometry(0.07, isBoss ? 0.6 : 0.34, 4), hornMat);
      horn.position.set(0.19 * s, isBoss ? 2.8 : 2.08, 0);
      horn.rotation.z = -0.45 * s;
      horn.rotation.x = -0.12;
      horn.castShadow = true;
      root.add(horn);
    }

    // Shoulders and arms.
    for (let s = -1; s <= 1; s += 2) {
      const shoulder = new THREE.Mesh(new THREE.DodecahedronGeometry(isBoss ? 0.37 : isBrute ? 0.3 : 0.2, 0), armorMat);
      shoulder.position.set((isBoss ? 0.74 : 0.52) * s, isBoss ? 1.85 : 1.43, 0);
      shoulder.castShadow = true;
      root.add(shoulder);

      const armPivot = new THREE.Group();
      armPivot.position.set((isBoss ? 0.7 : 0.52) * s, isBoss ? 1.8 : 1.4, 0);
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(isBoss ? 0.12 : 0.09, isBoss ? 0.72 : 0.42, 3, 6), bodyMat);
      arm.position.y = isBoss ? -0.48 : -0.31;
      arm.castShadow = true;
      const claw = new THREE.Mesh(new THREE.ConeGeometry(isBoss ? 0.11 : 0.08, isBoss ? 0.36 : 0.22, 4), glowMat);
      claw.position.y = isBoss ? -0.9 : -0.6;
      claw.rotation.x = PI;
      armPivot.add(arm, claw);
      root.add(armPivot);
      if (s < 0) leftArm = armPivot; else rightArm = armPivot;
    }

    const legMat = new THREE.MeshStandardMaterial({ color: '#171024', roughness: 0.9, flatShading: true });
    for (let s = -1; s <= 1; s += 2) {
      const pivot = new THREE.Group();
      pivot.position.set((isBoss ? 0.25 : 0.17) * s, isBoss ? 1.1 : 0.78, 0);
      const leg = new THREE.Mesh(new THREE.CapsuleGeometry(isBoss ? 0.14 : 0.1, isBoss ? 0.74 : 0.44, 3, 6), legMat);
      leg.position.y = isBoss ? -0.46 : -0.29;
      leg.castShadow = true;
      pivot.add(leg);
      root.add(pivot);
      if (s < 0) leftLeg = pivot; else rightLeg = pivot;
    }

    if (isBrute || isBoss) {
      for (let i = 0; i < (isBoss ? 6 : 3); i++) {
        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.55, 4), armorMat);
        spike.position.set((rand() - 0.5) * 0.65, (isBoss ? 1.6 : 1.25) + rand() * 0.45, 0.34 + rand() * 0.18);
        spike.rotation.x = 1.1 + rand() * 0.4;
        root.add(spike);
      }
    }

    if (isBoss) {
      const crown = new THREE.Mesh(
        new THREE.TorusGeometry(0.42, 0.05, 4, 16),
        new THREE.MeshBasicMaterial({ color: '#ffbf69', transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending })
      );
      crown.rotation.x = PI / 2;
      crown.position.y = 2.92;
      root.add(crown);
      floaters.push({ mesh: crown, speed: 0.5, axis: 'z' });

      const aura = new THREE.PointLight('#ff6b9d', 8, 8, 1.6);
      aura.position.y = 1.8;
      root.add(aura);
    }
  }

  const healthBar = new THREE.Group();
  const barW = isBoss ? 1.7 : isBrute ? 1.3 : 0.95;
  const barY = isBoss ? 3.2 : isBrute ? 2.25 : isSpitter ? 2.1 : 2.2;
  healthBar.position.y = barY;
  const bg = new THREE.Sprite(new THREE.SpriteMaterial({ color: '#180b25', transparent: true, opacity: 0.7, depthTest: false, depthWrite: false }));
  bg.scale.set(barW, 0.09, 1);
  bg.center.set(0.5, 0.5);
  const fill = new THREE.Sprite(new THREE.SpriteMaterial({ color: '#ff5c9b', transparent: true, opacity: 0.95, depthTest: false, depthWrite: false }));
  fill.scale.set(barW, 0.065, 1);
  fill.center.set(0, 0.5);
  fill.position.x = -barW / 2;
  healthBar.add(bg, fill);
  healthBar.visible = false;
  healthBar.renderOrder = 20;
  group.add(healthBar);

  const aura = new THREE.Sprite(new THREE.SpriteMaterial({
    map: sharedEnemyGlow || (sharedEnemyGlow = makeGlowTexture()),
    color: isBoss ? '#ffbf69' : isBrute ? '#ff9b62' : '#ff77b2',
    transparent: true,
    opacity: 0.18,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  }));
  aura.scale.setScalar(isBoss ? 7 : isBrute ? 4.4 : 3.1);
  aura.position.y = isBoss ? 2 : 1.1;
  aura.raycast = () => {};
  group.add(aura);

  group.traverse((obj) => {
    if (obj.isMesh) {
      obj.castShadow = true;
      obj.receiveShadow = false;
    }
  });

  return {
    group,
    root,
    torso,
    head,
    leftArm,
    rightArm,
    leftLeg,
    rightLeg,
    healthBar,
    healthFill: fill,
    healthBarWidth: barW,
    floaters,
    type,
    scale
  };
}

function createResourceNode(type, rand) {
  const group = new THREE.Group();
  let glows = [];

  if (type === 'wood') {
    const trunkMat = new THREE.MeshStandardMaterial({ color: '#5d3c35', roughness: 0.95, flatShading: true });
    const leafMat = new THREE.MeshStandardMaterial({ color: '#1c8f85', emissive: '#0b423f', emissiveIntensity: 0.6, roughness: 0.75, flatShading: true });
    const leafMat2 = new THREE.MeshStandardMaterial({ color: '#3bcfb4', emissive: '#0e5b56', emissiveIntensity: 0.55, roughness: 0.7, flatShading: true });

    const height = 3.4 + rand() * 1.8;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.36, height, 6), trunkMat);
    trunk.position.y = height / 2;
    trunk.rotation.z = (rand() - 0.5) * 0.15;
    trunk.castShadow = true;
    group.add(trunk);

    const branch = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.15, 1.5, 5), trunkMat);
    branch.position.set(0.5, height * 0.7, 0);
    branch.rotation.z = -0.8;
    group.add(branch);

    const canopyPositions = [
      [0, height + 0.25, 0, 1.45],
      [-0.8, height - 0.25, 0.15, 1.0],
      [0.75, height - 0.2, 0.2, 0.92]
    ];
    for (let i = 0; i < 3; i++) {
      const [x, y, z, s] = canopyPositions[i];
      const canopy = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), i === 1 ? leafMat2 : leafMat);
      canopy.position.set(x, y, z);
      canopy.scale.y = 0.72;
      canopy.rotation.set(rand() * PI, rand() * PI, rand() * PI);
      canopy.castShadow = true;
      group.add(canopy);
    }

    for (let i = 0; i < 3; i++) {
      const fruit = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.12, 0),
        new THREE.MeshBasicMaterial({ color: '#ffcc77', transparent: true, opacity: 0.92 })
      );
      fruit.position.set((rand() - 0.5) * 2.2, height - 0.4 + rand() * 0.8, (rand() - 0.5) * 1.5);
      group.add(fruit);
      glows.push(fruit);
    }
  } else if (type === 'stone') {
    const rockMat = new THREE.MeshStandardMaterial({ color: '#4f5575', roughness: 0.9, metalness: 0.1, flatShading: true });
    const rockMat2 = new THREE.MeshStandardMaterial({ color: '#353b5f', roughness: 0.96, flatShading: true });
    const shardMat = new THREE.MeshStandardMaterial({ color: '#e879c5', emissive: '#8f1b6f', emissiveIntensity: 1.1, roughness: 0.3, flatShading: true });

    for (let i = 0; i < 4; i++) {
      const size = 0.7 + rand() * 0.95;
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(size, 0), i % 2 ? rockMat : rockMat2);
      rock.position.set((rand() - 0.5) * 2.1, size * 0.55, (rand() - 0.5) * 1.8);
      rock.rotation.set(rand() * PI, rand() * PI, rand() * PI);
      rock.scale.y = 0.65 + rand() * 0.45;
      rock.castShadow = true;
      group.add(rock);
    }
    for (let i = 0; i < 3; i++) {
      const shard = new THREE.Mesh(new THREE.ConeGeometry(0.18 + rand() * 0.15, 1.4 + rand() * 1.4, 4), shardMat);
      shard.position.set((rand() - 0.5) * 1.5, 1.1 + rand() * 0.5, (rand() - 0.5) * 1.4);
      shard.rotation.z = (rand() - 0.5) * 0.65;
      shard.rotation.x = (rand() - 0.5) * 0.35;
      shard.castShadow = true;
      group.add(shard);
      glows.push(shard);
    }
  } else {
    const metalMat = new THREE.MeshStandardMaterial({ color: '#5a6a77', roughness: 0.38, metalness: 0.78, flatShading: true });
    const rustMat = new THREE.MeshStandardMaterial({ color: '#95543b', roughness: 0.72, metalness: 0.4, flatShading: true });
    const panelMat = new THREE.MeshStandardMaterial({ color: '#49d9d5', emissive: '#157b7e', emissiveIntensity: 1.4, roughness: 0.3, metalness: 0.5 });

    const crate = new THREE.Mesh(new THREE.BoxGeometry(1.45, 1.1, 1.2), metalMat);
    crate.position.y = 0.55;
    crate.rotation.set(0.04, rand() * 0.5, -0.06);
    crate.castShadow = true;
    group.add(crate);

    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.1, 1.35), rustMat);
    frame.position.y = 1.14;
    group.add(frame);

    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.44, 0.05), panelMat);
    panel.position.set(0, 0.67, 0.63);
    group.add(panel);
    glows.push(panel);

    const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 1.4, 8), rustMat);
    tank.position.set(1.15, 0.7, -0.3);
    tank.rotation.z = 0.12;
    tank.castShadow = true;
    group.add(tank);

    const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.6, 4), metalMat);
    antenna.position.set(-0.7, 1.6, -0.15);
    antenna.rotation.z = 0.2;
    group.add(antenna);

    const beacon = new THREE.Mesh(new THREE.OctahedronGeometry(0.17, 0), panelMat);
    beacon.position.set(-0.86, 2.4, -0.15);
    group.add(beacon);
    glows.push(beacon);
  }

  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: makeGlowTexture(),
    color: type === 'wood' ? '#e8bd67' : type === 'stone' ? '#ff8bd2' : '#61fff3',
    transparent: true,
    opacity: 0.36,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  }));
  glow.scale.setScalar(type === 'wood' ? 5.5 : 4.8);
  glow.position.y = 1.35;
  group.add(glow);

  const contactShadow = new THREE.Mesh(
    new THREE.CircleGeometry(1.65, 18),
    new THREE.MeshBasicMaterial({ color: '#050711', transparent: true, opacity: 0.24, depthWrite: false })
  );
  contactShadow.rotation.x = -PI / 2;
  contactShadow.position.y = 0.025;
  contactShadow.raycast = () => {};
  group.add(contactShadow);

  const marker = new THREE.Mesh(
    new THREE.RingGeometry(1.25, 1.31, 28),
    new THREE.MeshBasicMaterial({
      color: type === 'wood' ? '#e8bd67' : type === 'stone' ? '#ff8bd2' : '#61fff3',
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    })
  );
  marker.rotation.x = -PI / 2;
  marker.position.y = 0.04;
  glow.raycast = () => {};
  marker.raycast = () => {};
  group.add(marker);

  return {
    group,
    glow,
    marker,
    glows,
    maxHp: type === 'wood' ? 5 : type === 'stone' ? 6 : 7,
    yield: type === 'wood' ? 10 : type === 'stone' ? 9 : 8,
    type
  };
}

export function makeSkyFlash(world, strength = 0.5) {
  if (world?.skyUniforms) world.skyUniforms.uFlash.value = strength;
}
