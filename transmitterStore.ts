"use client";
/**
 * Transmitter Store — Zustand store.
 * Governs: tensor state, oscillation parameters, playback, compendium, traversal programs, messages.
 * ZKP removed — replaced with SHA-256 fingerprint integrity only.
 */

import { create } from "zustand";
import { createIdentityUnifiedTensor, UnifiedTensor } from "@/lib/g3nenTensor";
import { secondsToG3nenTimecode, g3nenTimecodeToHex } from "@/lib/g3pMetrics";
import {
  saveFile,
  getFileHeaders,
  getFolders,
  saveFolder,
  listCompendiumEntryRecords,
  saveCompendiumEntryRecord,
  listCompendiumPreviewCaches,
  saveCompendiumPreviewCache,
  listPlayerSessionRecords,
  savePlayerSessionRecord,
  listIngestArtifactRecords,
  saveIngestArtifactRecord,
  listMeshQualityAuditRecords,
  saveMeshQualityAuditRecord,
  listCompendiumPlaylistRecords,
  saveCompendiumPlaylistRecord,
  listGarmentArchetypeRecords,
  saveGarmentArchetypeRecord,
  listGarmentJobRecords,
  saveGarmentJobRecord,
  listAvatarProfileRecords,
  saveAvatarProfileRecord,
  listGradingRuleRecords,
  saveGradingRuleRecord,
} from "@/lib/indexedDB";
import { G3_COMPENDIUM_SEED } from "@/lib/compendium/g3CompendiumSeed";
import {
  DEFAULT_GARMENT_ARCHETYPES,
  type GarmentArchetypeDefinition,
} from "@/lib/garment/archetypes";
import {
  POPULATION_PRIORS,
  buildDropRatios,
  type AvatarProfile,
  type AvatarMeasurementSchema,
  type AvatarPopulationPrior,
} from "@/lib/garment/avatarSchema";
import {
  DEFAULT_GRADING_PACKS,
  type GradingRulePack,
} from "@/lib/garment/gradingEngine";
import {
  DEFAULT_CYMAGLYPH_GARMENT_MAPPING,
  type CymaglyphGarmentMappingState,
} from "@/lib/garment/cymaglyphMapping";
import type { FaaImageModelFrame } from "@/lib/signing/types";
import { normalizeMediumId } from "@/lib/mediumProfiles";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PhiSudTensor {
  scalar: number;
  vector: [number, number, number];
  bivector: [number, number, number];
  trivector: number;
  grades: number[];
}

export interface GradientConfig {
  nodeColor: string;
  antiColor: string;
  transColor: string;
  brightness: number;
  gamma: number;
}

export interface CompendiumEntry {
  id: string;
  name: string;
  title?: string;
  canonicalLabel?: string;
  sourceType?: "legacy" | "signing_image" | "text_cause";
  category: "Carrier" | "Payload" | "Compound" | "Traversal" | "Message";
  folder: string;
  section?: "fiber_families" | "tactile_receptors" | "proprioceptors" | "supporting_cells" | "resonant_cavities" | string;
  subtype?: string;
  sizeBytes: number;
  sha256?: string;          // integrity fingerprint — ZKP removed
  tensorSnapshot?: PhiSudTensor;
  gradient: GradientConfig;
  description?: string;
  lpgFund?: number;
  lpgValue?: number;
  lpgMin?: number;
  lpgMax?: number;
  harmonics?: number[];
  rhotorseSignature?: string;
  tensorIndex?: string;
  cymaglyphSignature?: string;
  signingSourceDigest?: string;
  signingFaaHash?: string;
  signingMode?: "point_cloud" | "sdf";
  textCauseInput?: string;
  textCauseInputDigest?: string;
  textCauseTomeHash?: string;
  textCauseMappingHash?: string;
  textCauseLedgerHash?: string;
  textCauseTensorBeforeHash?: string;
  textCauseTensorAfterHash?: string;
  textCauseAssertionPassed?: boolean;
  textCauseAssertionMessage?: string;
  renderSource?: CymaglyphRenderSource;
  renderMode?: CymaglyphRenderMode;
  propagationMedium?: PropagationMediumId;
  renderDefaults?: {
    source: CymaglyphRenderSource;
    mode: CymaglyphRenderMode;
    medium: PropagationMediumId;
  };
  schemaVersion?: number;
  updatedAt?: number;
}

export interface OscillationPreset {
  id: string;
  name: string;
  category: "Carrier" | "Payload" | "Compound";
  description: string;
  payloadG3Nen: string;
  carrierG3Nen: string;
  amDepth: number;
  pmDepth: number;
  resonanceQ: number;
  tensorSnapshot: PhiSudTensor;
}

// Traversal step: one move through the FoL graph
export interface TraversalStep {
  fromNodeId?: string | null;
  toNodeId?: string | null;
  direction?: "UP" | "UP_RIGHT" | "DOWN_RIGHT" | "DOWN" | "DOWN_LEFT" | "UP_LEFT";
  oscillationId?: string | null;
  oscillationName?: string;
  g3nenDurationHex?: string;
  carrierFreq: number;
  payloadFreq: number;
  durationTicks: number;
  tensorSnapshot: PhiSudTensor;
}

export interface TraversalProgram {
  id: string;
  name: string;
  steps: TraversalStep[];
  createdAt: number;
  g3nenTimecode: string;
}

// Cymaglyph message package
export interface CymaphMessage {
  id: string;
  senderNote: string;
  cymaglyphSnapshot: PhiSudTensor;
  gradientSnapshot: GradientConfig;
  payloadG3Nen: string;
  carrierG3Nen: string;
  g3nenTimecode: string;
  createdAt: number;
  sha256?: string;
}

export interface AudioDiagnostics {
  contextState: AudioContextState | "none";
  workletReady: boolean;
  ackCount: number;
  debugCount: number;
  updateCount: number;
  peakOutL: number;
  peakOutR: number;
  analyserRms: number;
  lastCarrierHz: number;
  lastPayloadHz: number;
  lastUpdatedMs: number;
}

export interface CymaglyphGeneratedFrame {
  positions: Float32Array;
  colors: Float32Array;
  sizes: Float32Array;
  linePositions?: Float32Array;
  lineColors?: Float32Array;
  zoneCounts: Record<"NODE_EQ" | "ANTINODE_A" | "ANTINODE_B" | "TRANSITION", number>;
  extractionConfidence?: number;
  generatedAt: number;
}

export interface SignalContractFrame {
  frameId: number;
  renderFrameId: number;
  audioBlockId: number;
  timestampMs: number;
  emittedSignalHash: string;
  carrierBase: number;
  payloadMod: number;
  emittedEstimate: number;
  carrierHz: number;
  payloadHz: number;
  amDepth: number;
  pmDepth: number;
  resonanceQ: number;
  inputDigest?: string;
  tomeHash?: string;
  mappingHash?: string;
  eventLedgerHash?: string;
  tensorBeforeHash?: string;
  tensorAfterHash?: string;
}

export interface AirTransferEstimate {
  frameId: number;
  timestampMs: number;
  deviceGain: number;
  damping: number;
  boundaryReflection: number;
  propagationSpeed: number;
  confidence: number;
}

export interface PsiAirState {
  frameId: number;
  timestampMs: number;
  mediumId: PropagationMediumId;
  mode: "predicted" | "measured" | "hybrid";
  width: number;
  height: number;
  psiGrid: Float32Array;
  confidence: number;
  source: "medium-elucidated";
}

export type CymaglyphRenderSource =
  | "FAA_IMAGE_MODEL"
  | "DSP_ESTIMATE"
  | "AIR_ELUCIDATED"
  | "AIR_MEASURED"
  | "AIR_HYBRID"
  | "BIOPLASMA_ELUCIDATED"
  | "BIOPLASMA_MEASURED"
  | "BIOPLASMA_HYBRID";
export type CymaglyphRenderMode =
  | "POINT_CLOUD"
  | "RHOTORSE_FLUID"
  | "SDF_DOMAIN_REPEAT"
  | "SDF_DOMAIN_REPEAT_RHOTORSE"
  | "SDF_WORLD"
  | "SDF_CLOSED_MESH";
