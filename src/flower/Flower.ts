import * as THREE from 'three';
import { leafTextures, petalTextures } from './textures';

/**
 * 程序化 3D 花朵（莲/芍药风格，多层花瓣）。
 * 每片花瓣有两个形态：
 *   - 闭合：包裹在一个“花苞”回转面上（同层花瓣半径错开，互不穿插）
 *   - 张开：沿弯曲中心线向外展开，带内凹和边缘波浪
 * 两个形态在“以花瓣基部为圆心的极坐标”里插值，看起来像真实地翻转展开，而不是直线缩放。
 */

interface LayerDef {
  n: number; // 花瓣数
  L: number; // 长度
  W: number; // 半宽
  rb: number; // 闭合时花苞半径
  pr: number; // 张开时基部半径
  py: number; // 张开时基部高度
  tilt: number; // 张开时与竖直方向夹角
  bend: number; // 张开时尖端外翻程度
  cup: number; // 张开时横向内凹
  delay: number; // 开放延迟（外层先开）
  tint: string;
}

const LAYERS: LayerDef[] = [
  { n: 6, L: 1.3, W: 0.5, rb: 0.3, pr: 0.13, py: 0.0, tilt: 1.42, bend: 0.55, cup: 0.32, delay: 0.0, tint: '#ffffff' },
  { n: 6, L: 1.2, W: 0.46, rb: 0.255, pr: 0.11, py: 0.04, tilt: 1.18, bend: 0.38, cup: 0.42, delay: 0.08, tint: '#fff6f8' },
  { n: 6, L: 1.06, W: 0.42, rb: 0.21, pr: 0.09, py: 0.08, tilt: 0.95, bend: 0.22, cup: 0.55, delay: 0.16, tint: '#fff0f4' },
  { n: 5, L: 0.88, W: 0.36, rb: 0.165, pr: 0.07, py: 0.11, tilt: 0.72, bend: 0.12, cup: 0.68, delay: 0.24, tint: '#ffeef3' },
  { n: 5, L: 0.66, W: 0.3, rb: 0.12, pr: 0.05, py: 0.13, tilt: 0.5, bend: 0.05, cup: 0.8, delay: 0.32, tint: '#fff4f6' },
];

const SEPAL: LayerDef = {
  n: 5, L: 0.62, W: 0.2, rb: 0.355, pr: 0.12, py: -0.06, tilt: 1.95, bend: 0.35, cup: 0.25, delay: 0, tint: '#ffffff',
};

