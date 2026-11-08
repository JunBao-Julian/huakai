import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Flower } from './flora/Flower';
import { softDotTexture } from './flora/textures';
import type { CompiledFlower } from './flora/spec';

const easeIn = (t: number) => t * t * t;
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const SINK = -4.8; // 换花时花朵沉到画面下方的位置

export class BloomScene {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private flower: Flower | null = null;
  private pollen: THREE.Points;
  private pollenVel: Float32Array;
  private keyLight: THREE.DirectionalLight;
  private burstPts: THREE.Points;
  private burstVel: Float32Array;
  private burstAge = Infinity;
  /** 换花动画：先沉下去，再长出新花 */
  private swap: { next: CompiledFlower | null; phase: 'out' | 'in'; t: number } | null = null;
  /** 画面水平偏移（屏幕宽度的比例）：显示知识卡时把花往右让一让 */
  private shift = 0;
  private shiftTarget = 0;

  constructor(container: HTMLElement, userControls: boolean) {
    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }));
    r.setPixelRatio(Math.min(devicePixelRatio, 2));
    r.setSize(innerWidth, innerHeight);
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(r.domElement);

    const pmrem = new THREE.PMREMGenerator(r);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.45;

    this.camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.05, 50);
    this.camera.position.set(0, 1.9, 3.6);
    this.controls = new OrbitControls(this.camera, r.domElement);
    this.controls.target.set(0, 0.25, 0);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.enableRotate = userControls;
    this.controls.enableZoom = userControls;
    this.controls.minDistance = 2;
    this.controls.maxDistance = 7;
    this.controls.maxPolarAngle = Math.PI * 0.62;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.35;

    // 灯光：暖色主光 + 冷色轮廓光 + 天光
    const key = (this.keyLight = new THREE.DirectionalLight('#fff1dc', 2.6));
    key.position.set(2.2, 4, 2.6);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, { left: -2, right: 2, top: 2, bottom: -2, near: 0.5, far: 12 });
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.02;
    key.shadow.radius = 4;
    this.scene.add(key);

    const rim = new THREE.DirectionalLight('#9fb8ff', 1.6);
    rim.position.set(-3, 2, -3.5);
    this.scene.add(rim);

    const back = new THREE.PointLight('#ffb3cf', 1.2, 6, 2);
    back.position.set(0, 1.2, -1.4);
    this.scene.add(back);

    this.scene.add(new THREE.HemisphereLight('#ffe9f2', '#1a2030', 0.5));

    const dot = softDotTexture();

    // 漂浮的花粉/光点
    const n = 260;
    const p = new Float32Array(n * 3);
    this.pollenVel = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      p[i * 3] = (Math.random() - 0.5) * 6;
      p[i * 3 + 1] = Math.random() * 4 - 1.5;
      p[i * 3 + 2] = (Math.random() - 0.5) * 6;
      this.pollenVel[i] = 0.05 + Math.random() * 0.12;
    }
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(p, 3));
    this.pollen = new THREE.Points(
      pg,
      new THREE.PointsMaterial({
        size: 0.045, map: dot, color: '#ffd9a8', transparent: true, opacity: 0.2,
        depthWrite: false, blending: THREE.AdditiveBlending,
      }),
    );
    this.scene.add(this.pollen);

    // 盛开时的花粉爆发
    const bn = 220;
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(bn * 3), 3));
    this.burstVel = new Float32Array(bn * 3);
    this.burstPts = new THREE.Points(
      bg,
      new THREE.PointsMaterial({
        size: 0.06, map: dot, color: '#ffe2a8', transparent: true, opacity: 0,
        depthWrite: false, blending: THREE.AdditiveBlending,
      }),
    );
    this.burstPts.visible = false;
    this.scene.add(this.burstPts);

    addEventListener('resize', () => {
      this.camera.aspect = innerWidth / innerHeight;
      this.camera.updateProjectionMatrix();
      r.setSize(innerWidth, innerHeight);
    });
  }

  get currentFlower() {
    return this.flower?.spec ?? null;
  }

  /** 立即显示某朵花（启动时用） */
  setFlower(spec: CompiledFlower) {
    this.swap = null;
    this.replace(spec);
    this.flower!.group.position.y = 0;
  }

  /** 带动画换花：旧花沉下去，新花长上来 */
  swapFlower(spec: CompiledFlower) {
    if (!this.flower) return this.setFlower(spec);
    this.swap = { next: spec, phase: 'out', t: 0 };
  }

  private replace(spec: CompiledFlower) {
    if (this.flower) {
      this.scene.remove(this.flower.group);
      this.flower.dispose();
    }
    this.flower = new Flower(spec);
    this.scene.add(this.flower.group);
  }

  /** 显示知识卡时，花朵在画面里向右让出位置 */
  makeRoomForCard(on: boolean) {
    this.shiftTarget = on ? 0.14 : 0;
  }

  /** 盛开高光：从花心向四周喷出花粉 */
  burst() {
    const pos = this.burstPts.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      pos.setXYZ(i, (Math.random() - 0.5) * 0.15, 0.25 + Math.random() * 0.1, (Math.random() - 0.5) * 0.15);
      const a = Math.random() * Math.PI * 2;
      const up = 0.3 + Math.random() * 0.9;
      const out = 0.4 + Math.random() * 1.1;
      this.burstVel.set([Math.cos(a) * out, up, Math.sin(a) * out], i * 3);
    }
    pos.needsUpdate = true;
    this.burstAge = 0;
    this.burstPts.visible = true;
  }

  render(openness: number, time: number, dt: number) {
    this.updateSwap(dt);
    this.flower?.update(openness, time);

    const pos = this.pollen.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      let y = pos.getY(i) + this.pollenVel[i] * dt * (0.4 + openness);
      if (y > 2.5) y = -1.5;
      pos.setY(i, y);
      pos.setX(i, pos.getX(i) + Math.sin(time * 0.5 + i) * 0.002);
    }
    pos.needsUpdate = true;
    (this.pollen.material as THREE.PointsMaterial).opacity = 0.12 + 0.55 * openness;
    this.keyLight.intensity = 2.3 + openness * 0.6;

    this.updateBurst(dt);
    this.shift += (this.shiftTarget - this.shift) * (1 - Math.exp(-dt * 2.5));
    const W = innerWidth, H = innerHeight;
    if (Math.abs(this.shift) > 1e-4) this.camera.setViewOffset(W, H, -this.shift * W, 0, W, H);
    else if (this.camera.view?.enabled) this.camera.clearViewOffset();
    this.controls.update(dt);
    this.renderer.render(this.scene, this.camera);
  }

  private updateSwap(dt: number) {
    const s = this.swap;
    if (!s || !this.flower) return;
    if (s.phase === 'out') {
      s.t = Math.min(1, s.t + dt / 0.6);
      this.flower.group.position.y = SINK * easeIn(s.t);
      if (s.t >= 1) {
        this.replace(s.next!);
        this.flower.group.position.y = SINK;
        s.phase = 'in';
        s.t = 0;
      }
    } else {
      s.t = Math.min(1, s.t + dt / 1.1);
      this.flower.group.position.y = SINK * (1 - easeOut(s.t));
      if (s.t >= 1) this.swap = null;
    }
  }

  private updateBurst(dt: number) {
    if (this.burstAge > 2.6) {
      this.burstPts.visible = false;
      return;
    }
    this.burstAge += dt;
    const pos = this.burstPts.geometry.attributes.position as THREE.BufferAttribute;
    const drag = Math.exp(-dt * 1.6);
    for (let i = 0; i < pos.count; i++) {
      const v = this.burstVel;
      v[i * 3] *= drag;
      v[i * 3 + 1] = v[i * 3 + 1] * drag - 0.12 * dt; // 轻微下落
      v[i * 3 + 2] *= drag;
      pos.setXYZ(i, pos.getX(i) + v[i * 3] * dt, pos.getY(i) + v[i * 3 + 1] * dt, pos.getZ(i) + v[i * 3 + 2] * dt);
    }
    pos.needsUpdate = true;
    const t = this.burstAge / 2.6;
    (this.burstPts.material as THREE.PointsMaterial).opacity = t < 0.1 ? t * 10 : 1 - (t - 0.1) / 0.9;
  }
}
