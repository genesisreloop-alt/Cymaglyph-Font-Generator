import type {
  CymaglyphGeneratedFrame,
  PsiAirState,
  SignalContractFrame,
} from "@/store/transmitterStore";

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

type Zone = "NODE_EQ" | "ANTINODE_A" | "ANTINODE_B" | "TRANSITION";

function zoneColor(zone: Zone): [number, number, number] {
  if (zone === "NODE_EQ") return [0.12, 0.45, 1.0];
  if (zone === "ANTINODE_A") return [0.72, 0.95, 1.0];
  if (zone === "ANTINODE_B") return [0.45, 0.78, 1.0];
  return [0.24, 0.6, 0.95];
}

function sample(grid: Float32Array, w: number, h: number, x: number, y: number): number {
  const xi = clamp(x, 0, w - 1);
  const yi = clamp(y, 0, h - 1);
  return grid[yi * w + xi];
}

export function extractCymaglyphFromPsiAir(
  psiAir: PsiAirState,
  contract: SignalContractFrame | null,
  pointTarget = 18000,
): CymaglyphGeneratedFrame {
  const w = psiAir.width;
  const h = psiAir.height;
  const grid = psiAir.psiGrid;
  const positions = new Float32Array(pointTarget * 3);
  const colors = new Float32Array(pointTarget * 3);
  const sizes = new Float32Array(pointTarget);
  const zoneCounts: Record<Zone, number> = {
    NODE_EQ: 0,
    ANTINODE_A: 0,
    ANTINODE_B: 0,
    TRANSITION: 0,
  };

  const payloadNorm = clamp((contract?.payloadHz ?? 220) / 2000, 0.01, 1);
  const carrierNorm = clamp((contract?.carrierHz ?? 14000) / 24000, 0.01, 1);
  const symmetry = Math.max(4, Math.round(6 + carrierNorm * 18));
  // Carrier drives propagation scaffold; payload drives deformation envelope.
  const radialGain = 1 + carrierNorm * 0.8;
  const depthScale = 0.25 + payloadNorm * 0.7;

  let maxAbs = 1e-9;
  for (let i = 0; i < grid.length; i += 1) {
    maxAbs = Math.max(maxAbs, Math.abs(grid[i]));
  }

  const stride = Math.max(1, Math.floor((w * h) / pointTarget));
  let ptr = 0;
  for (let gy = 0; gy < h && ptr < pointTarget; gy += 1) {
    for (let gx = 0; gx < w && ptr < pointTarget; gx += stride) {
      const p = sample(grid, w, h, gx, gy);
      const px = (gx / Math.max(1, w - 1)) * 2 - 1;
      const py = (gy / Math.max(1, h - 1)) * 2 - 1;
      const r = Math.hypot(px, py);
      const theta = Math.atan2(py, px);
      const symPhase = Math.cos(theta * symmetry);
      const psi = p / maxAbs;

      const isNode = Math.abs(psi) < 0.12;
      const zone: Zone = isNode ? "NODE_EQ" : psi > 0.28 ? "ANTINODE_A" : psi < -0.28 ? "ANTINODE_B" : "TRANSITION";
      zoneCounts[zone] += 1;

      const x = px * radialGain * (0.9 + 0.1 * symPhase);
      const y = py * radialGain * (0.9 + 0.1 * symPhase);
      const z = psi * depthScale + Math.sin(theta * symmetry) * (r * 0.08 * payloadNorm);
      positions[ptr * 3 + 0] = x * 4.4;
      positions[ptr * 3 + 1] = y * 4.4;
      positions[ptr * 3 + 2] = z;

      const [cr, cg, cb] = zoneColor(zone);
      colors[ptr * 3 + 0] = cr;
      colors[ptr * 3 + 1] = cg;
      colors[ptr * 3 + 2] = cb;

      const gxGrad = sample(grid, w, h, gx + 1, gy) - sample(grid, w, h, gx - 1, gy);
      const gyGrad = sample(grid, w, h, gx, gy + 1) - sample(grid, w, h, gx, gy - 1);
      const grad = Math.hypot(gxGrad, gyGrad) / maxAbs;
      sizes[ptr] = clamp(0.65 + Math.abs(psi) * 1.2 + grad * 0.6, 0.5, 4.2);
      ptr += 1;
    }
  }

  for (; ptr < pointTarget; ptr += 1) {
    positions[ptr * 3 + 0] = 0;
    positions[ptr * 3 + 1] = 0;
    positions[ptr * 3 + 2] = 0;
    colors[ptr * 3 + 0] = 0;
    colors[ptr * 3 + 1] = 0;
    colors[ptr * 3 + 2] = 0;
    sizes[ptr] = 0.2;
  }

  const populated = zoneCounts.NODE_EQ + zoneCounts.ANTINODE_A + zoneCounts.ANTINODE_B + zoneCounts.TRANSITION;
  const structureBalance =
    populated > 0
      ? (zoneCounts.NODE_EQ + zoneCounts.ANTINODE_A + zoneCounts.ANTINODE_B) / populated
      : 0;
  const extractionConfidence = clamp(
    psiAir.confidence * 0.65 + structureBalance * 0.35,
    0,
    1,
  );

  return {
    positions,
    colors,
    sizes,
    zoneCounts,
    extractionConfidence,
    generatedAt: Date.now(),
  };
}
