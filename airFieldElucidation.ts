import type {
  AirTransferEstimate,
  AudioDiagnostics,
  PsiAirState,
  SignalContractFrame,
} from "@/store/transmitterStore";
import { normalizeMediumId, resolveMediumProfile } from "@/lib/mediumProfiles";

const TAU = Math.PI * 2;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export interface AirFieldConfig {
  width: number;
  height: number;
  boundary: "circle" | "square";
}

export interface SignalContractInput {
  carrierHz: number;
  payloadHz: number;
  amDepth: number;
  pmDepth: number;
  resonanceQ: number;
  timeSec: number;
  frameId: number;
  renderFrameId?: number;
  audioBlockId?: number;
}

export interface MeasurementSnapshot {
  rms: number;
  spectralCentroidHz: number;
}

function fastHash(parts: Array<number | string>): string {
  let h = 2166136261 >>> 0;
  const text = parts.join("|");
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function createSignalContractFrame(input: SignalContractInput): SignalContractFrame {
  const phaseCarrier = TAU * input.carrierHz * input.timeSec;
  const phasePayload = TAU * input.payloadHz * input.timeSec;
  const payloadWave = Math.sin(phasePayload);
  const pmTerm = (input.pmDepth / 100) * payloadWave;
  const carrierBase = Math.sin(phaseCarrier + pmTerm);
  const payloadMod = (input.amDepth / 100) * payloadWave;
  const emittedEstimate = Math.tanh(carrierBase * (1 + payloadMod));
  const emittedSignalHash = fastHash([
    input.frameId,
    input.renderFrameId ?? input.frameId,
    input.audioBlockId ?? input.frameId,
    input.carrierHz.toFixed(3),
    input.payloadHz.toFixed(3),
    input.amDepth.toFixed(3),
    input.pmDepth.toFixed(3),
    input.resonanceQ.toFixed(3),
    emittedEstimate.toFixed(6),
  ]);

  return {
    frameId: input.frameId,
    renderFrameId: input.renderFrameId ?? input.frameId,
    audioBlockId: input.audioBlockId ?? input.frameId,
    timestampMs: Date.now(),
    emittedSignalHash,
    carrierBase,
    payloadMod,
    emittedEstimate,
    carrierHz: input.carrierHz,
    payloadHz: input.payloadHz,
    amDepth: input.amDepth,
    pmDepth: input.pmDepth,
    resonanceQ: input.resonanceQ,
  };
}

export function estimateAirTransfer(
  frameId: number,
  diagnostics: AudioDiagnostics,
  boundary: "circle" | "square",
  mediumId: string = "air",
): AirTransferEstimate {
  const profile = resolveMediumProfile(mediumId) ?? resolveMediumProfile("air");
  const peak = Math.max(diagnostics.peakOutL, diagnostics.peakOutR, 1e-6);
  const deviceGain = clamp(peak * 1.8, 0.05, 2.5);
  const mediumDamping = clamp(profile.dampingBase + profile.viscosityPaS * 120, 0.05, 0.98);
  const damping = clamp(1 - diagnostics.analyserRms * 0.8, 0.08, 0.98) * mediumDamping;
  const boundaryReflection = boundary === "circle" ? profile.boundaryReflectionCircle : profile.boundaryReflectionSquare;
  const propagationSpeed = profile.speedMps;
  const tierBias = profile.confidenceTier === "high" ? 0.12 : profile.confidenceTier === "medium" ? 0.05 : -0.06;
  const confidence = clamp(
    (diagnostics.workletReady ? 0.5 : 0.1) + diagnostics.analyserRms * 1.5 + tierBias,
    0,
    1,
  );

  return {
    frameId,
    timestampMs: Date.now(),
    deviceGain,
    damping,
    boundaryReflection,
    propagationSpeed,
    confidence,
  };
}

function buildGrid(
  frameId: number,
  mediumId: string,
  mode: "predicted" | "measured" | "hybrid",
  width: number,
  height: number,
  psiGrid: Float32Array,
  confidence: number,
): PsiAirState {
  const normalizedMediumId = normalizeMediumId(mediumId);
  return {
    frameId,
    timestampMs: Date.now(),
    mediumId: normalizedMediumId,
    mode,
    width,
    height,
    psiGrid,
    confidence: clamp(confidence, 0, 1),
    source: "medium-elucidated",
  };
}

function radialWeight(x: number, y: number, boundary: "circle" | "square"): number {
  if (boundary === "square") {
    const edge = Math.max(Math.abs(x), Math.abs(y));
    return clamp(1 - edge, 0, 1);
  }
  const r = Math.hypot(x, y);
  return clamp(1 - r, 0, 1);
}

function mediumAngularMode(frame: SignalContractFrame, mediumId: string): number {
  const normalizedMediumId = normalizeMediumId(mediumId);
  const base = clamp(Math.round(6 + (frame.carrierHz / 24000) * 18), 4, 24);
  if (normalizedMediumId === "ionized_plasma") return clamp(Math.round(base * 1.4), 6, 36);
  if (normalizedMediumId === "bioplasma") return clamp(Math.round(base * 1.15), 5, 32);
  if (normalizedMediumId === "air") return base;
  return clamp(Math.round(base * 0.95), 4, 30);
}

function mediumRadialMode(frame: SignalContractFrame, mediumId: string): number {
  const normalizedMediumId = normalizeMediumId(mediumId);
  const base = clamp(Math.round(2 + (frame.payloadHz / 2000) * 10), 1, 16);
  if (normalizedMediumId === "ionized_plasma") return clamp(Math.round(base * 1.2), 2, 24);
  if (normalizedMediumId === "bioplasma") return clamp(Math.round(base * 1.1), 2, 20);
  if (normalizedMediumId === "endoneurial_fluid") return clamp(Math.round(base * 0.9), 1, 14);
  return base;
}

function applyConstrainedFusionField(
  grid: Float32Array,
  width: number,
  height: number,
  angularMode: number,
  boundary: "circle" | "square",
): Float32Array {
  const out = new Float32Array(grid.length);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = y * width + x;
      const nx = (x / Math.max(1, width - 1)) * 2 - 1;
      const ny = (y / Math.max(1, height - 1)) * 2 - 1;
      const theta = Math.atan2(ny, nx);
      const r = Math.hypot(nx, ny);
      const w = radialWeight(nx, ny, boundary);

      // Symmetry lock (m = n): enforce angular-sector coherence.
      const lock = Math.cos(theta * angularMode);
      const locked = grid[idx] * (0.75 + 0.25 * Math.abs(lock));

      // Outward radial continuity + bounded torsion/curvature.
      const left = grid[idx - 1] ?? grid[idx];
      const right = grid[idx + 1] ?? grid[idx];
      const up = grid[idx - width] ?? grid[idx];
      const down = grid[idx + width] ?? grid[idx];
      const lap = left + right + up + down - 4 * grid[idx];
      const smooth = locked - clamp(lap, -0.3, 0.3) * 0.2;

      // Boundary compliance, with stronger attenuation near edges.
      const boundaryGain = clamp(Math.pow(w, 0.65) + 0.04, 0, 1);
      const radialBias = 1 - clamp(r * 0.18, 0, 0.18);
      out[idx] = smooth * boundaryGain * radialBias;
    }
  }

  return out;
}

