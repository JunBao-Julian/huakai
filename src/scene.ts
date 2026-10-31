import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Flower } from './flower/Flower';
import { softDotTexture } from './flower/textures';

export class BloomScene {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private flower = new Flower();
  private pollen: THREE.Points;
  private pollenVel: Float32Array;
  private keyLight: THREE.DirectionalLight;

  constructor(container: HTMLElement) {
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

    this.scene.add(this.flower.group);

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
        size: 0.045,
        map: softDotTexture(),
        color: '#ffd9a8',
        transparent: true,
        opacity: 0.2,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.scene.add(this.pollen);

    addEventListener('resize', () => {
      this.camera.aspect = innerWidth / innerHeight;
      this.camera.updateProjectionMatrix();
      r.setSize(innerWidth, innerHeight);
    });
  }

  render(openness: number, time: number, dt: number) {
    this.flower.update(openness, time);

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

    this.controls.update(dt);
    this.renderer.render(this.scene, this.camera);
  }
}
