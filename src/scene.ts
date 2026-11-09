import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { Flower } from './flora/Flower';
import { BG_LAYER, BlurredBackdrop } from './backdrop';
import { bokehTexture, softDotTexture } from './flora/textures';
import type { CompiledFlower } from './flora/spec';

/**
 * 场景与渲染管线：按“微距花卉摄影”的思路搭建
 *  - 长焦视角、景深虚化、暗背景上的柔和光斑
 *  - 暖色主光 + 强逆光（让花瓣透光）+ 很弱的环境补光
 *  - 后期：环境光遮蔽（花瓣夹缝里的暗部）→ 景深 → 轻微泛光 → AgX 胶片色调 → 颗粒、暗角、色差
 * quality：high 全部开启；medium 关闭环境光遮蔽；low 只保留基础渲染（给性能较弱的电脑）
 */

export type RenderQuality = 'high' | 'medium' | 'low';

const easeIn = (t: number) => t * t * t;
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const SINK = -4.8; // 换花时花朵沉到画面下方的位置
const TARGET = new THREE.Vector3(0, 0.32, 0);

/** 胶片质感：颗粒 + 暗角 + 边缘轻微色差（在色调映射之后执行） */
const FilmShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uTime; uniform vec2 uRes; varying vec2 vUv;
    float rand(vec2 co) { return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 c = vUv - 0.5;
      float d = length(c * vec2(uRes.x / uRes.y, 1.0)) / 0.9;
      vec2 off = c * 0.002 * d;
      vec3 col = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
      col *= mix(0.42, 1.0, smoothstep(1.05, 0.3, d));
      float luma = dot(col, vec3(0.299, 0.587, 0.114));
      col += (rand(floor(vUv * uRes) + fract(uTime) * 91.7) - 0.5) * mix(0.05, 0.022, luma);
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export class BloomScene {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private composer: EffectComposer;
  private backdrop: BlurredBackdrop;
  private film: ShaderPass;
  private flower: Flower | null = null;
  private pollen: THREE.Points;
  private pollenVel: Float32Array;
  private keyLight: THREE.DirectionalLight;
  private backLight: THREE.DirectionalLight;
  private burstPts: THREE.Points;
  private burstVel: Float32Array;
  private burstAge = Infinity;
  /** 换花动画：先沉下去，再长出新花 */
  private swap: { next: CompiledFlower | null; phase: 'out' | 'in'; t: number } | null = null;
  /** 画面水平偏移（屏幕宽度的比例）：显示知识卡时把花往右让一让 */
  private shift = 0;
  private shiftTarget = 0;
  private timeSec = 0;

  constructor(container: HTMLElement, userControls: boolean, quality: RenderQuality = 'high') {
    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: quality === 'low', powerPreference: 'high-performance' }));
    r.setPixelRatio(Math.min(devicePixelRatio, quality === 'high' ? 1.5 : 1));
    r.setSize(innerWidth, innerHeight);
    r.toneMapping = THREE.NeutralToneMapping;
    r.toneMappingExposure = 1.15;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(r.domElement);

    this.scene.background = new THREE.Color('#050405');
    const pmrem = new THREE.PMREMGenerator(r);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.12;

    // 长焦（约 100mm 等效）：透视压缩更像相机拍的
    this.camera = new THREE.PerspectiveCamera(22, innerWidth / innerHeight, 0.1, 60);
    this.camera.position.set(0, 4.4, 4.6);
    this.controls = new OrbitControls(this.camera, r.domElement);
    this.controls.target.copy(TARGET);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.enableRotate = userControls;
    this.controls.enableZoom = userControls;
    this.controls.minDistance = 3.5;
    this.controls.maxDistance = 10;
    this.controls.minPolarAngle = Math.PI * 0.2;
    this.controls.maxPolarAngle = Math.PI * 0.55;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.25;

    // 主光：暖白，左前上方，软阴影
    const key = (this.keyLight = new THREE.DirectionalLight('#fff3e2', 3.2));
    key.position.set(3.2, 5, 3.6);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, { left: -2.2, right: 2.2, top: 2.2, bottom: -2.2, near: 1, far: 14 });
    key.shadow.bias = -0.0003;
    key.shadow.normalBias = 0.012;
    key.shadow.radius = 3;
    this.scene.add(key);

    // 逆光：从花朵后上方照来，穿透花瓣、勾出轮廓（同样投影，内层被挡住的花瓣不会乱发亮）
    const back = (this.backLight = new THREE.DirectionalLight('#ffe6cc', 3.8));
    back.position.set(-1.6, 3.4, -4.8);
    back.castShadow = true;
    back.shadow.mapSize.set(1024, 1024);
    Object.assign(back.shadow.camera, { left: -2.2, right: 2.2, top: 2.2, bottom: -2.2, near: 1, far: 14 });
    back.shadow.bias = -0.0004;
    back.shadow.normalBias = 0.015;
    back.shadow.radius = 4;
    this.scene.add(back);

    // 很弱的补光，让暗部不死黑
    this.scene.add(new THREE.HemisphereLight('#f4ecff', '#3a2026', 0.18));

    this.scene.add(this.makeBokehBackground());

    const dot = softDotTexture();
    // 空气中极少量的细小花粉
    const n = 90;
    const p = new Float32Array(n * 3);
    this.pollenVel = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      p[i * 3] = (Math.random() - 0.5) * 4;
      p[i * 3 + 1] = Math.random() * 3 - 1;
      p[i * 3 + 2] = (Math.random() - 0.5) * 3;
      this.pollenVel[i] = 0.03 + Math.random() * 0.06;
    }
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(p, 3));
    this.pollen = new THREE.Points(
      pg,
      new THREE.PointsMaterial({
        size: 0.018, map: dot, color: '#ffe8c0', transparent: true, opacity: 0,
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
        size: 0.035, map: dot, color: '#ffe2a8', transparent: true, opacity: 0,
        depthWrite: false, blending: THREE.AdditiveBlending,
      }),
    );
    this.burstPts.visible = false;
    this.scene.add(this.burstPts);

    // ---------- 后期 ----------
    const W = innerWidth, H = innerHeight;
    const rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, samples: quality === 'low' ? 0 : 4 });
    this.composer = new EffectComposer(r, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    // 调试开关：?noao ?nodof ?nobloom ?nofilm（对比各后期效果）
    const dbg = new URLSearchParams(location.search);
    if (quality === 'high' && !dbg.has('noao')) {
      const ao = new GTAOPass(this.scene, this.camera, W, H);
      ao.normalMaterial.side = THREE.DoubleSide; // 花瓣是双面的
      ao.updateGtaoMaterial({ radius: 0.28, distanceExponent: 1.2, thickness: 1.2, scale: 1.1, samples: 16 });
      ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
      ao.blendIntensity = 0.6;
      this.composer.addPass(ao);
    }
    this.backdrop = new BlurredBackdrop(W, H, quality === 'low' ? 2 : 4);
    const bloom = new UnrealBloomPass(new THREE.Vector2(W, H), 0.08, 0.5, 0.95);
    bloom.enabled = quality !== 'low' && !dbg.has('nobloom');
    this.composer.addPass(bloom);
    this.composer.addPass(new OutputPass());
    this.film = new ShaderPass(FilmShader);
    this.film.enabled = quality !== 'low' && !dbg.has('nofilm');
    this.composer.addPass(this.film);

    addEventListener('resize', () => this.resize());
    this.resize();
  }

  private resize() {
    const W = innerWidth, H = innerHeight;
    this.camera.aspect = W / H;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(W, H);
    this.composer.setSize(W, H);
    this.backdrop?.setSize(W, H);
    (this.film.uniforms.uRes.value as THREE.Vector2).set(W * this.renderer.getPixelRatio(), H * this.renderer.getPixelRatio());
  }

  /** 远处的虚化光斑：暗绿、暖黄为主，像在花园里用大光圈拍摄 */
  private makeBokehBackground() {
    const g = new THREE.Group();
    const tex = bokehTexture();
    const colors = ['#3c5a24', '#5a7a2c', '#2e4a1e', '#8a7a3a', '#6a5a2a', '#4a6a34'];
    for (let i = 0; i < 26; i++) {
      const m = new THREE.SpriteMaterial({
        map: tex, color: colors[i % colors.length], transparent: true, depthWrite: false,
        opacity: 0.2 + Math.random() * 0.3, blending: THREE.AdditiveBlending,
      });
      const s = new THREE.Sprite(m);
      s.layers.set(BG_LAYER);
      const a = Math.random() * Math.PI * 2;
      s.position.set(Math.cos(a) * (3 + Math.random() * 6), -1 + Math.random() * 5, -7 - Math.random() * 6);
      s.scale.setScalar(0.8 + Math.random() * 1.8);
      g.add(s);
    }
    // 远处虚化的绿叶：几块大小不一的深绿色叶片，虚化后就是照片里常见的“绿色背景”
    const leafMat = new THREE.MeshStandardMaterial({ color: '#2c4a1c', roughness: 0.8, side: THREE.DoubleSide });
    const leaves = [
      [-4.5, 0.5, -6, 2.6, 0.5], [4.2, 1.6, -7, 2.2, -0.4], [3.5, -2.2, -5, 2.8, 0.9],
      [-3.2, -2.6, -4.5, 2.0, -0.7], [0.6, 3.6, -9, 3.0, 0.2], [-6, 3, -8, 2.4, 1.2],
    ];
    for (const [x, y, z, s, rot] of leaves) {
      const leaf = new THREE.Mesh(new THREE.CircleGeometry(1, 32), leafMat);
      leaf.scale.set(s, s * 0.45, 1);
      leaf.position.set(x, y, z);
      leaf.rotation.set(-0.3, 0.2 * x, rot);
      leaf.layers.set(BG_LAYER);
      g.add(leaf);
    }
    return g;
  }

  get currentFlower() {
    return this.flower?.spec ?? null;
  }

  setAutoRotate(on: boolean) {
    this.controls.autoRotate = on;
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
    this.timeSec += dt;
    this.updateSwap(dt);
    this.flower?.update(openness, time);

    const pos = this.pollen.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      let y = pos.getY(i) + this.pollenVel[i] * dt * (0.4 + openness);
      if (y > 2) y = -1;
      pos.setY(i, y);
      pos.setX(i, pos.getX(i) + Math.sin(time * 0.5 + i) * 0.001);
    }
    pos.needsUpdate = true;
    (this.pollen.material as THREE.PointsMaterial).opacity = 0.35 * openness;
    this.keyLight.intensity = 3.0 + openness * 0.4;
    this.backLight.intensity = 3.4 + openness * 0.8;

    this.updateBurst(dt);
    this.shift += (this.shiftTarget - this.shift) * (1 - Math.exp(-dt * 2.5));
    const W = innerWidth, H = innerHeight;
    if (Math.abs(this.shift) > 1e-4) this.camera.setViewOffset(W, H, -this.shift * W, 0, W, H);
    else if (this.camera.view?.enabled) this.camera.clearViewOffset();
    this.controls.update(dt);

    // 背景单独虚化后铺在花朵后面
    this.scene.background = this.backdrop.render(this.renderer, this.scene, this.camera);
    this.film.uniforms.uTime.value = this.timeSec;
    this.composer.render(dt);
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
