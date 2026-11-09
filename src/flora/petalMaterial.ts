import * as THREE from 'three';

/**
 * 花瓣材质：在 MeshPhysicalMaterial 的基础上加“薄片透光”。
 * 真实花瓣只有零点几毫米厚，光从背面照过来时会透出一层发亮的颜色——这是照片里花瓣看起来“软、活”的关键。
 * 做法：替换 three.js 的直射光计算 RE_Direct，在原有光照之外，再加上从背面射入、穿过花瓣的那部分光。
 * 因为加在 RE_Direct 里，用的是已经乘过阴影的光照：被外层花瓣挡住的内层花瓣不会乱发光。
 */

export interface PetalMaterialOptions {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  tint: THREE.ColorRepresentation;
  sheenColor: THREE.ColorRepresentation;
  /** 透光颜色（通常取花瓣主色、更饱和一些） */
  transmitColor: THREE.ColorRepresentation;
  /** 透光强度 0~1.5 */
  transmit: number;
}

const PARS = /* glsl */ `
uniform vec3 uTransmit;
void RE_Direct_Petal( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
  RE_Direct_Physical( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
  // 光从花瓣另一面射入的程度
  float back = saturate( dot( -geometryNormal, directLight.direction ) );
  // 视线正对光源（逆光看花瓣）时透光最强
  float forward = pow( saturate( dot( -geometryViewDir, directLight.direction ) ), 4.0 );
  // 花瓣边缘和尖端更薄、更透
  vec2 tuv = vMapUv;
  float thin = mix( 0.35, 1.0, smoothstep( 0.0, 0.7, tuv.y ) ) * mix( 0.85, 1.25, abs( tuv.x * 2.0 - 1.0 ) );
  // 侧对视线（花瓣边缘）时减弱，避免描边感
  float facing = 0.3 + 0.7 * saturate( abs( dot( geometryNormal, geometryViewDir ) ) * 1.6 );
  reflectedLight.directDiffuse += directLight.color * uTransmit * material.diffuseColor * thin * back * facing * ( 0.45 + 1.6 * forward );
}
#undef RE_Direct
#define RE_Direct RE_Direct_Petal
`;

export function createPetalMaterial(o: PetalMaterialOptions) {
  const mat = new THREE.MeshPhysicalMaterial({
    map: o.map,
    normalMap: o.normalMap,
    normalScale: new THREE.Vector2(0.32, 0.32),
    color: o.tint,
    vertexColors: true,
    roughness: 0.42,
    sheen: 0.35,
    sheenColor: new THREE.Color(o.sheenColor),
    sheenRoughness: 0.35,
    specularIntensity: 0.5,
    // 模拟花朵内部光线相互反射，阴影里的白花瓣带一点自身的粉白色，不会发灰
    emissive: new THREE.Color(0xffffff),
    emissiveMap: o.map,
    emissiveIntensity: 0.1,
    side: THREE.DoubleSide,
  });
  const transmit = new THREE.Color(o.transmitColor).multiplyScalar(o.transmit);
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTransmit = { value: transmit };
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <lights_physical_pars_fragment>',
      `#include <lights_physical_pars_fragment>\n${PARS}`,
    );
  };
  // 不同透光参数的材质需要各自编译
  mat.customProgramCacheKey = () => 'petal-transmit';
  return mat;
}
