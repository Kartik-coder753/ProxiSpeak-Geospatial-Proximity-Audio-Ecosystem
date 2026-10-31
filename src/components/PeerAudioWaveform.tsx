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
import { Mic, MicOff, Volume2, VolumeX, Activity, Radio } from 'lucide-react';

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
}

/**
 * Real-time Audio Waveform & Speaking Volume Visualizer
 * Uses Web Audio API AnalyserNode and Recharts for responsive waveform rendering.
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
}) => {
  const [chartMode, setChartMode] = useState<'wave' | 'spectrum'>('wave');
  const [dataPoints, setDataPoints] = useState<WaveformDataPoint[]>(() =>
    Array.from({ length: 24 }, (_, i) => ({ index: i, value: 50 }))
  );
  const [speakingVolume, setSpeakingVolume] = useState<number>(0);
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);
  const animationFrameRef = useRef<number | null>(null);
  const lastSampleTimeRef = useRef<number>(0);
  const dataArrayRef = useRef<Uint8Array | null>(null);

  // Unique SVG gradient IDs to prevent collisions between multiple peers
  const gradientId = useId().replace(/:/g, '');

  // Initialize typed array for Web Audio AnalyserNode
  useEffect(() => {
    if (analyserNode) {
      dataArrayRef.current = new Uint8Array(analyserNode.frequencyBinCount);
    }
  }, [analyserNode]);

  // Real-time animation loop throttled to ~25fps (40ms) for smooth visual updates
  useEffect(() => {
    const sampleAudio = (timestamp: number) => {
      // Throttle to 40ms (~25 updates/sec) to keep chart animations smooth and efficient
      if (timestamp - lastSampleTimeRef.current >= 40) {
        lastSampleTimeRef.current = timestamp;

        if (isBlocked || !isSpatialAudioEnabled) {
          // Flat silent baseline when sound is occluded by wall or spatial audio is off
          setDataPoints((prev) =>
            prev.map((pt) => ({ index: pt.index, value: 50 }))
          );
          setSpeakingVolume(0);
          setIsSpeaking(false);
        } else if (analyserNode && dataArrayRef.current) {
          const buffer = dataArrayRef.current;

          if (chartMode === 'wave') {
            analyserNode.getByteTimeDomainData(buffer as any);
            const numSamples = 24;
            const step = Math.floor(buffer.length / numSamples) || 1;
            const points: WaveformDataPoint[] = [];

            let sumSquareDiff = 0;
            for (let i = 0; i < numSamples; i++) {
              const raw = buffer[i * step] ?? 128;
              const normalized = (raw - 128) / 128; // -1.0 to 1.0
              sumSquareDiff += normalized * normalized;
              // Map to 0-100 scale centered at 50, scaled by transmission & distance factor
              const distanceFactor = Math.max(0, 1 - distance / 110);
              const scaledVal = 50 + normalized * 45 * transmission * distanceFactor;
              points.push({ index: i, value: Math.max(5, Math.min(95, Math.round(scaledVal))) });
            }

            const rms = Math.sqrt(sumSquareDiff / numSamples);
            const vol = Math.min(100, Math.round(rms * 100 * 2.5 * transmission));
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
              totalFreq += raw;
              const distanceFactor = Math.max(0, 1 - distance / 110);
              const barHeight = (raw / 255) * 100 * transmission * distanceFactor;
              points.push({ index: i, value: Math.max(4, Math.round(barHeight)) });
            }

            const avgVol = Math.min(100, Math.round((totalFreq / (numBars * 255)) * 100 * transmission));
            setSpeakingVolume(avgVol);
            setIsSpeaking(avgVol > 6);
            setDataPoints(points);
          }
        } else {
          // Graceful fallback when analyser node is idle (e.g., subtle heartbeat wave)
          const distanceFactor = Math.max(0, 1 - distance / 110);
          const baseVol = Math.round(distanceFactor * transmission * 35);
          const points: WaveformDataPoint[] = Array.from({ length: 24 }, (_, i) => {
            const phase = timestamp * 0.008 + i * 0.4;
            const oscVal = Math.sin(phase) * (baseVol * 0.4);
            return { index: i, value: Math.round(50 + oscVal) };
          });
          setSpeakingVolume(baseVol);
          setIsSpeaking(baseVol > 12);
          setDataPoints(points);
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
  }, [analyserNode, chartMode, isBlocked, transmission, distance, isSpatialAudioEnabled]);

  // Dynamic theme colors based on acoustic state
  const waveColor = isBlocked
    ? '#f43f5e' // Rose when wall blocked
    : isSpeaking
    ? themeColor || '#10b981' // Vibrant user theme when speaking
    : '#818cf8'; // Soft indigo when idle

  return (
    <div
      className={`p-3 rounded-xl border transition-all duration-200 ${
        isBlocked
          ? 'bg-rose-950/20 border-rose-500/30'
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
                : isSpeaking
                ? 'bg-emerald-400 animate-pulse scale-125'
                : 'bg-slate-600'
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
                : isSpeaking
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                : 'bg-slate-800 text-slate-400'
            }`}
          >
            {isBlocked ? (
              <>
                <VolumeX className="h-2.5 w-2.5" /> Wall Muted
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
            Transmission:{' '}
            <strong className={isBlocked ? 'text-rose-400' : 'text-slate-200'}>
              {Math.round(transmission * 100)}%
            </strong>
          </span>
        </div>

        {/* Volume Level Metric */}
        <div className="flex items-center gap-1.5">
          <Activity className="h-3 w-3 text-slate-500" />
          <span>
            Volume:{' '}
            <strong
              className={
                isBlocked
                  ? 'text-rose-400'
                  : speakingVolume > 40
                  ? 'text-emerald-400'
                  : speakingVolume > 10
                  ? 'text-indigo-300'
                  : 'text-slate-500'
              }
            >
              {speakingVolume}%
            </strong>
          </span>
        </div>
      </div>
    </div>
  );
};
