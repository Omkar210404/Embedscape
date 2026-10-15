import * as THREE from "three";
import type { RGB } from "../math/colors";

// One draw call for every word: soft round sprites, size falls off with distance,
// and exponential depth fog towards the background colour.

const vertexShader = /* glsl */ `
  attribute vec3 color;
  attribute float state;      // 0 normal, 1 neighbour, 2 focus
  uniform float uSize;
  uniform float uPixelRatio;
  uniform float uDim;         // 0..1, fades words that are not focused or neighbours
  varying vec3 vColor;
  varying float vAlpha;
  varying float vDepth;
  varying float vState;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float boost = state > 1.5 ? 2.6 : (state > 0.5 ? 1.7 : 1.0);
    // Perspective size, but never smaller than ~2 CSS px so distant words stay visible.
    gl_PointSize = max(uSize * boost * uPixelRatio * (90.0 / -mv.z), 2.0 * boost * uPixelRatio);
    gl_Position = projectionMatrix * mv;
    vColor = color;
    vState = state;
    vAlpha = state > 0.5 ? 1.0 : mix(0.9, 0.2, uDim);
    vDepth = -mv.z;
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vDepth;
  varying float vState;
  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float r = length(p);
    if (r > 0.5) discard;
    float core = smoothstep(0.5, 0.1, r);
    vec3 col = vState > 1.5 ? mix(vColor, vec3(1.0), 0.55) : vColor;
    float fog = 1.0 - exp(-uFogDensity * uFogDensity * vDepth * vDepth);
    if (vState > 0.5) fog *= 0.35;   // keep the focused group readable through the fog
    gl_FragColor = vec4(mix(col, uFogColor, fog), core * vAlpha * (1.0 - fog * 0.6));
  }
`;

export class WordPoints {
  readonly object: THREE.Points;
  private readonly state: THREE.BufferAttribute;
  private readonly material: THREE.ShaderMaterial;
  private dimTarget = 0;

  constructor(positions: Float32Array, colors: RGB[], cluster: Uint8Array, fogColor: THREE.Color) {
    const n = cluster.length;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.set(colors[cluster[i]!]!, i * 3);
    geometry.setAttribute("color", new THREE.BufferAttribute(col, 3));
    this.state = new THREE.BufferAttribute(new Float32Array(n), 1);
    geometry.setAttribute("state", this.state);
    geometry.computeBoundingSphere();

    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uSize: { value: 2.0 },
        uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
        uDim: { value: 0 },
        uFogColor: { value: fogColor },
        uFogDensity: { value: 0.0062 },
      },
    });
    this.object = new THREE.Points(geometry, this.material);
  }

  /** Mark the focused word(s) and their neighbours; everything else fades back. */
  setHighlight(focus: number[], neighbours: number[]): void {
    const s = this.state.array as Float32Array;
    s.fill(0);
    for (const i of neighbours) s[i] = 1;
    for (const i of focus) s[i] = 2;
    this.state.needsUpdate = true;
    this.dimTarget = focus.length || neighbours.length ? 1 : 0;
  }

  setPixelRatio(ratio: number): void {
    this.material.uniforms.uPixelRatio!.value = ratio;
  }

  /** Ease the dimming so focus changes fade instead of snapping. */
  update(dt: number): void {
    const u = this.material.uniforms.uDim!;
    u.value += (this.dimTarget - u.value) * Math.min(1, dt * 4);
  }
}
