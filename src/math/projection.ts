// How faithful is the 3D picture around one word? Compares the true (50-d) neighbours with the
// words that merely *look* closest in the 3D layout. Used only to show the projection's limits.

export function nearestIn3d(positions: Float32Array, i: number, k: number): number[] {
  const n = positions.length / 3;
  const x = positions[i * 3]!;
  const y = positions[i * 3 + 1]!;
  const z = positions[i * 3 + 2]!;
  const d: { j: number; d: number }[] = [];
  for (let j = 0; j < n; j++) {
    if (j === i) continue;
    const dx = positions[j * 3]! - x;
    const dy = positions[j * 3 + 1]! - y;
    const dz = positions[j * 3 + 2]! - z;
    d.push({ j, d: dx * dx + dy * dy + dz * dz });
  }
  d.sort((a, b) => a.d - b.d);
  return d.slice(0, k).map((e) => e.j);
}

/** How many of the true neighbours are also among the k closest points in 3D. */
export function projectionOverlap(positions: Float32Array, i: number, trueNeighbours: number[]): number {
  const near = new Set(nearestIn3d(positions, i, trueNeighbours.length));
  return trueNeighbours.filter((j) => near.has(j)).length;
}
