import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS2DObject, CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import type { Dataset } from "../data/load";
import type { RGB } from "../math/colors";
import { WordPoints } from "./points";
import { continentTexture, ringTexture } from "./textures";

/** Words sit on a sphere of this radius (set by the pipeline; checked by tests/realData.test.ts). */
export const GLOBE_RADIUS = 50;
const R = GLOBE_RADIUS;
const OVERVIEW_DIR = new THREE.Vector3(0.25, 0.32, 1).normalize();
const OVERVIEW_DIST = 152;
const INTRO_DIST = 420;
const FLY_MS = 1500;
const MAX_FOCUS_LABELS = 12;
const MAX_NEAR_LABELS = 28;
const MAX_ARCS = 16;
const ARC_STEPS = 28;

const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

type LabelKind = "focus" | "near" | "cluster";

interface Label {
  kind: LabelKind;
  obj: CSS2DObject;
  text: HTMLSpanElement;
  /** Measured size in CSS px; 0 until rendered once with the current text. */
  w: number;
  h: number;
  /** Current nudge as "dx,dy" or "hidden", so the DOM is only touched when it changes. */
  placement: string;
}

// Positions tried for focus labels when they would overlap: above the point, nudged up/down,
// then beside it. `side` shifts by half the label width. Other labels only try the first slot.
const NUDGES: { side: -1 | 0 | 1; dy: number }[] = [
  { side: 0, dy: 0 }, { side: 0, dy: -18 }, { side: 0, dy: 18 },
  { side: 1, dy: 12 }, { side: -1, dy: 12 }, { side: 0, dy: -36 }, { side: 0, dy: 36 },
  { side: 1, dy: -6 }, { side: -1, dy: -6 }, { side: 0, dy: -54 }, { side: 0, dy: 54 },
];

/** Camera travel over the globe: direction is slerped, distance eased, so flights never cut through it. */
interface Flight {
  start: number;
  ms: number;
  from: THREE.Quaternion;
  to: THREE.Quaternion;
  fromDist: number;
  toDist: number;
  /** Extra height mid-flight for long hops, like a plane climbing. */
  lift: number;
}

export interface FocusOptions {
  /** Explicit pairs of word indices to connect. Default: arcs from focus[0] to the others. */
  segments?: [number, number][];
  /** Draw no arcs at all. */
  lines?: boolean;
  /** Which words get labels. Default: focus words, then neighbours. */
  labels?: number[];
}

export interface ExplorerEvents {
  onPick(index: number): void;
  onHover(index: number | null, x: number, y: number): void;
  /** Screen rectangles covered by UI; no label is drawn underneath them. */
  blockers?(): DOMRect[];
}

const globeVertex = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vView;
  varying vec2 vUv;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vView = normalize(-mv.xyz);
    vUv = uv;
    gl_Position = projectionMatrix * mv;
  }
`;

const globeFragment = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uDim;
  varying vec3 vNormal;
  varying vec3 vView;
  varying vec2 vUv;
  void main() {
    float facing = max(dot(vNormal, vView), 0.0);
    float rim = pow(1.0 - facing, 3.0);
    vec3 base = vec3(0.022, 0.032, 0.062);
    vec3 land = texture2D(uMap, vUv).rgb * (0.62 - 0.36 * uDim);
    vec3 col = base + land * (0.35 + 0.65 * facing) + vec3(0.25, 0.36, 0.68) * rim * 0.55;
    gl_FragColor = vec4(col, 1.0);
  }
`;

const atmosphereFragment = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vView;
  varying vec2 vUv;
  void main() {
    // Back faces of a slightly larger sphere: brightest just outside the globe's edge
    // (facing ~ -0.48 there), fading to nothing at the atmosphere's own edge (facing 0).
    float t = smoothstep(0.0, 0.48, -dot(vNormal, vView));
    float i = t * t * 0.32;
    gl_FragColor = vec4(vec3(0.42, 0.56, 0.95) * i, i);
  }