const BUD_H = LAYERS[0].L * 0.96;
const SPAN = 0.62; // 每层开放所占的进度区间

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smooth = (x: number) => x * x * (3 - 2 * x);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** 花瓣轮廓：基部窄、尖端圆 */
function petalWidth(v: number) {
  const c = 0.62;
  if (v < c) return 0.16 + 0.84 * Math.pow(Math.sin(((v / c) * Math.PI) / 2), 0.9);
  const k = (v - c) / (1 - c);
  return Math.sqrt(Math.max(0, 1 - k * k));
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
  private tilt: number;
  private L: number;
  private ruffle: number;
  private phase: number;

  constructor(
    private def: LayerDef,
    private theta: number,
    private rbClosed: number,
    material: THREE.Material,
    private segU = 14,
    private segV = 24,
  ) {
    const nu = segU + 1, nv = segV + 1;
    this.pos = new Float32Array(nu * nv * 3);
    const uv = new Float32Array(nu * nv * 2);
    const idx: number[] = [];
    for (let j = 0; j < nv; j++)
      for (let i = 0; i < nu; i++) {
        const k = j * nu + i;
        uv[k * 2] = i / segU;
        uv[k * 2 + 1] = j / segV;
        if (i < segU && j < segV) {
          const a = k, b = k + 1, c = k + nu, d = k + nu + 1;
          idx.push(a, b, d, a, d, c);
        }
      }
    this.geom.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geom.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    this.geom.setIndex(idx);
    this.cR = new Float32Array(nv);
    this.cY = new Float32Array(nv);
    this.cA = new Float32Array(nv);

    // 每片花瓣的随机差异，让花更自然
    this.tilt = def.tilt + (Math.random() - 0.5) * 0.12;
    this.L = def.L * (0.95 + Math.random() * 0.08);
    this.ruffle = 0.02 + Math.random() * 0.03;
    this.phase = Math.random() * Math.PI * 2;

    this.mesh = new THREE.Mesh(this.geom, material);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
  }

  update(t: number, time: number) {
    const { segU, segV, def, pos, cR, cY, cA } = this;
    const L = this.L;
    const ds = L / segV;
    const sway = Math.sin(time * 0.9 + this.phase) * 0.025 * t;

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
      const sw = petalWidth(v) * def.W;
      const yc = v * L * 0.96;
      const rc = this.rbClosed * budProfile(yc / BUD_H);
      const a = cA[j];
      const nx = -Math.cos(a), ny = Math.sin(a); // 指向花心/上方的法向

      for (let i = 0; i <= segU; i++, k++) {
        const u = (i / segU) * 2 - 1;
        const x = u * sw;

        // 闭合：包在花苞回转面上
        const phi = Math.max(-2.8, Math.min(2.8, x / rc));
        const dC = Math.hypot(rc - pr, yc - py);
        const psiC = Math.atan2(rc - pr, yc - py);
        const alC = phi;

        // 张开：中心线 + 内凹 + 边缘波浪
        const off = def.cup * sw * u * u + this.ruffle * L * Math.sin(v * 11 + this.phase + u * 2) * Math.abs(u) ** 3;
        const rad = cR[j] + nx * off;
        const yy = cY[j] + ny * off;
        const rO = Math.hypot(rad, x);
        const dO = Math.hypot(rO - pr, yy - py);
        const psiO = Math.atan2(rO - pr, yy - py);
        const alO = Math.atan2(x, rad);

        // 以基部为圆心的极坐标插值
        const d = lerp(dC, dO, t);
        const psi = lerp(psiC, psiO, t);
        const al = this.theta + lerp(alC, alO, t);
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

/** 花蕊：实例化的花丝 + 花药 */
class Stamens {
  readonly group = new THREE.Group();
  private filaments: THREE.InstancedMesh;
  private anthers: THREE.InstancedMesh;
  private data: { base: THREE.Vector3; ang: number; len: number; spread: number }[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);
  private dir = new THREE.Vector3();
  private tip = new THREE.Vector3();

  constructor(count = 120) {
    const fGeo = new THREE.CylinderGeometry(0.0035, 0.005, 1, 5).translate(0, 0.5, 0);
    const aGeo = new THREE.SphereGeometry(1, 8, 6);
    const fMat = new THREE.MeshStandardMaterial({ color: '#f3e3a0', roughness: 0.6 });
    const aMat = new THREE.MeshStandardMaterial({ color: '#e8a422', roughness: 0.75, emissive: '#5a3000', emissiveIntensity: 0.25 });
    this.filaments = new THREE.InstancedMesh(fGeo, fMat, count);
    this.anthers = new THREE.InstancedMesh(aGeo, aMat, count);
    this.filaments.castShadow = this.anthers.castShadow = true;
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < count; i++) {
      const rr = 0.03 + 0.07 * Math.sqrt(i / count);
      const ang = i * golden;
      this.data.push({
        base: new THREE.Vector3(Math.sin(ang) * rr, 0.1, Math.cos(ang) * rr),
        ang,
        len: 0.2 + Math.random() * 0.1,
        spread: 0.25 + 0.75 * (rr / 0.1) + (Math.random() - 0.5) * 0.15,
      });
    }

    // 花托（莲蓬状）
    const pod = new THREE.Mesh(
      new THREE.CylinderGeometry(0.075, 0.05, 0.09, 24),
      new THREE.MeshStandardMaterial({ color: '#c9d46a', roughness: 0.8 }),
    );
    pod.position.y = 0.1;
    pod.castShadow = true;
    const dots = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.008, 6, 4),
      new THREE.MeshStandardMaterial({ color: '#8a9a3a', roughness: 0.9 }),
      12,
    );
    for (let i = 0; i < 12; i++) {
      const r = i === 0 ? 0 : 0.045;
      const a = (i / 11) * Math.PI * 2;
      this.m.makeTranslation(Math.sin(a) * r, 0.146, Math.cos(a) * r);
      dots.setMatrixAt(i, this.m);
    }
    this.group.add(pod, dots, this.filaments, this.anthers);
  }

  update(t: number, time: number) {
    this.data.forEach((d, i) => {
      const sp = lerp(0.04, d.spread, t) + Math.sin(time * 1.3 + i) * 0.02 * t;
      this.dir.set(Math.sin(d.ang) * Math.sin(sp), Math.cos(sp), Math.cos(d.ang) * Math.sin(sp));
      this.q.setFromUnitVectors(this.up, this.dir);
      const len = d.len * lerp(0.55, 1, t);
      this.m.compose(d.base, this.q, this.s.set(1, len, 1));
      this.filaments.setMatrixAt(i, this.m);
      this.tip.copy(d.base).addScaledVector(this.dir, len);
      this.m.compose(this.tip, this.q, this.s.set(0.011, 0.02, 0.011));
      this.anthers.setMatrixAt(i, this.m);
    });
    this.filaments.instanceMatrix.needsUpdate = true;
    this.anthers.instanceMatrix.needsUpdate = true;
  }
}

function leafGeometry(L: number, W: number) {
  const segU = 10, segV = 24;
  const g = new THREE.PlaneGeometry(1, 1, segU, segV);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const u = p.getX(i) * 2; // -1..1
    const v = p.getY(i) + 0.5; // 0..1
    const w = Math.pow(Math.sin(Math.PI * Math.min(v, 1)), 0.75) * W;
    const x = u * w;
    // 沿长度弯曲下垂 + 沿主脉对折
    const y = v * L;
    const z = 0.28 * L * v * v - Math.abs(u) * w * 0.35 + Math.sin(v * 9 + u * 3) * 0.012 * Math.abs(u);
    p.setXYZ(i, x, y * Math.cos(v * 0.9) , z + y * Math.sin(v * 0.9) * 0.5);
  }
  g.computeVertexNormals();
  return g;
}

