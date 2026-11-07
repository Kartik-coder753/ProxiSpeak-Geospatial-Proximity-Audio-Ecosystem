import React, { useEffect, useState, useRef, useId } from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  YAxis,
  XAxis,
} from 'recharts';
import {
  Mic,
  Volume2,
  Volume1,
  VolumeX,
  Activity,
  Radio,
  Sliders,
  RotateCcw,
  Headphones,
  Gauge,
  EyeOff,
} from 'lucide-react';

interface WaveformDataPoint {
  index: number;
  value: number;
}

export interface PeerAudioWaveformProps {
  peerId: string;
  displayName: string;
  analyserNode?: AnalyserNode | null;
  isBlocked?: boolean;
  transmission?: number; // 0.0 to 1.0
  distance?: number;
  themeColor?: string;
  isSpatialAudioEnabled?: boolean;
  playbackVolume?: number; // 0 to 150%, default 100
  isMuted?: boolean;
  onPlaybackVolumeChange?: (volume: number) => void;
  onToggleMute?: () => void;
  isLocalUser?: boolean;
  pan?: number; // -1.0 (hard left) to +1.0 (hard right)
  relativeX?: number; // pixel offset from local user
  isWindowFocused?: boolean;
  isMasterMuted?: boolean;
}

/**
 * Real-time Audio Waveform & Speaking Volume Visualizer
 * Uses Web Audio API AnalyserNode, Recharts, an interactive volume range slider,
 * a stereo panning meter, a real-time vertical peak decibel meter, and automatic window focus muting.
 */
