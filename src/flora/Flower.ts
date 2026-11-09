import * as THREE from 'three';
import { leafTextures, petalTextures } from './textures';
import { createPetalMaterial } from './petalMaterial';
import { buildFoliage, Center, stemPrickles, type Foliage } from './parts';
import type { CompiledFlower, LayerDef } from './spec';

/**
 * 程序化 3D 花朵：形状、颜色、层数都来自 FlowerSpec（见 spec.ts 和 content/flowers）。
 * 每片花瓣有两个形态：
 *   - 闭合：包裹在一个“花苞”回转面上（同层花瓣半径错开，互不穿插）
 *   - 张开：沿弯曲中心线向外展开，带内凹和边缘波浪
 * 两个形态在“以花瓣基部为圆心的极坐标”里插值，看起来像真实地翻转展开，而不是直线缩放。
 */

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smooth = (x: number) => x * x * (3 - 2 * x);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const STAGGER = 0.007;

type Shape = CompiledFlower['petalShape'];

/** 花瓣轮廓：根部窄，最宽处之后收向尖端；tip 决定是圆头还是尖头 */
function petalWidth(v: number, s: Shape) {
  const c = s.widest;
  if (v < c) return s.base + (1 - s.base) * Math.pow(Math.sin(((v / c) * Math.PI) / 2), 0.9);
  const k = Math.min(1, (v - c) / (1 - c));
  const round = Math.sqrt(Math.max(0, 1 - k * k));
  const pointed = Math.pow(Math.cos((k * Math.PI) / 2), 1.15);
  return lerp(round, pointed, s.tip);
}

/** 花苞侧面轮廓（相对半径 vs 高度） */
function budProfile(t: number) {
  return 0.15 + 0.85 * Math.sin(Math.PI * (0.3 + 0.7 * clamp01(t)));
}

class Petal {
  readonly mesh: THREE.Mesh;
  private geom = new THREE.BufferGeometry();
  private pos: Float32Array;
  private cR: Float32Array;
  private cY: Float32Array;
  private cA: Float32Array;
  private widths: Float32Array;
  private tilt: number;
  private L: number;
  private ruffle: number;
  private phase: number;
  private twist: number;
  private ripple: number;

  constructor(
    private def: LayerDef,
    private theta: number,
    private rbClosed: number,
    private budH: number,
    ruffleScale: number,
    shape: Shape,
    material: THREE.Material,
    private segU = 20,
    private segV = 36,
  ) {
    const nu = segU + 1, nv = segV + 1;
    this.pos = new Float32Array(nu * nv * 3);
    const uv = new Float32Array(nu * nv * 2);
    const col = new Float32Array(nu * nv * 3);
    const idx: number[] = [];

    // 每片花瓣颜色略有不同：真实的花不会每片都一模一样
    const c = new THREE.Color(1, 1, 1).offsetHSL((Math.random() - 0.5) * 0.02, (Math.random() - 0.5) * 0.1, (Math.random() - 0.5) * 0.09);
    for (let j = 0; j < nv; j++)
      for (let i = 0; i < nu; i++) {
        const k = j * nu + i;
        uv[k * 2] = i / segU;
        uv[k * 2 + 1] = j / segV;
        col.set([c.r, c.g, c.b], k * 3);
        if (i < segU && j < segV) {
          const a = k, b = k + 1, cc = k + nu, d = k + nu + 1;
          idx.push(a, b, d, a, d, cc);
        }
      }
    this.geom.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geom.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    this.geom.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.geom.setIndex(idx);
    this.cR = new Float32Array(nv);
    this.cY = new Float32Array(nv);
    this.cA = new Float32Array(nv);

    // 每片花瓣的随机差异：倾角、长度、波浪、轻微扭转、轮廓的不规则
    this.tilt = def.tilt + (Math.random() - 0.5) * 0.12;
    this.L = def.L * (0.94 + Math.random() * 0.1);
    this.ruffle = (0.02 + Math.random() * 0.03) * ruffleScale;
    this.phase = Math.random() * Math.PI * 2;
    // 一层花瓣越多越拥挤，扭转和起伏要收敛一些
    const crowd = Math.min(1, 5 / def.n);
    this.twist = (Math.random() - 0.5) * 0.18 * crowd;
    this.ripple = (0.006 + Math.random() * 0.008) * crowd;
    const wJitter = 0.93 + Math.random() * 0.12;
    const p1 = Math.random() * 6, p2 = Math.random() * 6;
    this.widths = new Float32Array(nv);
    for (let j = 0; j < nv; j++) {
      const v = j / segV;
      const wobble = 1 + 0.025 * Math.sin(v * 9 + p1) + 0.015 * Math.sin(v * 23 + p2);
      this.widths[j] = petalWidth(v, shape) * def.W * wJitter * wobble;
    }

    this.mesh = new THREE.Mesh(this.geom, material);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
  }

