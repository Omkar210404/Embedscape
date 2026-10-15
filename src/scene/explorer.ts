import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS2DObject, CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import type { Dataset } from "../data/load";
import type { RGB } from "../math/colors";
import { WordPoints } from "./points";

const BACKGROUND = new THREE.Color("#07090f");
const FLY_MS = 1200;
const FOCUS_DISTANCE = 16;
const MAX_LABELS = 12;

const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

interface Label {
  obj: CSS2DObject;
  text: HTMLSpanElement;
  /** Measured size in CSS px; 0 until the label has been rendered once. */
  w: number;
  h: number;
  /** Current nudge as "dx,dy" (or "hidden"), so the DOM is only touched when it changes. */
  placement: string;
}

// Positions tried, in order, when a label would overlap one already placed:
// above the point, then nudged up/down, then beside it. `side` shifts by half the label width.
const NUDGES: { side: -1 | 0 | 1; dy: number }[] = [
  { side: 0, dy: 0 }, { side: 0, dy: -18 }, { side: 0, dy: 18 },
  { side: 1, dy: 12 }, { side: -1, dy: 12 }, { side: 0, dy: -36 }, { side: 0, dy: 36 },
  { side: 1, dy: -6 }, { side: -1, dy: -6 }, { side: 0, dy: -54 }, { side: 0, dy: 54 },
];

interface Flight {
  start: number;
  fromPos: THREE.Vector3;
  toPos: THREE.Vector3;
  fromTarget: THREE.Vector3;
  toTarget: THREE.Vector3;
}

export interface ExplorerEvents {
  onPick(index: number): void;
  onHover(index: number | null, x: number, y: number): void;
}

