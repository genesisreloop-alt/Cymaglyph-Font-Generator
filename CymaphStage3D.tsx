"use client";
/**
 * CymaphStage3D — Three.js 3D Cymaglyph Renderer
 *
 * Modes:
 * - POINT_CLOUD / RHOTORSE_FLUID / SDF_DOMAIN_REPEAT: classic point cloud path
 * - SDF_WORLD: true raymarched signed-distance world driven by signal contract
 */

import React, { useRef, useEffect, useCallback, useMemo, useState } from "react";
import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  LineBasicMaterial,
  LineSegments,
  Material,
  MeshBasicMaterial,
  Mesh,
  OrthographicCamera,
  PerspectiveCamera,
  PlaneGeometry,
  Points,
  PointsMaterial,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector3,
  WebGLRenderer,
  DoubleSide,
} from "three";
import { useTransmitterStore } from "@/store/transmitterStore";
import type { FAAMeshControlVector, PhiSudTensor, PsiAirState } from "@/store/transmitterStore";
import { createRhotorseFluidMaterial, updateRhotorseFluidUniforms } from "@/lib/rhotorseFluidShader";
import { applyDomainRepetitionToFrame } from "@/lib/cymaglyphDomainRepeat";
import { loadPanelExportRecord, savePanelExportRecord } from "@/lib/indexedDB";
import { emitConsoleHead } from "@/lib/consoleHead";
import {
  computeFAAMeshControlVector,
  deriveFAAReportLikeFromAir,
  deriveRhoTorseMeansFromPsi,
} from "@/lib/faaRhotorseMeshMapping";

const PHI = 1.6180339887498948482;
const ROOT3 = Math.sqrt(3);
const COS60 = Math.cos(Math.PI / 3);
const SIN60 = Math.sin(Math.PI / 3);
const COS120 = Math.cos((2 * Math.PI) / 3);
const SIN120 = Math.sin((2 * Math.PI) / 3);
const COS240 = Math.cos((4 * Math.PI) / 3);
const SIN240 = Math.sin((4 * Math.PI) / 3);
const COS300 = Math.cos((5 * Math.PI) / 3);
const SIN300 = Math.sin((5 * Math.PI) / 3);
const CAMERA_TRACK_EXPORT_ID = "stage:camera-track";
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const parseIntegerOrKeep = (raw: string, previous: number, min: number, max: number): number => {
  const trimmed = raw.trim();
  if (!trimmed) return previous;
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed)) return previous;
  return clamp(parsed, min, max);
};

function computeFoLDomainSpacingFromFrame(frame: { positions: Float32Array } | null | undefined, repeatCount: number): number {
  if (!frame || frame.positions.length < 3) return 3.2 + repeatCount * 1.1;
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < frame.positions.length; i += 3) {
    const x = frame.positions[i + 0];
    const z = frame.positions[i + 2];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  const diameter = Math.max(0.4, maxX - minX, maxZ - minZ);
  // FoL stack spacing invariant: diameter:spacing = 2:sqrt(3)
  return Math.max(0.24, diameter * (ROOT3 / 2));
}

const disposeMaterial = (material: Material | Material[]) => {
  if (Array.isArray(material)) {
    for (const m of material) m.dispose();
    return;
  }
  material.dispose();
};

const DIRS_3D: Vector3[] = [
  new Vector3(0, 1, 0).normalize(),
  new Vector3(COS60, 0, SIN60).normalize(),
  new Vector3(COS120, 0, SIN120).normalize(),
  new Vector3(0, -1, 0).normalize(),
  new Vector3(COS240, 0, SIN240).normalize(),
  new Vector3(COS300, 0, SIN300).normalize(),
];
const OPP = [3, 4, 5, 0, 1, 2];

const SDF_WORLD_VERTEX = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const SDF_WORLD_FRAGMENT = `
precision highp float;

varying vec2 vUv;
uniform vec2 uResolution;
uniform float uTime;
uniform vec3 uCamPos;
uniform vec3 uCamForward;
uniform vec3 uCamRight;
uniform vec3 uCamUp;
uniform float uCarrierHz;
uniform float uPayloadHz;
uniform float uCarrierBase;
uniform float uPayloadMod;
uniform float uEmitted;
uniform float uAmDepth;
uniform float uPmDepth;
uniform float uResQ;
uniform float uRepeatCount;
uniform float uMoveSpeed;
uniform float uPsiConfidence;
uniform float uDomainSpacing;

const int MAX_STEPS = 112;
const float MAX_DIST = 120.0;
const float HIT_EPS = 0.0018;

vec3 opRepFinite(vec3 p, float spacing, float count) {
  vec3 tile = floor(p / spacing + 0.5);
  tile = clamp(tile, vec3(-count), vec3(count));
  return p - spacing * tile;
}

float sdSphere(vec3 p, float r) {
  return length(p) - r;
}

float sdTorus(vec3 p, vec2 t) {
  vec2 q = vec2(length(p.xz) - t.x, p.y);
  return length(q) - t.y;
}

float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

float fractalDE(vec3 p) {
  vec3 z = p;
  float dr = 1.0;
  float r = 0.0;
  for (int i = 0; i < 7; i++) {
    r = length(z);
    if (r > 2.4) break;
    float theta = acos(clamp(z.y / max(r, 1e-4), -1.0, 1.0));
    float phi = atan(z.z, z.x);
    float power = 6.0 + 2.0 * clamp(uPayloadHz / 2000.0, 0.0, 1.0);
    dr = pow(r, power - 1.0) * power * dr + 1.0;
    float zr = pow(r, power);
    theta *= power;
    phi *= power;
    z = zr * vec3(sin(theta) * cos(phi), cos(theta), sin(theta) * sin(phi)) + p;
  }
  return 0.5 * log(max(r, 1e-4)) * r / max(dr, 1e-4);
}

float signalField(vec3 p) {
  float cf = clamp(uCarrierHz / 24000.0, 0.01, 1.0);
  float pf = clamp(uPayloadHz / 2000.0, 0.01, 1.0);
  float phaseScaffold = sin(length(p.xz) * (5.0 + cf * 18.0) - uTime * (0.7 + cf * 2.5) + uCarrierBase * 6.0);
  float phaseEnvelope = sin(p.y * (3.0 + pf * 10.0) + atan(p.z, p.x) * (6.0 + cf * 16.0) + uPayloadMod * 4.0);
  float torsion = sin((p.x * p.y - p.z * p.z) * (0.45 + clamp(uResQ / 100.0, 0.01, 1.0) * 1.8) + uPmDepth * 0.03);
  return phaseScaffold * 0.55 + phaseEnvelope * 0.35 + torsion * 0.18 + uEmitted * 0.25;
}

float mapScene(vec3 p) {
  vec3 q = opRepFinite(p, uDomainSpacing, uRepeatCount);
  float carrierNorm = clamp(uCarrierHz / 24000.0, 0.01, 1.0);
  float payloadNorm = clamp(uPayloadHz / 2000.0, 0.01, 1.0);
  float baseR = mix(0.6, 1.55, carrierNorm);
  float dPrimRepeat = min(
    sdSphere(q, baseR),
    sdTorus(q, vec2(0.72 + carrierNorm * 0.65, 0.1 + payloadNorm * 0.22))
  );
  float dPrimCenter = min(
    sdSphere(p, baseR * 1.05),
    sdTorus(p, vec2(0.72 + carrierNorm * 0.65, 0.1 + payloadNorm * 0.22))
  );
  float dPrim = smin(dPrimRepeat, dPrimCenter, 0.18 + payloadNorm * 0.08);
  float dFrac = fractalDE(q * (0.84 + payloadNorm * 0.42));
  float dBase = smin(dPrim, dFrac, 0.16 + payloadNorm * 0.06);

  float fieldEnvelope = smoothstep(1.0, 0.15, clamp(length(p) / (14.0 + uRepeatCount * 4.0), 0.0, 1.0));
  float dSignal = -signalField(q) * (0.04 + payloadNorm * 0.08 + uPsiConfidence * 0.05) * fieldEnvelope;
  float d = dBase + dSignal;

  // Finite world envelope (closure bound).
  float worldBound = length(p) - (24.0 + uRepeatCount * 10.0);
  d = max(d, worldBound);
  return d;
}

vec3 estimateNormal(vec3 p) {
  vec2 e = vec2(0.001, 0.0);
  return normalize(vec3(
    mapScene(p + e.xyy) - mapScene(p - e.xyy),
    mapScene(p + e.yxy) - mapScene(p - e.yxy),
    mapScene(p + e.yyx) - mapScene(p - e.yyx)
  ));
}

void main() {
  vec2 uv = vUv * 2.0 - 1.0;
  uv.x *= uResolution.x / max(uResolution.y, 1.0);

  vec3 rd = normalize(uCamForward + uv.x * uCamRight + uv.y * uCamUp);
  vec3 ro = uCamPos;

  float t = 0.0;
  float d = 0.0;
  bool hit = false;
  for (int i = 0; i < MAX_STEPS; i++) {
    vec3 p = ro + rd * t;
    d = mapScene(p);
    if (d < HIT_EPS) { hit = true; break; }
    if (t > MAX_DIST) break;
    t += max(0.002, d * 0.82);
  }

  vec3 col = vec3(0.01, 0.02, 0.05);
  if (hit) {
    vec3 p = ro + rd * t;
    vec3 n = estimateNormal(p);
    vec3 l = normalize(vec3(0.6, 0.7, -0.4));
    float diff = clamp(dot(n, l), 0.0, 1.0);
    float fres = pow(1.0 - clamp(dot(-rd, n), 0.0, 1.0), 3.0);

    float sf = signalField(p);
    vec3 nodeCol = vec3(0.88, 1.0, 1.0);
    vec3 antiCol = vec3(0.5, 0.69, 0.75);
    vec3 mixCol = mix(nodeCol, antiCol, smoothstep(-0.9, 0.9, sf));

    col = mixCol * (0.25 + diff * 0.8) + fres * vec3(0.55, 0.75, 1.0);
  } else {
    float haze = exp(-0.018 * t * t);
    col += vec3(0.03, 0.07, 0.12) * haze;
  }

  float vignette = smoothstep(1.35, 0.25, length(uv));
  col *= vignette;
  gl_FragColor = vec4(col, 1.0);
}
`;

function runIFS3D(tensor: PhiSudTensor, baseR: number, iters: number): Float32Array {
  const scale = tensor.scalar / 100;
  const torsion = tensor.bivector[0] / 50;
  const divergence = Math.abs(tensor.vector[1]) / 50;
  const rho = baseR * (scale * 0.6 + 0.4);
  const step = rho * (2 / ROOT3);

  let seed = (Math.round(tensor.scalar * 1000 + tensor.trivector * 100000 + tensor.bivector[0] * 10000)) | 0;
  const rng = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
    return ((seed >>> 1) & 0x7fffffff) / 0x7fffffff;
  };

  const positions: number[] = [];
  let x = 0;
  let y = 0;
  let z = 0;
  let lastDir = -1;
  for (let i = 0; i < iters; i++) {
    let idx = 0;
    let tries = 0;
    do {
      idx = Math.floor(rng() * 6);
      tries++;
    } while (lastDir >= 0 && idx === OPP[lastDir] && tries < 12);
    const dir = DIRS_3D[idx];
    const ang = Math.atan2(dir.z, dir.x) + torsion * 0.25;
    const eff = step * (1 + divergence * 0.12 * Math.sin(idx * 1.047));
    const flatR = Math.hypot(dir.x, dir.z) > 0.001 ? Math.hypot(dir.x, dir.z) : 0;
    x = x / PHI + Math.cos(ang) * eff * flatR;
    y = y / PHI + dir.y * eff;
    z = z / PHI + Math.sin(ang) * eff * flatR;
    lastDir = idx;
    if (i > 80) positions.push(x, y, z);
  }
  return new Float32Array(positions);
}

function buildSeedLines(baseR: number, scalar: number): { positions: Float32Array; colors: Float32Array } {
  const scale = scalar / 100;
  const rho = baseR * (scale * 0.6 + 0.4);
  const step = rho * (2 / ROOT3);
  const nodeColors = [
    [0.06, 0.94, 0.99],
    [0.99, 0.06, 0.75],
    [0.36, 0.55, 1.0],
    [0.06, 0.94, 0.99],
    [0.99, 0.06, 0.75],
    [0.36, 0.55, 1.0],
  ];
  const positions: number[] = [];
  const colors: number[] = [];
  for (let d = 0; d < 6; d++) {
    const dir = DIRS_3D[d];
    positions.push(0, 0, 0, dir.x * step, dir.y * step, dir.z * step);
    const c = nodeColors[d];
    colors.push(c[0], c[1], c[2], c[0], c[1], c[2]);
  }
  return { positions: new Float32Array(positions), colors: new Float32Array(colors) };
}

function OverlaySlider({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.62rem", fontFamily: "var(--font-family-mono)", color: "rgba(255,255,255,0.55)" }}>
        <span>{label}</span>
        <span style={{ color: "#E0FFFF" }}>{value.toFixed(step < 1 ? 2 : 0)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(parseFloat(e.target.value))} style={{ width: "100%", accentColor: "#A0D0E0", cursor: "pointer" }} />
    </div>
  );
}

