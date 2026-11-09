import * as THREE from 'three';
import type { StamenDef } from './spec';
import { leafTextures, lotusPadTextures } from './textures';
import { BG_LAYER } from '../backdrop';

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * 花心：花蕊（花丝 + 花药）+ 可选的莲蓬 / 雌蕊。
 *   style = 'lotus'  莲花：倒圆锥形莲蓬，顶面嵌着一圈圈心皮；外围一圈细长花蕊，花药顶端有白色附属物
 *   style = 'default' 其它花：中心簇生花蕊，可选雌蕊
 */
export class Center {
  readonly group = new THREE.Group();
  private filaments: THREE.InstancedMesh;
  private anthers: THREE.InstancedMesh;
  private tips: THREE.InstancedMesh | null = null;
  private data: { base: THREE.Vector3; ang: number; len: number; spread: number; lean: number }[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);
  private dir = new THREE.Vector3();
  private tip = new THREE.Vector3();
  private lotus: boolean;

  constructor(private def: StamenDef) {
    this.lotus = def.style === 'lotus';
    const count = def.count;
    const fGeo = new THREE.CylinderGeometry(0.003, 0.0045, 1, 6).translate(0, 0.5, 0);
    const aGeo = new THREE.CapsuleGeometry(1, 2.2, 3, 8);
    const fMat = new THREE.MeshStandardMaterial({ color: def.filamentColor, roughness: 0.55 });
    const aMat = new THREE.MeshStandardMaterial({
      color: def.antherColor,
      roughness: 0.7,
      emissive: new THREE.Color(def.antherColor).multiplyScalar(0.25),
    });
    this.filaments = new THREE.InstancedMesh(fGeo, fMat, count);
    this.anthers = new THREE.InstancedMesh(aGeo, aMat, count);
    this.filaments.castShadow = this.anthers.castShadow = true;
    this.filaments.receiveShadow = this.anthers.receiveShadow = true;
    if (this.lotus) {
      // 莲花花药顶端的白色棒状附属物
      this.tips = new THREE.InstancedMesh(
        new THREE.SphereGeometry(1, 8, 6),
        new THREE.MeshStandardMaterial({ color: '#f3e6b0', roughness: 0.6 }),
        count,
      );
      this.tips.castShadow = true;
    }

    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < count; i++) {
      const ang = i * golden;
      let rr: number, y: number, spread: number;
      if (this.lotus) {
        rr = def.radius * (0.8 + 0.45 * Math.random()); // 围在莲蓬外侧一圈
        y = 0.03 + Math.random() * 0.03;
        spread = def.spread * (0.55 + 0.6 * Math.random());
      } else {
        rr = def.radius * (0.3 + 0.7 * Math.sqrt(i / count));
        y = 0.1;
        spread = def.spread * (0.25 + 0.75 * (rr / def.radius)) + (Math.random() - 0.5) * 0.15;
      }
      this.data.push({
        base: new THREE.Vector3(Math.sin(ang) * rr, y, Math.cos(ang) * rr),
        ang: ang + (Math.random() - 0.5) * 0.3,
        len: def.length[0] + Math.random() * (def.length[1] - def.length[0]),
        spread,
        lean: (Math.random() - 0.5) * 0.25,
      });
    }
    this.group.add(this.filaments, this.anthers);
    if (this.tips) this.group.add(this.tips);

    if (def.pod) {
      const pod = this.lotus ? lotusPod(def.pod) : smallPod(def.pod);
      if (this.lotus) {
        pod.scale.setScalar(1.25);
        pod.position.y = 0.02;
      }
      this.group.add(pod);
    }
    if (def.pistil) this.group.add(pistil(def.pistil));
  }

  update(t: number, time: number) {
    const a = this.def.antherSize;
    this.data.forEach((d, i) => {
      const sp = lerp(0.05, d.spread, t) + Math.sin(time * 1.3 + i) * 0.015 * t;
      const ang = d.ang + d.lean * t;
      this.dir.set(Math.sin(ang) * Math.sin(sp), Math.cos(sp), Math.cos(ang) * Math.sin(sp));
      this.q.setFromUnitVectors(this.up, this.dir);
      const len = d.len * lerp(0.6, 1, t);
      this.m.compose(d.base, this.q, this.s.set(1, len, 1));
      this.filaments.setMatrixAt(i, this.m);
      this.tip.copy(d.base).addScaledVector(this.dir, len);
      const r = this.lotus ? 0.0045 * a : 0.006 * a;
      this.tip.addScaledVector(this.dir, r * (this.lotus ? 2.0 : 0));
      this.m.compose(this.tip, this.q, this.s.set(r, r * (this.lotus ? 2.6 : 1.3), r));
      this.anthers.setMatrixAt(i, this.m);
      if (this.tips) {
        this.tip.addScaledVector(this.dir, r * 3.2);
        this.m.compose(this.tip, this.q, this.s.set(r * 0.55, r * 1.1, r * 0.55));
        this.tips.setMatrixAt(i, this.m);
      }
    });
    this.filaments.instanceMatrix.needsUpdate = true;
    this.anthers.instanceMatrix.needsUpdate = true;
    if (this.tips) this.tips.instanceMatrix.needsUpdate = true;
  }
}

