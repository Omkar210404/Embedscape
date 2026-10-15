import * as THREE from "three";
import type { RGB } from "../math/colors";

// One draw call for every word: glowing sprites (bright core, soft halo) blended additively,
// sized by distance, with exponential depth fog so far words recede into the dark.

const vertexShader = /* glsl */ `
  attribute vec3 color;
  attribute float state;      // 0 normal, 1 neighbour, 2 focus
  uniform float uSize;
  uniform float uPixelRatio;
  uniform float uDim;         // 0..1, fades words that are not focused or neighbours
  uniform float uFogDensity;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float boost = state > 1.5 ? 3.2 : (state > 0.5 ? 2.0 : 1.0);
    // Perspective size, but never smaller than ~2.8 CSS px so distant words stay visible.
    gl_PointSize = max(uSize * boost * uPixelRatio * (110.0 / -mv.z), 2.8 * boost * uPixelRatio);
    gl_Position = projectionMatrix * mv;
    float depth = -mv.z;
    float fog = 1.0 - exp(-uFogDensity * uFogDensity * depth * depth);
    if (state > 0.5) fog *= 0.25;   // keep the focused group readable through the fog
    vColor = state > 1.5 ? mix(color, vec3(1.0), 0.6) : color;
    float base = state > 0.5 ? 1.0 : mix(0.7, 0.12, uDim);
    vAlpha = base * (1.0 - fog);
  }
`;

const fragmentShader = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float r2 = dot(p, p) * 4.0;          // 0 at centre, 1 at the edge
    if (r2 > 1.0) discard;
    float core = exp(-r2 * 18.0);
    float halo = exp(-r2 * 4.0) * 0.35;
    float a = (core + halo) * vAlpha;
    gl_FragColor = vec4(vColor * a, a);
  }
`;

export class WordPoints {
  readonly object: THREE.Points;
  private readonly state: THREE.BufferAttribute;
  private readonly material: THREE.ShaderMaterial;
  private dimTarget = 0;

  constructor(positions: Float32Array, colors: RGB[], cluster: Uint8Array) {
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
      // Premultiplied "over" blending: overlapping words brighten like light without blowing out to white.
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      uniforms: {
        uSize: { value: 2.6 },
        uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
        uDim: { value: 0 },
        uFogDensity: { value: 0.0058 },
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

  /** 0 when nothing is focused, 1 when the rest of the map is dimmed. */
  get dim(): number {
    return this.material.uniforms.uDim!.value as number;
  }

  /** Ease the dimming so focus changes fade instead of snapping. */
  update(dt: number): void {
    const u = this.material.uniforms.uDim!;
    u.value += (this.dimTarget - u.value) * Math.min(1, dt * 4);
  }
}