interface CameraKeyframe {
  t: number;
  x: number;
  y: number;
  z: number;
  tx: number;
  ty: number;
  tz: number;
  params?: CameraParamSnapshot;
}

interface CameraParamSnapshot {
  carrierHz: number;
  payloadHz: number;
  amDepth: number;
  pmDepth: number;
  resonanceQ: number;
  tensorScalar: number;
  tensorBivector0: number;
  tensorTrivector: number;
  nodeColor: string;
  antiColor: string;
  transColor: string;
  brightness: number;
  gamma: number;
}

interface CameraTrack {
  id: string;
  name: string;
  durationSec: number;
  frames: CameraKeyframe[];
  hysteresis: {
    coercivity: number;
    retentivity: number;
    saturation: number;
  };
  exportProfile?: {
    alpha: boolean;
    width?: number;
    height?: number;
    fps?: number;
    durationSec?: number;
    codec?: "webm-vp9" | "webm-vp8" | "h264-mp4";
    quality?: number;
  };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function hexToRgb(hex: string): [number, number, number] {
  const safe = hex.trim().replace("#", "");
  if (safe.length !== 6) return [224, 255, 255];
  const r = Number.parseInt(safe.slice(0, 2), 16);
  const g = Number.parseInt(safe.slice(2, 4), 16);
  const b = Number.parseInt(safe.slice(4, 6), 16);
  if (![r, g, b].every(Number.isFinite)) return [224, 255, 255];
  return [r, g, b];
}

function rgbToHex(rgb: [number, number, number]): string {
  const p = rgb.map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, "0"));
  return `#${p[0]}${p[1]}${p[2]}`;
}

function lerpHex(a: string, b: string, t: number): string {
  const aa = hexToRgb(a);
  const bb = hexToRgb(b);
  return rgbToHex([
    lerp(aa[0], bb[0], t),
    lerp(aa[1], bb[1], t),
    lerp(aa[2], bb[2], t),
  ]);
}

function interpolateParams(a?: CameraParamSnapshot, b?: CameraParamSnapshot, u = 0): CameraParamSnapshot | undefined {
  if (!a && !b) return undefined;
  if (!a) return b;
  if (!b) return a;
  return {
    carrierHz: lerp(a.carrierHz, b.carrierHz, u),
    payloadHz: lerp(a.payloadHz, b.payloadHz, u),
    amDepth: lerp(a.amDepth, b.amDepth, u),
    pmDepth: lerp(a.pmDepth, b.pmDepth, u),
    resonanceQ: lerp(a.resonanceQ, b.resonanceQ, u),
    tensorScalar: lerp(a.tensorScalar, b.tensorScalar, u),
    tensorBivector0: lerp(a.tensorBivector0, b.tensorBivector0, u),
    tensorTrivector: lerp(a.tensorTrivector, b.tensorTrivector, u),
    nodeColor: lerpHex(a.nodeColor, b.nodeColor, u),
    antiColor: lerpHex(a.antiColor, b.antiColor, u),
    transColor: lerpHex(a.transColor, b.transColor, u),
    brightness: lerp(a.brightness, b.brightness, u),
    gamma: lerp(a.gamma, b.gamma, u),
  };
}

function interpolateTrack(track: CameraTrack, tSec: number): CameraKeyframe {
  if (track.frames.length === 0) {
    return { t: 0, x: 0, y: 0.8, z: 3.5, tx: 0, ty: 0, tz: 0 };
  }
  if (track.frames.length === 1) return track.frames[0];
  const duration = Math.max(0.001, track.durationSec);
  const t = ((tSec % duration) + duration) % duration;
  const frames = track.frames.slice().sort((a, b) => a.t - b.t);
  let i1 = 1;
  while (i1 < frames.length && frames[i1].t < t) i1 += 1;
  const b = frames[Math.min(frames.length - 1, i1)];
  const a = frames[Math.max(0, i1 - 1)];
  const span = Math.max(0.0001, b.t - a.t);
  const u = Math.max(0, Math.min(1, (t - a.t) / span));
  return {
    t,
    x: lerp(a.x, b.x, u),
    y: lerp(a.y, b.y, u),
    z: lerp(a.z, b.z, u),
    tx: lerp(a.tx, b.tx, u),
    ty: lerp(a.ty, b.ty, u),
    tz: lerp(a.tz, b.tz, u),
    params: interpolateParams(a.params, b.params, u),
  };
}

function applyHystereticResponse(
  current: Vector3,
  target: Vector3,
  hysteresis: CameraTrack["hysteresis"],
  dt: number,
): Vector3 {
  const k = Math.max(0.05, hysteresis.coercivity);
  const sat = Math.max(0.1, hysteresis.saturation);
  const ret = Math.max(0, Math.min(0.999, hysteresis.retentivity));
  const dx = target.x - current.x;
  const dy = target.y - current.y;
  const dz = target.z - current.z;
  const driveX = Math.tanh((dx * k) / sat) * sat;
  const driveY = Math.tanh((dy * k) / sat) * sat;
  const driveZ = Math.tanh((dz * k) / sat) * sat;
  const alpha = Math.max(0.01, Math.min(1, dt * (1.2 + k * 0.8) * (1 - ret * 0.6)));
  return new Vector3(
    current.x + driveX * alpha,
    current.y + driveY * alpha,
    current.z + driveZ * alpha,
  );
}

function summarizePsi(psi: PsiAirState | null): { confidence: number } {
  if (!psi) return { confidence: 0 };
  return { confidence: clamp(psi.confidence, 0, 1) };
}

interface RuntimeFieldParams {
  carrierHz: number;
  payloadHz: number;
  carrierBase: number;
  payloadMod: number;
  emitted: number;
  amDepth: number;
  pmDepth: number;
  resonanceQ: number;
  domainRepeatCount: number;
  domainSpacing: number;
  psiConfidence: number;
}

function opRepFiniteJS(p: Vector3, spacing: number, count: number): Vector3 {
  const tileX = clamp(Math.round(p.x / spacing), -count, count);
  const tileY = clamp(Math.round(p.y / spacing), -count, count);
  const tileZ = clamp(Math.round(p.z / spacing), -count, count);
  return new Vector3(p.x - spacing * tileX, p.y - spacing * tileY, p.z - spacing * tileZ);
}

function signalFieldJS(p: Vector3, f: RuntimeFieldParams, t: number): number {
  const cf = clamp(f.carrierHz / 24000, 0.01, 1);
  const pf = clamp(f.payloadHz / 2000, 0.01, 1);
  const phaseScaffold = Math.sin(Math.hypot(p.x, p.z) * (5 + cf * 18) - t * (0.7 + cf * 2.5) + f.carrierBase * 6);
  const phaseEnvelope = Math.sin(p.y * (3 + pf * 10) + Math.atan2(p.z, p.x) * (6 + cf * 16) + f.payloadMod * 4);
  const torsion = Math.sin((p.x * p.y - p.z * p.z) * (0.45 + clamp(f.resonanceQ / 100, 0.01, 1) * 1.8) + f.pmDepth * 0.03);
  return phaseScaffold * 0.55 + phaseEnvelope * 0.35 + torsion * 0.18 + f.emitted * 0.25;
}

function fractalDEJS(p: Vector3, payloadHz: number): number {
  let z = p.clone();
  let dr = 1;
  let r = 0;
  const power = 6 + 2 * clamp(payloadHz / 2000, 0, 1);
  for (let i = 0; i < 7; i += 1) {
    r = z.length();
    if (r > 2.4) break;
    const theta = Math.acos(clamp(z.y / Math.max(r, 1e-4), -1, 1));
    const phi = Math.atan2(z.z, z.x);
    dr = Math.pow(r, power - 1) * power * dr + 1;
    const zr = Math.pow(r, power);
    const nTheta = theta * power;
    const nPhi = phi * power;
    z = new Vector3(
      zr * Math.sin(nTheta) * Math.cos(nPhi),
      zr * Math.cos(nTheta),
      zr * Math.sin(nTheta) * Math.sin(nPhi),
    ).add(p);
  }
  return 0.5 * Math.log(Math.max(r, 1e-4)) * r / Math.max(dr, 1e-4);
}

function evalDistanceFieldJS(pIn: Vector3, f: RuntimeFieldParams, t: number): number {
  const spacing = f.domainSpacing;
  const p = opRepFiniteJS(pIn, spacing, f.domainRepeatCount);
  const carrierNorm = clamp(f.carrierHz / 24000, 0.01, 1);
  const payloadNorm = clamp(f.payloadHz / 2000, 0.01, 1);
  const smoothMin = (a: number, b: number, k: number) => {
    const h = clamp(0.5 + 0.5 * (b - a) / k, 0, 1);
    return b * (1 - h) + a * h - k * h * (1 - h);
  };
  const baseR = 0.6 + (1.55 - 0.6) * carrierNorm;
  const dSphereRep = p.length() - baseR;
  const qxRep = Math.hypot(p.x, p.z) - (0.72 + carrierNorm * 0.65);
  const qyRep = p.y;
  const dTorusRep = Math.hypot(qxRep, qyRep) - (0.1 + payloadNorm * 0.22);
  const dPrimRep = Math.min(dSphereRep, dTorusRep);

  const dSphereCenter = pIn.length() - baseR * 1.05;
  const qxCenter = Math.hypot(pIn.x, pIn.z) - (0.72 + carrierNorm * 0.65);
  const qyCenter = pIn.y;
  const dTorusCenter = Math.hypot(qxCenter, qyCenter) - (0.1 + payloadNorm * 0.22);
  const dPrimCenter = Math.min(dSphereCenter, dTorusCenter);

  const dPrim = smoothMin(dPrimRep, dPrimCenter, 0.18 + payloadNorm * 0.08);
  const dFrac = fractalDEJS(p.clone().multiplyScalar(0.84 + payloadNorm * 0.42), f.payloadHz);
  const dBase = smoothMin(dPrim, dFrac, 0.16 + payloadNorm * 0.06);
  const fieldEnvelope = clamp(1 - ((pIn.length() / (14 + f.domainRepeatCount * 4) - 0.15) / (1 - 0.15)), 0, 1);
  const dSignal = -signalFieldJS(p, f, t) * (0.04 + payloadNorm * 0.08 + f.psiConfidence * 0.05) * fieldEnvelope;
  let d = dBase + dSignal;
  const worldBound = pIn.length() - (24 + f.domainRepeatCount * 10);
  d = Math.max(d, worldBound);
  return d;
}