  update(t: number, time: number) {
    const { segU, segV, def, pos, cR, cY, cA } = this;
    const L = this.L;
    const ds = L / segV;
    const sway = Math.sin(time * 0.9 + this.phase) * 0.02 * t;

    // 张开形态的弯曲中心线（在径向-竖直平面内）
    cR[0] = def.pr;
    cY[0] = def.py;
    for (let j = 0; j <= segV; j++) {
      const v = j / segV;
      cA[j] = this.tilt * (0.72 + 0.28 * v) + def.bend * v * v + sway;
      if (j > 0) {
        const a = (cA[j] + cA[j - 1]) / 2;
        cR[j] = cR[j - 1] + ds * Math.sin(a);
        cY[j] = cY[j - 1] + ds * Math.cos(a);
      }
    }

    const pr = def.pr, py = def.py;
    let k = 0;
    for (let j = 0; j <= segV; j++) {
      const v = j / segV;
      const sw = this.widths[j];
      const yc = v * L * 0.96;
      const rc = this.rbClosed * budProfile(yc / this.budH);
      const a = cA[j];
      const nx = -Math.cos(a), ny = Math.sin(a); // 指向花心/上方的法向
      const tw = this.twist * v * t;

      for (let i = 0; i <= segU; i++, k++) {
        const u = (i / segU) * 2 - 1;
        const x = u * sw;

        // 闭合：包在花苞回转面上
        const phi = Math.max(-2.8, Math.min(2.8, x / rc));
        const dC = Math.hypot(rc - pr, yc - py);
        const psiC = Math.atan2(rc - pr, yc - py);
        const alC = phi;

        // 张开：中心线 + 横向内凹（越靠边越上翘）+ 边缘波浪 + 轻微扭转
        const cupK = def.cup * (0.55 + 0.45 * Math.sin(Math.PI * Math.min(1, v * 1.15)));
        const off =
          cupK * sw * u * u +
          this.ruffle * L * Math.sin(v * 11 + this.phase + u * 2) * Math.abs(u) ** 3 +
          tw * x +
          // 纵向的细微起伏：真实花瓣不是一张平整的曲面
          this.ripple * L * Math.sin(u * Math.PI * 2.5 + this.phase) * Math.sin(Math.PI * v);
        const rad = cR[j] + nx * off;
        const yy = cY[j] + ny * off;
        const rO = Math.hypot(rad, x);
        const dO = Math.hypot(rO - pr, yy - py);
        const psiO = Math.atan2(rO - pr, yy - py);
        const alO = Math.atan2(x, rad);

        // 以基部为圆心的极坐标插值
        const d = lerp(dC, dO, t);
        const psi = lerp(psiC, psiO, t);
        // 花瓣先“松开”成各自的船形，再逐渐向外倾倒：半开时像真实的莲花一样是杯状，而不是一圈圈的玫瑰
        const ta = 1 - (1 - t) * (1 - t);
        const al = this.theta + lerp(alC, alO, ta);
        const r = Math.max(0.001, pr + d * Math.sin(psi));
        const y = py + d * Math.cos(psi);

        pos[k * 3] = r * Math.sin(al);
        pos[k * 3 + 1] = y;
        pos[k * 3 + 2] = r * Math.cos(al);
      }
    }
    this.geom.attributes.position.needsUpdate = true;
    this.geom.computeVertexNormals();
  }
}

export class Flower {
  readonly group = new THREE.Group();
  readonly head = new THREE.Group();
  private layers: Petal[][] = [];
  private sepals: Petal[] = [];
  private center: Center | null = null;
  private foliage: Foliage;