/** 莲蓬：倒圆锥，顶面略平，嵌着心皮 */
function lotusPod(color: string) {
  const g = new THREE.Group();
  const profile = [
    [0.0, 0.205], [0.06, 0.204], [0.11, 0.2], [0.135, 0.193], [0.145, 0.18],
    [0.14, 0.15], [0.115, 0.1], [0.085, 0.055], [0.06, 0.02], [0.05, 0.0],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const body = new THREE.Mesh(
    new THREE.LatheGeometry(profile, 48),
    new THREE.MeshPhysicalMaterial({ color, roughness: 0.55, sheen: 0.6, sheenColor: new THREE.Color('#f8f2b0') }),
  );
  body.castShadow = body.receiveShadow = true;
  g.add(body);

  // 心皮：中心 1 个，外面两圈
  const rings = [[0, 1], [0.045, 7], [0.09, 12]] as const;
  const total = rings.reduce((s, [, n]) => s + n, 0);
  const carpel = new THREE.InstancedMesh(
    new THREE.SphereGeometry(1, 12, 8),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(color).offsetHSL(0.02, 0.05, -0.08), roughness: 0.5 }),
    total,
  );
  const stigma = new THREE.InstancedMesh(
    new THREE.SphereGeometry(1, 8, 6),
    new THREE.MeshStandardMaterial({ color: '#b9a23c', roughness: 0.6 }),
    total,
  );
  const m = new THREE.Matrix4();
  let k = 0;
  for (const [r, n] of rings)
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + r * 20;
      const x = Math.sin(a) * r, z = Math.cos(a) * r;
      m.compose(new THREE.Vector3(x, 0.2, z), new THREE.Quaternion(), new THREE.Vector3(0.014, 0.008, 0.014));
      carpel.setMatrixAt(k, m);
      m.compose(new THREE.Vector3(x, 0.208, z), new THREE.Quaternion(), new THREE.Vector3(0.004, 0.003, 0.004));
      stigma.setMatrixAt(k, m);
      k++;
    }
  g.add(carpel, stigma);
  return g;
}

/** 其它花的小花托 */
function smallPod(color: string) {
  const pod = new THREE.Mesh(
    new THREE.SphereGeometry(0.06, 24, 16),
    new THREE.MeshStandardMaterial({ color, roughness: 0.7 }),
  );
  pod.scale.set(1, 0.6, 1);
  pod.position.y = 0.11;
  pod.castShadow = true;
  return pod;
}

/** 雌蕊：子房 + 花柱 + 三裂柱头（郁金香等） */
function pistil(color: string) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.5 });
  const ovary = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.2, 12), mat);
  ovary.position.y = 0.2;
  const stigma = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const lobe = new THREE.Mesh(new THREE.SphereGeometry(0.022, 10, 8), mat);
    lobe.scale.set(1, 0.6, 1.6);
    lobe.position.set(Math.sin((i / 3) * Math.PI * 2) * 0.02, 0.31, Math.cos((i / 3) * Math.PI * 2) * 0.02);
    lobe.rotation.y = (i / 3) * Math.PI * 2;
    stigma.add(lobe);
  }
  g.add(ovary, stigma);
  g.traverse((o) => ((o as THREE.Mesh).castShadow = true));
  return g;
}

// ---------------- 叶子 ----------------

export type FoliageKind = 'lotus' | 'tulip' | 'leaves' | 'none';

export interface Foliage {
  group: THREE.Group;
  sway(time: number): void;
}

function leafGeometry(L: number, W: number, droop = 0.28, fold = 0.35) {
  const segU = 12, segV = 32;
  const g = new THREE.PlaneGeometry(1, 1, segU, segV);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const u = p.getX(i) * 2; // -1..1
    const v = p.getY(i) + 0.5; // 0..1
    const w = Math.pow(Math.sin(Math.PI * Math.min(v, 1)), 0.75) * W;
    const x = u * w;
    const y = v * L;
    const z = droop * L * v * v - Math.abs(u) * w * fold + Math.sin(v * 9 + u * 3) * 0.012 * Math.abs(u);
    p.setXYZ(i, x, y * Math.cos(v * 0.9), z + y * Math.sin(v * 0.9) * 0.5);
  }
  g.computeVertexNormals();
  return g;
}

