import type { AirValidationSnapshot, PsiAirState } from "@/store/transmitterStore";

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function corr(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  if (n <= 0) return 0;
  let sa = 0, sb = 0;
  for (let i = 0; i < n; i += 1) {
    sa += a[i];
    sb += b[i];
  }
  const ma = sa / n;
  const mb = sb / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i += 1) {
    const xa = a[i] - ma;
    const xb = b[i] - mb;
    num += xa * xb;
    da += xa * xa;
    db += xb * xb;
  }
  const den = Math.sqrt(da * db) + 1e-9;
  return clamp(num / den, -1, 1);
}

export function buildAirValidationSnapshot(
  frameId: number,
  predicted: PsiAirState,
  measured: PsiAirState | null,
  previous: PsiAirState | null,
): AirValidationSnapshot {
  const fieldCorrelation = measured ? corr(predicted.psiGrid, measured.psiGrid) : 0;
  const topologyPersistence = previous ? corr(predicted.psiGrid, previous.psiGrid) : 0;

  let spectralError = 1;
  if (measured) {
    const n = Math.min(predicted.psiGrid.length, measured.psiGrid.length);
    let sum = 0;
    for (let i = 0; i < n; i += 1) {
      sum += Math.abs(predicted.psiGrid[i] - measured.psiGrid[i]);
    }
    spectralError = clamp(sum / Math.max(1, n), 0, 1);
  }

  const nodalAlignment = measured
    ? clamp(0.5 + fieldCorrelation * 0.5 - spectralError * 0.35, 0, 1)
    : clamp(0.45 + topologyPersistence * 0.25, 0, 1);

  const phaseError = measured
    ? clamp(1 - (fieldCorrelation * 0.5 + 0.5), 0, 1)
    : clamp(1 - (topologyPersistence * 0.5 + 0.5), 0, 1);
  const extractionConfidence = clamp(
    0.4 + nodalAlignment * 0.35 + (1 - spectralError) * 0.25,
    0,
    1,
  );

  const passed =
    nodalAlignment >= 0.35 &&
    topologyPersistence >= -0.2 &&
    spectralError <= 0.9 &&
    phaseError <= 0.92 &&
    extractionConfidence >= 0.28;

  return {
    frameId,
    timestampMs: Date.now(),
    spectralError,
    fieldCorrelation,
    nodalAlignment,
    topologyPersistence,
    phaseError,
    extractionConfidence,
    passed,
  };
}