`;

/** The 3D globe. It only draws; all similarity numbers come from src/math on the 50-d vectors. */
export class Explorer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly labelRenderer: CSS2DRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly points: WordPoints;
  private readonly globeMaterial: THREE.ShaderMaterial;
  private readonly arcs: THREE.LineSegments;
  private readonly arcMaterial: THREE.LineBasicMaterial;
  private readonly ring: THREE.Sprite;
  private readonly focusLabels: Label[] = [];
  private readonly nearLabels: Label[] = [];
  private readonly clusterLabels: Label[] = [];
  private readonly labelled = new Set<number>();
  private readonly projected = new THREE.Vector3();
  private readonly raycaster = new THREE.Raycaster();
  private readonly clock = new THREE.Clock();
  private readonly keys = new Set<string>();
  private readonly reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  private insets = { right: 0, bottom: 0, top: 0 };
  private flight: Flight | null = null;
  private hoverQueued: PointerEvent | null = null;
  private lastHover: number | null = null;
  private nearTimer = 0;
  private time = 0;

  constructor(
    private readonly container: HTMLElement,
    private readonly data: Dataset,
    private readonly colors: RGB[],
    private readonly events: ExplorerEvents,
  ) {
    // Throws if WebGL is unavailable; the caller shows the text-only fallback.
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0); // the CSS gradient behind the canvas is the sky
    this.renderer.domElement.setAttribute("aria-label", "3D globe of word meanings. Use search to navigate by keyboard.");
    this.renderer.domElement.setAttribute("role", "img");
    container.append(this.renderer.domElement);

    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.domElement.className = "label-layer";
    container.append(this.labelRenderer.domElement);

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.5, 2000);
    this.camera.position.copy(OVERVIEW_DIR).multiplyScalar(OVERVIEW_DIST);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.07;
    this.controls.enablePan = false;
    this.controls.minDistance = R + 4;
    this.controls.maxDistance = R * 7;
    this.controls.zoomSpeed = 0.8;
    this.controls.autoRotate = !this.reducedMotion;
    this.controls.autoRotateSpeed = 0.35;
    this.controls.addEventListener("start", () => this.stopAutoMotion());

    // The globe: a dark sphere painted with the word-density "continents", plus a soft atmosphere.
    this.globeMaterial = new THREE.ShaderMaterial({
      vertexShader: globeVertex,
      fragmentShader: globeFragment,
      uniforms: { uMap: { value: continentTexture(data.positions, data.cluster, colors, R) }, uDim: { value: 0 } },
    });
    this.scene.add(new THREE.Mesh(new THREE.SphereGeometry(R * 0.985, 128, 96), this.globeMaterial));
    this.scene.add(
      new THREE.Mesh(
        new THREE.SphereGeometry(R * 1.14, 96, 64),
        new THREE.ShaderMaterial({
          vertexShader: globeVertex,
          fragmentShader: atmosphereFragment,
          side: THREE.BackSide,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      ),
    );
    this.scene.add(this.graticule());

    this.points = new WordPoints(data.positions, colors, data.cluster);
    this.points.object.renderOrder = 2;
    this.scene.add(this.points.object);

    const arcGeo = new THREE.BufferGeometry();
    const arcVerts = MAX_ARCS * ARC_STEPS * 2;
    arcGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(arcVerts * 3), 3));
    arcGeo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(arcVerts * 3), 3));
    arcGeo.setDrawRange(0, 0);
    this.arcMaterial = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.arcs = new THREE.LineSegments(arcGeo, this.arcMaterial);
    this.arcs.frustumCulled = false;
    this.arcs.renderOrder = 3;
    this.scene.add(this.arcs);

    this.ring = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: ringTexture(), transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.ring.visible = false;
    this.ring.renderOrder = 4;
    this.scene.add(this.ring);

    for (let i = 0; i < MAX_FOCUS_LABELS; i++) this.focusLabels.push(this.makeLabel("focus"));
    for (let i = 0; i < MAX_NEAR_LABELS; i++) this.nearLabels.push(this.makeLabel("near"));
    this.addClusterLabels();

    this.bindPointer();
    this.bindKeys();
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  // ---------- public API ----------

  /** Highlight words, label them, connect them with arcs, and fly the camera over them. */
  focus(focus: number[], neighbours: number[], options: FocusOptions = {}): void {
    this.points.setHighlight(focus, neighbours);
    const labelled = (options.labels ?? [...focus, ...neighbours]).slice(0, MAX_FOCUS_LABELS);
    this.labelled.clear();
    this.focusLabels.forEach((label, slot) => {
      const i = labelled[slot];
      label.obj.visible = i !== undefined;
      if (i === undefined) return;
      this.labelled.add(i);
      label.obj.position.copy(this.at(i));
      this.setText(label, this.data.words[i]!);
      label.text.classList.toggle("is-focus", focus.includes(i));
    });

    let segments: [number, number][] = [];
    if (options.segments) segments = options.segments;
    else if (options.lines !== false && focus.length) {
      const origin = focus[0]!;
      segments = (focus.length > 1 ? focus.slice(1) : neighbours).map((j) => [origin, j]);
    }
    this.setArcs(segments.slice(0, MAX_ARCS));

    this.ring.visible = focus.length > 0;
    if (focus.length) this.ring.position.copy(this.at(focus[0]!));
    this.refreshNear(true);

    // Frame the focus word, or every word when the view is about relations between several.
    const group = focus.length === 1 && !options.segments ? focus : [...focus, ...neighbours];
    if (!group.length) return;
    const centre = new THREE.Vector3();
    group.forEach((i) => centre.add(this.at(i)));
    if (centre.lengthSq() < 1e-6) centre.copy(this.camera.position);
    const dir = centre.normalize();
    // Height above the surface that keeps most of the group in view (ignoring far outliers).
    const surface = dir.clone().multiplyScalar(R);
    const all = [...focus, ...neighbours].map((i) => this.at(i).distanceTo(surface)).sort((a, b) => a - b);
    // For relations (compare, word maths) every word must be in view; otherwise ignore far outliers.
    const spread = all[options.segments || focus.length > 1 ? all.length - 1 : Math.floor(all.length * 0.8)] ?? 0;
    // Pull back further when the uncovered part of the screen is small (phones, open panels).
    const { clientWidth: w, clientHeight: h } = this.container;
    const room = THREE.MathUtils.clamp(Math.min(w - this.insets.right, h - this.insets.bottom - this.insets.top) / 700, 0.45, 1);
    this.flyTo(dir, R + Math.min(R * 2.2, Math.max(14, (spread * 2.1) / room)));
  }

  clearFocus(): void {
    this.focus([], []);
  }

  /** Clear any focus and float back out to see the whole globe. */
  overview(): void {
    this.clearFocus();
    this.flyTo(this.camera.position.clone().normalize(), OVERVIEW_DIST);
  }

  /** Cinematic arrival from far away. Skipped for users who prefer reduced motion. */
  introFlight(): void {
    if (this.reducedMotion) return;
    const start = new THREE.Vector3(-0.5, 0.45, 1).normalize();
    this.camera.position.copy(start).multiplyScalar(INTRO_DIST);
    this.flight = {
      start: performance.now(),
      ms: 3400,
      from: quatFromDir(start),
      to: quatFromDir(OVERVIEW_DIR),
      fromDist: INTRO_DIST,
      toDist: OVERVIEW_DIST,
      lift: 0,
    };
  }

  /** Screen space covered by UI, so the camera can centre the globe in what is visible. */
  setInsets(right: number, bottom: number, top = 0): void {
    if (right === this.insets.right && bottom === this.insets.bottom && top === this.insets.top) return;
    this.insets = { right, bottom, top };
    this.resize();
  }

  // ---------- scene building ----------

  private at(i: number): THREE.Vector3 {
    const p = this.data.positions;
    return new THREE.Vector3(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
  }

  /** Is a point on the globe on the side facing the camera? `margin` > 0 keeps it away from the horizon. */
  private facing(p: THREE.Vector3, margin = 0): boolean {
    return p.dot(this.camera.position) > R * R + margin;
  }

  /** Faint latitude and longitude lines, so the globe reads as a globe. The grid itself means nothing. */
  private graticule(): THREE.LineSegments {
    const pts: number[] = [];
    const r = R * 0.992;
    const seg = 96;
    const onSphere = (theta: number, phi: number) =>
      new THREE.Vector3(-r * Math.cos(phi) * Math.sin(theta), r * Math.cos(theta), r * Math.sin(phi) * Math.sin(theta));
    const push = (a: THREE.Vector3, b: THREE.Vector3) => pts.push(a.x, a.y, a.z, b.x, b.y, b.z);
    for (let lat = 30; lat < 180; lat += 30) {
      const theta = (lat * Math.PI) / 180;
      for (let s = 0; s < seg; s++) push(onSphere(theta, (s / seg) * Math.PI * 2), onSphere(theta, ((s + 1) / seg) * Math.PI * 2));
    }
    for (let lon = 0; lon < 360; lon += 30) {
      const phi = (lon * Math.PI) / 180;
      const half = seg / 2;
      for (let s = 0; s < half; s++) push(onSphere((s / half) * Math.PI, phi), onSphere(((s + 1) / half) * Math.PI, phi));
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    return new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: "#8fa6dd", transparent: true, opacity: 0.07, depthWrite: false }));
  }

  /** Each group's name floats over its most central word (the same rule that names the group). */
  private addClusterLabels(): void {
    this.data.vocab.clusters.forEach((info, c) => {
      const anchor = this.data.index.get(info.central[0]!);
      if (anchor === undefined) return;
      const label = this.makeLabel("cluster");
      this.setText(label, info.central.join(" · "));
      label.text.style.color = `rgb(${this.colors[c]!.map((v) => Math.round(v * 255)).join(",")})`;
      label.obj.position.copy(this.at(anchor)).multiplyScalar(1.02);
      label.obj.visible = true;
      this.clusterLabels.push(label);
    });
  }

  private makeLabel(kind: LabelKind): Label {
    // CSS2DRenderer positions the anchor; the inner span carries our overlap nudge.
    const anchor = document.createElement("div");
    anchor.className = "word-anchor";
    const text = document.createElement("span");
    text.className = kind === "cluster" ? "cluster-label" : `word-label${kind === "near" ? " is-near" : ""}`;
    anchor.append(text);
    const obj = new CSS2DObject(anchor);
    obj.visible = false;
    this.scene.add(obj);
    return { kind, obj, text, w: 0, h: 0, placement: "" };
  }

  private setText(label: Label, text: string): void {
    if (label.text.textContent === text) return;
    label.text.textContent = text;
    label.w = 0; // re-measure after the next render
  }

  /** Great-circle arcs that rise above the surface, like flight routes. */
  private setArcs(segments: [number, number][]): void {
    const pos = this.arcs.geometry.getAttribute("position") as THREE.BufferAttribute;
    const col = this.arcs.geometry.getAttribute("color") as THREE.BufferAttribute;
    const pointAt = (a: THREE.Vector3, b: THREE.Vector3, angle: number, t: number) => {
      const s = Math.sin(angle);
      const d = s < 1e-5 ? a.clone() : a.clone().multiplyScalar(Math.sin((1 - t) * angle) / s).addScaledVector(b, Math.sin(t * angle) / s);
      const lift = 1.01 + (0.04 + 0.22 * (angle / Math.PI)) * Math.sin(Math.PI * t);
      return d.normalize().multiplyScalar(R * lift);
    };
    let v = 0;
    for (const [ia, ib] of segments) {
      const a = this.at(ia).normalize();
      const b = this.at(ib).normalize();
      const angle = a.angleTo(b);
      const cb = this.colors[this.data.cluster[ib]!]!;
      for (let s = 0; s < ARC_STEPS; s++) {
        const t0 = s / ARC_STEPS;
        const t1 = (s + 1) / ARC_STEPS;
        const p0 = pointAt(a, b, angle, t0);
        const p1 = pointAt(a, b, angle, t1);
        pos.setXYZ(v, p0.x, p0.y, p0.z);
        pos.setXYZ(v + 1, p1.x, p1.y, p1.z);
        // Fade from white at the source word to the target word's group colour.
        col.setXYZ(v, 1 + (cb[0] - 1) * t0, 1 + (cb[1] - 1) * t0, 1 + (cb[2] - 1) * t0);
        col.setXYZ(v + 1, 1 + (cb[0] - 1) * t1, 1 + (cb[1] - 1) * t1, 1 + (cb[2] - 1) * t1);
        v += 2;
      }
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    this.arcs.geometry.setDrawRange(0, v);
  }

  // ---------- motion ----------

  private stopAutoMotion(): void {
    this.controls.autoRotate = false;
    this.flight = null;
  }

  private flyTo(dir: THREE.Vector3, dist: number): void {
    this.controls.autoRotate = false;
    if (this.reducedMotion) {
      this.camera.position.copy(dir).normalize().multiplyScalar(dist);
      return;
    }
    const fromDir = this.camera.position.clone().normalize();
    const angle = fromDir.angleTo(dir);
    this.flight = {
      start: performance.now(),
      ms: FLY_MS + angle * 300,
      from: quatFromDir(fromDir),
      to: quatFromDir(dir),
      fromDist: this.camera.position.length(),
      toDist: dist,
      lift: angle > 0.6 ? angle * 28 : 0,
    };
  }

  /** Arrow keys / WASD spin the globe, Q/E zoom out and in. */
  private keyMotion(dt: number): void {
    if (!this.keys.size) return;
    const k = this.keys;
    const speed = (k.has("shift") ? 2.4 : 1) * dt * THREE.MathUtils.clamp((this.camera.position.length() - R) / 70, 0.15, 1.2);
    const yaw = ((k.has("a") || k.has("arrowleft") ? 1 : 0) - (k.has("d") || k.has("arrowright") ? 1 : 0)) * speed;
    const pitch = ((k.has("w") || k.has("arrowup") ? 1 : 0) - (k.has("s") || k.has("arrowdown") ? 1 : 0)) * speed;
    const zoom = (k.has("q") ? 1 : 0) - (k.has("e") ? 1 : 0);
    const p = this.camera.position;
    if (yaw) p.applyAxisAngle(this.camera.up, -yaw);
    if (pitch) {
      const right = p.clone().cross(this.camera.up).normalize();
      const next = p.clone().applyAxisAngle(right, pitch);
      if (Math.abs(next.clone().normalize().dot(this.camera.up)) < 0.97) p.copy(next);
    }
    if (zoom) {
      const height = Math.max(4, p.length() - R) * (1 + zoom * dt * 1.4);
      p.setLength(THREE.MathUtils.clamp(R + height, this.controls.minDistance, this.controls.maxDistance));
    }
  }

  private bindKeys(): void {
    const keys = new Set(["w", "a", "s", "d", "q", "e", "shift", "arrowup", "arrowdown", "arrowleft", "arrowright"]);
    window.addEventListener("keydown", (ev) => {
      const t = ev.target as HTMLElement;
      if (t instanceof HTMLInputElement || t.isContentEditable || ev.ctrlKey || ev.metaKey || ev.altKey) return;
      if (t instanceof HTMLButtonElement && ev.key.startsWith("Arrow")) return; // tabs use arrows
      if (document.querySelector("dialog[open]")) return;
      const key = ev.key.toLowerCase();
      if (!keys.has(key)) return;
      if (key.startsWith("arrow")) ev.preventDefault();
      this.stopAutoMotion();
      this.keys.add(key);
    });
    window.addEventListener("keyup", (ev) => this.keys.delete(ev.key.toLowerCase()));
    window.addEventListener("blur", () => this.keys.clear());
  }

  // ---------- per frame ----------

  private frame(): void {
    const dt = Math.min(0.1, this.clock.getDelta());
    this.time += dt;
    if (this.flight) {
      const f = this.flight;
      const t = Math.min(1, (performance.now() - f.start) / f.ms);
      const e = easeInOutCubic(t);
      const q = f.from.clone().slerp(f.to, e);
      const dist = f.fromDist + (f.toDist - f.fromDist) * e + f.lift * Math.sin(Math.PI * e);
      this.camera.position.set(0, 0, 1).applyQuaternion(q).multiplyScalar(dist);
      if (t >= 1) this.flight = null;
    }
    this.keyMotion(dt);
    if (this.hoverQueued) this.processHover(this.hoverQueued);
    // Spin slower when close to the surface, so dragging feels the same at every zoom.
    const height = this.camera.position.length() - R;
    this.controls.rotateSpeed = THREE.MathUtils.clamp(height / 90, 0.12, 0.7);
    this.controls.update(dt);
    this.points.update(dt);
    this.globeMaterial.uniforms.uDim!.value = this.points.dim;

    // Gentle pulse on the focus ring and arcs.
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 2.2);
    if (this.ring.visible) {
      const d = this.camera.position.distanceTo(this.ring.position);
      this.ring.scale.setScalar(d * (0.075 + 0.012 * pulse));
      this.ring.material.opacity = this.facing(this.ring.position) ? 0.9 : 0;
    }
    this.arcMaterial.opacity = 0.45 + 0.3 * pulse;

    this.nearTimer -= dt;
    if (this.nearTimer <= 0) this.refreshNear(false);

    this.renderer.render(this.scene, this.camera);
    this.labelRenderer.render(this.scene, this.camera);
    this.placeLabels();
  }

  /** Label the words nearest the camera, so swooping down to the surface reveals what is there. */
  private refreshNear(force: boolean): void {
    this.nearTimer = force ? 0.05 : 0.2;
    const cam = this.camera.position;
    const height = cam.length() - R;
    const range = height * 1.7 + 6;
    const cand: { i: number; d: number }[] = [];
    if (height < 48) {
      const p = this.data.positions;
      const v = new THREE.Vector3();
      for (let i = 0; i < this.data.count; i++) {
        if (this.labelled.has(i)) continue;
        v.set(p[i * 3]!, p[i * 3 + 1]!, p[i * 3 + 2]!);
        if (!this.facing(v, R * 3)) continue;
        const d = v.distanceTo(cam);
        if (d < range) cand.push({ i, d });
      }
      cand.sort((a, b) => a.d - b.d);
    }
    this.nearLabels.forEach((label, slot) => {
      const c = cand[slot];
      label.obj.visible = c !== undefined;
      if (!c) return;
      label.obj.position.copy(this.at(c.i));
      this.setText(label, this.data.words[c.i]!);
      // Fade with distance; fainter still while a word is focused.
      const fade = 1 - c.d / range;
      label.text.style.opacity = String(Math.max(0.2, fade) * (1 - 0.5 * this.points.dim));
    });
  }

  /**
   * Greedy screen-space placement in priority order: focus labels (may be nudged), then words
   * near the camera, then group names. Labels over the horizon, under UI, or overlapping are hidden.
   */
  private placeLabels(): void {
    const { clientWidth: W, clientHeight: H } = this.container;
    const placed = (this.events.blockers?.() ?? []).map((r) => ({ x0: r.left, x1: r.right, y0: r.top, y1: r.bottom }));
    const dim = this.points.dim;
    const height = this.camera.position.length() - R;

    const place = (label: Label, tries: typeof NUDGES, visible: boolean) => {
      let placement = "hidden";
      if (visible) {
        if (!label.w) {
          label.w = label.text.offsetWidth;
          label.h = label.text.offsetHeight;
        }
        this.projected.copy(label.obj.position).project(this.camera);
        const x = ((this.projected.x + 1) / 2) * W;
        const y = ((1 - this.projected.y) / 2) * H;
        for (const n of tries) {
          const dx = n.side * (label.w / 2 + 8);
          const box = { x0: x + dx - label.w / 2 - 3, x1: x + dx + label.w / 2 + 3, y0: y + n.dy - label.h - 8, y1: y + n.dy - 6 };
          if (!placed.some((b) => box.x0 < b.x1 && box.x1 > b.x0 && box.y0 < b.y1 && box.y1 > b.y0)) {
            placement = `${dx}px,${n.dy}px`;
            placed.push(box);
            break;
          }
        }
      }
      if (placement !== label.placement) {
        label.placement = placement;
        label.text.style.visibility = placement === "hidden" ? "hidden" : "";
        if (placement !== "hidden") label.text.style.transform = `translate(${placement})`;
      }
    };

    for (const l of this.focusLabels) if (l.obj.visible) place(l, NUDGES, this.facing(l.obj.position));
    for (const l of this.nearLabels) if (l.obj.visible) place(l, NUDGES.slice(0, 1), this.facing(l.obj.position, R * 3));
    for (const l of this.clusterLabels) {
      // Group names guide you from afar; close to the surface the individual words take over.
      place(l, NUDGES.slice(0, 1), dim < 0.5 && height > 26 && this.facing(l.obj.position, R * R * 0.35));
    }
  }

  // ---------- pointer ----------

  private pick(ev: PointerEvent): number | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    // Scale the pick radius with height so far-away words are still clickable.
    const height = this.camera.position.length() - R;
    this.raycaster.params.Points = { threshold: Math.max(0.25, height * 0.012) };
    const hits = this.raycaster
      .intersectObject(this.points.object)
      .filter((h) => h.index !== undefined && this.facing(this.at(h.index)));
    // Nearest to the ray first, then nearest to the camera.
    hits.sort((a, b) => (a.distanceToRay ?? 0) - (b.distanceToRay ?? 0) || a.distance - b.distance);
    return hits[0]?.index ?? null;
  }

  private processHover(ev: PointerEvent): void {
    this.hoverQueued = null;
    const i = this.pick(ev);
    if (i !== this.lastHover) this.renderer.domElement.style.cursor = i === null ? "" : "pointer";
    this.lastHover = i;
    this.events.onHover(i, ev.clientX, ev.clientY);
  }

  private bindPointer(): void {
    const el = this.renderer.domElement;
    let down: { x: number; y: number } | null = null;
    el.addEventListener("pointerdown", (ev) => (down = { x: ev.clientX, y: ev.clientY }));
    el.addEventListener("pointermove", (ev) => {
      if (ev.pointerType === "mouse") this.hoverQueued = ev;
    });
    el.addEventListener("pointerleave", () => {
      this.hoverQueued = null;
      this.lastHover = null;
      this.events.onHover(null, 0, 0);
    });
    el.addEventListener("pointerup", (ev) => {
      // A click, not the end of a drag.
      if (down && Math.hypot(ev.clientX - down.x, ev.clientY - down.y) < 6) {
        const i = this.pick(ev);
        if (i !== null) this.events.onPick(i);
      }
      down = null;
    });
  }

  private resize(): void {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    this.camera.aspect = w / h;
    // Shift the projection centre into the uncovered part of the screen.
    // Positive values move the centre left / up; negative ones move it down.
    const dx = this.insets.right / 2;
    const dy = (this.insets.bottom - this.insets.top) / 2;
    if (dx || dy) {
      this.camera.setViewOffset(w + 2 * dx, h + 2 * Math.abs(dy), 2 * dx, dy > 0 ? 2 * dy : 0, w, h);
    } else {
      this.camera.clearViewOffset();
    }
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.labelRenderer.setSize(w, h);
    this.points.setPixelRatio(this.renderer.getPixelRatio());
  }
}

/** Rotation that turns +Z into `dir`, used to slerp the camera around the globe. */
function quatFromDir(dir: THREE.Vector3): THREE.Quaternion {
  return new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.clone().normalize());
}
