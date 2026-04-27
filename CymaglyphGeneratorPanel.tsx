"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  useTransmitterStore,
  type CymaglyphGeneratedFrame,
  type DomainRepeatLayout,
  type CymaglyphRenderMode,
  type CymaglyphRenderSource,
  type PropagationMediumId,
} from "@/store/transmitterStore";
import {
  createUnifiedTensorFromPhysics,
  type UnifiedTensor,
} from "@/lib/g3nenTensor";
import {
  computeSpectralMetrics,
  type CymaglyphSpectralMetrics,
} from "@/lib/cymaglyph12x12";
import {
  type AngularDistribution,
  type DeformationField,
  type FieldMode,
  type GapFillRule,
  type PrimitiveKind,
  type RadialRatioFunction,
  type ZRule,
  deriveSacredParamsFromOscillation,
  generateSacredCymaglyphFrame,
} from "@/lib/sacredGeometryGenerator";
import { exportFBX, exportGCode, exportOBJ } from "@/lib/cymaglyphExport";
import { ALL_MEDIUM_IDS, MEDIUM_PROFILES, normalizeMediumId, resolveMediumProfile } from "@/lib/mediumProfiles";
import { applyDomainRepetitionToFrame } from "@/lib/cymaglyphDomainRepeat";

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
type PreviewFrame = CymaglyphGeneratedFrame;

function parseFreq(value: string, fallback: number): number {
  const text = String(value ?? "").trim();
  if (!text) return fallback;
  if (/^[0-7]+$/.test(text)) {
    const oct = Number.parseInt(text, 8);
    if (Number.isFinite(oct) && oct > 0) return oct;
  }
  const dec = Number.parseFloat(text);
  return Number.isFinite(dec) && dec > 0 ? dec : fallback;
}

