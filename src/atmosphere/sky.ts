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
  // 地平线：城市光污染的紫红辉光 -> 天顶深蓝黑
  vec3 zenith = vec3(0.008, 0.010, 0.030);
  vec3 horizon = vec3(0.16, 0.06, 0.18);
  vec3 col = mix(horizon, zenith, pow(h, 0.45));

  // 星点（高处才可见）
  vec2 cell = floor(vDir.xz / max(vDir.y, 0.08) * 240.0);
  float star = step(0.9975, hash21(cell)) * smoothstep(0.15, 0.5, h);
  col += vec3(0.7, 0.8, 1.0) * star * 0.6;

  // 月亮
  vec3 moonDir = normalize(vec3(0.45, 0.55, 0.2));
  float moon = smoothstep(0.9992, 0.9997, dot(vDir, moonDir));
  col += vec3(0.75, 0.8, 0.95) * moon * 1.4;

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