/** The 3D view. It only draws; all similarity numbers come from src/math on the 50-d vectors. */
export class Explorer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly labels: CSS2DRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly points: WordPoints;
  private readonly lines: THREE.LineSegments;
  private readonly labelPool: Label[] = [];
  private readonly projected = new THREE.Vector3();
  private insets = { right: 0, bottom: 0, top: 0 };
  private readonly raycaster = new THREE.Raycaster();
  private readonly clock = new THREE.Clock();
  private flight: Flight | null = null;
  private readonly reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  private hoverQueued: PointerEvent | null = null;
  private lastHover: number | null = null;

  constructor(
    private readonly container: HTMLElement,
    private readonly data: Dataset,
    colors: RGB[],
    private readonly events: ExplorerEvents,
  ) {
    // Throws if WebGL is unavailable; the caller shows the text-only fallback.
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(BACKGROUND);
    this.renderer.domElement.setAttribute("aria-label", "3D map of word meanings. Use search to navigate by keyboard.");
    this.renderer.domElement.setAttribute("role", "img");
    container.append(this.renderer.domElement);

    this.labels = new CSS2DRenderer();
    this.labels.domElement.className = "label-layer";
    container.append(this.labels.domElement);

    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 600);
    this.camera.position.set(0, 14, 82);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 3;
    this.controls.maxDistance = 220;
    this.controls.rotateSpeed = 0.6;
    this.controls.autoRotate = !this.reducedMotion;
    this.controls.autoRotateSpeed = 0.25;
    this.controls.addEventListener("start", () => {
      this.controls.autoRotate = false;
      this.flight = null;
    });

    this.points = new WordPoints(data.positions, colors, data.cluster, BACKGROUND);
    this.scene.add(this.points.object);

    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MAX_LABELS * 6), 3));
    lineGeo.setDrawRange(0, 0);
    this.lines = new THREE.LineSegments(
      lineGeo,
      new THREE.LineBasicMaterial({ color: "#c9d4ea", transparent: true, opacity: 0.32, depthWrite: false }),
    );
    this.lines.frustumCulled = false;
    this.scene.add(this.lines);

    for (let i = 0; i < MAX_LABELS; i++) {
      // CSS2DRenderer positions the anchor; the inner span carries our overlap nudge.
      const anchor = document.createElement("div");
      anchor.className = "word-anchor";
      const text = document.createElement("span");
      text.className = "word-label";
      anchor.append(text);
      const obj = new CSS2DObject(anchor);
      obj.visible = false;
      this.labelPool.push({ obj, text, w: 0, h: 0, placement: "" });
      this.scene.add(obj);
    }

    this.raycaster.params.Points = { threshold: 0.7 };
    this.bindPointer();
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  /** Highlight `focus` words, label them and their neighbours, draw lines, and fly the camera there. */
  focus(focus: number[], neighbours: number[], options: { lines?: boolean; labels?: number[] } = {}): void {
    this.points.setHighlight(focus, neighbours);
    const pos = this.data.positions;
    const at = (i: number) => new THREE.Vector3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);

    const labelled = (options.labels ?? [...focus, ...neighbours]).slice(0, MAX_LABELS);
    this.labelPool.forEach((label, slot) => {
      const i = labelled[slot];
      label.obj.visible = i !== undefined;
      if (i === undefined) return;
      label.obj.position.copy(at(i));
      label.text.textContent = this.data.words[i]!;
      label.text.classList.toggle("is-focus", focus.includes(i));
      label.w = 0; // re-measure after the next render
    });

    const lineArr = this.lines.geometry.getAttribute("position") as THREE.BufferAttribute;
    let segs = 0;
    if (options.lines !== false && focus.length) {
      const origin = at(focus[0]!);
      const targets = focus.length > 1 ? focus.slice(1) : neighbours;
      for (const i of targets.slice(0, MAX_LABELS)) {
        lineArr.setXYZ(segs * 2, origin.x, origin.y, origin.z);
        const p = at(i);
        lineArr.setXYZ(segs * 2 + 1, p.x, p.y, p.z);
        segs++;
      }
    }
    lineArr.needsUpdate = true;
    this.lines.geometry.setDrawRange(0, segs * 2);

    const anchor = focus.length ? focus : neighbours;
    if (!anchor.length) return;
    const centre = new THREE.Vector3();
    anchor.forEach((i) => centre.add(at(i)));
    centre.divideScalar(anchor.length);
    // Frame the group, ignoring far outliers (the 3D layout can scatter true neighbours).
    const dists = [...focus, ...neighbours].map((i) => at(i).distanceTo(centre)).sort((a, b) => a - b);
    const spread = dists[Math.floor(dists.length * 0.8)] ?? 0;
    this.flyTo(centre, Math.min(140, Math.max(FOCUS_DISTANCE, spread * 2.4)));
  }

  clearFocus(): void {
    this.focus([], []);
  }

  private flyTo(target: THREE.Vector3, distance: number): void {
    this.controls.autoRotate = false;
    // Keep the current viewing direction so the move feels like travelling, not teleporting.
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    const toPos = target.clone().addScaledVector(dir, distance);
    if (this.reducedMotion) {
      this.controls.target.copy(target);
      this.camera.position.copy(toPos);
      return;
    }
    this.flight = {
      start: performance.now(),
      fromPos: this.camera.position.clone(),
      toPos,
      fromTarget: this.controls.target.clone(),
      toTarget: target.clone(),
    };
  }

  private frame(): void {
    const dt = this.clock.getDelta();
    if (this.flight) {
      const t = Math.min(1, (performance.now() - this.flight.start) / FLY_MS);
      const e = easeInOutCubic(t);
      this.camera.position.lerpVectors(this.flight.fromPos, this.flight.toPos, e);
      this.controls.target.lerpVectors(this.flight.fromTarget, this.flight.toTarget, e);
      if (t >= 1) this.flight = null;
    }
    if (this.hoverQueued) this.processHover(this.hoverQueued);
    this.controls.update(dt);
    this.points.update(dt);
    this.renderer.render(this.scene, this.camera);
    this.labels.render(this.scene, this.camera);
    this.placeLabels();
  }

  /** Greedy screen-space placement: focus labels first, then neighbours in rank order. */
  private placeLabels(): void {
    const { clientWidth: W, clientHeight: H } = this.container;
    const placed: { x0: number; x1: number; y0: number; y1: number }[] = [];
    for (const label of this.labelPool) {
      if (!label.obj.visible) continue;
      if (!label.w) {
        label.w = label.text.offsetWidth;
        label.h = label.text.offsetHeight;
      }
      this.projected.copy(label.obj.position).project(this.camera);
      const x = ((this.projected.x + 1) / 2) * W;
      const y = ((1 - this.projected.y) / 2) * H;
      // If nothing fits, hide the label: the word is still highlighted and listed in the panel.
      let placement = "hidden";
      for (const n of NUDGES) {
        const dx = n.side * (label.w / 2 + 8);
        const box = { x0: x + dx - label.w / 2 - 2, x1: x + dx + label.w / 2 + 2, y0: y + n.dy - label.h - 8, y1: y + n.dy - 8 };
        if (!placed.some((b) => box.x0 < b.x1 && box.x1 > b.x0 && box.y0 < b.y1 && box.y1 > b.y0)) {
          placement = `${dx}px,${n.dy}px`;
          placed.push(box);
          break;
        }
      }
      if (placement !== label.placement) {
        label.placement = placement;
        label.text.style.visibility = placement === "hidden" ? "hidden" : "";
        if (placement !== "hidden") label.text.style.transform = `translate(${placement})`;
      }
    }
  }

  /** Screen space covered by the UI panel, so the camera can centre the scene in what is visible. */
  setInsets(right: number, bottom: number, top = 0): void {
    this.insets = { right, bottom, top };
    this.resize();
  }

  private pick(ev: PointerEvent): number | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    // Scale the pick radius with distance so far-away words are still clickable.
    const dist = this.camera.position.distanceTo(this.controls.target);
    this.raycaster.params.Points = { threshold: Math.max(0.25, dist * 0.008) };
    const hits = this.raycaster.intersectObject(this.points.object);
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
    // Shift the projection centre into the uncovered part of the screen (left of the side panel,
    // or above the bottom sheet). Picking and labels use the same matrix, so they stay correct.
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
    this.labels.setSize(w, h);
    this.points.setPixelRatio(this.renderer.getPixelRatio());
  }
}