export function buildPredictedPsiAir(
  frame: SignalContractFrame,
  transfer: AirTransferEstimate,
  cfg: AirFieldConfig,
  mediumId: string = "air",
): PsiAirState {
  const profile = resolveMediumProfile(mediumId);
  const grid = new Float32Array(cfg.width * cfg.height);
  const angularMode = mediumAngularMode(frame, mediumId);
  const radialMode = mediumRadialMode(frame, mediumId);
  const time = frame.timestampMs * 0.001;
  const dispersivePhase = profile.dispersion * time;

  let idx = 0;
  for (let y = 0; y < cfg.height; y += 1) {
    const ny = (y / Math.max(1, cfg.height - 1)) * 2 - 1;
    for (let x = 0; x < cfg.width; x += 1) {
      const nx = (x / Math.max(1, cfg.width - 1)) * 2 - 1;
      const theta = Math.atan2(ny, nx);
      const r = Math.hypot(nx, ny);
      const w = radialWeight(nx, ny, cfg.boundary);
      const standing = Math.sin(Math.PI * radialMode * r - time * (0.6 + profile.speedMps / 2000) + dispersivePhase);
      const angular = Math.sin(angularMode * theta + time * (0.55 + profile.dispersion));
      const carrier = frame.carrierBase * 0.35;
      const payload = frame.payloadMod * 0.28;
      const damping = 1 - transfer.damping * (1 - w);
      const mediumGain = clamp(0.5 + profile.speedMps / 2000 + profile.conductivitySm * 0.00005, 0.4, 2.2);
      grid[idx] =
        (standing * angular + carrier + payload) *
        transfer.deviceGain *
        mediumGain *
        damping *
        (0.7 + transfer.boundaryReflection * 0.3);
      idx += 1;
    }
  }

  return buildGrid(frame.frameId, mediumId, "predicted", cfg.width, cfg.height, grid, transfer.confidence);
}

