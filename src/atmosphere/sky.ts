import * as THREE from 'three';

export interface Sky {
  mesh: THREE.Mesh;
  setFlash(v: number): void;
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

float hash21(vec2 p) {
  p = fract(p * vec2(234.34, 435.345));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}

void main() {
  float h = clamp(vDir.y, 0.0, 1.0);
  // 夜之城的天：被光污染熏成暗琥珀的烟雾地平线 -> 近黑的天顶
  vec3 zenith = vec3(0.004, 0.005, 0.012);
  vec3 smogLow = vec3(0.30, 0.14, 0.05);   // 贴地烟雾琥珀
  vec3 smogHigh = vec3(0.07, 0.045, 0.06); // 高层雾紫灰
  vec3 col = zenith;
  col += smogHigh * pow(1.0 - h, 2.5);
  col += smogLow * pow(1.0 - h, 9.0);

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
    uniforms: { uFlash: { value: 0 } },
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(15000, 32, 16), mat);
  mesh.frustumCulled = false;
  return {
    mesh,
    setFlash(v: number) { mat.uniforms.uFlash.value = v; },
  };
}