function buildClosedMeshFromField(
  params: RuntimeFieldParams,
  timeSec: number,
  control: FAAMeshControlVector,
): BufferGeometry {
  const gridRes = Math.max(24, Math.min(96, Math.round(control.res_final)));
  const worldRadius = 4.8 + params.domainRepeatCount * 1.2;
  const step = (worldRadius * 2) / (gridRes - 1);
  const nodeCol = new Color(0xe0ffff);
  const antiCol = new Color(0x80b0c0);
  let positions: number[] = [];
  let colors: number[] = [];
  const field: number[] = new Array(gridRes * gridRes * gridRes);
  const p = new Vector3();

  const sample = (x: number, y: number, z: number): number => {
    p.set(-worldRadius + x * step, -worldRadius + y * step, -worldRadius + z * step);
    return evalDistanceFieldJS(p, params, timeSec);
  };

  const idx3 = (x: number, y: number, z: number) => x + y * gridRes + z * gridRes * gridRes;
  for (let z = 0; z < gridRes; z += 1) {
    for (let y = 0; y < gridRes; y += 1) {
      for (let x = 0; x < gridRes; x += 1) {
        field[idx3(x, y, z)] = sample(x, y, z);
      }
    }
  }

  const cubeCorners = [
    [0, 0, 0],
    [1, 0, 0],
    [1, 1, 0],
    [0, 1, 0],
    [0, 0, 1],
    [1, 0, 1],
    [1, 1, 1],
    [0, 1, 1],
  ] as const;
  const tetrahedra = [
    [0, 5, 1, 6],
    [0, 1, 2, 6],
    [0, 2, 3, 6],
    [0, 3, 7, 6],
    [0, 7, 4, 6],
    [0, 4, 5, 6],
  ] as const;
  const tetraEdges = [
    [0, 1],
    [1, 2],
    [2, 0],
    [0, 3],
    [1, 3],
    [2, 3],
  ] as const;

  const lerpVertex = (a: Vector3, b: Vector3, va: number, vb: number): Vector3 => {
    const t = Math.abs(vb - va) < 1e-6 ? 0.5 : clamp((0 - va) / (vb - va), 0, 1);
    return new Vector3(
      a.x + (b.x - a.x) * t,
      a.y + (b.y - a.y) * t,
      a.z + (b.z - a.z) * t,
    );
  };

  const pushTri = (a: Vector3, b: Vector3, c: Vector3) => {
    const pts = [a, b, c];
    for (let i = 0; i < 3; i += 1) {
      const v = pts[i];
      const sf = signalFieldJS(v, params, timeSec);
      const t = clamp((sf + 1) * 0.5, 0, 1);
      const col = nodeCol.clone().lerp(antiCol, t);
      positions.push(v.x, v.y, v.z);
      colors.push(col.r, col.g, col.b);
    }
  };

  for (let z = 0; z < gridRes - 1; z += 1) {
    for (let y = 0; y < gridRes - 1; y += 1) {
      for (let x = 0; x < gridRes - 1; x += 1) {
        const cornerPos: Vector3[] = new Array(8);
        const cornerVal: number[] = new Array(8);
        for (let c = 0; c < 8; c += 1) {
          const [cx, cy, cz] = cubeCorners[c];
          const gx = x + cx;
          const gy = y + cy;
          const gz = z + cz;
          cornerPos[c] = new Vector3(
            -worldRadius + gx * step,
            -worldRadius + gy * step,
            -worldRadius + gz * step,
          );
          cornerVal[c] = field[idx3(gx, gy, gz)];
        }

        for (let t = 0; t < tetrahedra.length; t += 1) {
          const [a0, a1, a2, a3] = tetrahedra[t];
          const tp = [cornerPos[a0], cornerPos[a1], cornerPos[a2], cornerPos[a3]];
          const tv = [cornerVal[a0], cornerVal[a1], cornerVal[a2], cornerVal[a3]];
          const cross: Vector3[] = [];
          for (let e = 0; e < tetraEdges.length; e += 1) {
            const [i0, i1] = tetraEdges[e];
            const v0 = tv[i0];
            const v1 = tv[i1];
            if ((v0 <= 0 && v1 >= 0) || (v0 >= 0 && v1 <= 0)) {
              cross.push(lerpVertex(tp[i0], tp[i1], v0, v1));
            }
          }
          if (cross.length === 3) {
            pushTri(cross[0], cross[1], cross[2]);
          } else if (cross.length === 4) {
            pushTri(cross[0], cross[1], cross[2]);
            pushTri(cross[0], cross[2], cross[3]);
          }
        }
      }
    }
  }

  // Cleanup: remove degenerate/small triangles and keep dominant connected component.
  if (positions.length >= 9) {
    const triCount = Math.floor(positions.length / 9);
    const minArea = step * step * 0.0008;
    const maxArea = step * step * 4.5;
    const keepByArea: number[] = [];
    const cx: number[] = [];
    const cy: number[] = [];
    const cz: number[] = [];
    for (let t = 0; t < triCount; t += 1) {
      const i = t * 9;
      const ax = positions[i + 0];
      const ay = positions[i + 1];
      const az = positions[i + 2];
      const bx = positions[i + 3];
      const by = positions[i + 4];
      const bz = positions[i + 5];
      const cxp = positions[i + 6];
      const cyp = positions[i + 7];
      const czp = positions[i + 8];
      const abx = bx - ax;
      const aby = by - ay;
      const abz = bz - az;
      const acx = cxp - ax;
      const acy = cyp - ay;
      const acz = czp - az;
      const nx = aby * acz - abz * acy;
      const ny = abz * acx - abx * acz;
      const nz = abx * acy - aby * acx;
      const area = 0.5 * Math.hypot(nx, ny, nz);
      if (area >= minArea && area <= maxArea) {
        keepByArea.push(t);
        cx.push((ax + bx + cxp) / 3);
        cy.push((ay + by + cyp) / 3);
        cz.push((az + bz + czp) / 3);
      }
    }

    if (keepByArea.length > 0) {
      const cell = step * 2.2;
      const toKey = (x: number, y: number, z: number) =>
        `${Math.floor(x / cell)}|${Math.floor(y / cell)}|${Math.floor(z / cell)}`;
      const buckets = new Map<string, number[]>();
      for (let i = 0; i < keepByArea.length; i += 1) {
        const key = toKey(cx[i], cy[i], cz[i]);
        const arr = buckets.get(key);
        if (arr) arr.push(i);
        else buckets.set(key, [i]);
      }

      const parent = new Array(keepByArea.length);
      for (let i = 0; i < parent.length; i += 1) parent[i] = i;
      const find = (i: number): number => {
        let pIdx = i;
        while (parent[pIdx] !== pIdx) {
          parent[pIdx] = parent[parent[pIdx]];
          pIdx = parent[pIdx];
        }
        return pIdx;
      };
      const union = (a: number, b: number) => {
        const ra = find(a);
        const rb = find(b);
        if (ra !== rb) parent[rb] = ra;
      };

      const neigh = [-1, 0, 1];
      const maxDist = cell * 1.25;
      const maxDistSq = maxDist * maxDist;
      for (let i = 0; i < keepByArea.length; i += 1) {
        const kx = Math.floor(cx[i] / cell);
        const ky = Math.floor(cy[i] / cell);
        const kz = Math.floor(cz[i] / cell);
        for (let dx = 0; dx < neigh.length; dx += 1) {
          for (let dy = 0; dy < neigh.length; dy += 1) {
            for (let dz = 0; dz < neigh.length; dz += 1) {
              const cand = buckets.get(`${kx + neigh[dx]}|${ky + neigh[dy]}|${kz + neigh[dz]}`);
              if (!cand) continue;
              for (let cIdx = 0; cIdx < cand.length; cIdx += 1) {
                const j = cand[cIdx];
                if (j <= i) continue;
                const dxv = cx[i] - cx[j];
                const dyv = cy[i] - cy[j];
                const dzv = cz[i] - cz[j];
                const d2 = dxv * dxv + dyv * dyv + dzv * dzv;
                if (d2 <= maxDistSq) union(i, j);
              }
            }
          }
        }
      }

      const counts = new Map<number, number>();
      for (let i = 0; i < keepByArea.length; i += 1) {
        const r = find(i);
        counts.set(r, (counts.get(r) ?? 0) + 1);
      }
      let bestRoot = -1;
      let bestCount = -1;
      counts.forEach((cnt, root) => {
        if (cnt > bestCount) {
          bestCount = cnt;
          bestRoot = root;
        }
      });

      const cleanedPos: number[] = [];
      const cleanedCol: number[] = [];
      for (let i = 0; i < keepByArea.length; i += 1) {
        if (find(i) !== bestRoot) continue;
        const tri = keepByArea[i];
        const pBase = tri * 9;
        const cBase = tri * 9;
        for (let k = 0; k < 9; k += 1) {
          cleanedPos.push(positions[pBase + k]);
          cleanedCol.push(colors[cBase + k]);
        }
      }
      if (cleanedPos.length >= 9) {
        positions = cleanedPos;
        colors = cleanedCol;
      }
    }
  }

  // Vertex weld to enforce shared topology before RhoTorse closure transport.
  const weldedPos: number[] = [];
  const weldedCol: number[] = [];
  const triIndices: number[] = [];
  const keyToIndex = new Map<string, number>();
  const weldScale = Math.max(1e-4, step * 0.16);
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i + 0];
    const y = positions[i + 1];
    const z = positions[i + 2];
    const key = `${Math.round(x / weldScale)}|${Math.round(y / weldScale)}|${Math.round(z / weldScale)}`;
    let vi = keyToIndex.get(key);
    if (vi === undefined) {
      vi = weldedPos.length / 3;
      keyToIndex.set(key, vi);
      weldedPos.push(x, y, z);
      weldedCol.push(colors[i + 0], colors[i + 1], colors[i + 2]);
    }
    triIndices.push(vi);
  }

  // Build adjacency and run RhoTorse closure transport (FAA-mapped, no Laplacian).
  if (control.rt_gate > 1e-4 && weldedPos.length >= 9) {
    const vCount = weldedPos.length / 3;
    const neighbors: Array<Set<number>> = Array.from({ length: vCount }, () => new Set<number>());
    for (let t = 0; t < triIndices.length; t += 3) {
      const a = triIndices[t + 0];
      const b = triIndices[t + 1];
      const c = triIndices[t + 2];
      neighbors[a].add(b); neighbors[a].add(c);
      neighbors[b].add(a); neighbors[b].add(c);
      neighbors[c].add(a); neighbors[c].add(b);
    }
    const src = new Float32Array(weldedPos);
    const dst = new Float32Array(src.length);
    const rtIters = Math.max(1, Math.min(24, Math.round(control.rt_iters)));
    const alpha = clamp(control.rt_alpha, 0.05, 0.85);
    const phaseLock = clamp(control.rt_phase_lock, 0, 1);
    const edgePreserve = clamp(control.rt_edge_preserve, 0, 1);
    const boundaryLeak = clamp(control.rt_boundary_leak, 0, 1);
    const tensorCoupling = clamp(control.rt_tensor_coupling, 0, 1);
    const curlW = clamp(control.rt_curl_weight, 0, 1);
    const torsionW = clamp(control.rt_torsion_weight, 0, 1);
    const divCeil = clamp(control.rt_divergence_ceiling, 0, 1);
    const closureMix = clamp(control.rt_closure_mix, 0, 1);
    const rtGate = clamp(control.rt_gate, 0, 1);

    let read = src;
    let write = dst;
    for (let it = 0; it < rtIters; it += 1) {
      for (let v = 0; v < vCount; v += 1) {
        const i3 = v * 3;
        const px = read[i3 + 0];
        const py = read[i3 + 1];
        const pz = read[i3 + 2];
        const nbr = neighbors[v];
        if (nbr.size === 0) {
          write[i3 + 0] = px;
          write[i3 + 1] = py;
          write[i3 + 2] = pz;
          continue;
        }
        let mx = 0;
        let my = 0;
        let mz = 0;
        nbr.forEach((n) => {
          const n3 = n * 3;
          mx += read[n3 + 0];
          my += read[n3 + 1];
          mz += read[n3 + 2];
        });
        mx /= nbr.size;
        my /= nbr.size;
        mz /= nbr.size;

        const dx = mx - px;
        const dy = my - py;
        const dz = mz - pz;
        const radial = Math.hypot(px, py, pz);
        const radialSafe = Math.max(radial, 1e-6);
        const nx = px / radialSafe;
        const ny = py / radialSafe;
        const nz = pz / radialSafe;
        const closureProj = dx * nx + dy * ny + dz * nz;
        const closureTerm = closureProj * (0.5 + 0.5 * closureMix);
        const tangentialX = dx - closureProj * nx;
        const tangentialY = dy - closureProj * ny;
        const tangentialZ = dz - closureProj * nz;
        const tangentialGain = 0.5 * (curlW + torsionW) * (0.4 + 0.6 * tensorCoupling);
        const divergenceGate = clamp(divCeil, 0.1, 1);
        const preserve = 1 - edgePreserve * (1 - boundaryLeak) * (1 - divergenceGate);
        const localPhase = 0.75 + 0.25 * Math.cos(radial * 0.9 + it * 0.17);

        write[i3 + 0] = px + rtGate * alpha * localPhase * (preserve * (closureTerm * nx + tangentialGain * tangentialX) + phaseLock * tangentialX * 0.15);
        write[i3 + 1] = py + rtGate * alpha * localPhase * (preserve * (closureTerm * ny + tangentialGain * tangentialY) + phaseLock * tangentialY * 0.15);
        write[i3 + 2] = pz + rtGate * alpha * localPhase * (preserve * (closureTerm * nz + tangentialGain * tangentialZ) + phaseLock * tangentialZ * 0.15);
      }
      const tmp = read;
      read = write;
      write = tmp;
    }
    for (let i = 0; i < weldedPos.length; i += 1) weldedPos[i] = read[i];
  }

  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(new Float32Array(weldedPos), 3));
  g.setAttribute("color", new Float32BufferAttribute(new Float32Array(weldedCol), 3));
  g.setIndex(triIndices);
  g.computeVertexNormals();
  return g;
}

interface FractalConstraintQuality {
  ok: boolean;
  triangles: number;
  boundaryEdgeRatio: number;
  degenerateRatio: number;
  reason: string;
}

function assessFractalConstraintQuality(geometry: BufferGeometry): FractalConstraintQuality {
  const posAttr = geometry.getAttribute("position") as Float32BufferAttribute | undefined;
  const index = geometry.getIndex();
  if (!posAttr || !index || index.count < 9) {
    return { ok: false, triangles: 0, boundaryEdgeRatio: 1, degenerateRatio: 1, reason: "missing-indexed-geometry" };
  }

  const pos = posAttr.array as ArrayLike<number>;
  const ind = index.array as ArrayLike<number>;
  const triCount = Math.floor(index.count / 3);
  if (triCount === 0) {
    return { ok: false, triangles: 0, boundaryEdgeRatio: 1, degenerateRatio: 1, reason: "no-triangles" };
  }

  let degenerate = 0;
  const edgeUse = new Map<string, number>();
  const pushEdge = (a: number, b: number) => {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const key = `${lo}|${hi}`;
    edgeUse.set(key, (edgeUse.get(key) ?? 0) + 1);
  };

  for (let t = 0; t < triCount; t += 1) {
    const ia = Number(ind[t * 3 + 0]);
    const ib = Number(ind[t * 3 + 1]);
    const ic = Number(ind[t * 3 + 2]);
    if (ia === ib || ib === ic || ia === ic) {
      degenerate += 1;
      continue;
    }

    const ax = Number(pos[ia * 3 + 0]);
    const ay = Number(pos[ia * 3 + 1]);
    const az = Number(pos[ia * 3 + 2]);
    const bx = Number(pos[ib * 3 + 0]);
    const by = Number(pos[ib * 3 + 1]);
    const bz = Number(pos[ib * 3 + 2]);
    const cx = Number(pos[ic * 3 + 0]);
    const cy = Number(pos[ic * 3 + 1]);
    const cz = Number(pos[ic * 3 + 2]);

    const abx = bx - ax;
    const aby = by - ay;
    const abz = bz - az;
    const acx = cx - ax;
    const acy = cy - ay;
    const acz = cz - az;
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    const area2 = Math.hypot(nx, ny, nz);
    if (!Number.isFinite(area2) || area2 < 1e-7) degenerate += 1;

    pushEdge(ia, ib);
    pushEdge(ib, ic);
    pushEdge(ic, ia);
  }

  let boundaryEdges = 0;
  edgeUse.forEach((count) => {
    if (count === 1) boundaryEdges += 1;
  });

  const totalEdges = Math.max(1, edgeUse.size);
  const boundaryEdgeRatio = boundaryEdges / totalEdges;
  const degenerateRatio = degenerate / triCount;

  const ok = triCount >= 120 && boundaryEdgeRatio <= 0.08 && degenerateRatio <= 0.06;
  let reason = "ok";
  if (!ok) {
    reason =
      triCount < 120
        ? "insufficient-triangles"
        : boundaryEdgeRatio > 0.08
          ? "open-fractal-seams"
          : "degenerate-triangles";
  }

  return { ok, triangles: triCount, boundaryEdgeRatio, degenerateRatio, reason };
}