export type DomainRepeatLayout = "radial" | "stack";
export type PropagationMediumId =
  | "air"
  | "bioplasma"
  | "blood_plasma"
  | "interstitial_fluid"
  | "lymph"
  | "csf"
  | "endoneurial_fluid"
  | "ionized_plasma";

export interface AirValidationSnapshot {
  frameId: number;
  timestampMs: number;
  spectralError: number;
  fieldCorrelation: number;
  nodalAlignment: number;
  topologyPersistence: number;
  phaseError: number;
  extractionConfidence: number;
  passed: boolean;
}

export interface FAAMeshControlVector {
  // Adaptive extraction resolution decomposition.
  res_base: number;
  res_detail: number;
  res_closure: number;
  res_quality: number;
  res_latency_penalty: number;
  res_final: number;
  // RhoTorse-only closure controls (no Laplacian terms).
  rt_iters: number;
  rt_alpha: number;
  rt_phase_lock: number;
  rt_edge_preserve: number;
  rt_boundary_leak: number;
  rt_tensor_coupling: number;
  rt_curl_weight: number;
  rt_torsion_weight: number;
  rt_divergence_ceiling: number;
  rt_closure_mix: number;
  rt_gate: number;
}

export type MicPermissionState =
  | "unknown"
  | "not_required"
  | "prompting"
  | "granted"
  | "denied"
  | "error";

export interface CompendiumPreviewCacheEntry {
  id: string;
  sourceOscillationId: string;
  renderSource: CymaglyphRenderSource;
  renderMode: CymaglyphRenderMode;
  previewHash: string;
  previewDataUrl?: string;
  updatedAt: number;
}

export interface PlayerSessionState {
  sessionId: string;
  sourceId: string | null;
  sourceType: "compendium" | "upload" | "voice" | "pcm" | "unknown";
  title: string;
  mimeType: string;
  durationMs: number;
  currentTimeMs: number;
  isPlaying: boolean;
  loop: boolean;
  updatedAt: number;
}

export interface VoiceIngestState {
  status: "idle" | "recording" | "processing" | "ready" | "error";
  startedAtMs: number | null;
  endedAtMs: number | null;
  durationMs: number;
  mimeType: string;
  artifactId: string | null;
  errorMessage: string | null;
}

export interface IngestArtifactState {
  id: string;
  sourceType: "upload" | "voice" | "pcm";
  name: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: number;
  contractFrameId: number | null;
}

export interface PlaybackQueueItem {
  id: string;
  sourceId: string;
  title: string;
  durationMs: number;
  g3nenDurationHex?: string;
  renderSource?: CymaglyphRenderSource;
  renderMode?: CymaglyphRenderMode;
  propagationMedium?: PropagationMediumId;
  contractHash?: string | null;
}

export interface CompendiumPlaylistGroup {
  id: string;
  name: string;
  entryIds: string[];
  updatedAt: number;
}

export interface MeshQualityTelemetry {
  id: string;
  frameId: number | null;
  renderMode: CymaglyphRenderMode;
  source: CymaglyphRenderSource;
  nodalAlignment: number;
  fieldCorrelation: number;
  extractionConfidence: number;
  faaMeshRes?: number;
  rhoTorseGate?: number;
  recordedAt: number;
}

export interface AppUiSettings {
  backgroundMode: "solid" | "fol";
  backgroundIntensity: number;
  panelBlurPx: number;
  settingsDrawerOpen: boolean;
  settingsDrawerWidthPx: number;
  settingsDrawerScrollTop: number;
  settingsDrawerSection: string;
}

export interface SigningSaveProgress {
  stage:
    | "idle"
    | "creating_artifact"
    | "writing_compendium_entry"
    | "writing_preview_cache"
    | "refreshing_index"
    | "completed"
    | "error";
  message: string;
  startedAt: number | null;
  updatedAt: number;
  error?: string | null;
}

export interface GarmentDraftJob {
  id: string;
  archetypeId: string;
  avatarProfileId: string;
  gradingPackId: string;
  mappingZone: CymaglyphGarmentMappingState["targetZone"];
  createdAt: number;
  updatedAt: number;
}

// ─── Store State ─────────────────────────────────────────────────────────────

interface TransmitterState {
  // Tensor
  unifiedTensor: UnifiedTensor;
  globalTensorState: PhiSudTensor;

  // Parameters
  payloadG3Nen: string;
  carrierG3Nen: string;
  amDepth: number;
  pmDepth: number;
  resonanceQ: number;

  // Clock
  playbackSeconds: number;
  g3nenTimecode: string;
  isGenerating: boolean;
  audioError: string | null;
  audioDiagnostics: AudioDiagnostics;
  cymaglyphGeneratedFrame: CymaglyphGeneratedFrame | null;
  signalContractFrame: SignalContractFrame | null;
  airTransferEstimate: AirTransferEstimate | null;
  psiAirState: PsiAirState | null;
  cymaglyphRenderSource: CymaglyphRenderSource;
  cymaglyphRenderMode: CymaglyphRenderMode;
  domainRepeatCount: number;
  domainRepeatLayout: DomainRepeatLayout;
  domainRepeatDepthStep: number;
  domainRepeatOscillationCoupling: number;
  domainRepeatRotXDeg: number[];
  domainRepeatRotYDeg: number[];
  domainRepeatRotZDeg: number[];
  domainRepeatLayerOscillationIds: string[];
  propagationMediumId: PropagationMediumId;
  micPermissionState: MicPermissionState;
  micPermissionRequestId: number;
  lastValidCymaglyphFrame: CymaglyphGeneratedFrame | null;
  airValidationSnapshot: AirValidationSnapshot | null;
  faaMeshControlVector: FAAMeshControlVector | null;
  faaImageModelFrame: FaaImageModelFrame | null;
  signingSaveProgress: SigningSaveProgress;

  // Active oscillation
  activeOscillationId: string | null;
  activeIngestSessionId: string | null;
  ingestLockActive: boolean;
  activeGradient: GradientConfig;

  // Compendium
  compendiumEntries: CompendiumEntry[];
  compendiumSchemaVersion: number;
  compendiumPreviewCache: Record<string, CompendiumPreviewCacheEntry>;
  compendiumPlaylists: CompendiumPlaylistGroup[];
  playerSession: PlayerSessionState;
  voiceIngestState: VoiceIngestState;
  ingestArtifacts: Record<string, IngestArtifactState>;
  meshQualityTelemetry: MeshQualityTelemetry[];
  garmentArchetypes: GarmentArchetypeDefinition[];
  selectedGarmentArchetypeId: string | null;
  avatarPopulationPriors: AvatarPopulationPrior[];
  avatarProfiles: AvatarProfile[];
  activeAvatarProfileId: string | null;
  gradingRulePacks: GradingRulePack[];
  activeGradingRulePackId: string | null;
  cymaglyphGarmentMapping: CymaglyphGarmentMappingState;
  garmentDraftJobs: GarmentDraftJob[];
  playbackQueue: PlaybackQueueItem[];
  playbackQueueIndex: number;
  playbackQueueStatus: "idle" | "playing" | "paused";
  activeTab: "compendium" | "generator" | "visualizer" | "traversal" | "send" | "ratio" | "image" | "garment" | "player";
  appUiSettings: AppUiSettings;

  // Traversal
  traversalPrograms: TraversalProgram[];
  activeTraversalId: string | null;
  traversalPlayhead: number; // current step index during playback

  // Messages (send/receive)
  outboxMessages: CymaphMessage[];
  inboxMessages: CymaphMessage[];

  // Live fusion (video+voice)
  liveVideoActive: boolean;
  liveVoiceActive: boolean;