export function buildMeasuredPsiAir(
  frame: SignalContractFrame,
  transfer: AirTransferEstimate,
  measured: MeasurementSnapshot,
  cfg: AirFieldConfig,
  mediumId: string = "air",
): PsiAirState {
  const predicted = buildPredictedPsiAir(frame, transfer, cfg, mediumId);
  const grid = new Float32Array(predicted.psiGrid.length);
  const observedAmp = clamp(measured.rms * 8, 0, 2);
  const centroidNorm = clamp(measured.spectralCentroidHz / 12000, 0, 1);
  const confidence = clamp(transfer.confidence * 0.6 + measured.rms * 1.2, 0, 1);

  for (let i = 0; i < grid.length; i += 1) {
    const p = predicted.psiGrid[i];
    const mod = Math.sin(i * (0.0009 + centroidNorm * 0.0018) + frame.frameId * 0.02);
    grid[i] = p * (0.72 + observedAmp * 0.28) + mod * observedAmp * 0.14;
  }

  return buildGrid(frame.frameId, mediumId, "measured", cfg.width, cfg.height, grid, confidence);
}

export function buildHybridPsiAir(
  frame: SignalContractFrame,
  transfer: AirTransferEstimate,
  measured: MeasurementSnapshot | null,
  cfg: AirFieldConfig,
  mediumId: string = "air",
): PsiAirState {
  const predicted = buildPredictedPsiAir(frame, transfer, cfg, mediumId);
  if (!measured || transfer.confidence < 0.25) return predicted;

  const measuredState = buildMeasuredPsiAir(frame, transfer, measured, cfg, mediumId);
  const wMeasured = clamp(measuredState.confidence, 0, 1);
  const wPred = 1 - wMeasured;
  const blended = new Float32Array(predicted.psiGrid.length);

  for (let i = 0; i < blended.length; i += 1) {
    blended[i] = measuredState.psiGrid[i] * wMeasured + predicted.psiGrid[i] * wPred;
  }

  const constrained = applyConstrainedFusionField(
    blended,
    cfg.width,
    cfg.height,
    mediumAngularMode(frame, mediumId),
    cfg.boundary,
  );

  return buildGrid(
    frame.frameId,
    mediumId,
    "hybrid",
    cfg.width,
    cfg.height,
    constrained,
    clamp((predicted.confidence + measuredState.confidence) * 0.5, 0, 1),
  );
}