export const PeerAudioWaveform: React.FC<PeerAudioWaveformProps> = ({
  peerId,
  displayName,
  analyserNode,
  isBlocked = false,
  transmission = 1.0,
  distance = 50,
  themeColor = '#10b981',
  isSpatialAudioEnabled = true,
  playbackVolume = 100,
  isMuted = false,
  onPlaybackVolumeChange,
  onToggleMute,
  isLocalUser = false,
  pan,
  relativeX,
  isWindowFocused = true,
  isMasterMuted = false,
}) => {
  const [chartMode, setChartMode] = useState<'wave' | 'spectrum'>('wave');
  const [dataPoints, setDataPoints] = useState<WaveformDataPoint[]>(() =>
    Array.from({ length: 24 }, (_, i) => ({ index: i, value: 50 }))
  );
  const [speakingVolume, setSpeakingVolume] = useState<number>(0);
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);
  const [instantDb, setInstantDb] = useState<number>(-60);
  const [peakHoldDb, setPeakHoldDb] = useState<number>(-60);

  const animationFrameRef = useRef<number | null>(null);
  const lastSampleTimeRef = useRef<number>(0);
  const dataArrayRef = useRef<Uint8Array | null>(null);
  const peakHoldTimeRef = useRef<number>(0);
  const peakHoldDbRef = useRef<number>(-60);

  // Unique SVG gradient IDs to prevent collisions between multiple peers
  const gradientId = useId().replace(/:/g, '');

  // Is audio active considering window focus and master mute for remote peers
  const isAudioActive = isSpatialAudioEnabled && (isLocalUser || (isWindowFocused && !isMasterMuted));

  // Effective volume factor (0.0 to 1.5)
  const effectiveVolumeFactor =
    isMuted || (isMasterMuted && !isLocalUser) || (!isWindowFocused && !isLocalUser) ? 0 : playbackVolume / 100;

  // Calculate current stereo panning (-1.0 for Left to +1.0 for Right)
  const currentPan =
    pan !== undefined
      ? Math.max(-1, Math.min(1, pan))
      : relativeX !== undefined
      ? Math.max(-1, Math.min(1, relativeX / 150))
      : 0;

  // Human-readable pan label
  let panLabel = 'Center';
  if (currentPan < -0.08) {
    panLabel = `${Math.round(Math.abs(currentPan) * 100)}% L`;
  } else if (currentPan > 0.08) {
    panLabel = `${Math.round(currentPan * 100)}% R`;
  }

  // Convert dBFS (-60 to 0 dB, or +3 dB) to height percentage (0% to 100%)
  const meterHeightPercent = Math.max(0, Math.min(100, ((instantDb + 60) / 60) * 100));
  const peakHoldPercent = Math.max(0, Math.min(100, ((peakHoldDb + 60) / 60) * 100));

  // Initialize typed array for Web Audio AnalyserNode
  useEffect(() => {
    if (analyserNode) {
      dataArrayRef.current = new Uint8Array(analyserNode.frequencyBinCount);
    }
  }, [analyserNode]);

  // Real-time animation loop throttled to ~25fps (40ms) for smooth visual updates
  useEffect(() => {
    const sampleAudio = (timestamp: number) => {
      if (timestamp - lastSampleTimeRef.current >= 40) {
        lastSampleTimeRef.current = timestamp;

        if (
          isBlocked ||
          !isAudioActive ||
          (isMuted && !isLocalUser) ||
          (isMasterMuted && !isLocalUser) ||
          (!isWindowFocused && !isLocalUser)
        ) {
          // Flat silent baseline when sound is occluded by wall, muted by user, window is unfocused, master muted, or spatial audio is off
          setDataPoints((prev) =>
            prev.map((pt) => ({ index: pt.index, value: 50 }))
          );
          setSpeakingVolume(0);
          setIsSpeaking(false);
          setInstantDb(-60);
          setPeakHoldDb(-60);
          peakHoldDbRef.current = -60;
        } else if (analyserNode && dataArrayRef.current) {
          const buffer = dataArrayRef.current;
          let maxSamplePeak = 0;

          if (chartMode === 'wave') {
            analyserNode.getByteTimeDomainData(buffer as any);
            const numSamples = 24;
            const step = Math.floor(buffer.length / numSamples) || 1;
            const points: WaveformDataPoint[] = [];

            let sumSquareDiff = 0;
            for (let i = 0; i < numSamples; i++) {
              const raw = buffer[i * step] ?? 128;
              const normalized = (raw - 128) / 128; // -1.0 to 1.0
              const absVal = Math.abs(normalized);
              if (absVal > maxSamplePeak) maxSamplePeak = absVal;

              sumSquareDiff += normalized * normalized;
              // Map to 0-100 scale centered at 50, scaled by transmission, distance, and user volume
              const distanceFactor = Math.max(0, 1 - distance / 110);
              const scaledVal =
                50 +
                normalized *
                  45 *
                  transmission *
                  distanceFactor *
                  effectiveVolumeFactor;
              points.push({
                index: i,
                value: Math.max(5, Math.min(95, Math.round(scaledVal))),
              });
            }

            const rms = Math.sqrt(sumSquareDiff / numSamples);
            const vol = Math.min(
              100,
              Math.round(rms * 100 * 2.5 * transmission * effectiveVolumeFactor)
            );
            setSpeakingVolume(vol);
            setIsSpeaking(vol > 6);
            setDataPoints(points);
          } else {
            // Spectrum frequency mode
            analyserNode.getByteFrequencyData(buffer as any);
            const numBars = 16;
            const step = Math.floor(buffer.length / numBars) || 1;
            const points: WaveformDataPoint[] = [];
            let totalFreq = 0;

            for (let i = 0; i < numBars; i++) {
              const raw = buffer[i * step] ?? 0;
              const normalized = raw / 255;
              if (normalized > maxSamplePeak) maxSamplePeak = normalized;
              totalFreq += raw;

              const distanceFactor = Math.max(0, 1 - distance / 110);
              const barHeight =
                normalized *
                100 *
                transmission *
                distanceFactor *
                effectiveVolumeFactor;
              points.push({ index: i, value: Math.max(4, Math.round(barHeight)) });
            }

            const avgVol = Math.min(
              100,
              Math.round(
                (totalFreq / (numBars * 255)) *
                  100 *
                  transmission *
                  effectiveVolumeFactor
              )
            );
            setSpeakingVolume(avgVol);
            setIsSpeaking(avgVol > 6);
            setDataPoints(points);
          }

          // Compute Instantaneous Peak Decibels (dBFS)
          const distanceFactor = Math.max(0, 1 - distance / 110);
          const effectivePeak = isLocalUser
            ? maxSamplePeak
            : maxSamplePeak * transmission * distanceFactor * effectiveVolumeFactor;

          const calculatedDb =
            effectivePeak > 0.001
              ? Math.max(-60, Math.min(3, 20 * Math.log10(effectivePeak * 1.4)))
              : -60;

          setInstantDb(calculatedDb);

          // Peak Hold with smooth decay
          if (calculatedDb >= peakHoldDbRef.current) {
            peakHoldDbRef.current = calculatedDb;
            peakHoldTimeRef.current = timestamp;
            setPeakHoldDb(calculatedDb);
          } else if (timestamp - peakHoldTimeRef.current > 750) {
            const decayed = Math.max(-60, peakHoldDbRef.current - 2.5);
            peakHoldDbRef.current = decayed;
            setPeakHoldDb(decayed);
          }
        } else {
          // Fallback simulation wave scaled by user playback volume
          const distanceFactor = Math.max(0, 1 - distance / 110);
          const baseVol = Math.round(
            distanceFactor * transmission * 35 * effectiveVolumeFactor
          );
          const points: WaveformDataPoint[] = Array.from({ length: 24 }, (_, i) => {
            const phase = timestamp * 0.008 + i * 0.4;
            const oscVal = Math.sin(phase) * (baseVol * 0.4);
            return { index: i, value: Math.round(50 + oscVal) };
          });
          setSpeakingVolume(baseVol);
          setIsSpeaking(baseVol > 12);
          setDataPoints(points);

          // Simulated decibels
          const simRatio = baseVol / 100;
          const simDb = simRatio > 0.01 ? Math.max(-60, Math.min(0, -48 + simRatio * 46)) : -60;
          setInstantDb(simDb);

          if (simDb >= peakHoldDbRef.current) {
            peakHoldDbRef.current = simDb;
            peakHoldTimeRef.current = timestamp;
            setPeakHoldDb(simDb);
          } else if (timestamp - peakHoldTimeRef.current > 750) {
            const decayed = Math.max(-60, peakHoldDbRef.current - 2.5);
            peakHoldDbRef.current = decayed;
            setPeakHoldDb(decayed);
          }
        }
      }

      animationFrameRef.current = requestAnimationFrame(sampleAudio);
    };

    animationFrameRef.current = requestAnimationFrame(sampleAudio);

    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [
    analyserNode,
    chartMode,
    isBlocked,
    transmission,
    distance,
    isSpatialAudioEnabled,
    effectiveVolumeFactor,
    isMuted,
    isLocalUser,
    isWindowFocused,
    isMasterMuted,
    isAudioActive,
  ]);

  // Dynamic theme colors based on acoustic state
  const waveColor = isBlocked
    ? '#f43f5e' // Rose when wall blocked
    : isMasterMuted && !isLocalUser
    ? '#f43f5e' // Rose when master muted
    : !isWindowFocused && !isLocalUser
    ? '#f59e0b' // Amber when window lost focus
    : isMuted
    ? '#64748b' // Slate when muted by user
    : isSpeaking
    ? themeColor || '#10b981' // Vibrant user theme when speaking
    : '#818cf8'; // Soft indigo when idle

  return (
    <div
      className={`p-3 rounded-xl border transition-all duration-200 ${
        isBlocked
          ? 'bg-rose-950/20 border-rose-500/30'
          : isMasterMuted && !isLocalUser
          ? 'bg-rose-950/15 border-rose-500/30'
          : !isWindowFocused && !isLocalUser
          ? 'bg-amber-950/15 border-amber-500/30'
          : isMuted
          ? 'bg-slate-900/60 border-slate-800/80 opacity-90'
          : isSpeaking
          ? 'bg-slate-900 border-indigo-500/50 shadow-md shadow-indigo-500/5'
          : 'bg-slate-900/90 border-slate-800'
      }`}
    >
      {/* Header Info: User Name, Speaking Status & Mode Selector */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <div
            className={`h-2.5 w-2.5 rounded-full transition-transform ${
              isBlocked
                ? 'bg-rose-500'
                : isMasterMuted && !isLocalUser
                ? 'bg-rose-400'
                : !isWindowFocused && !isLocalUser
                ? 'bg-amber-400'
                : isMuted
                ? 'bg-slate-600'
                : isSpeaking
                ? 'bg-emerald-400 animate-pulse scale-125'
                : 'bg-slate-500'
            }`}
          />
          <span className="font-semibold text-xs text-slate-100 truncate">
            {displayName}
          </span>
          <span className="text-[10px] text-slate-500 font-mono hidden sm:inline">
            ({peerId.replace('user-', '')})
          </span>
        </div>

        {/* Status indicator & Chart View Mode Toggle */}
        <div className="flex items-center gap-1.5 shrink-0">
          <span
            className={`text-[9px] font-mono px-1.5 py-0.5 rounded flex items-center gap-1 ${
              isBlocked
                ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                : isMasterMuted && !isLocalUser
                ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                : !isWindowFocused && !isLocalUser
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                : isMuted
                ? 'bg-slate-800 text-slate-400 border border-slate-700'
                : isSpeaking
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                : 'bg-slate-800 text-slate-400'
            }`}
            title={
              isMasterMuted && !isLocalUser
                ? 'Master Mute is enabled: All incoming peer audio is silenced'
                : !isWindowFocused && !isLocalUser
                ? 'Window is out of focus: spatial audio stream is automatically silenced until you return'
                : undefined
            }
          >
            {isBlocked ? (
              <>
                <VolumeX className="h-2.5 w-2.5" /> Wall Muted
              </>
            ) : isMasterMuted && !isLocalUser ? (
              <>
                <VolumeX className="h-2.5 w-2.5 text-rose-400" /> Master Muted
              </>
            ) : !isWindowFocused && !isLocalUser ? (
              <>
                <EyeOff className="h-2.5 w-2.5 text-amber-400" /> Focus Silenced
              </>
            ) : isMuted ? (
              <>
                <VolumeX className="h-2.5 w-2.5 text-slate-400" /> User Muted
              </>
            ) : isSpeaking ? (
              <>
                <Radio className="h-2.5 w-2.5 animate-pulse text-emerald-400" /> Speaking
              </>
            ) : (
              <>
                <Volume2 className="h-2.5 w-2.5 text-slate-500" /> Silent
              </>
            )}
          </span>

          {/* Toggle button: Wave vs Spectrum */}
          <button
            type="button"
            onClick={() => setChartMode((m) => (m === 'wave' ? 'spectrum' : 'wave'))}
            className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition"
            title="Toggle between Oscilloscope Waveform and Frequency Spectrum"
          >
            {chartMode === 'wave' ? 'Wave' : 'Spectrum'}
          </button>
        </div>
      </div>

      {/* Local Microphone Real-Time Intensity Bar */}
      {isLocalUser && (
        <div className="mb-2 p-1.5 rounded-lg bg-slate-950/60 border border-slate-800/80 flex items-center justify-between text-[10px] font-mono">
          <div className="flex items-center gap-1.5 text-slate-400">
            <Mic className="h-3 w-3 text-indigo-400" />
            <span>Instantaneous Mic Level:</span>
          </div>

          <div className="flex items-center gap-2">
            {/* Small Vertical Decibel Meter */}
            <div
              className="relative w-2.5 h-6 bg-slate-950 rounded-sm border border-slate-800 flex flex-col justify-end overflow-hidden shadow-inner"
              title={`Microphone input: ${instantDb <= -58 ? '-inf' : `${instantDb.toFixed(1)} dBFS`}`}
            >
              {/* Threshold Lines */}
              <div className="absolute inset-x-0 top-[20%] border-t border-rose-500/40 pointer-events-none z-10" />
              <div className="absolute inset-x-0 top-[45%] border-t border-amber-500/30 pointer-events-none z-10" />

              {/* Live level bar */}
              <div
                className={`w-full transition-all duration-75 ${
                  instantDb > -6
                    ? 'bg-rose-500 shadow-sm shadow-rose-500/50'
                    : instantDb > -18
                    ? 'bg-amber-400'
                    : 'bg-indigo-400'
                }`}
                style={{ height: `${meterHeightPercent}%` }}
              />

              {/* Peak Hold Tick */}
              {peakHoldPercent > 5 && (
                <div
                  className="absolute left-0 right-0 h-0.5 bg-indigo-200 z-20"
                  style={{ bottom: `calc(${peakHoldPercent}% - 1px)` }}
                />
              )}
            </div>

            <span
              className={`text-[9px] font-mono tabular-nums font-semibold ${
                instantDb <= -58
                  ? 'text-slate-600'
                  : instantDb > -6
                  ? 'text-rose-400 font-bold'
                  : instantDb > -18
                  ? 'text-amber-400'
                  : 'text-indigo-300'
              }`}
            >
              {instantDb <= -58 ? '-inf' : `${Math.round(instantDb)} dBFS`}
            </span>
          </div>
        </div>
      )}

      {/* Individual Playback Volume Range Slider, Vertical Peak dB Meter & Stereo Panning Meter */}
      {!isLocalUser && onPlaybackVolumeChange && (
        <div className="mb-2 p-2 rounded-lg bg-slate-950/60 border border-slate-800/80">
          {/* Top Label Row: Level & Reset */}
          <div className="flex items-center justify-between text-[10px] text-slate-300 mb-1.5 font-mono">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={onToggleMute}
                title={isMuted ? 'Unmute peer audio' : 'Mute peer audio'}
                className={`p-0.5 rounded transition ${
                  isMuted
                    ? 'text-rose-400 hover:text-rose-300 bg-rose-500/10'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {isMuted ? (
                  <VolumeX className="h-3.5 w-3.5" />
                ) : playbackVolume < 50 ? (
                  <Volume1 className="h-3.5 w-3.5 text-amber-400" />
                ) : (
                  <Volume2 className="h-3.5 w-3.5 text-emerald-400" />
                )}
              </button>
              <span className="font-semibold text-slate-300">Level:</span>
              <span
                className={`font-bold ${
                  !isWindowFocused
                    ? 'text-amber-400'
                    : isMuted
                    ? 'text-rose-400'
                    : playbackVolume > 100
                    ? 'text-amber-400'
                    : playbackVolume > 0
                    ? 'text-emerald-400'
                    : 'text-slate-500'
                }`}
              >
                {!isWindowFocused
                  ? 'Silenced (Unfocused)'
                  : isMuted
                  ? 'Muted'
                  : `${playbackVolume}%`}
                {playbackVolume > 100 && !isMuted && isWindowFocused ? ' (Boost)' : ''}
              </span>
            </div>

            {/* Quick Reset to 100% */}
            {playbackVolume !== 100 && !isMuted && (
              <button
                type="button"
                onClick={() => onPlaybackVolumeChange(100)}
                title="Reset volume to default 100%"
                className="text-[9px] text-slate-500 hover:text-indigo-400 flex items-center gap-0.5 transition"
              >
                <RotateCcw className="h-2.5 w-2.5" /> Reset
              </button>
            )}
          </div>

          {/* Volume Range Slider, Vertical Peak Decibel Meter & Visual Stereo Panning Meter */}
          <div className="flex items-center gap-2">
            {/* Volume Range Slider */}
            <div
              className="flex-1 min-w-0"
              title={`Adjust playback volume: ${isMuted ? 0 : playbackVolume}%`}
            >
              <input
                type="range"
                min="0"
                max="150"
                step="1"
                value={isMuted ? 0 : playbackVolume}
                onChange={(e) => onPlaybackVolumeChange(Number(e.target.value))}
                aria-label={`Playback volume for ${displayName}`}
                className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500 hover:accent-indigo-400 transition block"
              />
            </div>

            {/* Small Vertical Peak Decibel Meter */}
            <div
              className="shrink-0 flex items-center gap-1 bg-slate-900/90 px-1.5 py-0.5 rounded-md border border-slate-800/90"
              title={`Instantaneous Peak: ${
                !isWindowFocused || instantDb <= -58 ? '-inf' : `${instantDb.toFixed(1)} dBFS`
              } (Peak Hold: ${
                !isWindowFocused || peakHoldDb <= -58 ? '-inf' : `${peakHoldDb.toFixed(1)} dBFS`
              })`}
            >
              {/* Vertical LED Bar Container */}
              <div className="relative w-2 h-7 bg-slate-950 rounded-sm border border-slate-800 flex flex-col justify-end overflow-hidden shadow-inner">
                {/* Reference Segment Lines: -6dB (red zone), -18dB (amber zone), -36dB (green zone) */}
                <div className="absolute inset-x-0 top-[15%] border-t border-rose-500/40 pointer-events-none z-10" />
                <div className="absolute inset-x-0 top-[40%] border-t border-amber-500/30 pointer-events-none z-10" />
                <div className="absolute inset-x-0 top-[70%] border-t border-emerald-500/20 pointer-events-none z-10" />

                {/* Dynamic Instantaneous Peak Bar */}
                <div
                  className={`w-full transition-all duration-75 ${
                    isBlocked || !isWindowFocused || (isMuted && !isLocalUser)
                      ? 'bg-slate-700'
                      : instantDb > -6
                      ? 'bg-rose-500 shadow-sm shadow-rose-500/50'
                      : instantDb > -18
                      ? 'bg-amber-400'
                      : 'bg-emerald-400'
                  }`}
                  style={{
                    height: `${meterHeightPercent}%`,
                  }}
                />

                {/* Peak Hold Tick Needle */}
                {peakHoldPercent > 5 &&
                  !isBlocked &&
                  isWindowFocused &&
                  !(isMuted && !isLocalUser) && (
                    <div
                      className={`absolute left-0 right-0 h-0.5 z-20 transition-all duration-100 ${
                        peakHoldDb > -6
                          ? 'bg-rose-300'
                          : peakHoldDb > -18
                          ? 'bg-amber-200'
                          : 'bg-emerald-200'
                      }`}
                      style={{
                        bottom: `calc(${peakHoldPercent}% - 1px)`,
                      }}
                    />
                  )}
              </div>

              {/* dB Numeric Readout */}
              <div className="flex flex-col items-end justify-center">
                <span className="text-[7px] text-slate-500 font-mono leading-none">dBFS</span>
                <span
                  className={`text-[8px] font-mono tabular-nums font-semibold leading-tight ${
                    isBlocked || !isWindowFocused || (isMuted && !isLocalUser) || instantDb <= -58
                      ? 'text-slate-600'
                      : instantDb > -6
                      ? 'text-rose-400 font-bold'
                      : instantDb > -18
                      ? 'text-amber-400'
                      : 'text-emerald-400'
                  }`}
                >
                  {isBlocked || !isWindowFocused || (isMuted && !isLocalUser) || instantDb <= -58
                    ? '-inf'
                    : `${Math.round(instantDb)}`}
                </span>
              </div>
            </div>

            {/* Visual Stereo Panning Meter */}
            <div
              className="shrink-0 flex items-center gap-1.5 bg-slate-900/90 px-2 py-1 rounded-md border border-slate-800/90"
              title={`Stereo Panning: ${panLabel} (horizontal offset: ${Math.round(relativeX ?? 0)}px)`}
            >
              <Headphones className="h-3 w-3 text-slate-400 shrink-0" />

              <span
                className={`text-[8px] font-bold font-mono transition-colors ${
                  currentPan < -0.1 ? 'text-cyan-400' : 'text-slate-600'
                }`}
              >
                L
              </span>

              {/* Horizontal Bidirectional Stereo Gauge Track */}
              <div className="w-11 h-2 bg-slate-950 rounded-full border border-slate-800 relative overflow-hidden flex items-center">
                {/* Center Zero Tick */}
                <div className="absolute left-1/2 top-0 bottom-0 w-0.5 bg-slate-700 -translate-x-1/2 z-0" />

                {/* Left Pan Fill (from center to left) */}
                {currentPan < 0 && (
                  <div
                    className="absolute top-0 bottom-0 bg-cyan-500/80 transition-all duration-75"
                    style={{
                      right: '50%',
                      width: `${Math.min(50, Math.abs(currentPan) * 50)}%`,
                    }}
                  />
                )}

                {/* Right Pan Fill (from center to right) */}
                {currentPan > 0 && (
                  <div
                    className="absolute top-0 bottom-0 bg-indigo-500/80 transition-all duration-75"
                    style={{
                      left: '50%',
                      width: `${Math.min(50, currentPan * 50)}%`,
                    }}
                  />
                )}

                {/* Spatial Indicator Needle Dot */}
                <div
                  className={`absolute top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full shadow-sm transition-all duration-75 z-10 ${
                    Math.abs(currentPan) <= 0.08
                      ? 'bg-emerald-400 ring-1 ring-emerald-400/50'
                      : currentPan < 0
                      ? 'bg-cyan-300 ring-1 ring-cyan-400/50'
                      : 'bg-indigo-300 ring-1 ring-indigo-400/50'
                  }`}
                  style={{
                    left: `calc(${50 + currentPan * 40}% - 3px)`,
                  }}
                />
              </div>

              <span
                className={`text-[8px] font-bold font-mono transition-colors ${
                  currentPan > 0.1 ? 'text-indigo-400' : 'text-slate-600'
                }`}
              >
                R
              </span>

              {/* Text readout */}
              <span className="text-[9px] font-mono font-medium text-slate-300 w-8 text-right tabular-nums">
                {panLabel}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Recharts Real-Time Waveform / Spectrum Visualization */}
      <div className="h-16 w-full rounded-lg bg-slate-950/80 border border-slate-800/80 p-1 relative overflow-hidden">
        {/* Subtle grid lines & center reference */}
        {chartMode === 'wave' && (
          <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 border-t border-slate-800/60 pointer-events-none" />
        )}

        <ResponsiveContainer width="100%" height="100%">
          {chartMode === 'wave' ? (
            <AreaChart data={dataPoints} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
              <defs>
                <linearGradient id={`gradient-${gradientId}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={waveColor} stopOpacity={0.65} />
                  <stop offset="50%" stopColor={waveColor} stopOpacity={0.2} />
                  <stop offset="100%" stopColor={waveColor} stopOpacity={0.0} />
                </linearGradient>
              </defs>
              <YAxis domain={[0, 100]} hide />
              <XAxis dataKey="index" hide />
              <Area
                type="monotone"
                dataKey="value"
                stroke={waveColor}
                strokeWidth={isSpeaking ? 2 : 1.5}
                fill={`url(#gradient-${gradientId})`}
                isAnimationActive={false}
              />
            </AreaChart>
          ) : (
            <BarChart data={dataPoints} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
              <defs>
                <linearGradient id={`bar-gradient-${gradientId}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={waveColor} stopOpacity={0.9} />
                  <stop offset="100%" stopColor={waveColor} stopOpacity={0.2} />
                </linearGradient>
              </defs>
              <YAxis domain={[0, 100]} hide />
              <XAxis dataKey="index" hide />
              <Bar
                dataKey="value"
                fill={`url(#bar-gradient-${gradientId})`}
                radius={[2, 2, 0, 0]}
                isAnimationActive={false}
              />
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>

      {/* Live Speaking Volume & Acoustic Metrics Footer */}
      <div className="mt-2 flex items-center justify-between text-[10px] text-slate-400 font-mono">
        <div className="flex items-center gap-2">
          <span>
            Distance: <strong className="text-slate-200">{Math.round(distance)}px</strong>
          </span>
          <span className="text-slate-600">·</span>
          <span>
            Acoustics:{' '}
            <strong className={isBlocked ? 'text-rose-400' : 'text-slate-200'}>
              {Math.round(transmission * 100)}%
            </strong>
          </span>
          {!isLocalUser && (
            <>
              <span className="text-slate-600">·</span>
              <span>
                Pan: <strong className="text-indigo-300">{panLabel}</strong>
              </span>
            </>
          )}
        </div>

        {/* Volume & Peak Decibel Metric */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            <Gauge className="h-3 w-3 text-slate-500" />
            <span
              className={
                isBlocked || !isWindowFocused || isMuted || instantDb <= -58
                  ? 'text-slate-500'
                  : instantDb > -6
                  ? 'text-rose-400 font-bold'
                  : instantDb > -18
                  ? 'text-amber-400 font-semibold'
                  : 'text-emerald-400 font-semibold'
              }
            >
              {isBlocked || !isWindowFocused || isMuted || instantDb <= -58
                ? '-inf dB'
                : `${Math.round(instantDb)} dBFS`}
            </span>
          </div>

          <span className="text-slate-600">·</span>

          <div className="flex items-center gap-1">
            <Activity className="h-3 w-3 text-slate-500" />
            <strong
              className={
                isBlocked || !isWindowFocused || isMuted
                  ? 'text-slate-500'
                  : speakingVolume > 40
                  ? 'text-emerald-400'
                  : speakingVolume > 10
                  ? 'text-indigo-300'
                  : 'text-slate-500'
              }
            >
              {!isWindowFocused ? 'Unfocused' : isMuted ? '0%' : `${speakingVolume}%`}
            </strong>
          </div>
        </div>
      </div>
    </div>
  );
};