  // Actions
  setParam: (key: string, value: any) => void;
  updatePhiSudTensor: (field: string, partial: Partial<PhiSudTensor>) => void;
  tick: (deltaSeconds: number) => void;
  setActiveTab: (tab: TransmitterState["activeTab"]) => void;
  setIsGenerating: (v: boolean) => void;
  setAudioError: (msg: string | null) => void;
  setAudioDiagnostics: (patch: Partial<AudioDiagnostics>) => void;
  resetAudioDiagnostics: () => void;
  primeAudibleDefaults: () => void;
  setCymaglyphGeneratedFrame: (frame: CymaglyphGeneratedFrame | null) => void;
  setSignalContractFrame: (frame: SignalContractFrame | null) => void;
  setAirTransferEstimate: (estimate: AirTransferEstimate | null) => void;
  setPsiAirState: (state: PsiAirState | null) => void;
  setCymaglyphRenderSource: (source: CymaglyphRenderSource) => void;
  setCymaglyphRenderMode: (mode: CymaglyphRenderMode) => void;
  setCymaglyphRenderProfile: (profile: {
    source: CymaglyphRenderSource;
    mode: CymaglyphRenderMode;
    medium: PropagationMediumId;
  }) => void;
  setDomainRepeatCount: (count: number) => void;
  setDomainRepeatLayout: (layout: DomainRepeatLayout) => void;
  setDomainRepeatDepthStep: (step: number) => void;
  setDomainRepeatOscillationCoupling: (coupling: number) => void;
  setDomainRepeatRotationXDeg: (ringIndex: number, degrees: number) => void;
  setDomainRepeatRotationYDeg: (ringIndex: number, degrees: number) => void;
  setDomainRepeatRotationZDeg: (ringIndex: number, degrees: number) => void;
  setDomainRepeatLayerOscillationId: (ringIndex: number, oscillationId: string | null) => void;
  setPropagationMediumId: (mediumId: PropagationMediumId) => void;
  setMicPermissionState: (state: MicPermissionState) => void;
  requestMicPermission: () => void;
  setLastValidCymaglyphFrame: (frame: CymaglyphGeneratedFrame | null) => void;
  setAirValidationSnapshot: (snapshot: AirValidationSnapshot | null) => void;
  setFAAMeshControlVector: (vector: FAAMeshControlVector | null) => void;
  setFaaImageModelFrame: (frame: FaaImageModelFrame | null) => void;
  setSigningSaveProgress: (progress: Partial<SigningSaveProgress>) => void;
  setActiveOscillation: (id: string | null) => void;
  setIngestLock: (sessionId: string | null, active: boolean) => void;
  setGradient: (g: Partial<GradientConfig>) => void;
  loadPreset: (preset: OscillationPreset) => void;

  // Compendium
  setCompendiumSchemaVersion: (version: number) => void;
  upsertCompendiumPreviewCache: (entry: CompendiumPreviewCacheEntry) => void;
  setCompendiumPlaylists: (groups: CompendiumPlaylistGroup[]) => void;
  createCompendiumPlaylist: (name: string) => Promise<string>;
  renameCompendiumPlaylist: (id: string, name: string) => Promise<void>;
  deleteCompendiumPlaylist: (id: string) => Promise<void>;
  addEntryToPlaylist: (playlistId: string, entryId: string) => Promise<void>;
  removeEntryFromPlaylist: (playlistId: string, entryId: string) => Promise<void>;
  reorderPlaylistEntries: (playlistId: string, fromIndex: number, toIndex: number) => Promise<void>;
  setPlayerSession: (session: Partial<PlayerSessionState>) => void;
  setVoiceIngestState: (patch: Partial<VoiceIngestState>) => void;
  setIngestArtifact: (artifact: IngestArtifactState) => void;
  appendMeshQualityTelemetry: (sample: MeshQualityTelemetry) => void;
  clearMeshQualityTelemetry: () => void;
  setSelectedGarmentArchetypeId: (id: string) => void;
  setActiveAvatarProfileId: (id: string) => void;
  upsertAvatarProfile: (profile: AvatarProfile) => Promise<void>;
  setAvatarMeasurement: (profileId: string, key: keyof AvatarMeasurementSchema, value: number) => void;
  setActiveGradingRulePackId: (id: string) => void;
  setCymaglyphGarmentMapping: (patch: Partial<CymaglyphGarmentMappingState>) => void;
  createGarmentDraftJob: () => Promise<string>;
  loadCompendium: () => Promise<void>;
  saveOscillationToCompendium: (name: string, folder: string) => Promise<string>;
  updateCompendiumEntry: (id: string, patch: Partial<CompendiumEntry>) => Promise<void>;
  selectEntryAndPlay: (entryId: string) => Promise<void>;
  applyEntryRenderProfile: (entry: CompendiumEntry) => void;
  setPlaybackQueue: (items: PlaybackQueueItem[], startIndex?: number) => void;
  setPlaybackQueueIndex: (index: number) => void;
  setPlaybackQueueStatus: (status: "idle" | "playing" | "paused") => void;
  advanceQueueStep: (direction: -1 | 1) => void;
  reorderPlaybackQueue: (fromIndex: number, toIndex: number) => void;
  removePlaybackQueueItem: (index: number) => void;
  clearPlaybackQueue: () => void;
  setAppUiSettings: (patch: Partial<AppUiSettings>) => void;

  // Traversal
  saveTraversalProgram: (program: Omit<TraversalProgram, "id" | "createdAt" | "g3nenTimecode">) => Promise<void>;
  deleteTraversalProgram: (id: string) => void;
  setActiveTraversal: (id: string | null) => void;

  // Messages
  composeMessage: (note: string) => CymaphMessage;
  exportMessageAsGloop: (msg: CymaphMessage) => void;
  importMessageFromGloop: (file: File) => Promise<void>;

  // Live fusion
  setLiveVideoActive: (v: boolean) => void;
  setLiveVoiceActive: (v: boolean) => void;
  applyLiveFusionTensor: (patch: Partial<PhiSudTensor>) => void;
}

// ─── Defaults ────────────────────────────────────────────────────────────────

export const DEFAULT_TENSOR: PhiSudTensor = {
  scalar: 50,
  vector: [0.144, 0.432, 0.072],
  bivector: [0.5, 0.25, 0],
  trivector: 0.618,
  grades: [50, 0.144, 0.432, 0.072, 0.5, 0.25, 0, 0.618, 0, 0, 0, 0, 0, 0, 0],
};

export const DEFAULT_GRADIENT: GradientConfig = {
  nodeColor: "#E0FFFF",
  antiColor: "#80B0C0",
  transColor: "#A0D0E0",
  brightness: 1.45,
  gamma: 0.78,
};

const ALL_FOLDERS = ["Carrier", "Payload", "Compound", "Traversal", "Messages", "root"];
const DEFAULT_AUDIO_DIAGNOSTICS: AudioDiagnostics = {
  contextState: "none",
  workletReady: false,
  ackCount: 0,
  debugCount: 0,
  updateCount: 0,
  peakOutL: 0,
  peakOutR: 0,
  analyserRms: 0,
  lastCarrierHz: 0,
  lastPayloadHz: 0,
  lastUpdatedMs: 0,
};

const DEFAULT_PLAYER_SESSION: PlayerSessionState = {
  sessionId: "player-default",
  sourceId: null,
  sourceType: "unknown",
  title: "No Source",
  mimeType: "audio/wav",
  durationMs: 0,
  currentTimeMs: 0,
  isPlaying: false,
  loop: false,
  updatedAt: Date.now(),
};

const DEFAULT_VOICE_INGEST_STATE: VoiceIngestState = {
  status: "idle",
  startedAtMs: null,
  endedAtMs: null,
  durationMs: 0,
  mimeType: "audio/webm",
  artifactId: null,
  errorMessage: null,
};

const DEFAULT_APP_UI_SETTINGS: AppUiSettings = {
  backgroundMode: "fol",
  backgroundIntensity: 0.72,
  panelBlurPx: 8,
  settingsDrawerOpen: false,
  settingsDrawerWidthPx: 420,
  settingsDrawerScrollTop: 0,
  settingsDrawerSection: "global",
};

