import * as THREE from "three";
import type { RGB } from "../math/colors";

// Textures drawn on a canvas at runtime (no image files, nothing for the CSP to allow).

function canvasTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Thin ring with a soft edge, used to mark the focused word. */
export function ringTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const g = canvas.getContext("2d")!;
  g.strokeStyle = "rgba(255,255,255,0.95)";
  g.lineWidth = 4.5;
  g.shadowColor = "rgba(255,255,255,0.9)";
  g.shadowBlur = 8;
  g.beginPath();
  g.arc(64, 64, 46, 0, Math.PI * 2);
  g.stroke();
  return canvasTexture(canvas);
}

/**
 * The globe's surface colour: a density map of where each group's words actually sit, so the
 * coloured "continents" come from the real word positions, not invented regions.
 * Each word adds a small Gaussian of its group's colour; the sum keeps each place's average hue
 * while its brightness is compressed (1 - e^-k·density), so crowded areas glow without turning white.
 * Equirectangular, matching three.js SphereGeometry UVs (y is up).
 */
export function continentTexture(positions: Float32Array, cluster: Uint8Array, colors: RGB[], radius: number): THREE.CanvasTexture {
  const W = 1024;
  const H = 512;
  const acc = new Float32Array(W * H * 4); // r, g, b (weighted by density), density
  const sigma = 3.6; // px at the equator
  const reach = Math.ceil(sigma * 2.5);

  for (let i = 0; i < cluster.length; i++) {
    const x = positions[i * 3]! / radius;
    const y = positions[i * 3 + 1]! / radius;
    const z = positions[i * 3 + 2]! / radius;
    const theta = Math.acos(Math.max(-1, Math.min(1, y)));
    let phi = Math.atan2(z, -x);
    if (phi < 0) phi += Math.PI * 2;
    const u = (phi / (Math.PI * 2)) * W;
    const v = (theta / Math.PI) * H;
    // Widen horizontally towards the poles, where the equirectangular map is compressed.
    const stretch = 1 / Math.max(Math.sin(theta), 0.12);
    const reachX = Math.min(Math.ceil(reach * stretch), W / 2);
    const [cr, cg, cb] = colors[cluster[i]!]!;
    for (let dy = -reach; dy <= reach; dy++) {
      const py = Math.round(v) + dy;
      if (py < 0 || py >= H) continue;
      const gy = Math.exp(-(dy * dy) / (2 * sigma * sigma));
      for (let dx = -reachX; dx <= reachX; dx++) {
        const ex = dx / stretch;
        const w = gy * Math.exp(-(ex * ex) / (2 * sigma * sigma));
        if (w < 0.01) continue;
        const px = (((Math.round(u) + dx) % W) + W) % W;
        const k = (py * W + px) * 4;
        acc[k] = acc[k]! + cr * w;
        acc[k + 1] = acc[k + 1]! + cg * w;
        acc[k + 2] = acc[k + 2]! + cb * w;
        acc[k + 3] = acc[k + 3]! + w;
      }
    }
  }

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext("2d")!;
  const img = g.createImageData(W, H);
  for (let p = 0; p < W * H; p++) {
    const d = acc[p * 4 + 3]!;
    if (d <= 0) continue;
    const bright = 1 - Math.exp(-d * 0.55);
    for (let c = 0; c < 3; c++) img.data[p * 4 + c] = Math.round((acc[p * 4 + c]! / d) * bright * 255);
    img.data[p * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const tex = canvasTexture(canvas);
  tex.anisotropy = 4;
  return tex;
}
