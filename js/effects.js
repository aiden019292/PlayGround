import * as THREE from 'three';

export const TMP_COLOR = new THREE.Color();
export const TMP_VEC = new THREE.Vector3();

function makeGlowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.26, 'rgba(255,255,255,0.9)');
  gradient.addColorStop(0.62, 'rgba(255,255,255,0.24)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeRingTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(64, 64, 34, 64, 64, 62);
  gradient.addColorStop(0, 'rgba(255,255,255,0)');
  gradient.addColorStop(0.7, 'rgba(255,255,255,0.12)');
  gradient.addColorStop(0.87, 'rgba(255,255,255,0.95)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export class Effects {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    this.glowTexture = makeGlowTexture();
    this.ringTexture = makeRingTexture();
    this.tracers = [];
    this.rings = [];
    this.flashes = [];
    this.createParticlePool(760);
  }

  createParticlePool(capacity) {
    this.capacity = capacity;
    this.particles = [];
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(capacity * 3);
    const colors = new Float32Array(capacity * 3);
    const sizes = new Float32Array(capacity);
    const alphas = new Float32Array(capacity);
    for (let i = 0; i < capacity; i++) {
      positions[i * 3 + 1] = -999;
      alphas[i] = 0;
      this.particles.push({ life: 0, maxLife: 1, vx: 0, vy: 0, vz: 0, gravity: 0, drag: 1, size: 1 });
    }
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 300);

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) }
      },
      vertexShader: `
        attribute vec3 aColor;
        attribute float aSize;
        attribute float aAlpha;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vColor = aColor;
          vAlpha = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * (360.0 / max(0.4, -mv.z));
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vec2 p = gl_PointCoord - 0.5;
          float d = length(p);
          if (d > 0.5) discard;
          float core = smoothstep(0.5, 0.02, d);
          gl_FragColor = vec4(vColor, core * vAlpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });

    this.points = new THREE.Points(geometry, material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 8;
    this.scene.add(this.points);
    this.positions = positions;
    this.colors = colors;
    this.sizes = sizes;
    this.alphas = alphas;
    this.next = 0;
  }

  emit(position, color, count = 10, options = {}) {
    const {
      speed = 5,
      life = 0.7,
      size = 0.22,
      gravity = 5,
      spread = 1,
      upward = 1.2,
      drag = 1.8
    } = options;
    const col = TMP_COLOR.set(color);
    for (let n = 0; n < count; n++) {
      const i = this.next;
      this.next = (this.next + 1) % this.capacity;
      const p = this.particles[i];
      p.life = life * (0.55 + Math.random() * 0.7);
      p.maxLife = p.life;
      p.vx = (Math.random() - 0.5) * speed * spread;
      p.vy = (Math.random() * 0.75 + 0.25) * speed * upward;
      p.vz = (Math.random() - 0.5) * speed * spread;
      p.gravity = gravity;
      p.drag = drag;
      p.size = size * (0.55 + Math.random() * 0.95);
      this.positions[i * 3] = position.x + (Math.random() - 0.5) * 0.18;
      this.positions[i * 3 + 1] = position.y + (Math.random() - 0.5) * 0.18;
      this.positions[i * 3 + 2] = position.z + (Math.random() - 0.5) * 0.18;
      const tint = 0.75 + Math.random() * 0.45;
      this.colors[i * 3] = Math.min(1, col.r * tint);
      this.colors[i * 3 + 1] = Math.min(1, col.g * tint);
      this.colors[i * 3 + 2] = Math.min(1, col.b * tint);
      this.sizes[i] = p.size;
      this.alphas[i] = 1;
    }
    this.flagUpdate();
  }

  emitTrail(position, color, count = 2, size = 0.1) {
    this.emit(position, color, count, { speed: 0.8, life: 0.35, size, gravity: -1, spread: 1, upward: 0.3, drag: 3 });
  }

  tracer(from, to, color = 0x7dfcf4, thickness = 1) {
    const geometry = new THREE.BufferGeometry().setFromPoints([from, to]);
    const material = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      linewidth: thickness
    });
    const line = new THREE.Line(geometry, material);
    line.renderOrder = 7;
    this.scene.add(line);
    this.tracers.push({ line, life: 0.09, maxLife: 0.09 });
  }

  ring(position, color = 0x6ffff7, radius = 3, duration = 0.5) {
    const material = new THREE.SpriteMaterial({
      map: this.ringTexture,
      color,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    const sprite = new THREE.Sprite(material);
    sprite.position.copy(position);
    sprite.scale.setScalar(0.3);
    sprite.renderOrder = 6;
    this.scene.add(sprite);
    this.rings.push({ sprite, life: duration, maxLife: duration, radius });
  }

  flash(position, color = 0xffffff, size = 1.5, duration = 0.12) {
    const material = new THREE.SpriteMaterial({
      map: this.glowTexture,
      color,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    const sprite = new THREE.Sprite(material);
    sprite.position.copy(position);
    sprite.scale.setScalar(size);
    sprite.renderOrder = 9;
    this.scene.add(sprite);
    this.flashes.push({ sprite, life: duration, maxLife: duration, size });
  }

  flagUpdate() {
    const attrs = this.points.geometry.attributes;
    attrs.position.needsUpdate = true;
    attrs.aColor.needsUpdate = true;
    attrs.aSize.needsUpdate = true;
    attrs.aAlpha.needsUpdate = true;
  }

  update(dt) {
    const pos = this.positions;
    const alpha = this.alphas;
    let any = false;
    for (let i = 0; i < this.capacity; i++) {
      const p = this.particles[i];
      if (p.life <= 0) continue;
      p.life -= dt;
      any = true;
      if (p.life <= 0) {
        alpha[i] = 0;
        pos[i * 3 + 1] = -999;
        continue;
      }
      p.vy -= p.gravity * dt;
      const drag = Math.max(0, 1 - p.drag * dt);
      p.vx *= drag;
      p.vz *= drag;
      pos[i * 3] += p.vx * dt;
      pos[i * 3 + 1] += p.vy * dt;
      pos[i * 3 + 2] += p.vz * dt;
      if (pos[i * 3 + 1] < 0.04) {
        pos[i * 3 + 1] = 0.04;
        p.vy *= -0.24;
        p.vx *= 0.7;
        p.vz *= 0.7;
      }
      alpha[i] = Math.min(1, (p.life / p.maxLife) * 1.5);
    }
    if (any) this.flagUpdate();

    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.life -= dt;
      t.line.material.opacity = Math.max(0, t.life / t.maxLife) * 0.85;
      if (t.life <= 0) {
        this.scene.remove(t.line);
        t.line.geometry.dispose();
        t.line.material.dispose();
        this.tracers.splice(i, 1);
      }
    }

    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.life -= dt;
      const progress = 1 - r.life / r.maxLife;
      r.sprite.scale.setScalar(0.3 + progress * r.radius * 2);
      r.sprite.material.opacity = (1 - progress) * 0.9;
      if (r.life <= 0) {
        this.scene.remove(r.sprite);
        r.sprite.material.dispose();
        this.rings.splice(i, 1);
      }
    }

    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.life -= dt;
      const progress = 1 - f.life / f.maxLife;
      f.sprite.scale.setScalar(f.size * (0.8 + progress * 0.4));
      f.sprite.material.opacity = (1 - progress) * 0.95;
      if (f.life <= 0) {
        this.scene.remove(f.sprite);
        f.sprite.material.dispose();
        this.flashes.splice(i, 1);
      }
    }
  }

  clear() {
    for (const t of this.tracers) {
      this.scene.remove(t.line);
      t.line.geometry.dispose();
      t.line.material.dispose();
    }
    this.tracers.length = 0;
    for (const r of this.rings) {
      this.scene.remove(r.sprite);
      r.sprite.material.dispose();
    }
    this.rings.length = 0;
    for (const f of this.flashes) {
      this.scene.remove(f.sprite);
      f.sprite.material.dispose();
    }
    this.flashes.length = 0;
    for (let i = 0; i < this.capacity; i++) {
      this.particles[i].life = 0;
      this.alphas[i] = 0;
      this.positions[i * 3 + 1] = -999;
    }
    this.flagUpdate();
  }
}
