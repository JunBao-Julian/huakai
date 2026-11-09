import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

/**
 * 背景虚化：像大光圈微距摄影那样，主体清晰、背景化开。
 * 背景物体（荷叶、远处光斑）放在单独的图层 BG_LAYER 上，先单独渲染到一张低分辨率贴图，
 * 再做几轮大半径高斯模糊，最后作为场景背景铺在清晰的花朵后面。
 * 比通用的景深后期更干净：不会出现前景花瓣“半透明重影”。
 */

export const BG_LAYER = 1;

const BlurShader = {
  uniforms: { tDiffuse: { value: null as THREE.Texture | null }, uDir: { value: new THREE.Vector2() } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform vec2 uDir; varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv) * 0.1964825501511404;
      c += texture2D(tDiffuse, vUv + uDir * 1.411764705882353) * 0.2969069646728344;
      c += texture2D(tDiffuse, vUv - uDir * 1.411764705882353) * 0.2969069646728344;
      c += texture2D(tDiffuse, vUv + uDir * 3.2941176470588234) * 0.09447039785044732;
      c += texture2D(tDiffuse, vUv - uDir * 3.2941176470588234) * 0.09447039785044732;
      c += texture2D(tDiffuse, vUv + uDir * 5.176470588235294) * 0.010381362401148057;
      c += texture2D(tDiffuse, vUv - uDir * 5.176470588235294) * 0.010381362401148057;
      gl_FragColor = c;
    }`,
};

export class BlurredBackdrop {
  private a: THREE.WebGLRenderTarget;
  private b: THREE.WebGLRenderTarget;
  private mat = new THREE.ShaderMaterial(BlurShader);
  private quad = new FullScreenQuad(this.mat);
  private clear = new THREE.Color('#050405');

  constructor(width: number, height: number, private iterations = 4, private scale = 0.25) {
    const opts = { type: THREE.HalfFloatType, depthBuffer: true } as const;
    this.a = new THREE.WebGLRenderTarget(1, 1, opts);
    this.b = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
    this.setSize(width, height);
  }

  get texture() {
    return this.a.texture;
  }

  setSize(width: number, height: number) {
    const w = Math.max(1, Math.round(width * this.scale)), h = Math.max(1, Math.round(height * this.scale));
    this.a.setSize(w, h);
    this.b.setSize(w, h);
  }

  /** 渲染并模糊背景图层，返回可直接用作 scene.background 的贴图 */
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    const mask = camera.layers.mask;
    const bg = scene.background;
    const shadowAuto = renderer.shadowMap.autoUpdate;
    camera.layers.set(BG_LAYER);
    scene.background = this.clear;
    renderer.shadowMap.autoUpdate = false; // 背景不需要重新计算阴影
    renderer.setRenderTarget(this.a);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.shadowMap.autoUpdate = shadowAuto;

    const w = this.a.width, h = this.a.height;
    for (let i = 0; i < this.iterations; i++) {
      const spread = 1 + i;
      this.mat.uniforms.tDiffuse.value = this.a.texture;
      this.mat.uniforms.uDir.value.set(spread / w, 0);
      renderer.setRenderTarget(this.b);
      this.quad.render(renderer);
      this.mat.uniforms.tDiffuse.value = this.b.texture;
      this.mat.uniforms.uDir.value.set(0, spread / h);
      renderer.setRenderTarget(this.a);
      this.quad.render(renderer);
    }
    renderer.setRenderTarget(null);
    camera.layers.mask = mask;
    scene.background = bg;
    return this.a.texture;
  }
}