export function CymaphStage3D({ showOverlayControls = true }: { showOverlayControls?: boolean } = {}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<WebGLRenderer | null>(null);
  const sceneRef = useRef<Scene | null>(null);
  const cameraRef = useRef<PerspectiveCamera | null>(null);
  const pointsRef = useRef<Points | null>(null);
  const linesRef = useRef<LineSegments | null>(null);
  const meshRef = useRef<Mesh | null>(null);
  const lastValidMeshGeoRef = useRef<BufferGeometry | null>(null);
  const sdfSceneRef = useRef<Scene | null>(null);
  const sdfCamRef = useRef<OrthographicCamera | null>(null);
  const sdfQuadRef = useRef<Mesh | null>(null);
  const rafRef = useRef<number>(0);
  const lastKeyRef = useRef("");
  const lastMeshControlSigRef = useRef("");
  const keysDownRef = useRef<Record<string, boolean>>({});
  const fpsCamRef = useRef({
    pos: new Vector3(0, 0.6, 4.8),
    yaw: 0,
    pitch: 0,
    pointerDown: false,
    lastX: 0,
    lastY: 0,
  });
  const orbitRef = useRef({
    azimuth: 0,
    elevation: 0.24,
    distance: 3.5,
    targetX: 0,
    targetY: 0,
    pointerDown: false,
    panning: false,
    lastX: 0,
    lastY: 0,
    interactedAt: 0,
  });
  const prevTsRef = useRef<number>(performance.now());
  const cameraTrackRef = useRef<CameraTrack | null>(null);
  const cameraTrackStartRef = useRef<number>(0);
  const cameraTrackPlayRef = useRef<boolean>(false);
  const freecamRecordStartRef = useRef<number>(0);
  const freecamLastCaptureRef = useRef<number>(0);
  const freecamRecordRef = useRef<boolean>(false);
  const lastAppliedParamHashRef = useRef<string>("");
  const lastPlayheadUiUpdateRef = useRef<number>(0);
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const cameraStateRef = useRef<{ pos: Vector3; target: Vector3 }>({
    pos: new Vector3(0, 0.8, 3.5),
    target: new Vector3(0, 0, 0),
  });

  const [moveSpeed, setMoveSpeed] = useState(5.5);
  const [trackName, setTrackName] = useState("Camera Track");
  const [trackDurationSec, setTrackDurationSec] = useState(12);
  const [trackCoercivity, setTrackCoercivity] = useState(1.25);
  const [trackRetentivity, setTrackRetentivity] = useState(0.32);
  const [trackSaturation, setTrackSaturation] = useState(1.0);
  const [cameraTrackFrames, setCameraTrackFrames] = useState<CameraKeyframe[]>([]);
  const [cameraTrackPlaying, setCameraTrackPlaying] = useState(false);
  const [timelinePlayheadSec, setTimelinePlayheadSec] = useState(0);
  const [timelineWindowSec, setTimelineWindowSec] = useState(12);
  const [freecamRecordMode, setFreecamRecordMode] = useState(false);
  const [exportAlpha, setExportAlpha] = useState(false);
  const [exportWidth, setExportWidth] = useState(1920);
  const [exportHeight, setExportHeight] = useState(1080);
  const [exportFps, setExportFps] = useState(30);
  const [exportDurationSec, setExportDurationSec] = useState(8);
  const [exportCodec, setExportCodec] = useState<"webm-vp9" | "webm-vp8" | "h264-mp4">("webm-vp9");
  const [exportQuality, setExportQuality] = useState(0.9);
  const [exportingVideo, setExportingVideo] = useState(false);
  const moveSpeedRef = useRef(moveSpeed);
  const exportAlphaRef = useRef(exportAlpha);
  const trackDurationRef = useRef(trackDurationSec);

  const isGenerating = useTransmitterStore((s) => s.isGenerating);
  const setIsGenerating = useTransmitterStore((s) => s.setIsGenerating);
  const audioError = useTransmitterStore((s) => s.audioError);
  const setAudioError = useTransmitterStore((s) => s.setAudioError);
  const activeGradient = useTransmitterStore((s) => s.activeGradient);
  const carrierG3Nen = useTransmitterStore((s) => s.carrierG3Nen);
  const payloadG3Nen = useTransmitterStore((s) => s.payloadG3Nen);
  const amDepth = useTransmitterStore((s) => s.amDepth);
  const pmDepth = useTransmitterStore((s) => s.pmDepth);
  const resonanceQ = useTransmitterStore((s) => s.resonanceQ);
  const tensorScalar = useTransmitterStore((s) => s.globalTensorState.scalar);
  const tensorBivector0 = useTransmitterStore((s) => s.globalTensorState.bivector[0]);
  const tensorTrivector = useTransmitterStore((s) => s.globalTensorState.trivector);
  const generatedFrame = useTransmitterStore((s) => s.cymaglyphGeneratedFrame);
  const lastValidFrame = useTransmitterStore((s) => s.lastValidCymaglyphFrame);
  const renderSource = useTransmitterStore((s) => s.cymaglyphRenderSource);
  const renderMode = useTransmitterStore((s) => s.cymaglyphRenderMode);
  const domainRepeatCount = useTransmitterStore((s) => s.domainRepeatCount);
  const domainRepeatLayout = useTransmitterStore((s) => s.domainRepeatLayout);
  const domainRepeatDepthStep = useTransmitterStore((s) => s.domainRepeatDepthStep);
  const domainRepeatOscillationCoupling = useTransmitterStore((s) => s.domainRepeatOscillationCoupling);
  const domainRepeatRotXDeg = useTransmitterStore((s) => s.domainRepeatRotXDeg);
  const domainRepeatRotYDeg = useTransmitterStore((s) => s.domainRepeatRotYDeg);
  const domainRepeatRotZDeg = useTransmitterStore((s) => s.domainRepeatRotZDeg);
  const domainRepeatLayerOscillationIds = useTransmitterStore((s) => s.domainRepeatLayerOscillationIds);
  const compendiumEntries = useTransmitterStore((s) => s.compendiumEntries);
  const signalContract = useTransmitterStore((s) => s.signalContractFrame);
  const psiAirState = useTransmitterStore((s) => s.psiAirState);
  const ingestLockActive = useTransmitterStore((s) => s.ingestLockActive);
  const playerSourceType = useTransmitterStore((s) => s.playerSession.sourceType);
  const setParam = useTransmitterStore((s) => s.setParam);
  const updatePhiSudTensor = useTransmitterStore((s) => s.updatePhiSudTensor);
  const setGradient = useTransmitterStore((s) => s.setGradient);

  const setCarrier = useCallback((v: number) => setParam("carrierG3Nen", String(Math.round(v))), [setParam]);
  const setPayload = useCallback((v: number) => setParam("payloadG3Nen", String(Math.round(v))), [setParam]);
  const setAmDepth = useCallback((v: number) => setParam("amDepth", v), [setParam]);
  const setPmDepth = useCallback((v: number) => setParam("pmDepth", v), [setParam]);
  const setResQ = useCallback((v: number) => setParam("resonanceQ", v), [setParam]);
  const setScalar = useCallback((v: number) => updatePhiSudTensor("tensor", { scalar: v }), [updatePhiSudTensor]);
  const setBivec0 = useCallback((v: number) => updatePhiSudTensor("tensor", { bivector: [v, 0, 0] as [number, number, number] }), [updatePhiSudTensor]);
  const setTrivec = useCallback((v: number) => updatePhiSudTensor("tensor", { trivector: v }), [updatePhiSudTensor]);
  const captureCurrentParams = useCallback(
    (): CameraParamSnapshot => ({
      carrierHz: parseFloat(carrierG3Nen) || 16000,
      payloadHz: parseFloat(payloadG3Nen) || 220,
      amDepth,
      pmDepth,
      resonanceQ,
      tensorScalar,
      tensorBivector0,
      tensorTrivector,
      nodeColor: activeGradient.nodeColor,
      antiColor: activeGradient.antiColor,
      transColor: activeGradient.transColor,
      brightness: activeGradient.brightness,
      gamma: activeGradient.gamma,
    }),
    [activeGradient, amDepth, carrierG3Nen, payloadG3Nen, pmDepth, resonanceQ, tensorBivector0, tensorScalar, tensorTrivector],
  );
  const seekTimeline = useCallback(
    (nextSec: number) => {
      const clamped = clamp(nextSec, 0, Math.max(0.001, trackDurationSec));
      setTimelinePlayheadSec(clamped);
      if (cameraTrackPlayRef.current) {
        cameraTrackStartRef.current = performance.now() - clamped * 1000;
      }
    },
    [trackDurationSec],
  );
  const layerCarrierHz = useMemo(
    () =>
      domainRepeatLayerOscillationIds.map((id) => {
        const entry = compendiumEntries.find((e) => e.id === id);
        const lpg = entry?.lpgValue ?? entry?.lpgFund;
        if (!Number.isFinite(lpg)) return undefined;
        return Math.max(20, Number(lpg) / 0.4858);
      }),
    [compendiumEntries, domainRepeatLayerOscillationIds],
  );
  const layerPayloadHz = useMemo(
    () => layerCarrierHz.map((hz) => (Number.isFinite(hz as number) ? Math.max(20, Number(hz) * 0.18) : undefined)),
    [layerCarrierHz],
  );
  const togglePlayback = useCallback(() => {
    if (!isGenerating) {
      setTimeout(() => setIsGenerating(true), 0);
      return;
    }
    setIsGenerating(false);
  }, [isGenerating, setIsGenerating]);
  const addKeyframeAt = useCallback(
    (atSec: number) => {
      const frame: CameraKeyframe = {
        t: clamp(atSec, 0, Math.max(0.001, trackDurationSec)),
        x: cameraStateRef.current.pos.x,
        y: cameraStateRef.current.pos.y,
        z: cameraStateRef.current.pos.z,
        tx: cameraStateRef.current.target.x,
        ty: cameraStateRef.current.target.y,
        tz: cameraStateRef.current.target.z,
        params: captureCurrentParams(),
      };
      setCameraTrackFrames((prev) => {
        const out = [...prev, frame].sort((a, b) => a.t - b.t);
        const merged: CameraKeyframe[] = [];
        for (const f of out) {
          const last = merged[merged.length - 1];
          if (last && Math.abs(last.t - f.t) < 0.04) {
            merged[merged.length - 1] = f;
          } else {
            merged.push(f);
          }
        }
        return merged;
      });
    },
    [captureCurrentParams, trackDurationSec],
  );
  const addCameraKeyframe = useCallback(() => {
    addKeyframeAt(timelinePlayheadSec);
    orbitRef.current.interactedAt = Date.now();
  }, [addKeyframeAt, timelinePlayheadSec]);
  const clearCameraTrack = useCallback(() => {
    setCameraTrackFrames([]);
    cameraTrackRef.current = null;
    cameraTrackPlayRef.current = false;
    setCameraTrackPlaying(false);
    setTimelinePlayheadSec(0);
  }, []);
  const saveCameraTrack = useCallback(async () => {
    const payload: CameraTrack = {
      id: `track-${Date.now()}`,
      name: trackName.trim() || "Camera Track",
      durationSec: Math.max(1, trackDurationSec),
      frames: cameraTrackFrames.slice().sort((a, b) => a.t - b.t),
      hysteresis: {
        coercivity: trackCoercivity,
        retentivity: trackRetentivity,
        saturation: trackSaturation,
      },
      exportProfile: {
        alpha: exportAlpha,
        width: exportWidth,
        height: exportHeight,
        fps: exportFps,
        durationSec: exportDurationSec,
        codec: exportCodec,
        quality: exportQuality,
      },
    };
    if (typeof window !== "undefined") {
      localStorage.setItem("g3-camera-track", JSON.stringify(payload));
    }
    await savePanelExportRecord(CAMERA_TRACK_EXPORT_ID, payload).catch(() => undefined);
    cameraTrackRef.current = payload;
  }, [
    cameraTrackFrames,
    exportAlpha,
    exportCodec,
    exportDurationSec,
    exportFps,
    exportHeight,
    exportQuality,
    exportWidth,
    trackCoercivity,
    trackRetentivity,
    trackSaturation,
    trackDurationSec,
    trackName,
  ]);
  const loadCameraTrack = useCallback(async () => {
    let payload: CameraTrack | null = await loadPanelExportRecord<CameraTrack>(CAMERA_TRACK_EXPORT_ID).catch(() => null);
    if (!payload && typeof window !== "undefined") {
      const raw = localStorage.getItem("g3-camera-track");
      if (raw) {
        try {
          payload = JSON.parse(raw) as CameraTrack;
        } catch {
          payload = null;
        }
      }
    }
    if (!payload) return;
    try {
      const parsed = payload;
      if (!parsed || !Array.isArray(parsed.frames)) return;
      setTrackName(parsed.name || "Camera Track");
      setTrackDurationSec(Math.max(1, parsed.durationSec || 12));
      setTrackCoercivity(Math.max(0.05, parsed.hysteresis?.coercivity ?? 1.25));
      setTrackRetentivity(Math.max(0, Math.min(0.999, parsed.hysteresis?.retentivity ?? 0.32)));
      setTrackSaturation(Math.max(0.1, parsed.hysteresis?.saturation ?? 1));
      setExportAlpha(Boolean(parsed.exportProfile?.alpha));
      setExportWidth(Math.max(256, Math.floor(parsed.exportProfile?.width ?? 1920)));
      setExportHeight(Math.max(256, Math.floor(parsed.exportProfile?.height ?? 1080)));
      setExportFps(Math.max(12, Math.min(120, Math.floor(parsed.exportProfile?.fps ?? 30))));
      setExportDurationSec(Math.max(1, parsed.exportProfile?.durationSec ?? 8));
      setExportCodec(parsed.exportProfile?.codec ?? "webm-vp9");
      setExportQuality(clamp(parsed.exportProfile?.quality ?? 0.9, 0.3, 1));
      setCameraTrackFrames(parsed.frames.slice().sort((a, b) => a.t - b.t));
      setTimelinePlayheadSec(0);
      cameraTrackRef.current = parsed;
    } catch {
      // noop
    }
  }, []);
  const toggleCameraTrackPlayback = useCallback(() => {
    const next = !cameraTrackPlaying;
    setCameraTrackPlaying(next);
    cameraTrackPlayRef.current = next;
    cameraTrackStartRef.current = performance.now() - timelinePlayheadSec * 1000;
    if (next) {
      cameraTrackRef.current = {
        id: cameraTrackRef.current?.id ?? `track-live-${Date.now()}`,
        name: trackName.trim() || "Camera Track",
        durationSec: Math.max(1, trackDurationSec),
        frames: cameraTrackFrames,
        hysteresis: {
          coercivity: trackCoercivity,
          retentivity: trackRetentivity,
          saturation: trackSaturation,
        },
        exportProfile: {
          alpha: exportAlpha,
          width: exportWidth,
          height: exportHeight,
          fps: exportFps,
          durationSec: exportDurationSec,
          codec: exportCodec,
          quality: exportQuality,
        },
      };
    }
  }, [
    cameraTrackFrames,
    cameraTrackPlaying,
    exportAlpha,
    exportCodec,
    exportDurationSec,
    exportFps,
    exportHeight,
    exportQuality,
    exportWidth,
    timelinePlayheadSec,
    trackCoercivity,
    trackDurationSec,
    trackName,
    trackRetentivity,
    trackSaturation,
  ]);
  const toggleFreecamRecord = useCallback(() => {
    setFreecamRecordMode((prev) => {
      const next = !prev;
      freecamRecordRef.current = next;
      if (next) {
        freecamRecordStartRef.current = performance.now() - timelinePlayheadSec * 1000;
        freecamLastCaptureRef.current = -Infinity;
      }
      return next;
    });
  }, [timelinePlayheadSec]);
  const exportTrackVideo = useCallback(async () => {
    const canvas = canvasRef.current;
    const renderer = rendererRef.current;
    const camera = cameraRef.current;
    if (!canvas || !renderer || !camera || exportingVideo) return;
    const stream = canvas.captureStream(Math.max(12, exportFps));
    const codecCandidates =
      exportCodec === "h264-mp4"
        ? ["video/mp4;codecs=avc1.42E01E", "video/mp4", "video/webm;codecs=h264", "video/webm"]
        : exportCodec === "webm-vp8"
          ? ["video/webm;codecs=vp8", "video/webm"]
          : ["video/webm;codecs=vp9", "video/webm"];
    const mimeType = codecCandidates.find((c) => MediaRecorder.isTypeSupported(c)) ?? "";
    if (!mimeType) {
      return;
    }
    const previousSize = renderer.getSize(new Vector2());
    const prevAspect = camera.aspect;
    const chunks: Blob[] = [];
    setExportingVideo(true);
    try {
      renderer.setSize(exportWidth, exportHeight, false);
      camera.aspect = exportWidth / exportHeight;
      camera.updateProjectionMatrix();

      const recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: Math.max(2_000_000, Math.floor(16_000_000 * clamp(exportQuality, 0.3, 1))),
      });
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
      };
      const stopped = new Promise<void>((resolve) => {
        recorder.onstop = () => resolve();
      });
      recorder.start(120);
      if (!cameraTrackPlayRef.current && cameraTrackFrames.length >= 2) {
        setCameraTrackPlaying(true);
        cameraTrackPlayRef.current = true;
        cameraTrackStartRef.current = performance.now() - timelinePlayheadSec * 1000;
      }
      await new Promise((resolve) => window.setTimeout(resolve, Math.max(1, exportDurationSec) * 1000));
      recorder.stop();
      await stopped;
      const blob = new Blob(chunks, { type: mimeType });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const ext = mimeType.includes("mp4") ? "mp4" : "webm";
      link.href = url;
      link.download = `cymaglyph-track-${Date.now()}.${ext}`;
      link.click();
      URL.revokeObjectURL(url);
    } finally {
      renderer.setSize(previousSize.x, previousSize.y, false);
      camera.aspect = prevAspect;
      camera.updateProjectionMatrix();
      setExportingVideo(false);
    }
  }, [
    cameraTrackFrames.length,
    exportCodec,
    exportDurationSec,
    exportFps,
    exportHeight,
    exportQuality,
    exportWidth,
    exportingVideo,
    timelinePlayheadSec,
  ]);
  const exportFramePng = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement("a");
    link.href = canvas.toDataURL("image/png");
    link.download = `cymaglyph-frame-${Date.now()}.png`;
    link.click();
  }, []);

  useEffect(() => {
    void loadCameraTrack();
  }, [loadCameraTrack]);

  useEffect(() => {
    freecamRecordRef.current = freecamRecordMode;
  }, [freecamRecordMode]);

  useEffect(() => {
    moveSpeedRef.current = moveSpeed;
  }, [moveSpeed]);

  useEffect(() => {
    exportAlphaRef.current = exportAlpha;
  }, [exportAlpha]);

  useEffect(() => {
    trackDurationRef.current = trackDurationSec;
  }, [trackDurationSec]);

  useEffect(() => {
    setTimelinePlayheadSec((prev) => clamp(prev, 0, Math.max(0.001, trackDurationSec)));
  }, [trackDurationSec]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const W = Math.max(2, Math.floor(container.clientWidth || 800));
    const H = Math.max(2, Math.floor(container.clientHeight || 600));
    const scene = new Scene();
    scene.background = new Color(0x080a10);
    sceneRef.current = scene;

    const camera = new PerspectiveCamera(60, W / H, 0.01, 1000);
    camera.position.set(0, 0.8, 3.5);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    const sdfScene = new Scene();
    const sdfCam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
    sdfSceneRef.current = sdfScene;
    sdfCamRef.current = sdfCam;
    const sdfMat = new ShaderMaterial({
      vertexShader: SDF_WORLD_VERTEX,
      fragmentShader: SDF_WORLD_FRAGMENT,
      uniforms: {
        uResolution: { value: new Vector2(W, H) },
        uTime: { value: 0 },
        uCamPos: { value: new Vector3(0, 0.6, 4.8) },
        uCamForward: { value: new Vector3(0, 0, -1) },
        uCamRight: { value: new Vector3(1, 0, 0) },
        uCamUp: { value: new Vector3(0, 1, 0) },
        uCarrierHz: { value: 14000 },
        uPayloadHz: { value: 144 },
        uCarrierBase: { value: 0 },
        uPayloadMod: { value: 0 },
        uEmitted: { value: 0 },
        uAmDepth: { value: 18 },
        uPmDepth: { value: 14 },
        uResQ: { value: 12 },
        uRepeatCount: { value: 1 },
        uMoveSpeed: { value: moveSpeedRef.current },
        uPsiConfidence: { value: 0 },
        uDomainSpacing: { value: 4.5 },
      },
      depthTest: false,
      depthWrite: false,
    });
    const sdfQuad = new Mesh(new PlaneGeometry(2, 2), sdfMat);
    sdfScene.add(sdfQuad);
    sdfQuadRef.current = sdfQuad;

    const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setSize(W, H, false);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setViewport(0, 0, W, H);
    renderer.setClearColor(0x080a10, exportAlphaRef.current ? 0 : 1);
    rendererRef.current = renderer;

    const onContextLost = (event: Event) => {
      event.preventDefault();
      setIsGenerating(false);
      setAudioError("WebGL context lost. Rendering paused until context is restored.");
      emitConsoleHead("APP_STATE_HEAD", "webgl_context_lost");
    };
    const onContextRestored = () => {
      setAudioError(null);
      lastKeyRef.current = "";
      lastMeshControlSigRef.current = "";
      emitConsoleHead("APP_STATE_HEAD", "webgl_context_restored");
    };
    canvas.addEventListener("webglcontextlost", onContextLost as EventListener, false);
    canvas.addEventListener("webglcontextrestored", onContextRestored as EventListener, false);

    const onResize = () => {
      const W2 = Math.max(2, Math.floor(container.clientWidth));
      const H2 = Math.max(2, Math.floor(container.clientHeight));
      camera.aspect = W2 / H2;
      camera.updateProjectionMatrix();
      renderer.setSize(W2, H2, false);
      renderer.setViewport(0, 0, W2, H2);
      const mat = sdfQuadRef.current?.material as ShaderMaterial | undefined;
      if (mat) (mat.uniforms.uResolution.value as Vector2).set(W2, H2);
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(container);

    const onPointerDown = (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest("[data-stage-ui='true']")) return;
      const mode = useTransmitterStore.getState().cymaglyphRenderMode;
      if (mode === "SDF_WORLD") {
        fpsCamRef.current.pointerDown = true;
        fpsCamRef.current.lastX = e.clientX;
        fpsCamRef.current.lastY = e.clientY;
        if (document.pointerLockElement !== canvas) {
          canvas.requestPointerLock?.();
        }
      } else {
        orbitRef.current.pointerDown = true;
        orbitRef.current.panning = e.button === 1 || e.button === 2 || e.shiftKey;
        orbitRef.current.lastX = e.clientX;
        orbitRef.current.lastY = e.clientY;
        orbitRef.current.interactedAt = performance.now();
      }
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    };
    const onPointerMove = (e: PointerEvent) => {
      const mode = useTransmitterStore.getState().cymaglyphRenderMode;
      if (mode === "SDF_WORLD") {
        if (!fpsCamRef.current.pointerDown && document.pointerLockElement !== canvas) return;
        const dx = document.pointerLockElement === canvas ? e.movementX : e.clientX - fpsCamRef.current.lastX;
        const dy = document.pointerLockElement === canvas ? e.movementY : e.clientY - fpsCamRef.current.lastY;
        fpsCamRef.current.lastX = e.clientX;
        fpsCamRef.current.lastY = e.clientY;
        fpsCamRef.current.yaw -= dx * 0.0035;
        fpsCamRef.current.pitch = clamp(fpsCamRef.current.pitch - dy * 0.0035, -1.45, 1.45);
        return;
      }
      if (!orbitRef.current.pointerDown) return;
      const dx = e.clientX - orbitRef.current.lastX;
      const dy = e.clientY - orbitRef.current.lastY;
      orbitRef.current.lastX = e.clientX;
      orbitRef.current.lastY = e.clientY;
      orbitRef.current.interactedAt = performance.now();
      if (orbitRef.current.panning) {
        orbitRef.current.targetX = clamp(orbitRef.current.targetX - dx * 0.004, -2.5, 2.5);
        orbitRef.current.targetY = clamp(orbitRef.current.targetY + dy * 0.004, -2.5, 2.5);
      } else {
        orbitRef.current.azimuth += dx * 0.0045;
        orbitRef.current.elevation = clamp(orbitRef.current.elevation + dy * 0.0035, -1.2, 1.2);
      }
    };
    const onPointerUp = (e: PointerEvent) => {
      fpsCamRef.current.pointerDown = false;
      orbitRef.current.pointerDown = false;
      orbitRef.current.panning = false;
      orbitRef.current.interactedAt = performance.now();
      (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
    };
    const onPointerLockChange = () => {
      if (document.pointerLockElement !== canvas) {
        fpsCamRef.current.pointerDown = false;
      }
    };
    const onWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest("[data-stage-ui='true']")) return;
      const mode = useTransmitterStore.getState().cymaglyphRenderMode;
      if (mode === "SDF_WORLD") return;
      e.preventDefault();
      orbitRef.current.distance = clamp(orbitRef.current.distance + e.deltaY * 0.0025, 1.2, 12);
      orbitRef.current.interactedAt = performance.now();
    };
    const onContextMenu = (e: MouseEvent) => e.preventDefault();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Escape" && freecamRecordRef.current) {
        setFreecamRecordMode(false);
        freecamRecordRef.current = false;
      }
      keysDownRef.current[e.code] = true;
    };
    const onKeyUp = (e: KeyboardEvent) => {
      keysDownRef.current[e.code] = false;
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("contextmenu", onContextMenu);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    document.addEventListener("pointerlockchange", onPointerLockChange);

    const render = () => {
      const s = useTransmitterStore.getState();
      const T = s.globalTensorState;
      const liveW = Math.max(0, Math.floor(container.clientWidth));
      const liveH = Math.max(0, Math.floor(container.clientHeight));
      if (liveW < 2 || liveH < 2) {
        rafRef.current = requestAnimationFrame(render);
        return;
      }
      const rendererSize = renderer.getSize(new Vector2());
      if (rendererSize.x !== liveW || rendererSize.y !== liveH) {
        renderer.setSize(liveW, liveH, false);
        renderer.setViewport(0, 0, liveW, liveH);
        camera.aspect = liveW / liveH;
        camera.updateProjectionMatrix();
        const mat = sdfQuadRef.current?.material as ShaderMaterial | undefined;
        if (mat) (mat.uniforms.uResolution.value as Vector2).set(liveW, liveH);
      }
      const nowTs = performance.now();
      const dt = Math.min(0.06, Math.max(0.001, (nowTs - prevTsRef.current) * 0.001));
      prevTsRef.current = nowTs;
      const baseR = Math.min(container.clientWidth, container.clientHeight) * 0.0025;
      renderer.setClearColor(0x080a10, exportAlphaRef.current ? 0 : 1);
      const iters = s.isGenerating ? 5000 : 2500;

      const ingestSourceActive =
        s.ingestLockActive &&
        (s.playerSession.sourceType === "upload" ||
          s.playerSession.sourceType === "voice" ||
          s.playerSession.sourceType === "pcm" ||
          s.playerSession.sourceType === "compendium");
      const baseFrame = s.cymaglyphGeneratedFrame ?? (!ingestSourceActive && s.cymaglyphRenderSource !== "DSP_ESTIMATE" ? s.lastValidCymaglyphFrame : null);
      const isDomainRepeatMode =
        s.cymaglyphRenderMode === "SDF_DOMAIN_REPEAT" ||
        s.cymaglyphRenderMode === "SDF_DOMAIN_REPEAT_RHOTORSE";
      const effectiveFrame =
        baseFrame && isDomainRepeatMode
          ? applyDomainRepetitionToFrame(baseFrame, s.domainRepeatCount, {
              layout: s.domainRepeatLayout,
              backwardOnly: true,
              depthStep: s.domainRepeatDepthStep,
              oscillationCoupling: s.domainRepeatOscillationCoupling,
              rotXDeg: s.domainRepeatRotXDeg,
              rotYDeg: s.domainRepeatRotYDeg,
              rotZDeg: s.domainRepeatRotZDeg,
              carrierHz: parseFloat(s.carrierG3Nen) || 14000,
              payloadHz: parseFloat(s.payloadG3Nen) || 144,
              layerCarrierHz,
              layerPayloadHz,
            })
          : baseFrame;
      const generatedAt = baseFrame?.generatedAt ?? 0;
      const key = `${T.scalar.toFixed(1)}_${T.bivector[0].toFixed(2)}_${T.trivector.toFixed(2)}_${T.vector[1].toFixed(2)}_${s.isGenerating}_${generatedAt}_${s.cymaglyphRenderMode}_${s.domainRepeatCount}_${s.domainRepeatLayout}_${s.domainRepeatDepthStep.toFixed(2)}_${s.domainRepeatOscillationCoupling.toFixed(2)}_${s.domainRepeatRotXDeg.map((v) => v.toFixed(1)).join(",")}_${s.domainRepeatRotYDeg.map((v) => v.toFixed(1)).join(",")}_${s.domainRepeatRotZDeg.map((v) => v.toFixed(1)).join(",")}_${s.domainRepeatLayerOscillationIds.join(",")}`;

      if (key !== lastKeyRef.current && s.cymaglyphRenderMode !== "SDF_WORLD") {
        lastKeyRef.current = key;
        if (s.cymaglyphRenderMode === "SDF_CLOSED_MESH") {
          const faaReport = deriveFAAReportLikeFromAir(
            s.airValidationSnapshot,
            "transport_full",
            0,
          );
          const rhoMeans = deriveRhoTorseMeansFromPsi(s.psiAirState);
          const meshControl = computeFAAMeshControlVector(faaReport, rhoMeans);
          const meshControlSig = `${meshControl.res_final.toFixed(3)}|${meshControl.rt_iters}|${meshControl.rt_alpha.toFixed(4)}|${meshControl.rt_gate.toFixed(4)}|${meshControl.rt_closure_mix.toFixed(4)}`;
          if (meshControlSig !== lastMeshControlSigRef.current) {
            lastMeshControlSigRef.current = meshControlSig;
            s.setFAAMeshControlVector(meshControl);
          }
          const fieldParams: RuntimeFieldParams = {
            carrierHz: parseFloat(s.carrierG3Nen) || 14000,
            payloadHz: parseFloat(s.payloadG3Nen) || 144,
            carrierBase: s.signalContractFrame?.carrierBase ?? 0,
            payloadMod: s.signalContractFrame?.payloadMod ?? 0,
            emitted: s.signalContractFrame?.emittedEstimate ?? 0,
            amDepth: s.amDepth,
            pmDepth: s.pmDepth,
            resonanceQ: s.resonanceQ,
            domainRepeatCount: s.domainRepeatCount,
            domainSpacing: computeFoLDomainSpacingFromFrame(effectiveFrame, s.domainRepeatCount),
            psiConfidence: summarizePsi(s.psiAirState).confidence,
          };
          let meshGeo = buildClosedMeshFromField(fieldParams, nowTs * 0.001, meshControl);
          const meshQuality = assessFractalConstraintQuality(meshGeo);
          if (!meshQuality.ok && lastValidMeshGeoRef.current) {
            meshGeo.dispose();
            meshGeo = lastValidMeshGeoRef.current.clone();
          } else if (meshQuality.ok) {
            if (lastValidMeshGeoRef.current) {
              lastValidMeshGeoRef.current.dispose();
            }
            lastValidMeshGeoRef.current = meshGeo.clone();
          }
          const meshMat = new MeshBasicMaterial({
            vertexColors: true,
            transparent: true,
            opacity: 0.94,
            wireframe: false,
            side: DoubleSide,
          });
          if (meshRef.current) {
            meshRef.current.geometry.dispose();
            disposeMaterial(meshRef.current.material);
            scene.remove(meshRef.current);
          }
          const mesh = new Mesh(meshGeo, meshMat);
          scene.add(mesh);
          meshRef.current = mesh;
        } else {
          if (meshRef.current) {
            meshRef.current.geometry.dispose();
            disposeMaterial(meshRef.current.material);
            scene.remove(meshRef.current);
            meshRef.current = null;
          }
          const geo = new BufferGeometry();
          let meanSize = 1;
          if (effectiveFrame) {
            geo.setAttribute("position", new Float32BufferAttribute(effectiveFrame.positions, 3));
            geo.setAttribute("color", new Float32BufferAttribute(effectiveFrame.colors, 3));
            geo.setAttribute("aColor", new Float32BufferAttribute(effectiveFrame.colors, 3));
            const sizes = effectiveFrame.sizes;
            let sum = 0;
            for (let i = 0; i < sizes.length; i += 1) sum += sizes[i];
            meanSize = sizes.length > 0 ? sum / sizes.length : 1;
          } else {
            const pts = runIFS3D(T, baseR * 80, iters);
            geo.setAttribute("position", new Float32BufferAttribute(pts, 3));
            const nPts = pts.length / 3;
            const cols = new Float32Array(nPts * 3);
            for (let i = 0; i < nPts; i++) {
              const even = i % 2 === 0;
              cols[i * 3 + 0] = even ? 0.88 : 0.5;
              cols[i * 3 + 1] = even ? 1.0 : 0.69;
              cols[i * 3 + 2] = even ? 1.0 : 0.75;
            }
            geo.setAttribute("color", new Float32BufferAttribute(cols, 3));
            geo.setAttribute("aColor", new Float32BufferAttribute(cols, 3));
          }

          const mat =
            s.cymaglyphRenderMode === "RHOTORSE_FLUID" || s.cymaglyphRenderMode === "SDF_DOMAIN_REPEAT_RHOTORSE"
              ? createRhotorseFluidMaterial()
              : new PointsMaterial({
                  size: effectiveFrame ? Math.max(0.01, Math.min(0.06, 0.008 + meanSize * 0.006)) : 0.018,
                  vertexColors: true,
                  blending: AdditiveBlending,
                  transparent: true,
                  opacity: 0.72,
                  depthWrite: false,
                  sizeAttenuation: true,
                });

          if (pointsRef.current) {
            pointsRef.current.geometry.dispose();
            disposeMaterial(pointsRef.current.material);
            scene.remove(pointsRef.current);
          }
          const pts3d = new Points(geo, mat);
          scene.add(pts3d);
          pointsRef.current = pts3d;

          if (linesRef.current) {
            linesRef.current.geometry.dispose();
            (linesRef.current.material as LineBasicMaterial).dispose();
            scene.remove(linesRef.current);
            linesRef.current = null;
          }
          if (effectiveFrame?.linePositions && effectiveFrame.linePositions.length >= 6) {
            const lineGeo = new BufferGeometry();
            lineGeo.setAttribute("position", new Float32BufferAttribute(effectiveFrame.linePositions, 3));
            const lineCols = effectiveFrame.lineColors ?? effectiveFrame.colors;
            if (lineCols && lineCols.length >= 6) {
              lineGeo.setAttribute("color", new Float32BufferAttribute(lineCols, 3));
            }
            const lineMat = new LineBasicMaterial({
              vertexColors: true,
              blending: AdditiveBlending,
              transparent: true,
              opacity: s.isGenerating ? 0.64 : 0.44,
              linewidth: 1,
            });
            const lines = new LineSegments(lineGeo, lineMat);
            scene.add(lines);
            linesRef.current = lines;
          } else if (!effectiveFrame) {
            const { positions: linePos, colors: lineCol } = buildSeedLines(baseR * 80, T.scalar);
            const lineGeo = new BufferGeometry();
            lineGeo.setAttribute("position", new Float32BufferAttribute(linePos, 3));
            lineGeo.setAttribute("color", new Float32BufferAttribute(lineCol, 3));
            const lineMat = new LineBasicMaterial({
              vertexColors: true,
              blending: AdditiveBlending,
              transparent: true,
              opacity: 0.6,
              linewidth: 1,
            });
            const lines = new LineSegments(lineGeo, lineMat);
            scene.add(lines);
            linesRef.current = lines;
          }
        }
      }

      if (cameraTrackPlayRef.current && cameraTrackRef.current && cameraTrackRef.current.frames.length >= 2) {
        const elapsed = (performance.now() - cameraTrackStartRef.current) * 0.001;
        const sample = interpolateTrack(cameraTrackRef.current, elapsed);
        const duration = Math.max(0.001, cameraTrackRef.current.durationSec);
        const playhead = ((elapsed % duration) + duration) % duration;
        if (performance.now() - lastPlayheadUiUpdateRef.current > 66) {
          lastPlayheadUiUpdateRef.current = performance.now();
          setTimelinePlayheadSec(playhead);
        }
        const targetPos = new Vector3(sample.x, sample.y, sample.z);
        const targetLook = new Vector3(sample.tx, sample.ty, sample.tz);
        cameraStateRef.current.pos = applyHystereticResponse(
          cameraStateRef.current.pos,
          targetPos,
          cameraTrackRef.current.hysteresis,
          dt,
        );
        cameraStateRef.current.target = applyHystereticResponse(
          cameraStateRef.current.target,
          targetLook,
          cameraTrackRef.current.hysteresis,
          dt,
        );
        if (sample.params) {
          const p = sample.params;
          const paramHash = [
            p.carrierHz.toFixed(3),
            p.payloadHz.toFixed(3),
            p.amDepth.toFixed(3),
            p.pmDepth.toFixed(3),
            p.resonanceQ.toFixed(3),
            p.tensorScalar.toFixed(3),
            p.tensorBivector0.toFixed(3),
            p.tensorTrivector.toFixed(3),
            p.nodeColor,
            p.antiColor,
            p.transColor,
            p.brightness.toFixed(3),
            p.gamma.toFixed(3),
          ].join("|");
          if (paramHash !== lastAppliedParamHashRef.current) {
            lastAppliedParamHashRef.current = paramHash;
            s.setParam("carrierG3Nen", String(Math.round(p.carrierHz)));
            s.setParam("payloadG3Nen", String(Math.round(p.payloadHz)));
            s.setParam("amDepth", p.amDepth);
            s.setParam("pmDepth", p.pmDepth);
            s.setParam("resonanceQ", p.resonanceQ);
            s.updatePhiSudTensor("tensor", {
              scalar: p.tensorScalar,
              bivector: [p.tensorBivector0, 0, 0],
              trivector: p.tensorTrivector,
            });
            s.setGradient({
              nodeColor: p.nodeColor,
              antiColor: p.antiColor,
              transColor: p.transColor,
              brightness: p.brightness,
              gamma: p.gamma,
            });
          }
        }
      }

      if (s.cymaglyphRenderMode === "SDF_WORLD") {
        if (pointsRef.current) pointsRef.current.visible = false;
        if (linesRef.current) linesRef.current.visible = false;
        if (meshRef.current) meshRef.current.visible = false;

        const yaw = fpsCamRef.current.yaw;
        const pitch = fpsCamRef.current.pitch;
        const forward = new Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)).normalize();
        const right = new Vector3().crossVectors(forward, new Vector3(0, 1, 0)).normalize();
        const up = new Vector3().crossVectors(right, forward).normalize();

        if (keysDownRef.current.ArrowLeft) fpsCamRef.current.yaw += dt * 1.6;
        if (keysDownRef.current.ArrowRight) fpsCamRef.current.yaw -= dt * 1.6;
        if (keysDownRef.current.ArrowUp) fpsCamRef.current.pitch = clamp(fpsCamRef.current.pitch + dt * 1.2, -1.45, 1.45);
        if (keysDownRef.current.ArrowDown) fpsCamRef.current.pitch = clamp(fpsCamRef.current.pitch - dt * 1.2, -1.45, 1.45);

        const speed = moveSpeedRef.current;
        const move = new Vector3(0, 0, 0);
        if (keysDownRef.current.KeyW) move.add(forward);
        if (keysDownRef.current.KeyS) move.addScaledVector(forward, -1);
        if (keysDownRef.current.KeyA) move.addScaledVector(right, -1);
        if (keysDownRef.current.KeyD) move.add(right);
        if (keysDownRef.current.Space) move.y += 1;
        if (keysDownRef.current.ShiftLeft || keysDownRef.current.ShiftRight) move.y -= 1;
        if (move.lengthSq() > 0) {
          move.normalize().multiplyScalar(speed * dt);
          fpsCamRef.current.pos.add(move);
        }
        if (cameraTrackPlayRef.current) {
          fpsCamRef.current.pos.copy(cameraStateRef.current.pos);
        }
        if (freecamRecordRef.current) {
          const nowSec = (performance.now() - freecamRecordStartRef.current) * 0.001;
          if (nowSec - freecamLastCaptureRef.current >= 1 / 12) {
            freecamLastCaptureRef.current = nowSec;
            const captureT = clamp(nowSec, 0, Math.max(0.001, trackDurationRef.current));
            const target = fpsCamRef.current.pos.clone().addScaledVector(forward, 2.4);
            const frame: CameraKeyframe = {
              t: captureT,
              x: fpsCamRef.current.pos.x,
              y: fpsCamRef.current.pos.y,
              z: fpsCamRef.current.pos.z,
              tx: target.x,
              ty: target.y,
              tz: target.z,
              params: {
                carrierHz: parseFloat(s.carrierG3Nen) || 16000,
                payloadHz: parseFloat(s.payloadG3Nen) || 220,
                amDepth: s.amDepth,
                pmDepth: s.pmDepth,
                resonanceQ: s.resonanceQ,
                tensorScalar: s.globalTensorState.scalar,
                tensorBivector0: s.globalTensorState.bivector[0],
                tensorTrivector: s.globalTensorState.trivector,
                nodeColor: s.activeGradient.nodeColor,
                antiColor: s.activeGradient.antiColor,
                transColor: s.activeGradient.transColor,
                brightness: s.activeGradient.brightness,
                gamma: s.activeGradient.gamma,
              },
            };
            setCameraTrackFrames((prev) => {
              const merged = [...prev, frame].sort((a, b) => a.t - b.t);
              const deduped: CameraKeyframe[] = [];
              for (const f of merged) {
                const last = deduped[deduped.length - 1];
                if (last && Math.abs(last.t - f.t) < 0.04) {
                  deduped[deduped.length - 1] = f;
                } else {
                  deduped.push(f);
                }
              }
              return deduped;
            });
          }
        }

        const mat = sdfQuadRef.current?.material as ShaderMaterial | undefined;
        if (mat) {
          const carrierHz = parseFloat(s.carrierG3Nen) || 14000;
          const payloadHz = parseFloat(s.payloadG3Nen) || 144;
          const psi = summarizePsi(s.psiAirState);
          mat.uniforms.uTime.value = nowTs * 0.001;
          mat.uniforms.uCamPos.value.copy(fpsCamRef.current.pos);
          mat.uniforms.uCamForward.value.copy(forward);
          mat.uniforms.uCamRight.value.copy(right);
          mat.uniforms.uCamUp.value.copy(up);
          mat.uniforms.uCarrierHz.value = carrierHz;
          mat.uniforms.uPayloadHz.value = payloadHz;
          mat.uniforms.uCarrierBase.value = s.signalContractFrame?.carrierBase ?? 0;
          mat.uniforms.uPayloadMod.value = s.signalContractFrame?.payloadMod ?? 0;
          mat.uniforms.uEmitted.value = s.signalContractFrame?.emittedEstimate ?? 0;
          mat.uniforms.uAmDepth.value = s.amDepth;
          mat.uniforms.uPmDepth.value = s.pmDepth;
          mat.uniforms.uResQ.value = s.resonanceQ;
          mat.uniforms.uRepeatCount.value = s.domainRepeatCount;
          mat.uniforms.uMoveSpeed.value = moveSpeedRef.current;
          mat.uniforms.uPsiConfidence.value = psi.confidence;
          mat.uniforms.uDomainSpacing.value = computeFoLDomainSpacingFromFrame(effectiveFrame, s.domainRepeatCount);
        }

        renderer.render(sdfScene, sdfCam);
      } else {
        if (meshRef.current) meshRef.current.visible = s.cymaglyphRenderMode === "SDF_CLOSED_MESH";
        if (pointsRef.current) pointsRef.current.visible = s.cymaglyphRenderMode !== "SDF_CLOSED_MESH";
        if (linesRef.current) linesRef.current.visible = s.cymaglyphRenderMode !== "SDF_CLOSED_MESH";

        const idleSec = (nowTs - orbitRef.current.interactedAt) / 1000;
        if (!orbitRef.current.pointerDown && idleSec > 2.5) orbitRef.current.azimuth += 0.001;
        const orbitR = orbitRef.current.distance;
        const orbitY = orbitRef.current.targetY;
        const x = Math.cos(orbitRef.current.azimuth) * orbitR * Math.cos(orbitRef.current.elevation);
        const y = orbitY + Math.sin(orbitRef.current.elevation) * orbitR * 0.55;
        const z = Math.sin(orbitRef.current.azimuth) * orbitR * Math.cos(orbitRef.current.elevation);
        const orbitPos = new Vector3(x + orbitRef.current.targetX, y, z);
        const orbitTarget = new Vector3(orbitRef.current.targetX, orbitRef.current.targetY, 0);
        cameraStateRef.current.pos.copy(orbitPos);
        cameraStateRef.current.target.copy(orbitTarget);
        if (cameraTrackPlayRef.current) {
          camera.position.copy(cameraStateRef.current.pos);
          camera.lookAt(cameraStateRef.current.target);
        } else {
          camera.position.copy(orbitPos);
          camera.lookAt(orbitTarget);
        }

        if (pointsRef.current) {
          if (s.cymaglyphRenderMode === "RHOTORSE_FLUID") {
            const mat = pointsRef.current.material as ShaderMaterial;
            updateRhotorseFluidUniforms(mat, s.signalContractFrame, nowTs * 0.001, clamp(0.65 + s.amDepth / 120 + s.pmDepth / 200, 0.2, 2.2), {
              nodeColor: s.activeGradient.nodeColor,
              antiColor: s.activeGradient.antiColor,
              transColor: s.activeGradient.transColor,
            });
          } else {
            const mat = pointsRef.current.material as PointsMaterial;
            mat.opacity = s.isGenerating ? 0.55 + Math.sin(s.playbackSeconds * 5.5) * 0.15 * (s.amDepth / 100) : 0.72;
          }
        }

        renderer.render(scene, camera);
      }

      rafRef.current = requestAnimationFrame(render);
    };

    rafRef.current = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("contextmenu", onContextMenu);
      canvas.removeEventListener("webglcontextlost", onContextLost as EventListener);
      canvas.removeEventListener("webglcontextrestored", onContextRestored as EventListener);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      document.removeEventListener("pointerlockchange", onPointerLockChange);
      if (document.pointerLockElement === canvas) {
        document.exitPointerLock?.();
      }
      renderer.dispose();
      if (pointsRef.current) {
        pointsRef.current.geometry.dispose();
        disposeMaterial(pointsRef.current.material);
        scene.remove(pointsRef.current);
      }
      if (linesRef.current) {
        linesRef.current.geometry.dispose();
        scene.remove(linesRef.current);
      }
      if (meshRef.current) {
        meshRef.current.geometry.dispose();
        disposeMaterial(meshRef.current.material);
        scene.remove(meshRef.current);
      }
      if (lastValidMeshGeoRef.current) {
        lastValidMeshGeoRef.current.dispose();
        lastValidMeshGeoRef.current = null;
      }
      if (sdfQuadRef.current) {
        sdfQuadRef.current.geometry.dispose();
        disposeMaterial(sdfQuadRef.current.material);
        sdfScene.remove(sdfQuadRef.current);
      }
    };
  }, []);

  useEffect(() => {
    lastKeyRef.current = "";
    lastMeshControlSigRef.current = "";
  }, [
    generatedFrame?.generatedAt,
    lastValidFrame?.generatedAt,
    renderSource,
    renderMode,
    domainRepeatCount,
    domainRepeatLayout,
    domainRepeatDepthStep,
    domainRepeatOscillationCoupling,
    domainRepeatRotXDeg,
    domainRepeatRotYDeg,
    domainRepeatRotZDeg,
    domainRepeatLayerOscillationIds,
    layerCarrierHz,
    layerPayloadHz,
    signalContract?.frameId,
    ingestLockActive,
    playerSourceType,
  ]);

  return (
    <div ref={containerRef} style={{ width: "100%", height: "100%", position: "relative", background: "var(--gorsck-void)", overflow: "hidden" }}>
      <canvas
        ref={canvasRef}
        style={{
          width: "100%",
          height: "100%",
          display: "block",
          filter: isGenerating ? `drop-shadow(0 0 18px ${activeGradient.nodeColor}) drop-shadow(0 0 50px ${activeGradient.antiColor}55)` : "drop-shadow(0 0 4px rgba(15,240,252,0.12))",
          transition: "filter 0.6s ease",
        }}
      />

      {showOverlayControls && (
      <div
        data-stage-ui="true"
        style={{
          position: "absolute",
          top: "16px",
          right: "16px",
          width: "220px",
          background: "rgba(8,10,16,0.82)",
          backdropFilter: "blur(8px)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: "12px",
          padding: "14px",
          display: "flex",
          flexDirection: "column",
          gap: "10px",
          zIndex: 20,
          userSelect: "none",
        }}
      >
        <div style={{ fontSize: "0.62rem", fontFamily: "var(--font-family-mono)", color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "2px" }}>
          Modulation
        </div>

        <OverlaySlider label="Carrier Hz" value={parseFloat(carrierG3Nen) || 16000} min={1000} max={24000} step={10} onChange={setCarrier} />
        <OverlaySlider label="Payload Hz" value={parseFloat(payloadG3Nen) || 220} min={20} max={2000} step={1} onChange={setPayload} />
        <OverlaySlider label="AM Depth" value={amDepth} min={0} max={100} step={0.5} onChange={setAmDepth} />
        <OverlaySlider label="PM Depth" value={pmDepth} min={0} max={100} step={0.5} onChange={setPmDepth} />
        <OverlaySlider label="Resonance Q" value={resonanceQ} min={1} max={100} step={0.5} onChange={setResQ} />

        <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: "8px", fontSize: "0.62rem", fontFamily: "var(--font-family-mono)", color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: "0.1em" }}>
          Tensor
        </div>

        <OverlaySlider label="Scalar" value={tensorScalar} min={1} max={100} step={0.5} onChange={setScalar} />
        <OverlaySlider label="Bivector (torsion)" value={tensorBivector0} min={-50} max={50} step={0.5} onChange={setBivec0} />
        <OverlaySlider label="Trivector (sun)" value={tensorTrivector} min={0} max={1} step={0.01} onChange={setTrivec} />

        {renderMode === "SDF_WORLD" && (
          <>
            <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: "8px", fontSize: "0.62rem", fontFamily: "var(--font-family-mono)", color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: "0.1em" }}>
              World Nav
            </div>
            <OverlaySlider label="Move Speed" value={moveSpeed} min={1} max={20} step={0.1} onChange={setMoveSpeed} />
            <div style={{ fontSize: "0.58rem", color: "rgba(255,255,255,0.5)", fontFamily: "var(--font-family-mono)" }}>
              WASD move · Space up · Shift down · drag look · Arrow keys rotate
            </div>
          </>
        )}
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: "8px", fontSize: "0.62rem", fontFamily: "var(--font-family-mono)", color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: "0.1em" }}>
          Camera Track
        </div>
        <input
          value={trackName}
          onChange={(e) => setTrackName(e.target.value)}
          placeholder="Track name..."
          style={{ background: "rgba(8,10,16,0.9)", border: "1px solid rgba(255,255,255,0.14)", color: "white", borderRadius: "8px", padding: "6px 8px", fontFamily: "var(--font-family-mono)", fontSize: "0.62rem" }}
        />
        <OverlaySlider label="Duration (s)" value={trackDurationSec} min={1} max={120} step={1} onChange={setTrackDurationSec} />
        <OverlaySlider label="Coercivity" value={trackCoercivity} min={0.1} max={4} step={0.05} onChange={setTrackCoercivity} />
        <OverlaySlider label="Retentivity" value={trackRetentivity} min={0} max={0.95} step={0.01} onChange={setTrackRetentivity} />
        <OverlaySlider label="Saturation" value={trackSaturation} min={0.1} max={2.5} step={0.05} onChange={setTrackSaturation} />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.58rem", fontFamily: "var(--font-family-mono)", color: "rgba(225,248,255,0.72)" }}>
          <span>Playhead: {timelinePlayheadSec.toFixed(2)}s</span>
          <span>Zoom: {timelineWindowSec.toFixed(1)}s</span>
        </div>
        <div
          ref={timelineRef}
          onMouseDown={(e) => {
            if (!timelineRef.current) return;
            const rect = timelineRef.current.getBoundingClientRect();
            const windowDur = Math.min(Math.max(1, timelineWindowSec), Math.max(1, trackDurationSec));
            const start = clamp(timelinePlayheadSec - windowDur * 0.5, 0, Math.max(0, trackDurationSec - windowDur));
            const ratio = clamp((e.clientX - rect.left) / Math.max(1, rect.width), 0, 1);
            seekTimeline(start + ratio * windowDur);
          }}
          onWheel={(e) => {
            e.preventDefault();
            if (e.ctrlKey) {
              setTimelineWindowSec((prev) => clamp(prev + Math.sign(e.deltaY) * 1.5, 1, 120));
              return;
            }
            seekTimeline(timelinePlayheadSec + (e.deltaY > 0 ? 0.25 : -0.25));
          }}
          style={{
            position: "relative",
            height: "30px",
            borderRadius: "8px",
            border: "1px solid rgba(170,220,248,0.28)",
            background: "linear-gradient(180deg, rgba(160,208,224,0.08), rgba(160,208,224,0.02))",
            overflow: "hidden",
            cursor: "pointer",
          }}
        >
          {(() => {
            const windowDur = Math.min(Math.max(1, timelineWindowSec), Math.max(1, trackDurationSec));
            const start = clamp(timelinePlayheadSec - windowDur * 0.5, 0, Math.max(0, trackDurationSec - windowDur));
            const end = start + windowDur;
            const playheadPct = ((timelinePlayheadSec - start) / windowDur) * 100;
            return (
              <>
                {cameraTrackFrames
                  .filter((f) => f.t >= start && f.t <= end)
                  .map((f, idx) => (
                    <div
                      key={`${f.t}-${idx}`}
                      style={{
                        position: "absolute",
                        left: `${((f.t - start) / windowDur) * 100}%`,
                        top: 0,
                        bottom: 0,
                        width: "2px",
                        background: "rgba(130,255,180,0.85)",
                      }}
                      title={`KF ${f.t.toFixed(2)}s`}
                    />
                  ))}
                <div style={{ position: "absolute", left: `${clamp(playheadPct, 0, 100)}%`, top: 0, bottom: 0, width: "2px", background: "#dff7ff", boxShadow: "0 0 8px rgba(210,248,255,0.8)" }} />
                <div style={{ position: "absolute", right: 8, bottom: 4, fontSize: "0.52rem", color: "rgba(220,240,255,0.62)" }}>
                  {start.toFixed(1)} - {end.toFixed(1)}s
                </div>
              </>
            );
          })()}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "6px" }}>
          <button onClick={addCameraKeyframe} style={{ padding: "6px 8px", borderRadius: "8px", border: "1px solid rgba(170,220,248,0.35)", background: "rgba(170,220,248,0.12)", color: "#dff7ff", fontFamily: "var(--font-family-mono)", fontSize: "0.6rem", cursor: "pointer" }}>Add KF</button>
          <button onClick={clearCameraTrack} style={{ padding: "6px 8px", borderRadius: "8px", border: "1px solid rgba(255,120,120,0.35)", background: "rgba(255,120,120,0.12)", color: "#ffd3d3", fontFamily: "var(--font-family-mono)", fontSize: "0.6rem", cursor: "pointer" }}>Clear</button>
          <button onClick={saveCameraTrack} style={{ padding: "6px 8px", borderRadius: "8px", border: "1px solid rgba(170,220,248,0.35)", background: "rgba(170,220,248,0.12)", color: "#dff7ff", fontFamily: "var(--font-family-mono)", fontSize: "0.6rem", cursor: "pointer" }}>Save</button>
          <button onClick={loadCameraTrack} style={{ padding: "6px 8px", borderRadius: "8px", border: "1px solid rgba(170,220,248,0.35)", background: "rgba(170,220,248,0.12)", color: "#dff7ff", fontFamily: "var(--font-family-mono)", fontSize: "0.6rem", cursor: "pointer" }}>Load</button>
          <button onClick={toggleCameraTrackPlayback} style={{ gridColumn: "1 / span 2", padding: "6px 8px", borderRadius: "8px", border: `1px solid ${cameraTrackPlaying ? "rgba(130,255,180,0.65)" : "rgba(170,220,248,0.35)"}`, background: cameraTrackPlaying ? "rgba(130,255,180,0.16)" : "rgba(170,220,248,0.12)", color: cameraTrackPlaying ? "#cbffe0" : "#dff7ff", fontFamily: "var(--font-family-mono)", fontSize: "0.6rem", cursor: "pointer" }}>{cameraTrackPlaying ? "Stop Track" : "Play Track"}</button>
          {renderMode === "SDF_WORLD" && (
            <button
              onClick={toggleFreecamRecord}
              style={{
                gridColumn: "1 / span 2",
                padding: "6px 8px",
                borderRadius: "8px",
                border: `1px solid ${freecamRecordMode ? "rgba(255,180,120,0.68)" : "rgba(170,220,248,0.35)"}`,
                background: freecamRecordMode ? "rgba(255,180,120,0.16)" : "rgba(170,220,248,0.12)",
                color: freecamRecordMode ? "#ffe3cb" : "#dff7ff",
                fontFamily: "var(--font-family-mono)",
                fontSize: "0.6rem",
                cursor: "pointer",
              }}
            >
              {freecamRecordMode ? "Stop Freecam Rec (Esc)" : "Record Freecam (WASD)"}
            </button>
          )}
        </div>
        <div style={{ fontSize: "0.58rem", color: "rgba(255,255,255,0.5)", fontFamily: "var(--font-family-mono)" }}>
          Keyframes: {cameraTrackFrames.length}
        </div>
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: "8px", fontSize: "0.62rem", fontFamily: "var(--font-family-mono)", color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: "0.1em" }}>
          Color Track
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "6px" }}>
          <input type="color" value={activeGradient.nodeColor} onChange={(e) => setGradient({ nodeColor: e.target.value })} />
          <input type="color" value={activeGradient.antiColor} onChange={(e) => setGradient({ antiColor: e.target.value })} />
          <input type="color" value={activeGradient.transColor} onChange={(e) => setGradient({ transColor: e.target.value })} />
        </div>
        <OverlaySlider label="Brightness" value={activeGradient.brightness} min={0.5} max={2.5} step={0.02} onChange={(v) => setGradient({ brightness: v })} />
        <OverlaySlider label="Gamma" value={activeGradient.gamma} min={0.4} max={1.4} step={0.02} onChange={(v) => setGradient({ gamma: v })} />
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: "8px", fontSize: "0.62rem", fontFamily: "var(--font-family-mono)", color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: "0.1em" }}>
          Export
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "0.6rem", fontFamily: "var(--font-family-mono)", color: "rgba(255,255,255,0.78)" }}>
          <input type="checkbox" checked={exportAlpha} onChange={(e) => setExportAlpha(e.target.checked)} />
          Transparent alpha
        </label>
        <button onClick={exportFramePng} style={{ padding: "6px 8px", borderRadius: "8px", border: "1px solid rgba(170,220,248,0.35)", background: "rgba(170,220,248,0.12)", color: "#dff7ff", fontFamily: "var(--font-family-mono)", fontSize: "0.6rem", cursor: "pointer" }}>
          Export Frame PNG
        </button>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: "6px" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: "2px", fontSize: "0.56rem", color: "rgba(225,248,255,0.72)" }}>
            Width
            <input
              type="number"
              min={256}
              max={7680}
              value={exportWidth}
              onChange={(e) => setExportWidth((prev) => parseIntegerOrKeep(e.target.value, prev, 256, 7680))}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: "2px", fontSize: "0.56rem", color: "rgba(225,248,255,0.72)" }}>
            Height
            <input
              type="number"
              min={256}
              max={4320}
              value={exportHeight}
              onChange={(e) => setExportHeight((prev) => parseIntegerOrKeep(e.target.value, prev, 256, 4320))}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: "2px", fontSize: "0.56rem", color: "rgba(225,248,255,0.72)" }}>
            FPS
            <input
              type="number"
              min={12}
              max={120}
              value={exportFps}
              onChange={(e) => setExportFps((prev) => parseIntegerOrKeep(e.target.value, prev, 12, 120))}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: "2px", fontSize: "0.56rem", color: "rgba(225,248,255,0.72)" }}>
            Duration (s)
            <input
              type="number"
              min={1}
              max={300}
              value={exportDurationSec}
              onChange={(e) => setExportDurationSec((prev) => parseIntegerOrKeep(e.target.value, prev, 1, 300))}
            />
          </label>
        </div>
        <label style={{ display: "flex", flexDirection: "column", gap: "2px", fontSize: "0.56rem", color: "rgba(225,248,255,0.72)" }}>
          Codec
          <select value={exportCodec} onChange={(e) => setExportCodec(e.target.value as "webm-vp9" | "webm-vp8" | "h264-mp4")}>
            <option value="webm-vp9">WEBM VP9</option>
            <option value="webm-vp8">WEBM VP8</option>
            <option value="h264-mp4">H264 MP4</option>
          </select>
        </label>
        <OverlaySlider label="Quality" value={exportQuality} min={0.3} max={1} step={0.01} onChange={setExportQuality} />
        <button
          onClick={exportTrackVideo}
          disabled={exportingVideo}
          style={{
            padding: "6px 8px",
            borderRadius: "8px",
            border: "1px solid rgba(170,220,248,0.35)",
            background: exportingVideo ? "rgba(170,220,248,0.25)" : "rgba(170,220,248,0.12)",
            color: "#dff7ff",
            fontFamily: "var(--font-family-mono)",
            fontSize: "0.6rem",
            cursor: exportingVideo ? "wait" : "pointer",
          }}
        >
          {exportingVideo ? "Exporting..." : "Export Track Video"}
        </button>
      </div>
      )}

      <div style={{ position: "absolute", bottom: "24px", left: "50%", transform: "translateX(-50%)", zIndex: 10 }}>
        <button
          onClick={togglePlayback}
          style={{
            padding: "13px 36px",
            borderRadius: "40px",
            border: `2px solid ${isGenerating ? activeGradient.antiColor : activeGradient.nodeColor}`,
            background: isGenerating ? `${activeGradient.antiColor}1a` : `${activeGradient.nodeColor}1a`,
            color: isGenerating ? activeGradient.antiColor : activeGradient.nodeColor,
            fontFamily: "var(--font-family-mono)",
            fontWeight: 800,
            fontSize: "0.9rem",
            cursor: "pointer",
            letterSpacing: "0.1em",
            boxShadow: isGenerating ? `0 0 24px ${activeGradient.antiColor}55, inset 0 0 12px ${activeGradient.antiColor}22` : "none",
            transition: "all 0.35s cubic-bezier(0.4,0,0.2,1)",
          }}
        >
          {isGenerating ? "■  STOP" : "▶  PLAY"}
        </button>
      </div>

      {audioError && (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            background: "rgba(220,40,40,0.92)",
            color: "#fff",
            fontFamily: "monospace",
            fontSize: "11px",
            padding: "8px 14px",
            zIndex: 30,
          }}
        >
          Audio: {audioError}
        </div>
      )}
    </div>
  );
}
