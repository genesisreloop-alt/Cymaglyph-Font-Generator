"use client";

import { useEffect, useRef } from "react";
import { useTransmitterStore } from "@/store/transmitterStore";
import {
  buildMeasuredPsiAir,
  buildPredictedPsiAir,
  buildHybridPsiAir,
  createSignalContractFrame,
  estimateAirTransfer,
  type MeasurementSnapshot,
} from "@/lib/airFieldElucidation";
import { extractCymaglyphFromPsiAir } from "@/lib/psiAirExtraction";
import { buildAirValidationSnapshot } from "@/lib/airValidation";

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

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

export function AirFieldEngine() {
  const isGenerating = useTransmitterStore((s) => s.isGenerating);
  const setSignalContractFrame = useTransmitterStore((s) => s.setSignalContractFrame);
  const setAirTransferEstimate = useTransmitterStore((s) => s.setAirTransferEstimate);
  const setPsiAirState = useTransmitterStore((s) => s.setPsiAirState);
  const setCymaglyphGeneratedFrame = useTransmitterStore((s) => s.setCymaglyphGeneratedFrame);
  const setAirValidationSnapshot = useTransmitterStore((s) => s.setAirValidationSnapshot);
  const setMicPermissionState = useTransmitterStore((s) => s.setMicPermissionState);
  const micPermissionRequestId = useTransmitterStore((s) => s.micPermissionRequestId);
  const setAudioError = useTransmitterStore((s) => s.setAudioError);
  const renderSource = useTransmitterStore((s) => s.cymaglyphRenderSource);
  const propagationMediumId = useTransmitterStore((s) => s.propagationMediumId);
  const ingestLockActive = useTransmitterStore((s) => s.ingestLockActive);
  const playerSourceType = useTransmitterStore((s) => s.playerSession.sourceType);

  const frameRef = useRef(0);
  const audioBlockRef = useRef(0);
  const intervalRef = useRef<number | null>(null);
  const micCtxRef = useRef<AudioContext | null>(null);
  const micAnalyserRef = useRef<AnalyserNode | null>(null);
  const micDataRef = useRef<Float32Array | null>(null);
  const micFreqRef = useRef<Float32Array | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const previousPsiRef = useRef<ReturnType<typeof buildPredictedPsiAir> | null>(null);

  const isBioplasmaSource =
    renderSource === "BIOPLASMA_ELUCIDATED" ||
    renderSource === "BIOPLASMA_MEASURED" ||
    renderSource === "BIOPLASMA_HYBRID";

  const stopMic = async () => {
    if (intervalRef.current != null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (streamRef.current) {
      for (const tr of streamRef.current.getTracks()) tr.stop();
      streamRef.current = null;
    }
    if (micCtxRef.current) {
      try {
        await micCtxRef.current.close();
      } catch {}
      micCtxRef.current = null;
    }
    micAnalyserRef.current = null;
    micDataRef.current = null;
    micFreqRef.current = null;
  };

  const requiresMicMeasurement =
    renderSource === "AIR_MEASURED" ||
    renderSource === "AIR_HYBRID" ||
    renderSource === "BIOPLASMA_MEASURED" ||
    renderSource === "BIOPLASMA_HYBRID";

  useEffect(() => {
    const lockToIngest =
      ingestLockActive &&
      (playerSourceType === "upload" || playerSourceType === "voice" || playerSourceType === "pcm");
    if (lockToIngest) return;

    if (!isGenerating) {
      setSignalContractFrame(null);
      setAirTransferEstimate(null);
      setPsiAirState(null);
      setAirValidationSnapshot(null);
      stopMic();
      return;
    }

    let canceled = false;
    const start = async () => {
      if (!requiresMicMeasurement) {
        setMicPermissionState("not_required");
      } else {
        if (!navigator.mediaDevices?.getUserMedia) {
          setMicPermissionState("error");
          setAudioError("Microphone capture is unavailable in this browser context.");
        } else {
          setMicPermissionState("prompting");
          try {
            const stream = await navigator.mediaDevices.getUserMedia({
              audio: {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false,
              },
              video: false,
            });
            if (canceled) {
              for (const tr of stream.getTracks()) tr.stop();
              return;
            }
            streamRef.current = stream;
            const micCtx = new AudioContext({ sampleRate: 48000 });
            const source = micCtx.createMediaStreamSource(stream);
            const analyser = micCtx.createAnalyser();
            analyser.fftSize = 1024;
            analyser.smoothingTimeConstant = 0.72;
            source.connect(analyser);
            micCtxRef.current = micCtx;
            micAnalyserRef.current = analyser;
            micDataRef.current = new Float32Array(analyser.fftSize);
            micFreqRef.current = new Float32Array(analyser.frequencyBinCount);
            setMicPermissionState("granted");
            setAudioError(null);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err ?? "Microphone permission failed");
            const isDenied = /NotAllowedError|denied|Permission/i.test(msg);
            setMicPermissionState(isDenied ? "denied" : "error");
            setAudioError(
              isDenied
                ? "Microphone permission was denied. Enable mic access for measured/hybrid capture."
                : `Microphone capture failed: ${msg}`,
            );
          }
        }
      }

      intervalRef.current = window.setInterval(() => {
        const s = useTransmitterStore.getState();
        const source = s.cymaglyphRenderSource;
        const effectiveMediumId =
          source === "BIOPLASMA_ELUCIDATED" ||
          source === "BIOPLASMA_MEASURED" ||
          source === "BIOPLASMA_HYBRID"
            ? "bioplasma"
            : s.propagationMediumId;
        const carrierHz = clamp(parseFreq(s.carrierG3Nen, 14000), 1, 24000);
        const payloadHz = clamp(parseFreq(s.payloadG3Nen, 144), 1, 20000);
        const timeSec = performance.now() * 0.001;
        const frameId = ++frameRef.current;
        const audioBlockId = ++audioBlockRef.current;

        const contract = createSignalContractFrame({
          carrierHz,
          payloadHz,
          amDepth: s.amDepth,
          pmDepth: s.pmDepth,
          resonanceQ: s.resonanceQ,
          timeSec,
          frameId,
          renderFrameId: frameId,
          audioBlockId,
        });
        setSignalContractFrame(contract);

        const transfer = estimateAirTransfer(
          frameId,
          s.audioDiagnostics,
          "circle",
          effectiveMediumId,
        );
        setAirTransferEstimate(transfer);

        let measured: MeasurementSnapshot | null = null;
        const analyser = micAnalyserRef.current;
        const td = micDataRef.current;
        const fd = micFreqRef.current;
        if (analyser && td && fd) {
          analyser.getFloatTimeDomainData(td as unknown as Float32Array<ArrayBuffer>);
          let sumSq = 0;
          for (let i = 0; i < td.length; i += 1) {
            const v = td[i];
            sumSq += v * v;
          }
          const rms = Math.sqrt(sumSq / Math.max(1, td.length));

          analyser.getFloatFrequencyData(fd as unknown as Float32Array<ArrayBuffer>);
          let wSum = 0;
          let magSum = 0;
          for (let i = 0; i < fd.length; i += 1) {
            const hz = (i * 48000) / (2 * fd.length);
            const mag = Math.pow(10, fd[i] / 20);
            wSum += hz * mag;
            magSum += mag;
          }
          const centroid = magSum > 1e-9 ? wSum / magSum : 0;
          measured = {
            rms,
            spectralCentroidHz: centroid,
          };
        }

        const predictedState = buildPredictedPsiAir(contract, transfer, {
          width: 96,
          height: 96,
          boundary: "circle",
        }, effectiveMediumId);
        const measuredState = measured
          ? buildMeasuredPsiAir(contract, transfer, measured, {
              width: 96,
              height: 96,
              boundary: "circle",
            }, effectiveMediumId)
          : null;
        const hybridState = buildHybridPsiAir(contract, transfer, measured, {
          width: 96,
          height: 96,
          boundary: "circle",
        }, effectiveMediumId);

        let psiState = hybridState;
        if (source === "AIR_ELUCIDATED" || source === "BIOPLASMA_ELUCIDATED") psiState = predictedState;
        if ((source === "AIR_MEASURED" || source === "BIOPLASMA_MEASURED") && measuredState) psiState = measuredState;
        if (source === "AIR_HYBRID" || source === "BIOPLASMA_HYBRID") psiState = hybridState;

        setPsiAirState(psiState);

        const validation = buildAirValidationSnapshot(
          frameId,
          predictedState,
          measuredState,
          previousPsiRef.current,
        );
        setAirValidationSnapshot(validation);
        previousPsiRef.current = predictedState;

        if (source !== "DSP_ESTIMATE") {
          const frame = extractCymaglyphFromPsiAir(psiState, contract, 18000);
          if (validation.passed) {
            setCymaglyphGeneratedFrame(frame);
          } else {
            const frozen = useTransmitterStore.getState().lastValidCymaglyphFrame;
            // Validation failed: freeze last valid frame to avoid collapse; if missing, keep constrained psi extraction.
            setCymaglyphGeneratedFrame(frozen ?? frame);
          }
        }
      }, 100);
    };

    start();
    return () => {
      canceled = true;
      stopMic();
    };
  }, [
    isGenerating,
    setSignalContractFrame,
    setAirTransferEstimate,
    setPsiAirState,
    setCymaglyphGeneratedFrame,
    setAirValidationSnapshot,
    setMicPermissionState,
    setAudioError,
    renderSource,
    isBioplasmaSource,
    requiresMicMeasurement,
    micPermissionRequestId,
    ingestLockActive,
    playerSourceType,
    propagationMediumId,
  ]);

  return null;
}