const DEFAULT_AVATAR_MEASUREMENTS: AvatarMeasurementSchema = {
  stature: 175,
  neck_circumference: 38,
  chest: 98,
  bust: 96,
  waist: 82,
  high_hip: 90,
  hip: 100,
  shoulder_width: 44,
  arm_length: 63,
  bicep: 32,
  wrist: 17,
  inseam: 80,
  outseam: 105,
  thigh: 58,
  knee: 39,
  calf: 38,
  ankle: 23,
  torso_length: 44,
  rise: 28,
  head_circumference: 57,
};

const DEFAULT_AVATAR_PROFILE: AvatarProfile = {
  id: "avatar-default",
  name: "Default Avatar",
  genderBand: "unisex",
  ageBand: "adult",
  populationPriorId: "global_mixed",
  measurements: { ...DEFAULT_AVATAR_MEASUREMENTS },
  dropRatios: buildDropRatios(DEFAULT_AVATAR_MEASUREMENTS),
  updatedAt: Date.now(),
};

// ─── SHA-256 fingerprint (replaces ZKP) ──────────────────────────────────────
async function sha256hex(text: string): Promise<string> {
  try {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return "0".repeat(64);
  }
}

// ─── Store ───────────────────────────────────────────────────────────────────

export const useTransmitterStore = create<TransmitterState>((set, get) => ({
  unifiedTensor:       createIdentityUnifiedTensor("0x00:00:00:00:00:00:00"),
  globalTensorState:   { ...DEFAULT_TENSOR },
  payloadG3Nen:        "220",
  carrierG3Nen:        "16000",
  amDepth:             18,
  pmDepth:             14,
  resonanceQ:          12,
  playbackSeconds:     0,
  g3nenTimecode:       "0x00:00:00:00:00:00:00",
  isGenerating:        false,
  audioError:          null,
  audioDiagnostics:    { ...DEFAULT_AUDIO_DIAGNOSTICS },
  cymaglyphGeneratedFrame: null,
  signalContractFrame: null,
  airTransferEstimate: null,
  psiAirState: null,
  cymaglyphRenderSource: "DSP_ESTIMATE",
  cymaglyphRenderMode: "POINT_CLOUD",
  domainRepeatCount: 1,
  domainRepeatLayout: "radial",
  domainRepeatDepthStep: 0,
  domainRepeatOscillationCoupling: 0.35,
  domainRepeatRotXDeg: [0, 0, 0, 0, 0, 0, 0, 0, 0],
  domainRepeatRotYDeg: [0, 0, 0, 0, 0, 0, 0, 0, 0],
  domainRepeatRotZDeg: [0, 0, 0, 0, 0, 0, 0, 0, 0],
  domainRepeatLayerOscillationIds: ["", "", "", "", "", "", "", "", ""],
  propagationMediumId: "air",
  micPermissionState: "unknown",
  micPermissionRequestId: 0,
  lastValidCymaglyphFrame: null,
  airValidationSnapshot: null,
  faaMeshControlVector: null,
  faaImageModelFrame: null,
  signingSaveProgress: {
    stage: "idle",
    message: "Idle",
    startedAt: null,
    updatedAt: Date.now(),
    error: null,
  },
  activeOscillationId: null,
  activeIngestSessionId: null,
  ingestLockActive: false,
  activeGradient:      { ...DEFAULT_GRADIENT },
  compendiumEntries:   [],
  compendiumSchemaVersion: 3,
  compendiumPreviewCache: {},
  compendiumPlaylists: [],
  playerSession: { ...DEFAULT_PLAYER_SESSION },
  voiceIngestState: { ...DEFAULT_VOICE_INGEST_STATE },
  ingestArtifacts: {},
  meshQualityTelemetry: [],
  garmentArchetypes: [...DEFAULT_GARMENT_ARCHETYPES],
  selectedGarmentArchetypeId: DEFAULT_GARMENT_ARCHETYPES[0]?.id ?? null,
  avatarPopulationPriors: [...POPULATION_PRIORS],
  avatarProfiles: [{ ...DEFAULT_AVATAR_PROFILE }],
  activeAvatarProfileId: DEFAULT_AVATAR_PROFILE.id,
  gradingRulePacks: [...DEFAULT_GRADING_PACKS],
  activeGradingRulePackId: DEFAULT_GRADING_PACKS[0]?.id ?? null,
  cymaglyphGarmentMapping: { ...DEFAULT_CYMAGLYPH_GARMENT_MAPPING },
  garmentDraftJobs: [],
  playbackQueue: [],
  playbackQueueIndex: 0,
  playbackQueueStatus: "idle",
  activeTab:           "compendium",
  appUiSettings: { ...DEFAULT_APP_UI_SETTINGS },
  traversalPrograms:   [],
  activeTraversalId:   null,
  traversalPlayhead:   0,
  outboxMessages:      [],
  inboxMessages:       [],
  liveVideoActive:     false,
  liveVoiceActive:     false,

  setParam: (key, value) => set((s) => ({ ...s, [key]: value })),

  updatePhiSudTensor: (_, partial) => set((s) => ({
    globalTensorState: { ...s.globalTensorState, ...partial },
  })),

  tick: (delta) => set((s) => {
    if (!s.isGenerating) return s;
    const secs = s.playbackSeconds + delta;
    const tc   = secondsToG3nenTimecode(secs);
    return { playbackSeconds: secs, g3nenTimecode: g3nenTimecodeToHex(tc) };
  }),

  setActiveTab:          (tab) => set({ activeTab: tab }),
  setIsGenerating:       (v)   => set({ isGenerating: v, ...(v ? { audioError: null } : {}) }),
  setAudioError:         (msg) => set({ audioError: msg }),
  setAudioDiagnostics:   (patch) =>
    set((s) => {
      const prev = s.audioDiagnostics;
      let changed = false;
      for (const [key, value] of Object.entries(patch) as [keyof AudioDiagnostics, AudioDiagnostics[keyof AudioDiagnostics]][]) {
        if (prev[key] !== value) {
          changed = true;
          break;
        }
      }
      if (!changed) return s;
      return { audioDiagnostics: { ...prev, ...patch, lastUpdatedMs: Date.now() } };
    }),
  resetAudioDiagnostics: () => set({ audioDiagnostics: { ...DEFAULT_AUDIO_DIAGNOSTICS } }),
  primeAudibleDefaults:  () => set((s) => {
    const carrierText = String(s.carrierG3Nen ?? "").trim();
    const payloadText = String(s.payloadG3Nen ?? "").trim();
    const carrier = Number.parseFloat(carrierText);
    const payload = Number.parseFloat(payloadText);
    const nextCarrier = Number.isFinite(carrier) && carrier > 0 ? carrierText : "14000";
    const nextPayload = Number.isFinite(payload) && payload > 0 ? payloadText : "144";
    const nextAm = Number.isFinite(s.amDepth) ? Math.max(0, Math.min(100, s.amDepth)) : 18;
    const nextPm = Number.isFinite(s.pmDepth) ? Math.max(0, Math.min(100, s.pmDepth)) : 14;
    const nextQ = Number.isFinite(s.resonanceQ) ? Math.max(0.1, Math.min(100, s.resonanceQ)) : 12;
    return {
      carrierG3Nen: nextCarrier,
      payloadG3Nen: nextPayload,
      amDepth: nextAm,
      pmDepth: nextPm,
      resonanceQ: nextQ,
      audioError: null,
    };
  }),
  setCymaglyphGeneratedFrame: (frame) =>
    set((s) => ({
      cymaglyphGeneratedFrame: frame,
      lastValidCymaglyphFrame: frame ?? s.lastValidCymaglyphFrame,
    })),
  setSignalContractFrame: (frame) => set({ signalContractFrame: frame }),
  setAirTransferEstimate: (estimate) => set({ airTransferEstimate: estimate }),
  setPsiAirState: (state) => set({ psiAirState: state }),
  setCymaglyphRenderSource: (source) =>
    set((s) => {
      let nextMedium = normalizeMediumId(s.propagationMediumId);
      if (source.startsWith("AIR_")) nextMedium = "air";
      if (source.startsWith("BIOPLASMA_")) nextMedium = "bioplasma";
      return {
        cymaglyphRenderSource: source,
        propagationMediumId: nextMedium,
      };
    }),
  setCymaglyphRenderMode: (mode) => set({ cymaglyphRenderMode: mode }),
  setCymaglyphRenderProfile: (profile) =>
    set(() => {
      const medium = normalizeMediumId(profile.medium);
      return {
        cymaglyphRenderSource: profile.source,
        cymaglyphRenderMode: profile.mode,
        propagationMediumId: medium,
      };
    }),
  setDomainRepeatCount: (count) => set({ domainRepeatCount: Math.max(1, Math.min(100, Math.round(count))) }),
  setDomainRepeatLayout: (layout) => set({ domainRepeatLayout: layout }),
  setDomainRepeatDepthStep: (step) => set({ domainRepeatDepthStep: Math.max(-8, Math.min(8, step)) }),
  setDomainRepeatOscillationCoupling: (coupling) => set({ domainRepeatOscillationCoupling: Math.max(0, Math.min(1, coupling)) }),
  setDomainRepeatRotationXDeg: (ringIndex, degrees) =>
    set((s) => {
      const clampedIndex = Math.max(0, Math.min(8, Math.round(ringIndex)));
      const next = s.domainRepeatRotXDeg.slice(0, 9);
      while (next.length < 9) next.push(0);
      next[clampedIndex] = degrees;
      return { domainRepeatRotXDeg: next };
    }),
  setDomainRepeatRotationYDeg: (ringIndex, degrees) =>
    set((s) => {
      const clampedIndex = Math.max(0, Math.min(8, Math.round(ringIndex)));
      const next = s.domainRepeatRotYDeg.slice(0, 9);
      while (next.length < 9) next.push(0);
      next[clampedIndex] = degrees;
      return { domainRepeatRotYDeg: next };
    }),
  setDomainRepeatRotationZDeg: (ringIndex, degrees) =>
    set((s) => {
      const clampedIndex = Math.max(0, Math.min(8, Math.round(ringIndex)));
      const next = s.domainRepeatRotZDeg.slice(0, 9);
      while (next.length < 9) next.push(0);
      next[clampedIndex] = degrees;
      return { domainRepeatRotZDeg: next };
    }),
  setDomainRepeatLayerOscillationId: (ringIndex, oscillationId) =>
    set((s) => {
      const clampedIndex = Math.max(0, Math.min(8, Math.round(ringIndex)));
      const next = s.domainRepeatLayerOscillationIds.slice(0, 9);
      while (next.length < 9) next.push("");
      next[clampedIndex] = oscillationId ?? "";
      return { domainRepeatLayerOscillationIds: next };
    }),
  setPropagationMediumId: (mediumId) =>
    set((s) => {
      const normalizedMedium = normalizeMediumId(mediumId);
      let source = s.cymaglyphRenderSource;
      if (normalizedMedium === "air" && source.startsWith("BIOPLASMA_")) {
        source = "AIR_ELUCIDATED";
      }
      if (normalizedMedium === "bioplasma" && source.startsWith("AIR_")) {
        source = "BIOPLASMA_ELUCIDATED";
      }
      return {
        propagationMediumId: normalizedMedium,
        cymaglyphRenderSource: source,
      };
    }),
  setMicPermissionState: (state) => set({ micPermissionState: state }),
  requestMicPermission: () => set((s) => ({ micPermissionRequestId: s.micPermissionRequestId + 1 })),
  setLastValidCymaglyphFrame: (frame) => set({ lastValidCymaglyphFrame: frame }),
  setAirValidationSnapshot: (snapshot) => set({ airValidationSnapshot: snapshot }),
  setFAAMeshControlVector: (vector) => set({ faaMeshControlVector: vector }),
  setFaaImageModelFrame: (frame) => set({ faaImageModelFrame: frame }),
  setSigningSaveProgress: (progress) =>
    set((s) => ({
      signingSaveProgress: {
        ...s.signingSaveProgress,
        ...progress,
        updatedAt: Date.now(),
      },
    })),
  setActiveOscillation:  (id)  => set({ activeOscillationId: id }),
  setIngestLock: (sessionId, active) =>
    set({
      activeIngestSessionId: sessionId,
      ingestLockActive: active,
    }),
  setGradient:           (g)   => set((s) => ({ activeGradient: { ...s.activeGradient, ...g } })),

  loadPreset: (preset) => set({
    payloadG3Nen:        preset.payloadG3Nen,
    carrierG3Nen:        preset.carrierG3Nen,
    amDepth:             preset.amDepth,
    pmDepth:             preset.pmDepth,
    resonanceQ:          preset.resonanceQ,
    globalTensorState:   { ...preset.tensorSnapshot },
    activeOscillationId: preset.id,
  }),

  setCompendiumSchemaVersion: (version) =>
    set({ compendiumSchemaVersion: Math.max(1, Math.floor(version)) }),
  upsertCompendiumPreviewCache: (entry) =>
    set((s) => {
      const next = {
        ...s.compendiumPreviewCache,
        [entry.id]: entry,
      };
      void saveCompendiumPreviewCache(entry.id, entry).catch(() => undefined);
      return { compendiumPreviewCache: next };
    }),
  setCompendiumPlaylists: (groups) => set({ compendiumPlaylists: groups }),
  createCompendiumPlaylist: async (name) => {
    const id = `playlist-${Date.now()}`;
    const group: CompendiumPlaylistGroup = {
      id,
      name: name.trim() || `Playlist ${new Date().toLocaleTimeString()}`,
      entryIds: [],
      updatedAt: Date.now(),
    };
    set((s) => ({ compendiumPlaylists: [...s.compendiumPlaylists, group] }));
    await saveCompendiumPlaylistRecord(id, group);
    return id;
  },
  renameCompendiumPlaylist: async (id, name) => {
    let target: CompendiumPlaylistGroup | null = null;
    set((s) => {
      const next = s.compendiumPlaylists.map((g) => {
        if (g.id !== id) return g;
        target = { ...g, name: name.trim() || g.name, updatedAt: Date.now() };
        return target;
      });
      return { compendiumPlaylists: next };
    });
    if (target) await saveCompendiumPlaylistRecord(id, target);
  },
  deleteCompendiumPlaylist: async (id) => {
    set((s) => ({ compendiumPlaylists: s.compendiumPlaylists.filter((g) => g.id !== id) }));
    await saveCompendiumPlaylistRecord(id, { id, deleted: true, updatedAt: Date.now() });
  },
  addEntryToPlaylist: async (playlistId, entryId) => {
    let target: CompendiumPlaylistGroup | null = null;
    set((s) => {
      const next = s.compendiumPlaylists.map((g) => {
        if (g.id !== playlistId) return g;
        if (g.entryIds.includes(entryId)) {
          target = g;
          return g;
        }
        target = { ...g, entryIds: [...g.entryIds, entryId], updatedAt: Date.now() };
        return target;
      });
      return { compendiumPlaylists: next };
    });
    if (target) await saveCompendiumPlaylistRecord(playlistId, target);
  },
  removeEntryFromPlaylist: async (playlistId, entryId) => {
    let target: CompendiumPlaylistGroup | null = null;
    set((s) => {
      const next = s.compendiumPlaylists.map((g) => {
        if (g.id !== playlistId) return g;
        target = { ...g, entryIds: g.entryIds.filter((id) => id !== entryId), updatedAt: Date.now() };
        return target;
      });
      return { compendiumPlaylists: next };
    });
    if (target) await saveCompendiumPlaylistRecord(playlistId, target);
  },
  reorderPlaylistEntries: async (playlistId, fromIndex, toIndex) => {
    let target: CompendiumPlaylistGroup | null = null;
    set((s) => {
      const next = s.compendiumPlaylists.map((g) => {
        if (g.id !== playlistId) return g;
        const entries = g.entryIds.slice();
        if (fromIndex < 0 || fromIndex >= entries.length || toIndex < 0 || toIndex >= entries.length) {
          target = g;
          return g;
        }
        const [item] = entries.splice(fromIndex, 1);
        entries.splice(toIndex, 0, item);
        target = { ...g, entryIds: entries, updatedAt: Date.now() };
        return target;
      });
      return { compendiumPlaylists: next };
    });
    if (target) await saveCompendiumPlaylistRecord(playlistId, target);
  },
  applyEntryRenderProfile: (entry) =>
    set((s) => {
      const defaults = entry.renderDefaults;
      return {
        cymaglyphRenderSource: defaults?.source ?? entry.renderSource ?? s.cymaglyphRenderSource,
        cymaglyphRenderMode: defaults?.mode ?? entry.renderMode ?? s.cymaglyphRenderMode,
        propagationMediumId: normalizeMediumId(defaults?.medium ?? entry.propagationMedium ?? s.propagationMediumId),
      };
    }),
  selectEntryAndPlay: async (entryId) => {
    const entry = get().compendiumEntries.find((e) => e.id === entryId);
    if (!entry) return;
    get().applyEntryRenderProfile(entry);
    set({
      activeOscillationId: entry.id,
      playerSession: {
        ...get().playerSession,
        sourceId: entry.id,
        sourceType: "compendium",
        title: entry.name,
        mimeType: "application/gloop",
        isPlaying: false,
        updatedAt: Date.now(),
      },
    });
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("g3-compendium-select-entry", { detail: { entryId: entry.id } }));
      window.dispatchEvent(new Event("g3-player-play"));
    }
  },
  setPlaybackQueue: (items, startIndex = 0) =>
    set((s) => {
      const nextIndex = Math.max(0, Math.min(items.length - 1, startIndex));
      const nextItem = items[nextIndex] ?? null;
      if (typeof window !== "undefined" && nextItem) {
        window.dispatchEvent(new CustomEvent("g3-compendium-select-entry", { detail: { entryId: nextItem.sourceId } }));
      }
      return {
        playbackQueue: items,
        playbackQueueIndex: nextIndex,
        playbackQueueStatus: items.length ? "paused" : "idle",
        cymaglyphRenderSource: nextItem?.renderSource ?? s.cymaglyphRenderSource,
        cymaglyphRenderMode: nextItem?.renderMode ?? s.cymaglyphRenderMode,
        propagationMediumId: normalizeMediumId(nextItem?.propagationMedium ?? s.propagationMediumId),
      };
    }),
  setPlaybackQueueIndex: (index) =>
    set((s) => ({
      playbackQueueIndex: Math.max(0, Math.min(s.playbackQueue.length - 1, index)),
    })),
  setPlaybackQueueStatus: (status) => set({ playbackQueueStatus: status }),
  advanceQueueStep: (direction) =>
    set((s) => {
      if (!s.playbackQueue.length) return s;
      const nextIndex = Math.max(0, Math.min(s.playbackQueue.length - 1, s.playbackQueueIndex + direction));
      const nextItem = s.playbackQueue[nextIndex];
      if (typeof window !== "undefined" && nextItem) {
        window.dispatchEvent(new CustomEvent("g3-compendium-select-entry", { detail: { entryId: nextItem.sourceId } }));
        window.dispatchEvent(new Event("g3-player-play"));
      }
      return {
        playbackQueueIndex: nextIndex,
        cymaglyphRenderSource: nextItem?.renderSource ?? s.cymaglyphRenderSource,
        cymaglyphRenderMode: nextItem?.renderMode ?? s.cymaglyphRenderMode,
        propagationMediumId: normalizeMediumId(nextItem?.propagationMedium ?? s.propagationMediumId),
        playerSession: nextItem
          ? {
              ...s.playerSession,
              sourceId: nextItem.sourceId,
              title: nextItem.title,
              durationMs: nextItem.durationMs,
              updatedAt: Date.now(),
            }
          : s.playerSession,
      };
    }),
  reorderPlaybackQueue: (fromIndex, toIndex) =>
    set((s) => {
      if (
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= s.playbackQueue.length ||
        toIndex >= s.playbackQueue.length ||
        fromIndex === toIndex
      ) {
        return s;
      }
      const nextQueue = s.playbackQueue.slice();
      const [item] = nextQueue.splice(fromIndex, 1);
      nextQueue.splice(toIndex, 0, item);
      const nextIndex = Math.max(0, Math.min(nextQueue.length - 1, toIndex));
      return {
        playbackQueue: nextQueue,
        playbackQueueIndex: nextIndex,
      };
    }),
  removePlaybackQueueItem: (index) =>
    set((s) => {
      if (index < 0 || index >= s.playbackQueue.length) return s;
      const nextQueue = s.playbackQueue.filter((_, i) => i !== index);
      const nextIndex = Math.max(0, Math.min(nextQueue.length - 1, s.playbackQueueIndex >= index ? s.playbackQueueIndex - 1 : s.playbackQueueIndex));
      return {
        playbackQueue: nextQueue,
        playbackQueueIndex: nextQueue.length ? nextIndex : 0,
        playbackQueueStatus: nextQueue.length ? s.playbackQueueStatus : "idle",
      };
    }),
  clearPlaybackQueue: () =>
    set({
      playbackQueue: [],
      playbackQueueIndex: 0,
      playbackQueueStatus: "idle",
    }),
  setAppUiSettings: (patch) =>
    set((s) => ({
      appUiSettings: {
        ...s.appUiSettings,
        ...patch,
        backgroundIntensity: Math.max(0, Math.min(1, patch.backgroundIntensity ?? s.appUiSettings.backgroundIntensity)),
        panelBlurPx: Math.max(0, Math.min(24, patch.panelBlurPx ?? s.appUiSettings.panelBlurPx)),
        settingsDrawerWidthPx: Math.max(320, Math.min(720, patch.settingsDrawerWidthPx ?? s.appUiSettings.settingsDrawerWidthPx)),
        settingsDrawerScrollTop: Math.max(0, patch.settingsDrawerScrollTop ?? s.appUiSettings.settingsDrawerScrollTop),
        settingsDrawerSection: patch.settingsDrawerSection ?? s.appUiSettings.settingsDrawerSection,
      },
    })),
  setPlayerSession: (session) =>
    set((s) => {
      const next = {
        ...s.playerSession,
        ...session,
        updatedAt: Date.now(),
      };
      void savePlayerSessionRecord(next.sessionId || "player-default", next).catch(() => undefined);
      return { playerSession: next };
    }),
  setVoiceIngestState: (patch) =>
    set((s) => ({
      voiceIngestState: {
        ...s.voiceIngestState,
        ...patch,
      },
    })),
  setIngestArtifact: (artifact) =>
    set((s) => {
      const next = {
        ...s.ingestArtifacts,
        [artifact.id]: artifact,
      };
      void saveIngestArtifactRecord(artifact.id, artifact).catch(() => undefined);
      return { ingestArtifacts: next };
    }),
  appendMeshQualityTelemetry: (sample) =>
    set((s) => {
      const next = [...s.meshQualityTelemetry, sample].slice(-120);
      void saveMeshQualityAuditRecord(sample.id, sample).catch(() => undefined);
      return { meshQualityTelemetry: next };
    }),
  clearMeshQualityTelemetry: () => set({ meshQualityTelemetry: [] }),
  setSelectedGarmentArchetypeId: (id) => set({ selectedGarmentArchetypeId: id }),
  setActiveAvatarProfileId: (id) => set({ activeAvatarProfileId: id }),
  upsertAvatarProfile: async (profile) => {
    const normalized: AvatarProfile = {
      ...profile,
      dropRatios: buildDropRatios(profile.measurements),
      updatedAt: Date.now(),
    };
    set((s) => {
      const exists = s.avatarProfiles.some((p) => p.id === normalized.id);
      return {
        avatarProfiles: exists
          ? s.avatarProfiles.map((p) => (p.id === normalized.id ? normalized : p))
          : [...s.avatarProfiles, normalized],
      };
    });
    await saveAvatarProfileRecord(normalized.id, normalized);
  },
  setAvatarMeasurement: (profileId, key, value) =>
    set((s) => {
      const nextProfiles = s.avatarProfiles.map((profile) => {
        if (profile.id !== profileId) return profile;
        const measurements = {
          ...profile.measurements,
          [key]: Number.isFinite(value) ? value : profile.measurements[key],
        };
        const next: AvatarProfile = {
          ...profile,
          measurements,
          dropRatios: buildDropRatios(measurements),
          updatedAt: Date.now(),
        };
        void saveAvatarProfileRecord(next.id, next).catch(() => undefined);
        return next;
      });
      return { avatarProfiles: nextProfiles };
    }),
  setActiveGradingRulePackId: (id) => set({ activeGradingRulePackId: id }),
  setCymaglyphGarmentMapping: (patch) =>
    set((s) => ({
      cymaglyphGarmentMapping: {
        ...s.cymaglyphGarmentMapping,
        ...patch,
      },
    })),
  createGarmentDraftJob: async () => {
    const s = get();
    const id = `garment-job-${Date.now()}`;
    const job: GarmentDraftJob = {
      id,
      archetypeId: s.selectedGarmentArchetypeId ?? s.garmentArchetypes[0]?.id ?? "unknown",
      avatarProfileId: s.activeAvatarProfileId ?? s.avatarProfiles[0]?.id ?? "avatar-default",
      gradingPackId: s.activeGradingRulePackId ?? s.gradingRulePacks[0]?.id ?? "grading-default",
      mappingZone: s.cymaglyphGarmentMapping.targetZone,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    set((prev) => ({ garmentDraftJobs: [job, ...prev.garmentDraftJobs].slice(0, 120) }));
    void saveGarmentJobRecord(id, job).catch(() => undefined);
    return id;
  },

  // ── Compendium ─────────────────────────────────────────────────────────────

  loadCompendium: async () => {
    try {
      const headers = await getFileHeaders();
      const folders = await getFolders();
      const existingNames = new Set(
        folders
          .map((f: any) => String(f?.name ?? "").trim().toLowerCase())
          .filter((name: string) => name.length > 0)
      );
      for (const name of ALL_FOLDERS) {
        if (!existingNames.has(name.trim().toLowerCase())) {
          await saveFolder(`folder-${Date.now()}-${name}`, name, null);
        }
      }

      const placeholderSet = new Set([
        "phi-root carrier",
        "menta-alpha carrier",
        "gorkov-pressure carrier",
        "willis-coupling carrier",
        "cymatic sub-payload",
        "phi-pi payload",
        "rhotorse payload",
        "standing wave payload",
        "flower-of-life compound",
        "seed-of-life compound",
        "graneau-jet compound",
        "mach-inertia compound",
      ]);

      const entries: CompendiumEntry[] = headers
        .filter((f: any) => f.name?.endsWith(".gloop"))
        .filter((f: any) => !placeholderSet.has(String(f?.name ?? "").replace(/\.gloop$/i, "").trim().toLowerCase()))
        .map((f: any) => ({
          id:       f.id,
          name:     f.name.replace(".gloop", ""),
          sourceType: "legacy",
          category: (["Carrier","Payload","Compound","Traversal","Message"].includes(f.folder)
                      ? f.folder : "Compound") as CompendiumEntry["category"],
          folder:   f.folder || "root",
          sizeBytes: f.size || 0,
          gradient: { ...DEFAULT_GRADIENT },
          description: "Compendium oscillation entry",
          lpgFund: 0,
          lpgValue: 0,
          lpgMin: 0,
          lpgMax: 0,
          harmonics: [],
          rhotorseSignature: "",
          tensorIndex: "",
          cymaglyphSignature: "",
          renderSource: "DSP_ESTIMATE",
          renderMode: "POINT_CLOUD",
          propagationMedium: "air",
          renderDefaults: {
            source: "DSP_ESTIMATE",
            mode: "POINT_CLOUD",
            medium: "air",
          },
        }));

      const previewRows = await listCompendiumPreviewCaches<CompendiumPreviewCacheEntry>();
      const playerRows = await listPlayerSessionRecords<PlayerSessionState>();
      const ingestRows = await listIngestArtifactRecords<IngestArtifactState>();
      const meshRows = await listMeshQualityAuditRecords<MeshQualityTelemetry>();
      const compendiumRows = await listCompendiumEntryRecords<any>();
      const playlistRows = await listCompendiumPlaylistRecords<CompendiumPlaylistGroup & { deleted?: boolean }>();
      const garmentArchetypeRows = await listGarmentArchetypeRecords<GarmentArchetypeDefinition>();
      const avatarProfileRows = await listAvatarProfileRecords<AvatarProfile>();
      const gradingRuleRows = await listGradingRuleRecords<GradingRulePack>();
      const garmentJobRows = await listGarmentJobRecords<GarmentDraftJob>();

      const previewCache: Record<string, CompendiumPreviewCacheEntry> = {};
      previewRows.forEach((row) => {
        if (row?.payload?.id) previewCache[row.payload.id] = row.payload;
      });

      const persistedEntries = compendiumRows
        .map((row) => row.payload)
        .filter((payload): payload is CompendiumEntry => Boolean(payload?.id && payload?.name));
      const persistedMap = new Map(persistedEntries.map((entry) => [entry.id, entry]));

      const seededEntries = G3_COMPENDIUM_SEED.map((entry) => persistedMap.get(entry.id) ?? entry);
      const mergedFileEntries = entries.map((entry) => persistedMap.get(entry.id) ?? entry);
      const mergedEntries = [...seededEntries, ...mergedFileEntries];

      mergedEntries.forEach((entry) => {
        void saveCompendiumEntryRecord(entry.id, {
          ...entry,
          schemaVersion: 3,
          updatedAt: Date.now(),
        }).catch(() => undefined);
      });

      const ingestArtifacts = ingestRows.reduce<Record<string, IngestArtifactState>>((acc, row) => {
        if (row?.payload?.id) acc[row.payload.id] = row.payload;
        return acc;
      }, {});
      const playlistGroups = playlistRows
        .map((row) => row.payload)
        .filter((payload): payload is CompendiumPlaylistGroup => Boolean(payload?.id && payload?.name && !("deleted" in payload && (payload as any).deleted)));
      const persistedArchetypes = garmentArchetypeRows
        .map((row) => row.payload)
        .filter((payload): payload is GarmentArchetypeDefinition => Boolean(payload?.id && payload?.name));
      const persistedProfiles = avatarProfileRows
        .map((row) => row.payload)
        .filter((payload): payload is AvatarProfile => Boolean(payload?.id && payload?.name));
      const persistedGrading = gradingRuleRows
        .map((row) => row.payload)
        .filter((payload): payload is GradingRulePack => Boolean(payload?.id && payload?.name));

      const garmentArchetypes = persistedArchetypes.length > 0
        ? persistedArchetypes
        : [...DEFAULT_GARMENT_ARCHETYPES];
      const avatarProfiles = persistedProfiles.length > 0
        ? persistedProfiles.map((profile) => ({
          ...profile,
          dropRatios: buildDropRatios(profile.measurements),
        }))
        : [{ ...DEFAULT_AVATAR_PROFILE }];
      const gradingRulePacks = persistedGrading.length > 0
        ? persistedGrading
        : [...DEFAULT_GRADING_PACKS];
      const garmentDraftJobs = garmentJobRows
        .map((row) => row.payload)
        .filter((payload): payload is GarmentDraftJob => Boolean(payload?.id))
        .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0))
        .slice(0, 120);

      if (persistedArchetypes.length === 0) {
        garmentArchetypes.forEach((entry) => {
          void saveGarmentArchetypeRecord(entry.id, entry).catch(() => undefined);
        });
      }
      if (persistedProfiles.length === 0) {
        avatarProfiles.forEach((entry) => {
          void saveAvatarProfileRecord(entry.id, entry).catch(() => undefined);
        });
      }
      if (persistedGrading.length === 0) {
        gradingRulePacks.forEach((entry) => {
          void saveGradingRuleRecord(entry.id, entry).catch(() => undefined);
        });
      }

      set({
        selectedGarmentArchetypeId: garmentArchetypes.some((a) => a.id === get().selectedGarmentArchetypeId)
          ? get().selectedGarmentArchetypeId
          : garmentArchetypes[0]?.id ?? null,
        activeAvatarProfileId: avatarProfiles.some((a) => a.id === get().activeAvatarProfileId)
          ? get().activeAvatarProfileId
          : avatarProfiles[0]?.id ?? DEFAULT_AVATAR_PROFILE.id,
        activeGradingRulePackId: gradingRulePacks.some((g) => g.id === get().activeGradingRulePackId)
          ? get().activeGradingRulePackId
          : gradingRulePacks[0]?.id ?? DEFAULT_GRADING_PACKS[0]?.id ?? null,
        compendiumEntries: mergedEntries,
        compendiumPreviewCache: previewCache,
        compendiumPlaylists: playlistGroups,
        playerSession: playerRows[0]?.payload ?? get().playerSession,
        ingestArtifacts,
        meshQualityTelemetry: meshRows.map((row) => row.payload).filter(Boolean).slice(-120),
        garmentArchetypes,
        avatarProfiles,
        gradingRulePacks,
        garmentDraftJobs,
      });
    } catch (e) {
      console.error("[Compendium] Load failed", e);
    }
  },

  saveOscillationToCompendium: async (name, folder) => {
    const s = get();
    const payload = {
      version: 2,
      type: "oscillation",
      name,
      tensor: s.globalTensorState,
      audio_params: {
        carrierFreq: parseFloat(s.carrierG3Nen) || 14000,
        payloadFreq: parseFloat(s.payloadG3Nen) || 144,
        amDepth:     s.amDepth,
        pmDepth:     s.pmDepth,
        resonanceQ:  s.resonanceQ,
      },
      gradient: s.activeGradient,
      g3nen_timecode: s.g3nenTimecode,
      created: new Date().toISOString(),
    };
    const json = JSON.stringify(payload);
    const fp   = await sha256hex(json);
    const full = JSON.stringify({ ...payload, sha256: fp });
    const blob = new Blob([full], { type: "application/gloop" });
    const recordId = `osc-${Date.now()}`;
    await saveFile(recordId, `${name}.gloop`, blob, "application/gloop", folder);
    const nextEntry: CompendiumEntry = {
      id: recordId,
      name,
      sourceType: "legacy",
      category: (["Carrier", "Payload", "Compound", "Traversal", "Message"].includes(folder) ? folder : "Compound") as CompendiumEntry["category"],
      folder,
      sizeBytes: blob.size,
      sha256: fp,
      tensorSnapshot: s.globalTensorState,
      gradient: s.activeGradient,
      schemaVersion: 3,
      updatedAt: Date.now(),
    };
    await saveCompendiumEntryRecord(recordId, nextEntry);
    set((state) => ({
      compendiumEntries: state.compendiumEntries.some((entry) => entry.id === recordId)
        ? state.compendiumEntries.map((entry) => (entry.id === recordId ? { ...entry, ...nextEntry } : entry))
        : [nextEntry, ...state.compendiumEntries],
    }));
    void get().loadCompendium().catch(() => undefined);
    return recordId;
  },

  updateCompendiumEntry: async (id, patch) => {
    const current = get().compendiumEntries.find((entry) => entry.id === id);
    if (!current) return;
    const next: CompendiumEntry = { ...current, ...patch };
    const cacheId = `entry:${id}`;
    const priorCache = get().compendiumPreviewCache[cacheId];
    const profileChanged =
      patch.renderSource !== undefined ||
      patch.renderMode !== undefined ||
      patch.propagationMedium !== undefined ||
      patch.renderDefaults !== undefined ||
      patch.lpgFund !== undefined ||
      patch.lpgValue !== undefined ||
      patch.lpgMin !== undefined ||
      patch.lpgMax !== undefined;
    set((s) => ({
      compendiumEntries: s.compendiumEntries.map((entry) => (entry.id === id ? next : entry)),
      compendiumPreviewCache:
        profileChanged && priorCache
          ? {
              ...s.compendiumPreviewCache,
              [cacheId]: {
                ...priorCache,
                renderSource: next.renderDefaults?.source ?? next.renderSource ?? priorCache.renderSource,
                renderMode: next.renderDefaults?.mode ?? next.renderMode ?? priorCache.renderMode,
                previewHash: `${priorCache.previewHash.split(":")[0] ?? "refresh"}:${Date.now()}`,
                updatedAt: Date.now(),
              },
            }
          : s.compendiumPreviewCache,
    }));
    if (profileChanged && priorCache) {
      const refreshed = get().compendiumPreviewCache[cacheId];
      if (refreshed) {
        void saveCompendiumPreviewCache(cacheId, refreshed).catch(() => undefined);
      }
    }
    await saveCompendiumEntryRecord(id, {
      ...next,
      schemaVersion: 3,
      updatedAt: Date.now(),
    });
  },

  // ── Traversal Programs ─────────────────────────────────────────────────────

  saveTraversalProgram: async (prog) => {
    const s   = get();
    const id  = `trav-${Date.now()}`;
    const full: TraversalProgram = {
      ...prog,
      id,
      createdAt: Date.now(),
      g3nenTimecode: s.g3nenTimecode,
    };
    const json = JSON.stringify({ version: 2, type: "traversal", ...full });
    const fp   = await sha256hex(json);
    const withHash = JSON.stringify({ version: 2, type: "traversal", ...full, sha256: fp });
    const blob = new Blob([withHash], { type: "application/gloop" });
    await saveFile(id, `${prog.name}.gloop`, blob, "application/gloop", "Traversal");
    set((s2) => ({ traversalPrograms: [...s2.traversalPrograms, full] }));
    await get().loadCompendium();
  },

  deleteTraversalProgram: (id) => set((s) => ({
    traversalPrograms: s.traversalPrograms.filter(p => p.id !== id),
  })),

  setActiveTraversal: (id) => set({ activeTraversalId: id, traversalPlayhead: 0 }),

  // ── Messages ───────────────────────────────────────────────────────────────

  composeMessage: (note) => {
    const s = get();
    const msg: CymaphMessage = {
      id:                `msg-${Date.now()}`,
      senderNote:        note,
      cymaglyphSnapshot: { ...s.globalTensorState },
      gradientSnapshot:  { ...s.activeGradient },
      payloadG3Nen:      s.payloadG3Nen,
      carrierG3Nen:      s.carrierG3Nen,
      g3nenTimecode:     s.g3nenTimecode,
      createdAt:         Date.now(),
    };
    set((s2) => ({ outboxMessages: [...s2.outboxMessages, msg] }));
    return msg;
  },

  exportMessageAsGloop: (msg) => {
    const json = JSON.stringify({ version: 2, type: "message", ...msg });
    const blob = new Blob([json], { type: "application/gloop" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `cymagyph-${msg.id}.gloop`;
    a.click();
    URL.revokeObjectURL(url);
  },

  importMessageFromGloop: async (file) => {
    const text = await file.text();
    const data = JSON.parse(text);
    if (data.type === "message") {
      set((s) => ({ inboxMessages: [...s.inboxMessages, data as CymaphMessage] }));
    } else if (data.type === "oscillation") {
      // Load it as a preset
      const s = get();
      set({
        globalTensorState: data.tensor || s.globalTensorState,
        payloadG3Nen:      String(data.audio_params?.payloadFreq || s.payloadG3Nen),
        carrierG3Nen:      String(data.audio_params?.carrierFreq || s.carrierG3Nen),
        amDepth:           data.audio_params?.amDepth ?? s.amDepth,
        pmDepth:           data.audio_params?.pmDepth ?? s.pmDepth,
        resonanceQ:        data.audio_params?.resonanceQ ?? s.resonanceQ,
        activeGradient:    data.gradient || s.activeGradient,
      });
    }
  },

  // ── Live fusion ────────────────────────────────────────────────────────────

  setLiveVideoActive: (v) => set({ liveVideoActive: v }),
  setLiveVoiceActive: (v) => set({ liveVoiceActive: v }),
  applyLiveFusionTensor: (patch) => set((s) => ({
    globalTensorState: { ...s.globalTensorState, ...patch },
  })),
}));