function downloadTextFile(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function drawPointCloud(
  canvas: HTMLCanvasElement,
  frame: PreviewFrame,
  scale = 44,
  spin = 0,
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  const cx = w * 0.5;
  const cy = h * 0.5;

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#050811";
  ctx.fillRect(0, 0, w, h);

  ctx.globalCompositeOperation = "lighter";
  const pos = frame.positions;
  const col = frame.colors;
  const siz = frame.sizes;
  const c = Math.cos(spin);
  const s = Math.sin(spin);

  const n = siz.length;
  for (let i = 0; i < n; i += 1) {
    const x = pos[i * 3 + 0];
    const y = pos[i * 3 + 1];
    const z = pos[i * 3 + 2];

    const xr = x * c - z * s;
    const zr = x * s + z * c;
    const depth = clamp((zr + 6) / 12, 0.2, 1.0);
    const px = cx + xr * scale;
    const py = cy - y * scale * 0.86;

    const r = Math.round(clamp(col[i * 3 + 0], 0, 1) * 255);
    const g = Math.round(clamp(col[i * 3 + 1], 0, 1) * 255);
    const b = Math.round(clamp(col[i * 3 + 2], 0, 1) * 255);
    const radius = clamp(0.4 + siz[i] * depth, 0.5, 3.6);
    const alpha = clamp(0.18 + depth * 0.55, 0.2, 0.86);

    ctx.fillStyle = `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(px, py, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = "source-over";
}

export function CymaglyphGeneratorPanel() {
  const setParam = useTransmitterStore((s) => s.setParam);
  const setCymaglyphGeneratedFrame = useTransmitterStore((s) => s.setCymaglyphGeneratedFrame);
  const renderSource = useTransmitterStore((s) => s.cymaglyphRenderSource);
  const setRenderSource = useTransmitterStore((s) => s.setCymaglyphRenderSource);
  const renderMode = useTransmitterStore((s) => s.cymaglyphRenderMode);
  const setRenderMode = useTransmitterStore((s) => s.setCymaglyphRenderMode);
  const micPermissionState = useTransmitterStore((s) => s.micPermissionState);
  const requestMicPermission = useTransmitterStore((s) => s.requestMicPermission);
  const domainRepeatCount = useTransmitterStore((s) => s.domainRepeatCount);
  const setDomainRepeatCount = useTransmitterStore((s) => s.setDomainRepeatCount);
  const domainRepeatLayout = useTransmitterStore((s) => s.domainRepeatLayout);
  const setDomainRepeatLayout = useTransmitterStore((s) => s.setDomainRepeatLayout);
  const domainRepeatDepthStep = useTransmitterStore((s) => s.domainRepeatDepthStep);
  const setDomainRepeatDepthStep = useTransmitterStore((s) => s.setDomainRepeatDepthStep);
  const domainRepeatOscillationCoupling = useTransmitterStore((s) => s.domainRepeatOscillationCoupling);
  const setDomainRepeatOscillationCoupling = useTransmitterStore((s) => s.setDomainRepeatOscillationCoupling);
  const domainRepeatRotXDeg = useTransmitterStore((s) => s.domainRepeatRotXDeg);
  const domainRepeatRotYDeg = useTransmitterStore((s) => s.domainRepeatRotYDeg);
  const domainRepeatRotZDeg = useTransmitterStore((s) => s.domainRepeatRotZDeg);
  const domainRepeatLayerOscillationIds = useTransmitterStore((s) => s.domainRepeatLayerOscillationIds);
  const setDomainRepeatRotationXDeg = useTransmitterStore((s) => s.setDomainRepeatRotationXDeg);
  const setDomainRepeatRotationYDeg = useTransmitterStore((s) => s.setDomainRepeatRotationYDeg);
  const setDomainRepeatRotationZDeg = useTransmitterStore((s) => s.setDomainRepeatRotationZDeg);
  const setDomainRepeatLayerOscillationId = useTransmitterStore((s) => s.setDomainRepeatLayerOscillationId);
  const compendiumEntries = useTransmitterStore((s) => s.compendiumEntries);
  const propagationMediumId = useTransmitterStore((s) => s.propagationMediumId);
  const setPropagationMediumId = useTransmitterStore((s) => s.setPropagationMediumId);
  const activeGradient = useTransmitterStore((s) => s.activeGradient);
  const tensor = useTransmitterStore((s) => s.globalTensorState);
  const carrier = useTransmitterStore((s) => s.carrierG3Nen);
  const payload = useTransmitterStore((s) => s.payloadG3Nen);
  const amDepth = useTransmitterStore((s) => s.amDepth);
  const pmDepth = useTransmitterStore((s) => s.pmDepth);
  const resonanceQ = useTransmitterStore((s) => s.resonanceQ);
  const playbackSeconds = useTransmitterStore((s) => s.playbackSeconds);
  const isGenerating = useTransmitterStore((s) => s.isGenerating);
  const currentUnifiedTensor = useTransmitterStore((s) => s.unifiedTensor);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pointCount, setPointCount] = useState(8000);
  const [radius, setRadius] = useState(3.2);
  const [spin, setSpin] = useState(0);
  const [lockToOscillation, setLockToOscillation] = useState(true);
  const [symmetryOrder, setSymmetryOrder] = useState(12);
  const [radialLayers, setRadialLayers] = useState(7);
  const [radialRatioFunction, setRadialRatioFunction] = useState<RadialRatioFunction>("phi");
  const [angularDistribution, setAngularDistribution] = useState<AngularDistribution>("uniform");
  const [primitiveSet, setPrimitiveSet] = useState<PrimitiveKind[]>(["circle", "arc", "petal", "polygon"]);
  const [gapFillRules, setGapFillRules] = useState<GapFillRule>("midpoint");
  const [deformationField, setDeformationField] = useState<DeformationField>("woven");
  const [fieldMode, setFieldMode] = useState<FieldMode>("standing");
  const [zRule, setZRule] = useState<ZRule>("field");
  const [fieldBoundary, setFieldBoundary] = useState<"circle" | "square">("circle");
  const [fieldMediumDensity, setFieldMediumDensity] = useState(0.85);
  const [gridOverlaySize, setGridOverlaySize] = useState(9);
  const [lotusPetals, setLotusPetals] = useState(10);
  const [carrierWaveCycles, setCarrierWaveCycles] = useState(8);
  const [carrierWaveStrength, setCarrierWaveStrength] = useState(0.55);
  const [mandalaMix, setMandalaMix] = useState(0.62);
  const [lotusMix, setLotusMix] = useState(0.56);
  const [cymaticMix, setCymaticMix] = useState(0.72);
  const [sampleDensity, setSampleDensity] = useState(1.0);
  const [layerDensityFalloff, setLayerDensityFalloff] = useState(1.3);
  const [centerDensityBoost, setCenterDensityBoost] = useState(1.7);
  const [strictSacredMapping, setStrictSacredMapping] = useState(true);
  const [noGapFullForm, setNoGapFullForm] = useState(true);
  const [depth, setDepth] = useState(0.55);
  const [scale, setScale] = useState(3.4);
  const [frame, setFrame] = useState<PreviewFrame | null>(null);
  const [metrics, setMetrics] = useState<CymaglyphSpectralMetrics | null>(null);
  const [loopSeconds, setLoopSeconds] = useState(2.0);
  const normalizedPropagationMediumId = normalizeMediumId(propagationMediumId);
  const mediumProfile = resolveMediumProfile(normalizedPropagationMediumId) ?? resolveMediumProfile("air");
  const carrierHz = useMemo(() => parseFreq(carrier, 14000), [carrier]);
  const payloadHz = useMemo(() => parseFreq(payload, 144), [payload]);
  const layerCarrierHz = useMemo(
    () =>
      domainRepeatLayerOscillationIds.map((id) => {
        const entry = compendiumEntries.find((e) => e.id === id);
        if (!entry) return undefined;
        const lpg = entry.lpgValue ?? entry.lpgFund;
        if (!Number.isFinite(lpg)) return undefined;
        return Math.max(20, Number(lpg) / 0.4858);
      }),
    [compendiumEntries, domainRepeatLayerOscillationIds],
  );
  const layerPayloadHz = useMemo(
    () =>
      layerCarrierHz.map((hz) => (Number.isFinite(hz as number) ? Math.max(20, Number(hz) * 0.18) : undefined)),
    [layerCarrierHz],
  );
  const renderFrame = useMemo(
    () =>
      frame
        ? (renderMode === "SDF_DOMAIN_REPEAT" || renderMode === "SDF_DOMAIN_REPEAT_RHOTORSE")
          ? applyDomainRepetitionToFrame(frame, domainRepeatCount, {
              layout: domainRepeatLayout,
              backwardOnly: true,
              depthStep: domainRepeatDepthStep,
              oscillationCoupling: domainRepeatOscillationCoupling,
              rotXDeg: domainRepeatRotXDeg,
              rotYDeg: domainRepeatRotYDeg,
              rotZDeg: domainRepeatRotZDeg,
              carrierHz,
              payloadHz,
              layerCarrierHz,
              layerPayloadHz,
            })
          : frame
        : null,
    [
      frame,
      renderMode,
      domainRepeatCount,
      domainRepeatLayout,
      domainRepeatDepthStep,
      domainRepeatOscillationCoupling,
      domainRepeatRotXDeg,
      domainRepeatRotYDeg,
      domainRepeatRotZDeg,
      carrierHz,
      payloadHz,
      layerCarrierHz,
      layerPayloadHz,
    ],
  );
  const tensorBivectorX = tensor.bivector[0];
  const tensorVectorY = tensor.vector[1];
  const tensorTrivector = tensor.trivector;

  const generatorTensor = useMemo<UnifiedTensor>(() => {
    const scalarNorm = clamp(tensor.scalar / 100, 0, 1);

    return createUnifiedTensorFromPhysics({
      gorkovPotential: clamp(payloadHz / 1800, 0.01, 3.5),
      gorkovVelocity: clamp((payloadHz / 2400) * (1 + resonanceQ * 0.02), 0.01, 3.5),
      ampereTension: clamp(carrierHz / 12000, 0.01, 5),
      stabilityLambda: clamp(0.3 + pmDepth / 100, 0.05, 1.8),
      graneauTension: clamp(0.1 + amDepth / 100, 0.01, 2.2),
      machianInertia: clamp(0.3 + resonanceQ / 20, 0.05, 4),
      massDensityRho: clamp(0.4 + scalarNorm * 1.6, 0.1, 3),
      magneticSaturationB: clamp(0.5 + scalarNorm * 2.2, 0.1, 6),
      spectralExpansionDelta: clamp(Math.abs(tensorTrivector), 0.01, 3),
      magneticTensionTm: clamp(10 + Math.abs(tensorBivectorX) * 2.2, 0.5, 160),
      magneticFluxPhi: clamp(Math.PI * (0.4 + Math.abs(tensorVectorY) * 0.04), 0.01, 16),
      timecode: `gen-${Date.now()}`,
    });
  }, [payloadHz, carrierHz, pmDepth, amDepth, resonanceQ, tensor.scalar, tensorTrivector, tensorBivectorX, tensorVectorY]);

  useEffect(() => {
    if (!lockToOscillation) return;
    const derived = deriveSacredParamsFromOscillation({
      carrierHz,
      payloadHz,
      amDepth,
      pmDepth,
      resonanceQ,
      tensorScalar: tensor.scalar,
      bivectorX: tensorBivectorX,
      vectorY: tensorVectorY,
      trivector: tensorTrivector,
    });
    setSymmetryOrder(derived.symmetryOrder);
    setRadialLayers(derived.radialLayers);
    setRadialRatioFunction(derived.radialRatioFunction);
    setAngularDistribution(derived.angularDistribution);
    setPrimitiveSet(derived.primitiveSet);
    setGapFillRules(derived.gapFillRules);
    setDeformationField(derived.deformationField);
    setFieldMode(derived.fieldMode);
    setZRule(derived.zRule);
    setFieldBoundary(derived.fieldBoundary);
    setFieldMediumDensity(derived.fieldMediumDensity);
    setGridOverlaySize(derived.gridOverlaySize);
    setLotusPetals(derived.lotusPetals);
    setCarrierWaveCycles(derived.carrierWaveCycles);
    setCarrierWaveStrength(derived.carrierWaveStrength);
    setMandalaMix(derived.mandalaMix);
    setLotusMix(derived.lotusMix);
    setCymaticMix(derived.cymaticMix);
    setSampleDensity(derived.sampleDensity);
    setLayerDensityFalloff(derived.layerDensityFalloff);
    setCenterDensityBoost(derived.centerDensityBoost);
    setStrictSacredMapping(derived.strictSacredMapping);
    setNoGapFullForm(derived.noGapFullForm);
    setDepth(derived.depth);
    setScale(derived.scale);
  }, [
    lockToOscillation,
    carrierHz,
    payloadHz,
    amDepth,
    pmDepth,
    resonanceQ,
    tensor.scalar,
    tensorBivectorX,
    tensorVectorY,
    tensorTrivector,
  ]);

  useEffect(() => {
    if (!noGapFullForm) return;
    if (gapFillRules === "none") {
      setGapFillRules("midpoint");
    }
    if (sampleDensity < 1) {
      setSampleDensity(1);
    }
  }, [gapFillRules, noGapFullForm, sampleDensity]);

  const runGenerate = (t: number) => {
    const nextMetrics = computeSpectralMetrics(generatorTensor);
    setMetrics(nextMetrics);
    setParam("unifiedTensor", generatorTensor);

    const sacredFrame = generateSacredCymaglyphFrame(
      {
        symmetryOrder,
        radialLayers,
        radialRatioFunction,
        angularDistribution,
        primitiveSet,
        gapFillRules,
        deformationField,
        fieldMode: "standing",
        zRule,
        fieldBoundary,
        fieldMediumDensity,
        gridOverlaySize,
        lotusPetals,
        carrierWaveCycles,
        carrierWaveStrength,
        mandalaMix,
        lotusMix,
        cymaticMix,
        sampleDensity,
        layerDensityFalloff,
        centerDensityBoost,
        strictSacredMapping,
        noGapFullForm,
        ringJitter: clamp(Math.abs(tensorVectorY) / 50, 0, 1),
        depth,
        scale,
      },
      t,
      pointCount,
    );
    setFrame(sacredFrame);
    if (renderSource === "DSP_ESTIMATE") {
      setCymaglyphGeneratedFrame(sacredFrame);
    }
  };

  useEffect(() => {
    runGenerate(playbackSeconds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    generatorTensor,
    pointCount,
    radius,
    symmetryOrder,
    radialLayers,
    radialRatioFunction,
    angularDistribution,
    primitiveSet,
    gapFillRules,
    deformationField,
    fieldMode,
    zRule,
    fieldBoundary,
    fieldMediumDensity,
    gridOverlaySize,
    lotusPetals,
    carrierWaveCycles,
    carrierWaveStrength,
    mandalaMix,
    lotusMix,
    cymaticMix,
    sampleDensity,
    layerDensityFalloff,
    centerDensityBoost,
    strictSacredMapping,
    noGapFullForm,
    depth,
    scale,
    tensorVectorY,
    setCymaglyphGeneratedFrame,
    renderSource,
  ]);

  useEffect(() => {
    if (!isGenerating) return;
    runGenerate(playbackSeconds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playbackSeconds, isGenerating]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !renderFrame) return;
    drawPointCloud(canvas, renderFrame, 42 * (radius / 3.2), spin);
  }, [renderFrame, spin, radius]);

  return (
    <aside
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "12px",
        height: "100%",
        overflowY: "auto",
        padding: "12px",
        background: "rgba(8,10,16,0.95)",
        borderLeft: "1px solid rgba(255,255,255,0.06)",
      }}
      className="hide-scrollbar"
    >
      <div style={{ fontFamily: "var(--font-family-mono)", fontSize: "0.72rem", color: "rgba(255,255,255,0.55)", textTransform: "uppercase", letterSpacing: "0.1em" }}>
        Cymaglyph Generator
      </div>

      <canvas
        ref={canvasRef}
        width={320}
        height={220}
        style={{
          width: "100%",
          height: "220px",
          borderRadius: "10px",
          border: "1px solid rgba(255,255,255,0.12)",
          background: "#050811",
        }}
      />

      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", rowGap: "6px", columnGap: "8px", fontSize: "0.68rem", fontFamily: "var(--font-family-mono)", color: "rgba(255,255,255,0.72)" }}>
        <span>Condition</span><span style={{ color: activeGradient.nodeColor }}>{metrics?.conditionScore.toFixed(4) ?? "0.0000"}</span>
        <span>Residual</span><span style={{ color: activeGradient.nodeColor }}>{metrics?.maxResidual.toFixed(5) ?? "0.00000"}</span>
        <span>Dominant λ (Re)</span><span style={{ color: activeGradient.nodeColor }}>{metrics?.dominantRealEigen.toFixed(5) ?? "0.00000"}</span>
        <span>Node / A / B / T</span>
        <span style={{ color: activeGradient.nodeColor }}>
          {frame ? `${frame.zoneCounts.NODE_EQ}/${frame.zoneCounts.ANTINODE_A}/${frame.zoneCounts.ANTINODE_B}/${frame.zoneCounts.TRANSITION}` : "0/0/0/0"}
        </span>
      </div>

      <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "0.65rem", fontFamily: "var(--font-family-mono)", color: "rgba(255,255,255,0.52)" }}>
        Point Count: {pointCount}
        <input type="range" min={1500} max={24000} step={500} value={pointCount} onChange={(e) => setPointCount(parseInt(e.target.value, 10))} />
      </label>

      <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "0.65rem", fontFamily: "var(--font-family-mono)", color: "rgba(255,255,255,0.52)" }}>
        Preview Radius: {radius.toFixed(2)}
        <input type="range" min={1.2} max={6} step={0.1} value={radius} onChange={(e) => setRadius(parseFloat(e.target.value))} />
      </label>

      <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "0.65rem", fontFamily: "var(--font-family-mono)", color: "rgba(255,255,255,0.52)" }}>
        View Spin: {spin.toFixed(2)}
        <input type="range" min={0} max={6.28} step={0.01} value={spin} onChange={(e) => setSpin(parseFloat(e.target.value))} />
      </label>

      <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "0.65rem", fontFamily: "var(--font-family-mono)", color: "rgba(255,255,255,0.72)" }}>
        <input type="checkbox" checked={lockToOscillation} onChange={(e) => setLockToOscillation(e.target.checked)} />
        Lock sacred params to oscillation
      </label>

      <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "0.65rem", fontFamily: "var(--font-family-mono)", color: "rgba(255,255,255,0.52)" }}>
        Render Source
        <select value={renderSource} onChange={(e) => setRenderSource(e.target.value as CymaglyphRenderSource)}>
          <option value="DSP_ESTIMATE">DSP_ESTIMATE</option>
          <option value="AIR_ELUCIDATED">AIR_ELUCIDATED</option>
          <option value="AIR_MEASURED">AIR_MEASURED</option>
          <option value="AIR_HYBRID">AIR_HYBRID</option>
          <option value="BIOPLASMA_ELUCIDATED">BIOPLASMA_ELUCIDATED</option>
          <option value="BIOPLASMA_MEASURED">BIOPLASMA_MEASURED</option>
          <option value="BIOPLASMA_HYBRID">BIOPLASMA_HYBRID</option>
        </select>
      </label>

      <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "0.65rem", fontFamily: "var(--font-family-mono)", color: "rgba(255,255,255,0.52)" }}>
        Render Mode
        <select value={renderMode} onChange={(e) => setRenderMode(e.target.value as CymaglyphRenderMode)}>
          <option value="POINT_CLOUD">POINT_CLOUD</option>
          <option value="RHOTORSE_FLUID">RHOTORSE_FLUID</option>
          <option value="SDF_DOMAIN_REPEAT">SDF_DOMAIN_REPEAT</option>
          <option value="SDF_DOMAIN_REPEAT_RHOTORSE">SDF_DOMAIN_REPEAT_RHOTORSE</option>
          <option value="SDF_WORLD">SDF_WORLD</option>
          <option value="SDF_CLOSED_MESH">SDF_CLOSED_MESH</option>
        </select>
      </label>
      {(renderSource === "AIR_MEASURED" ||
        renderSource === "AIR_HYBRID" ||
        renderSource === "BIOPLASMA_MEASURED" ||
        renderSource === "BIOPLASMA_HYBRID") && (
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto", columnGap: "8px", fontSize: "0.62rem", fontFamily: "var(--font-family-mono)", color: "rgba(255,255,255,0.65)" }}>
            <span>Mic Capture</span>
            <span style={{ color: activeGradient.nodeColor }}>{micPermissionState}</span>
          </div>
          <button
            onClick={() => requestMicPermission()}
            style={{
              padding: "8px 10px",
              borderRadius: "8px",
              border: `1px solid ${activeGradient.nodeColor}`,
              background: `${activeGradient.nodeColor}1a`,
              color: activeGradient.nodeColor,
              fontFamily: "var(--font-family-mono)",
              fontSize: "0.66rem",
              cursor: "pointer",
            }}
          >
            Request Mic Permission
          </button>
        </div>
      )}
      {(renderMode === "SDF_DOMAIN_REPEAT" || renderMode === "SDF_DOMAIN_REPEAT_RHOTORSE") && (
        <>
          <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "0.65rem", fontFamily: "var(--font-family-mono)", color: "rgba(255,255,255,0.52)" }}>
            Domain Repeat Count: {domainRepeatCount}
            <input
              type="range"
              min={1}
              max={100}
              step={1}
              value={domainRepeatCount}
              onChange={(e) => setDomainRepeatCount(parseInt(e.target.value, 10))}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "0.65rem", fontFamily: "var(--font-family-mono)", color: "rgba(255,255,255,0.52)" }}>
            Repeat Layout
            <select value={domainRepeatLayout} onChange={(e) => setDomainRepeatLayout(e.target.value as DomainRepeatLayout)}>
              <option value="radial">radial</option>
              <option value="stack">stack</option>
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "0.65rem", fontFamily: "var(--font-family-mono)", color: "rgba(255,255,255,0.52)" }}>
            Repeat Depth Step: {domainRepeatDepthStep.toFixed(2)}
            <input
              type="range"
              min={-6}
              max={6}
              step={0.05}
              value={domainRepeatDepthStep}
              onChange={(e) => setDomainRepeatDepthStep(parseFloat(e.target.value))}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "0.65rem", fontFamily: "var(--font-family-mono)", color: "rgba(255,255,255,0.52)" }}>
            Repeat Oscillation Coupling: {domainRepeatOscillationCoupling.toFixed(2)}
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={domainRepeatOscillationCoupling}
              onChange={(e) => setDomainRepeatOscillationCoupling(parseFloat(e.target.value))}
            />
          </label>
          {Array.from({ length: Math.min(domainRepeatCount, 8) + 1 }, (_, i) => i).map((ring) => (
            <div
              key={`ring-rot-${ring}`}
              style={{ display: "grid", gridTemplateColumns: "1fr", gap: "4px", padding: "6px", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "6px" }}
            >
              <div style={{ fontSize: "0.62rem", fontFamily: "var(--font-family-mono)", color: "rgba(255,255,255,0.6)" }}>
                Domain Ring {ring} Rotation
              </div>
              <label style={{ display: "flex", flexDirection: "column", gap: "2px", fontSize: "0.58rem", fontFamily: "var(--font-family-mono)", color: "rgba(255,255,255,0.5)" }}>
                X: {(domainRepeatRotXDeg[ring] ?? 0).toFixed(1)}°
                <input
                  type="range"
                  min={-180}
                  max={180}
                  step={0.5}
                  value={domainRepeatRotXDeg[ring] ?? 0}
                  onChange={(e) => setDomainRepeatRotationXDeg(ring, parseFloat(e.target.value))}
                />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: "2px", fontSize: "0.58rem", fontFamily: "var(--font-family-mono)", color: "rgba(255,255,255,0.5)" }}>
                Y: {(domainRepeatRotYDeg[ring] ?? 0).toFixed(1)}°
                <input
                  type="range"
                  min={-180}
                  max={180}
                  step={0.5}
                  value={domainRepeatRotYDeg[ring] ?? 0}
                  onChange={(e) => setDomainRepeatRotationYDeg(ring, parseFloat(e.target.value))}
                />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: "2px", fontSize: "0.58rem", fontFamily: "var(--font-family-mono)", color: "rgba(255,255,255,0.5)" }}>
                Z: {(domainRepeatRotZDeg[ring] ?? 0).toFixed(1)}°
                <input
                  type="range"
                  min={-180}
                  max={180}
                  step={0.5}
                  value={domainRepeatRotZDeg[ring] ?? 0}
                  onChange={(e) => setDomainRepeatRotationZDeg(ring, parseFloat(e.target.value))}
                />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: "2px", fontSize: "0.58rem", fontFamily: "var(--font-family-mono)", color: "rgba(255,255,255,0.62)" }}>
                Layer Oscillation
                <select
                  value={domainRepeatLayerOscillationIds[ring] ?? ""}
                  onChange={(e) => setDomainRepeatLayerOscillationId(ring, e.target.value || null)}
                  style={{ background: "rgba(8,18,32,0.92)", color: "white", border: "1px solid rgba(255,255,255,0.16)", borderRadius: "6px", padding: "4px 6px" }}
                >
                  <option value="">(default)</option>
                  {compendiumEntries
                    .filter((entry) => entry.category !== "Message")
                    .slice(0, 200)
                    .map((entry) => (
                      <option key={`ring-${ring}-osc-${entry.id}`} value={entry.id}>
                        {entry.name}
                      </option>
                    ))}
                </select>
              </label>
            </div>
          ))}
        </>
      )}

      <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "0.65rem", fontFamily: "var(--font-family-mono)", color: "rgba(255,255,255,0.52)" }}>
        Propagation Medium
        <select value={normalizedPropagationMediumId} onChange={(e) => setPropagationMediumId(normalizeMediumId(e.target.value) as PropagationMediumId)}>
          {ALL_MEDIUM_IDS.map((id) => (
            <option key={id} value={id}>{MEDIUM_PROFILES[id].label}</option>
          ))}
        </select>
      </label>

      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", rowGap: "4px", columnGap: "8px", fontSize: "0.62rem", fontFamily: "var(--font-family-mono)", color: "rgba(255,255,255,0.64)" }}>
        <span>Medium Family</span><span style={{ color: activeGradient.nodeColor }}>{mediumProfile.family}</span>
        <span>rho (kg/m3)</span><span style={{ color: activeGradient.nodeColor }}>{mediumProfile.rhoKgM3.toFixed(3)}</span>
        <span>c (m/s)</span><span style={{ color: activeGradient.nodeColor }}>{mediumProfile.speedMps.toFixed(2)}</span>
        <span>eta (Pa·s)</span><span style={{ color: activeGradient.nodeColor }}>{mediumProfile.viscosityPaS.toExponential(2)}</span>
        <span>Dispersion</span><span style={{ color: activeGradient.nodeColor }}>{mediumProfile.dispersion.toFixed(3)}</span>
              </div>


      <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "0.65rem", fontFamily: "var(--font-family-mono)", color: "rgba(255,255,255,0.52)" }}>
        Symmetry: {symmetryOrder}
        <input type="range" min={6} max={24} step={1} value={symmetryOrder} onChange={(e) => setSymmetryOrder(parseInt(e.target.value, 10))} />
      </label>

      <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "0.65rem", fontFamily: "var(--font-family-mono)", color: "rgba(255,255,255,0.52)" }}>
        Radial Layers: {radialLayers}
        <input type="range" min={3} max={16} step={1} value={radialLayers} onChange={(e) => setRadialLayers(parseInt(e.target.value, 10))} />
      </label>

      <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "0.65rem", fontFamily: "var(--font-family-mono)", color: "rgba(255,255,255,0.52)" }}>
        Radial Ratio Function
        <select value={radialRatioFunction} onChange={(e) => setRadialRatioFunction(e.target.value as RadialRatioFunction)}>
          <option value="linear">linear</option>
          <option value="phi">phi</option>
          <option value="exp">exp</option>
          <option value="harmonic">harmonic</option>
        </select>
      </label>

      <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "0.65rem", fontFamily: "var(--font-family-mono)", color: "rgba(255,255,255,0.52)" }}>
        Angular Distribution
        <select value={angularDistribution} onChange={(e) => setAngularDistribution(e.target.value as AngularDistribution)}>
          <option value="uniform">uniform</option>
          <option value="fol">fol</option>
          <option value="golden">golden</option>
          <option value="alternating">alternating</option>
          <option value="spiral">spiral</option>
        </select>
      </label>

      <div style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "0.65rem", fontFamily: "var(--font-family-mono)", color: "rgba(255,255,255,0.52)" }}>
        <span>Primitive Set</span>
        {(["circle", "arc", "petal", "polygon", "curvedRect"] as PrimitiveKind[]).map((kind) => (
          <label key={kind} style={{ display: "flex", alignItems: "center", gap: "8px", color: "rgba(255,255,255,0.72)" }}>
            <input
              type="checkbox"
              checked={primitiveSet.includes(kind)}
              onChange={(e) => {
                setPrimitiveSet((prev) => {
                  if (e.target.checked) {
                    if (prev.includes(kind)) return prev;
                    return [...prev, kind];
                  }
                  const next = prev.filter((x) => x !== kind);
                  return next.length > 0 ? next : ["circle"];
                });
              }}
            />
            {kind}
          </label>
        ))}
      </div>

      <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "0.65rem", fontFamily: "var(--font-family-mono)", color: "rgba(255,255,255,0.52)" }}>
        Gap Fill Rules
        <select value={gapFillRules} onChange={(e) => setGapFillRules(e.target.value as GapFillRule)}>
          <option value="none">none</option>
          <option value="midpoint">midpoint</option>
          <option value="midpointSpiral">midpointSpiral</option>
        </select>
      </label>

      <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "0.65rem", fontFamily: "var(--font-family-mono)", color: "rgba(255,255,255,0.52)" }}>
        Deformation Field
        <select value={deformationField} onChange={(e) => setDeformationField(e.target.value as DeformationField)}>
          <option value="none">none</option>
          <option value="torsion">torsion</option>
          <option value="radial">radial</option>
          <option value="woven">woven</option>
        </select>
      </label>

      <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "0.65rem", fontFamily: "var(--font-family-mono)", color: "rgba(255,255,255,0.52)" }}>
        Cymatic Field Mode
        <select value={fieldMode} onChange={(e) => setFieldMode(e.target.value as FieldMode)}>
          <option value="standing">standing</option>
        </select>
      </label>

      <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "0.65rem", fontFamily: "var(--font-family-mono)", color: "rgba(255,255,255,0.52)" }}>
        Projection Z Rule
        <select value={zRule} onChange={(e) => setZRule(e.target.value as ZRule)}>
          <option value="layer">layer</option>
          <option value="radialSin">radialSin</option>
          <option value="field">field</option>
        </select>
      </label>

      <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "0.65rem", fontFamily: "var(--font-family-mono)", color: "rgba(255,255,255,0.52)" }}>
        Field Boundary
        <select value={fieldBoundary} onChange={(e) => setFieldBoundary(e.target.value as "circle" | "square")}>
          <option value="circle">circle</option>
          <option value="square">square</option>
        </select>
      </label>

      <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "0.65rem", fontFamily: "var(--font-family-mono)", color: "rgba(255,255,255,0.52)" }}>
        Field Medium Density: {fieldMediumDensity.toFixed(2)}
        <input type="range" min={0.2} max={2.0} step={0.01} value={fieldMediumDensity} onChange={(e) => setFieldMediumDensity(parseFloat(e.target.value))} />
      </label>

      <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "0.65rem", fontFamily: "var(--font-family-mono)", color: "rgba(255,255,255,0.52)" }}>
        Grid Overlay: {gridOverlaySize}x{gridOverlaySize}
        <input type="range" min={0} max={12} step={1} value={gridOverlaySize} onChange={(e) => setGridOverlaySize(parseInt(e.target.value, 10))} />
      </label>

      <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "0.65rem", fontFamily: "var(--font-family-mono)", color: "rgba(255,255,255,0.52)" }}>
        Lotus Petals: {lotusPetals}
        <input type="range" min={4} max={24} step={1} value={lotusPetals} onChange={(e) => setLotusPetals(parseInt(e.target.value, 10))} />
      </label>

      <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "0.65rem", fontFamily: "var(--font-family-mono)", color: "rgba(255,255,255,0.52)" }}>
        Carrier Wave Cycles: {carrierWaveCycles}
        <input type="range" min={1} max={32} step={1} value={carrierWaveCycles} onChange={(e) => setCarrierWaveCycles(parseInt(e.target.value, 10))} />
      </label>

      <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "0.65rem", fontFamily: "var(--font-family-mono)", color: "rgba(255,255,255,0.52)" }}>
        Carrier Wave Strength: {carrierWaveStrength.toFixed(2)}
        <input type="range" min={0} max={1} step={0.01} value={carrierWaveStrength} onChange={(e) => setCarrierWaveStrength(parseFloat(e.target.value))} />
      </label>

      <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "0.65rem", fontFamily: "var(--font-family-mono)", color: "rgba(255,255,255,0.52)" }}>
        Mandala Mix: {mandalaMix.toFixed(2)}
        <input type="range" min={0} max={1} step={0.01} value={mandalaMix} onChange={(e) => setMandalaMix(parseFloat(e.target.value))} />
      </label>

      <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "0.65rem", fontFamily: "var(--font-family-mono)", color: "rgba(255,255,255,0.52)" }}>
        Lotus Mix: {lotusMix.toFixed(2)}
        <input type="range" min={0} max={1} step={0.01} value={lotusMix} onChange={(e) => setLotusMix(parseFloat(e.target.value))} />
      </label>

      <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "0.65rem", fontFamily: "var(--font-family-mono)", color: "rgba(255,255,255,0.52)" }}>
        Cymatic Mix: {cymaticMix.toFixed(2)}
        <input type="range" min={0} max={1} step={0.01} value={cymaticMix} onChange={(e) => setCymaticMix(parseFloat(e.target.value))} />
      </label>

      <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "0.65rem", fontFamily: "var(--font-family-mono)", color: "rgba(255,255,255,0.52)" }}>
        Sample Density: {sampleDensity.toFixed(2)}
        <input type="range" min={0.4} max={2.5} step={0.01} value={sampleDensity} onChange={(e) => setSampleDensity(parseFloat(e.target.value))} />
      </label>

      <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "0.65rem", fontFamily: "var(--font-family-mono)", color: "rgba(255,255,255,0.52)" }}>
        Layer Density Falloff: {layerDensityFalloff.toFixed(2)}
        <input type="range" min={0.1} max={4} step={0.01} value={layerDensityFalloff} onChange={(e) => setLayerDensityFalloff(parseFloat(e.target.value))} />
      </label>

      <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "0.65rem", fontFamily: "var(--font-family-mono)", color: "rgba(255,255,255,0.52)" }}>
        Center Density Boost: {centerDensityBoost.toFixed(2)}
        <input type="range" min={1} max={4} step={0.01} value={centerDensityBoost} onChange={(e) => setCenterDensityBoost(parseFloat(e.target.value))} />
      </label>

      <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "0.65rem", fontFamily: "var(--font-family-mono)", color: "rgba(255,255,255,0.72)" }}>
        <input type="checkbox" checked={strictSacredMapping} onChange={(e) => setStrictSacredMapping(e.target.checked)} />
        Strict Sacred Mapping
      </label>

      <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "0.65rem", fontFamily: "var(--font-family-mono)", color: "rgba(255,255,255,0.78)" }}>
        <input type="checkbox" checked={noGapFullForm} onChange={(e) => setNoGapFullForm(e.target.checked)} />
        No-Gap Full-Form
      </label>
      {noGapFullForm && (
        <div style={{ fontSize: "0.58rem", color: "rgba(190,235,255,0.82)", fontFamily: "var(--font-family-mono)" }}>
          Continuous curve mode enforced: closed loop output, no sparse ring gaps.
        </div>
      )}

      <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "0.65rem", fontFamily: "var(--font-family-mono)", color: "rgba(255,255,255,0.52)" }}>
        Depth: {depth.toFixed(2)}
        <input type="range" min={0.1} max={1.2} step={0.01} value={depth} onChange={(e) => setDepth(parseFloat(e.target.value))} />
      </label>

      <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "0.65rem", fontFamily: "var(--font-family-mono)", color: "rgba(255,255,255,0.52)" }}>
        Scale: {scale.toFixed(2)}
        <input type="range" min={1.4} max={5.4} step={0.05} value={scale} onChange={(e) => setScale(parseFloat(e.target.value))} />
      </label>

      <button
        onClick={() => runGenerate(playbackSeconds)}
        style={{
          marginTop: "4px",
          padding: "10px 12px",
          borderRadius: "8px",
          border: `1px solid ${activeGradient.nodeColor}`,
          background: `${activeGradient.nodeColor}18`,
          color: activeGradient.nodeColor,
          fontFamily: "var(--font-family-mono)",
          fontSize: "0.75rem",
          cursor: "pointer",
          letterSpacing: "0.08em",
          fontWeight: 700,
        }}
      >
        Generate Cymaglyph
      </button>

      <div style={{ display: "grid", gap: "6px", gridTemplateColumns: "1fr 1fr" }}>
        <button
          onClick={() => renderFrame && downloadTextFile("cymaglyph.obj", exportOBJ(renderFrame), "text/plain")}
          disabled={!renderFrame}
          style={{
            padding: "8px 10px",
            borderRadius: "8px",
            border: "1px solid rgba(255,255,255,0.2)",
            background: "rgba(255,255,255,0.06)",
            color: "#d8f6ff",
            fontFamily: "var(--font-family-mono)",
            fontSize: "0.68rem",
            cursor: renderFrame ? "pointer" : "not-allowed",
            opacity: renderFrame ? 1 : 0.6,
          }}
        >
          Export .OBJ
        </button>
        <button
          onClick={() => renderFrame && downloadTextFile("cymaglyph.fbx", exportFBX(renderFrame), "text/plain")}
          disabled={!renderFrame}
          style={{
            padding: "8px 10px",
            borderRadius: "8px",
            border: "1px solid rgba(255,255,255,0.2)",
            background: "rgba(255,255,255,0.06)",
            color: "#d8f6ff",
            fontFamily: "var(--font-family-mono)",
            fontSize: "0.68rem",
            cursor: renderFrame ? "pointer" : "not-allowed",
            opacity: renderFrame ? 1 : 0.6,
          }}
        >
          Export .FBX
        </button>
        <button
          onClick={() => renderFrame && downloadTextFile("cymaglyph.gcode", exportGCode(renderFrame), "text/plain")}
          disabled={!renderFrame}
          style={{
            padding: "8px 10px",
            borderRadius: "8px",
            border: "1px solid rgba(255,255,255,0.2)",
            background: "rgba(255,255,255,0.06)",
            color: "#d8f6ff",
            fontFamily: "var(--font-family-mono)",
            fontSize: "0.68rem",
            cursor: renderFrame ? "pointer" : "not-allowed",
            opacity: renderFrame ? 1 : 0.6,
          }}
        >
          Export .GCODE
        </button>
        <button
          onClick={() => {
            if (!renderFrame) return;
            const frames: Array<{ t: number; obj: string }> = [];
            const sampleCount = Math.max(8, Math.floor(loopSeconds * 16));
            for (let i = 0; i < sampleCount; i += 1) {
              const t = playbackSeconds + (i / sampleCount) * loopSeconds;
              const f = generateSacredCymaglyphFrame(
                {
                  symmetryOrder,
                  radialLayers,
                  radialRatioFunction,
                  angularDistribution,
                  primitiveSet,
                  gapFillRules,
                  deformationField,
                  fieldMode: "standing",
                  zRule,
                  fieldBoundary,
                  fieldMediumDensity,
                  gridOverlaySize,
                  lotusPetals,
                  carrierWaveCycles,
                  carrierWaveStrength,
                  mandalaMix,
                  lotusMix,
                  cymaticMix,
                  sampleDensity,
                  layerDensityFalloff,
                  centerDensityBoost,
                  strictSacredMapping,
                  noGapFullForm,
                  ringJitter: clamp(Math.abs(tensorVectorY) / 50, 0, 1),
                  depth,
                  scale,
                },
                t,
                pointCount,
              );
              const loopFrame =
                (renderMode === "SDF_DOMAIN_REPEAT" || renderMode === "SDF_DOMAIN_REPEAT_RHOTORSE")
                  ? applyDomainRepetitionToFrame(f, domainRepeatCount, {
                      layout: domainRepeatLayout,
                      backwardOnly: true,
                      depthStep: domainRepeatDepthStep,
                      oscillationCoupling: domainRepeatOscillationCoupling,
                      rotXDeg: domainRepeatRotXDeg,
                      rotYDeg: domainRepeatRotYDeg,
                      rotZDeg: domainRepeatRotZDeg,
                      carrierHz,
                      payloadHz,
                    })
                  : f;
              frames.push({ t, obj: exportOBJ(loopFrame) });
            }
            downloadTextFile(
              "cymaglyph_loop.json",
              JSON.stringify(
                {
                  loopSeconds,
                  samples: sampleCount,
                  frames,
                },
                null,
                2,
              ),
              "application/json",
            );
          }}
          disabled={!renderFrame}
          style={{
            padding: "8px 10px",
            borderRadius: "8px",
            border: "1px solid rgba(255,255,255,0.2)",
            background: "rgba(255,255,255,0.06)",
            color: "#d8f6ff",
            fontFamily: "var(--font-family-mono)",
            fontSize: "0.68rem",
            cursor: renderFrame ? "pointer" : "not-allowed",
            opacity: renderFrame ? 1 : 0.6,
          }}
        >
          Export Loop
        </button>
      </div>

      <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "0.65rem", fontFamily: "var(--font-family-mono)", color: "rgba(255,255,255,0.52)" }}>
        Loop Seconds: {loopSeconds.toFixed(2)}
        <input type="range" min={0.5} max={8} step={0.1} value={loopSeconds} onChange={(e) => setLoopSeconds(parseFloat(e.target.value))} />
      </label>

      <div style={{ fontSize: "0.62rem", color: "rgba(255,255,255,0.4)", fontFamily: "var(--font-family-mono)" }}>
        Active Tensor Timecode: {currentUnifiedTensor?.timecode ?? "n/a"}
      </div>
    </aside>
  );
}