/** 荷叶：大圆盘，中心下凹，边缘起伏 */
function lotusPadGeometry(R: number, seed: number) {
  const rings = 24, segs = 96;
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let r = 0; r <= rings; r++)
    for (let s = 0; s <= segs; s++) {
      const t = r / rings, a = (s / segs) * Math.PI * 2;
      const wave = Math.sin(a * 7 + seed) * 0.06 + Math.sin(a * 13 + seed * 2) * 0.025;
      const rr = R * t;
      const y = 0.22 * R * t * t + wave * R * Math.pow(t, 4) - 0.05 * R * (1 - t) * (1 - t);
      pos.push(Math.cos(a) * rr, y, Math.sin(a) * rr);
      uv.push(0.5 + Math.cos(a) * t * 0.5, 0.5 + Math.sin(a) * t * 0.5);
      if (r < rings && s < segs) {
        const i0 = r * (segs + 1) + s, i1 = i0 + segs + 1;
        idx.push(i0, i1, i0 + 1, i0 + 1, i1, i1 + 1);
      }
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export function buildFoliage(kind: FoliageKind, stem: THREE.CatmullRomCurve3): Foliage {
  const group = new THREE.Group();
  const swayers: { obj: THREE.Object3D; base: number; amp: number; speed: number }[] = [];

  if (kind === 'lotus') {
    const tex = lotusPadTextures();
    const mat = new THREE.MeshPhysicalMaterial({
      map: tex.map, normalMap: tex.normal, normalScale: new THREE.Vector2(0.45, 0.45), roughness: 0.85,
      sheen: 0.8, sheenRoughness: 0.6, sheenColor: new THREE.Color('#a8c8b0'), specularIntensity: 0.2,
      side: THREE.DoubleSide,
    });
    // 两片荷叶：一片在后方偏左，一片在前方偏右偏低，都在景深外会被虚化
    const pads = [
      { pos: [-2.3, -1.7, -2.9], rot: [0.12, 0.5, -0.08], R: 1.3 },
      { pos: [2.5, -2.4, -0.7], rot: [-0.1, 1.9, 0.1], R: 1.0 },
    ] as const;
    pads.forEach((p, i) => {
      const pad = new THREE.Mesh(lotusPadGeometry(p.R, i * 3.1), mat);
      pad.position.set(p.pos[0], p.pos[1], p.pos[2]);
      pad.rotation.set(p.rot[0], p.rot[1], p.rot[2]);
      pad.layers.set(BG_LAYER); // 荷叶在背景里，单独虚化
      group.add(pad);
      swayers.push({ obj: pad, base: p.rot[2], amp: 0.015, speed: 0.4 + i * 0.2 });
    });
  } else if (kind === 'tulip' || kind === 'leaves') {
    const tulip = kind === 'tulip';
    const tex = leafTextures(kind, tulip ? ['#5c7a48', '#55744a', '#6a8a52'] : undefined);
    const mat = new THREE.MeshPhysicalMaterial({
      map: tex.map, normalMap: tex.normal, roughness: tulip ? 0.5 : 0.6,
      sheen: tulip ? 0.6 : 0.2, sheenColor: new THREE.Color('#b8c8a0'), side: THREE.DoubleSide,
    });
    const specs = tulip
      ? [
          { t: 0.62, rotY: 0.3, tilt: 0.32, L: 2.3, W: 0.34, droop: 0.12, fold: 0.6 },
          { t: 0.7, rotY: 3.4, tilt: 0.4, L: 2.0, W: 0.3, droop: 0.16, fold: 0.6 },
        ]
      : [
          { t: 0.42, rotY: 0.6, tilt: 0.95, L: 1.25, W: 0.3, droop: 0.28, fold: 0.35 },
          { t: 0.6, rotY: 3.6, tilt: 1.05, L: 1.1, W: 0.27, droop: 0.28, fold: 0.35 },
        ];
    for (const s of specs) {
      const leaf = new THREE.Mesh(leafGeometry(s.L, s.W, s.droop, s.fold), mat);
      leaf.castShadow = leaf.receiveShadow = true;
      const holder = new THREE.Group();
      holder.position.copy(stem.getPointAt(s.t));
      holder.rotation.y = s.rotY;
      leaf.rotation.x = s.tilt;
      holder.add(leaf);
      group.add(holder);
      swayers.push({ obj: leaf, base: 0, amp: 0.035, speed: 0.8 });
    }
  }

  return {
    group,
    sway(time) {
      swayers.forEach((s, i) => (s.obj.rotation.z = s.base + Math.sin(time * s.speed + i * 2) * s.amp));
    },
  };
}

/** 莲花茎上的细小刺 */
export function stemPrickles(stem: THREE.CatmullRomCurve3, radius: number, color: string) {
  const n = 160;
  const mesh = new THREE.InstancedMesh(
    new THREE.ConeGeometry(1, 3, 5).translate(0, 1.5, 0),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(color).multiplyScalar(0.7), roughness: 0.8 }),
    n,
  );
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < n; i++) {
    const t = 0.03 + Math.random() * 0.9;
    const p = stem.getPointAt(t);
    const a = Math.random() * Math.PI * 2;
    const out = new THREE.Vector3(Math.cos(a), 0.35, Math.sin(a)).normalize();
    p.addScaledVector(new THREE.Vector3(Math.cos(a), 0, Math.sin(a)), radius * 0.95);
    q.setFromUnitVectors(up, out);
    const s = 0.0022 + Math.random() * 0.0018;
    m.compose(p, q, new THREE.Vector3(s, s, s));
    mesh.setMatrixAt(i, m);
  }
  return mesh;
}