  constructor(readonly spec: CompiledFlower) {
    const P = spec;
    const tex = petalTextures({ stops: P.petalColors, edgeRGB: P.edgeRGB, veinRGB: P.veinRGB, veins: P.veins, seed: P.id });
    const leafTex = leafTextures(`${P.id}-leaf`);
    const budH = P.layers[0].L * 0.96;

    P.layers.forEach((def, li) => {
      const mat = createPetalMaterial({
        map: tex.map,
        normalMap: tex.normal,
        tint: def.tint,
        sheenColor: P.sheenColor,
        transmitColor: P.transmitColor,
        // 内层花瓣被外层遮挡，透光略弱
        transmit: P.transmit * (1 - li * 0.08),
      });
      const row: Petal[] = [];
      const offset = li * 0.55 + (li % 2) * (Math.PI / def.n);
      for (let i = 0; i < def.n; i++) {
        const theta = offset + (i / def.n) * Math.PI * 2 + (Math.random() - 0.5) * 0.12;
        // 越靠内的花瓣越短小，波浪也相应减弱，避免互相穿插
        const ruffle = P.ruffle * Math.max(0.35, 1 - li * 0.15);
        const p = new Petal(def, theta, def.rb + i * STAGGER, budH, ruffle, P.petalShape, mat);
        row.push(p);
        this.head.add(p.mesh);
      }
      this.layers.push(row);
    });

    if (P.sepal) {
      const S = P.sepal;
      const sepalMat = new THREE.MeshPhysicalMaterial({
        map: leafTex.map, normalMap: leafTex.normal, roughness: 0.65, sheen: 0.3,
        sheenColor: new THREE.Color('#b0c890'), side: THREE.DoubleSide, vertexColors: true,
      });
      for (let i = 0; i < S.n; i++) {
        const p = new Petal(S, (i / S.n) * Math.PI * 2 + 0.3, S.rb + i * 0.006, budH, 0.5,
          { tip: 0.6, widest: 0.5, base: 0.3 }, sepalMat, 10, 18);
        this.sepals.push(p);
        this.head.add(p.mesh);
      }
    }
    if (P.stamens) {
      this.center = new Center(P.stamens);
      this.head.add(this.center.group);
    }

    const stemMat = new THREE.MeshPhysicalMaterial({
      color: P.stemColor, normalMap: leafTex.normal, normalScale: new THREE.Vector2(0.3, 0.3),
      roughness: 0.55, sheen: 0.4, sheenColor: new THREE.Color('#c8d8a0'),
    });
    // 花托下方的膨大部分
    const hip = new THREE.Mesh(new THREE.SphereGeometry(0.12, 32, 20), stemMat);
    hip.scale.set(1, 0.65, 1);
    hip.position.y = -0.03;
    hip.castShadow = true;
    this.head.add(hip);

    // 茎
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, -0.05, 0),
      new THREE.Vector3(0.02, -0.7, 0.03),
      new THREE.Vector3(0.09, -1.7, 0.05),
      new THREE.Vector3(0.05, -2.9, 0.0),
      new THREE.Vector3(0.1, -4.6, -0.05),
    ]);
    const stem = new THREE.Mesh(new THREE.TubeGeometry(curve, 120, 0.05, 20), stemMat);
    stem.castShadow = stem.receiveShadow = true;
    this.group.add(stem);
    if (P.foliage === 'lotus') this.group.add(stemPrickles(curve, 0.05, P.stemColor));

    this.foliage = buildFoliage(P.foliage, curve);
    this.group.add(this.foliage.group);

    this.group.add(this.head);
    this.update(0, 0);
  }

  /** openness ∈ [0,1] */
  update(openness: number, time: number) {
    const o = clamp01(openness);
    const { layers, span } = this.spec;
    this.layers.forEach((row, li) => {
      const t = smooth(clamp01((o - layers[li].delay) / span));
      for (const p of row) p.update(t, time);
    });
    const ts = smooth(clamp01(o / 0.55));
    for (const p of this.sepals) p.update(ts, time);
    this.center?.update(smooth(clamp01((o - 0.25) / 0.75)), time);

    // 微风摆动 + 盛开时花头微微上扬
    this.head.rotation.z = Math.sin(time * 0.7) * 0.02;
    this.head.rotation.x = Math.sin(time * 0.5 + 1) * 0.015 - o * 0.05;
    this.head.scale.setScalar(1 + o * 0.04);
    this.foliage.sway(time);
  }

  /** 释放显存（切换花朵时调用） */
  dispose() {
    const textures = new Set<THREE.Texture>();
    this.group.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.dispose();
      for (const m of ([] as THREE.Material[]).concat(mesh.material)) {
        for (const v of Object.values(m)) if (v instanceof THREE.Texture) textures.add(v);
        m.dispose();
      }
    });
    textures.forEach((t) => t.dispose());
  }
}
