import * as THREE from 'three';
import { FOG_COLOR, FOG_DENSITY } from '../core/engine';

const VERT = /* glsl */ `
varying vec2 vWorld;
varying float vDist;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xz;
  vec4 view = viewMatrix * world;
  vDist = -view.z;
  gl_Position = projectionMatrix * view;
}
`;

const FRAG = /* glsl */ `
uniform vec3 uFogColor;
uniform float uFogDensity;
varying vec2 vWorld;
varying float vDist;

float roadGlow(float coord, float spacing, float width) {
  float r = mod(coord, spacing);
  float d = min(r, spacing - r);
  return smoothstep(width, 0.0, d);
}

void main() {
  float cityMask = 1.0 - smoothstep(3400.0, 4400.0, length(vWorld));

  // 城内湿沥青偏蓝，城外恶土偏棕
  vec3 col = mix(vec3(0.05, 0.042, 0.034), vec3(0.030, 0.034, 0.052), cityMask);

  // 路网灯带（与 layout ROAD_SPACING=480 对齐）
  float gx = roadGlow(vWorld.x, 480.0, 7.0);
  float gy = roadGlow(vWorld.y, 480.0, 7.0);
  float g = max(gx, gy);
  col += vec3(0.12, 0.55, 0.85) * g * 0.4 * cityMask;

  // 路口加亮
  col += vec3(0.9, 0.75, 0.4) * gx * gy * 0.5 * cityMask;

  float fogF = 1.0 - exp(-uFogDensity * uFogDensity * vDist * vDist);
  col = mix(col, uFogColor, clamp(fogF, 0.0, 1.0));
  gl_FragColor = vec4(col, 1.0);
}
`;

export function createGround(): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uFogColor: { value: new THREE.Color(FOG_COLOR) },
      uFogDensity: { value: FOG_DENSITY },
    },
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(24000, 24000), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = -0.1;
  return mesh;
}
