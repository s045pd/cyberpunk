import * as THREE from 'three';

export interface Sky {
  mesh: THREE.Mesh;
  setFlash(v: number): void;
  update(t: number): void;
}

const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
varying vec3 vDir;
uniform float uFlash;
uniform float uTime;

float hash21(vec2 p) {
  p = fract(p * vec2(234.34, 435.345));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

void main() {
  float h = clamp(vDir.y, 0.0, 1.0);
  // 夜之城的天：被光污染熏浊的烟雾地平线 -> 近黑的天顶
  vec3 zenith = vec3(0.004, 0.005, 0.012);
  vec3 smogLow = vec3(0.22, 0.12, 0.06);   // 贴地烟雾琥珀（去饱和）
  vec3 smogHigh = vec3(0.06, 0.05, 0.065); // 高层雾灰
  vec3 col = zenith;
  col += smogHigh * pow(1.0 - h, 2.5);
  col += smogLow * pow(1.0 - h, 9.0);

  // 低空云层：被城市光从下面染亮的碎云
  vec2 cuv = vDir.xz / max(vDir.y + 0.15, 0.05);
  float cl = vnoise(cuv * 1.8 + uTime * 0.006) * 0.62
           + vnoise(cuv * 4.6 - uTime * 0.009) * 0.38;
  float cloudMask = smoothstep(0.48, 0.78, cl)
                  * smoothstep(0.5, 0.1, h) * step(0.015, vDir.y);
  col = mix(col, vec3(0.085, 0.06, 0.055), cloudMask * 0.85);

  // 星点：光污染下只剩少量、很暗
  vec2 cell = floor(vDir.xz / max(vDir.y, 0.08) * 240.0);
  float star = step(0.999, hash21(cell)) * smoothstep(0.25, 0.6, h);
  col += vec3(0.6, 0.7, 0.9) * star * 0.25;

  // 月亮：小而昏
  vec3 moonDir = normalize(vec3(0.45, 0.55, 0.2));
  float moon = smoothstep(0.99955, 0.9998, dot(vDir, moonDir));
  col += vec3(0.5, 0.52, 0.6) * moon * 0.8;

  // 闪电闪光
  col += vec3(0.55, 0.6, 0.9) * uFlash;

  gl_FragColor = vec4(col, 1.0);
}
`;

export function createSky(): Sky {
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: { uFlash: { value: 0 }, uTime: { value: 0 } },
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(15000, 32, 16), mat);
  mesh.frustumCulled = false;
  return {
    mesh,
    setFlash(v: number) { mat.uniforms.uFlash.value = v; },
    update(t: number) { mat.uniforms.uTime.value = t; },
  };
}