export class Flower {
  readonly group = new THREE.Group();
  private head = new THREE.Group();
  private layers: Petal[][] = [];
  private sepals: Petal[] = [];
  private stamens = new Stamens();
  private leaves: THREE.Object3D[] = [];

  constructor() {
    const petalTex = petalTextures([
      [0, '#f7f0d8'],
      [0.18, '#fbe8e6'],
      [0.5, '#f7c3d2'],
      [0.8, '#ee8fb0'],
      [1, '#d9638e'],
    ]);
    const leafTex = leafTextures();

    LAYERS.forEach((def, li) => {
      const mat = new THREE.MeshPhysicalMaterial({
        map: petalTex.map,
        bumpMap: petalTex.bump,
        bumpScale: 0.6,
        color: def.tint,
        roughness: 0.55,
        sheen: 0.8,
        sheenColor: new THREE.Color('#ffd6e4'),
        sheenRoughness: 0.45,
        emissive: new THREE.Color('#ff7aa6'),
        emissiveMap: petalTex.map,
        emissiveIntensity: 0.06, // 模拟花瓣的透光感
        side: THREE.DoubleSide,
      });
      const row: Petal[] = [];
      const offset = li * 0.55 + (li % 2) * (Math.PI / def.n);
      for (let i = 0; i < def.n; i++) {
        const theta = offset + (i / def.n) * Math.PI * 2 + (Math.random() - 0.5) * 0.12;
        const p = new Petal(def, theta, def.rb + i * 0.007, mat);
        row.push(p);
        this.head.add(p.mesh);
      }
      this.layers.push(row);
    });

    const sepalMat = new THREE.MeshStandardMaterial({
      map: leafTex.map, bumpMap: leafTex.bump, bumpScale: 0.5, roughness: 0.7, side: THREE.DoubleSide,
    });
    for (let i = 0; i < SEPAL.n; i++) {
      const p = new Petal(SEPAL, (i / SEPAL.n) * Math.PI * 2 + 0.3, SEPAL.rb + i * 0.006, sepalMat, 8, 14);
      this.sepals.push(p);
      this.head.add(p.mesh);
    }
    this.head.add(this.stamens.group);

    // 花托下方的膨大部分
    const stemMat = new THREE.MeshStandardMaterial({ map: leafTex.map, roughness: 0.65 });
    const hip = new THREE.Mesh(new THREE.SphereGeometry(0.14, 24, 16), stemMat);
    hip.scale.set(1, 0.7, 1);
    hip.position.y = -0.04;
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
    const stem = new THREE.Mesh(new THREE.TubeGeometry(curve, 80, 0.048, 14), stemMat);
    stem.castShadow = stem.receiveShadow = true;
    this.group.add(stem);

    // 叶子
    const leafMat = new THREE.MeshStandardMaterial({
      map: leafTex.map, bumpMap: leafTex.bump, bumpScale: 0.8, roughness: 0.6, side: THREE.DoubleSide,
    });
    const leafSpecs = [
      { t: 0.42, rotY: 0.6, tilt: 0.95, L: 1.25, W: 0.3 },
      { t: 0.6, rotY: 3.6, tilt: 1.05, L: 1.1, W: 0.27 },
    ];
    for (const s of leafSpecs) {
      const leaf = new THREE.Mesh(leafGeometry(s.L, s.W), leafMat);
      leaf.castShadow = leaf.receiveShadow = true;
      const holder = new THREE.Group();
      holder.position.copy(curve.getPointAt(s.t));
      holder.rotation.y = s.rotY;
      leaf.rotation.x = s.tilt;
      holder.add(leaf);
      this.group.add(holder);
      this.leaves.push(leaf);
    }

    this.group.add(this.head);
    this.update(0, 0);
  }

  /** openness ∈ [0,1] */
  update(openness: number, time: number) {
    const o = clamp01(openness);
    this.layers.forEach((row, li) => {
      const t = smooth(clamp01((o - LAYERS[li].delay) / SPAN));
      for (const p of row) p.update(t, time);
    });
    const ts = smooth(clamp01(o / 0.55));
    for (const p of this.sepals) p.update(ts, time);
    this.stamens.update(smooth(clamp01((o - 0.25) / 0.75)), time);

    // 微风摆动 + 盛开时花头微微上扬
    this.head.rotation.z = Math.sin(time * 0.7) * 0.025;
    this.head.rotation.x = Math.sin(time * 0.5 + 1) * 0.02 - o * 0.05;
    this.head.scale.setScalar(1 + o * 0.06);
    this.leaves.forEach((l, i) => (l.rotation.z = Math.sin(time * 0.8 + i * 2) * 0.04));
  }
}
