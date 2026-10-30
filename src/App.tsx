import React, { useEffect, useState, useRef, useCallback } from 'react';
import { io as ClientSocket, Socket } from 'socket.io-client';
import {
  ShieldCheck,
  Users,
  Activity,
  ArrowRight,
  LogOut,
  Radio,
  Server as ServerIcon,
  AlertTriangle,
  Move,
  Lock,
  Compass,
  Headphones,
  Zap,
  Layers,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  PhoneCall,
  PhoneOff,
  Building,
  Sliders,
  CheckCircle,
  Bot,
  Sparkles,
  RefreshCw,
  Play,
  Square,
  Maximize2,
  Eye,
  Info,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  Gauge,
} from 'lucide-react';
import { Office, Obstacle, SoundOcclusionResult } from './shared/contracts/office.types';
import {
  AvatarPosition,
  FacingDirection,
  PresenceSnapshot,
  PresenceUser,
  ServerToClientEvents,
  ClientToServerEvents,
} from './shared/contracts/presence.types';
import { User } from './shared/contracts/user.types';
import { ProximityPeer } from './shared/contracts/proximity.interface';
import {
  PeerEligibleEvent,
  PeerIneligibleEvent,
  InboundOfferEvent,
  InboundAnswerEvent,
  InboundIceEvent,
} from './shared/contracts/signaling.interface';
import { GeometryService } from './modules/offices/geometry.service';

type TypedClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

interface DemoAccount {
  user: User;
  token: string;
  simpleToken: string;
}

interface LogEntry {
  id: string;
  timestamp: string;
  type: 'info' | 'success' | 'warn' | 'error';
  message: string;
}

interface PeerConnectionState {
  peerUserId: string;
  negotiationId: string;
  connectionState: RTCPeerConnectionState;
  iceConnectionState: RTCIceConnectionState;
  isOfferer: boolean;
  hasAudio: boolean;
  distance?: number;
  occlusion?: SoundOcclusionResult;
}

interface SimulatedBot {
  userId: string;
  username: string;
  displayName: string;
  token: string;
  roleTitle: string;
  color: string;
  active: boolean;
  patrolActive: boolean;
  position: { x: number; y: number };
  waypoints: Array<{ x: number; y: number }>;
  currentWaypointIndex: number;
}

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

const clientGeometry = new GeometryService();

export default function App() {
  const [healthStatus, setHealthStatus] = useState<{ status: string; uptime: number } | null>(null);
  const [demoAccounts, setDemoAccounts] = useState<DemoAccount[]>([]);
  const [offices, setOffices] = useState<Office[]>([]);
  const [selectedUser, setSelectedUser] = useState<DemoAccount | null>(null);
  const [selectedOfficeId, setSelectedOfficeId] = useState<string>('infotact-office');
  const [departmentFilter, setDepartmentFilter] = useState<string>('all');

  // Connection state
  const [connected, setConnected] = useState(false);
  const [inOffice, setInOffice] = useState(false);
  const [currentOffice, setCurrentOffice] = useState<Office | null>(null);
  const [activeUsers, setActiveUsers] = useState<PresenceUser[]>([]);
  const [myPosition, setMyPosition] = useState<AvatarPosition>({
    x: 200,
    y: 200,
    sequence: 0,
    timestamp: Date.now(),
    facing: 'down',
  });
  const [lastError, setLastError] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);

  // Proximity & Peer Eligibility state (Person 2)
  const [proximityPeers, setProximityPeers] = useState<ProximityPeer[]>([]);
  const [proximityConfig, setProximityConfig] = useState<{
    entryRadius: number;
    exitRadius: number;
    staleTimeoutMs: number;
  }>({
    entryRadius: 100,
    exitRadius: 110,
    staleTimeoutMs: 15000,
  });

  // WebRTC Audio & Signaling State (Person 3)
  const [micActive, setMicActive] = useState(false);
  const [spatialAudioEnabled, setSpatialAudioEnabled] = useState(true);
  const [peerConnections, setPeerConnections] = useState<Record<string, PeerConnectionState>>({});
  const localStreamRef = useRef<MediaStream | null>(null);
  const activePeerConnectionsRef = useRef<
    Map<string, { pc: RTCPeerConnection; negotiationId: string; isPolite: boolean }>
  >(new Map());

  // Web Audio Context for synthesized realistic spatial audio feedback
  const audioCtxRef = useRef<AudioContext | null>(null);
  const peerAudioNodesRef = useRef<
    Map<string, { osc: OscillatorNode; panner: StereoPannerNode; gain: GainNode }>
  >(new Map());

  // Automated simulated multi-peer bots
  const [simBots, setSimBots] = useState<SimulatedBot[]>([
    {
      userId: 'user-bob',
      username: 'bob',
      displayName: 'Bob Martin',
      token: 'token-bob',
      roleTitle: 'Spatial Audio Lead',
      color: '#a855f7',
      active: false,
      patrolActive: false,
      position: { x: 260, y: 240 },
      waypoints: [
        { x: 260, y: 240 },
        { x: 190, y: 210 },
        { x: 740, y: 200 }, // in front of partition
        { x: 860, y: 200 }, // behind soundproof partition!
        { x: 260, y: 240 },
      ],
      currentWaypointIndex: 0,
    },
    {
      userId: 'user-charlie',
      username: 'charlie',
      displayName: 'Charlie Kim',
      token: 'token-charlie',
      roleTitle: 'Staff Designer',
      color: '#ec4899',
      active: false,
      patrolActive: false,
      position: { x: 340, y: 180 },
      waypoints: [
        { x: 340, y: 180 },
        { x: 210, y: 260 },
        { x: 160, y: 480 },
        { x: 340, y: 180 },
      ],
      currentWaypointIndex: 0,
    },
    {
      userId: 'user-elena',
      username: 'elena',
      displayName: 'Elena Rostova',
      token: 'token-elena',
      roleTitle: 'Acoustic ML Scientist',
      color: '#3b82f6',
      active: false,
      patrolActive: false,
      position: { x: 760, y: 160 },
      waypoints: [
        { x: 760, y: 160 },
        { x: 860, y: 260 }, // Behind partition
        { x: 750, y: 350 },
        { x: 760, y: 160 },
      ],
      currentWaypointIndex: 0,
    },
    {
      userId: 'user-dexter',
      username: 'dexter',
      displayName: 'Dexter-9 (Bot)',
      token: 'token-dexter',
      roleTitle: 'Patrol Unit',
      color: '#eab308',
      active: false,
      patrolActive: false,
      position: { x: 200, y: 320 },
      waypoints: [
        { x: 200, y: 320 },
        { x: 280, y: 220 },
        { x: 140, y: 180 },
        { x: 200, y: 320 },
      ],
      currentWaypointIndex: 0,
    },
  ]);

  const botSocketsRef = useRef<Map<string, TypedClientSocket>>(new Map());
  const botPcsRef = useRef<Map<string, RTCPeerConnection>>(new Map());

  const socketRef = useRef<TypedClientSocket | null>(null);
  const sequenceRef = useRef(1);
  const botSequencesRef = useRef<Map<string, number>>(new Map());
  const mapCanvasRef = useRef<HTMLDivElement | null>(null);
  const myPositionRef = useRef(myPosition);
  myPositionRef.current = myPosition;
  const walkTargetRef = useRef<{ x: number; y: number } | null>(null);
  const keysDownRef = useRef<Set<string>>(new Set());

  const addLog = useCallback((type: LogEntry['type'], message: string) => {
    const entry: LogEntry = {
      id: Math.random().toString(36).substring(2, 9),
      timestamp: new Date().toLocaleTimeString(),
      type,
      message,
    };
    setLogs((prev) => [entry, ...prev.slice(0, 59)]);
  }, []);

  // Web Audio spatial sound synthesizer setup
  const initSpatialAudioEngine = useCallback(() => {
    if (!audioCtxRef.current) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        audioCtxRef.current = new AudioCtx();
      }
    }
    if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume();
    }
  }, []);

  // Update spatial audio nodes for peers in earshot
  const updateSpatialAudio = useCallback(
    (peerId: string, distance: number, occlusionTransmission: number, relativeX: number) => {
      if (!spatialAudioEnabled) return;
      initSpatialAudioEngine();
      const ctx = audioCtxRef.current;
      if (!ctx) return;

      let nodes = peerAudioNodesRef.current.get(peerId);
      if (!nodes) {
        try {
          const osc = ctx.createOscillator();
          const panner = ctx.createStereoPanner();
          const gain = ctx.createGain();

          // Subtle melodic tone for each peer
          const hash = peerId.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
          osc.type = 'sine';
          osc.frequency.setValueAtTime(220 + (hash % 12) * 25, ctx.currentTime);

          gain.gain.setValueAtTime(0, ctx.currentTime);

          osc.connect(panner);
          panner.connect(gain);
          gain.connect(ctx.destination);
          osc.start();

          nodes = { osc, panner, gain };
          peerAudioNodesRef.current.set(peerId, nodes);
        } catch {
          return;
        }
      }

      // Distance attenuation (0 to 100px)
      const distanceFactor = Math.max(0, 1 - distance / 110);
      const targetVolume = distanceFactor * occlusionTransmission * 0.12;
      const targetPan = Math.max(-1, Math.min(1, relativeX / 150));

      const now = ctx.currentTime;
      nodes.gain.gain.setTargetAtTime(targetVolume, now, 0.08);
      nodes.panner.pan.setTargetAtTime(targetPan, now, 0.08);
    },
    [spatialAudioEnabled, initSpatialAudioEngine]
  );

  const silencePeerAudio = useCallback((peerId: string) => {
    const nodes = peerAudioNodesRef.current.get(peerId);
    if (nodes && audioCtxRef.current) {
      nodes.gain.gain.setTargetAtTime(0, audioCtxRef.current.currentTime, 0.05);
    }
  }, []);

  // Initialize synthetic or microphone audio track
  const toggleMicrophone = async () => {
    initSpatialAudioEngine();
    if (micActive) {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((t) => t.stop());
        localStreamRef.current = null;
      }
      setMicActive(false);
      addLog('warn', 'Microphone muted.');
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        localStreamRef.current = stream;
        setMicActive(true);
        addLog('success', 'Microphone stream captured successfully.');

        const audioTrack = stream.getAudioTracks()[0];
        activePeerConnectionsRef.current.forEach(({ pc }) => {
          pc.getSenders().forEach((s) => {
            if (s.track?.kind === 'audio') {
              s.replaceTrack(audioTrack);
            }
          });
        });
      } catch (err) {
        try {
          const audioCtx =
            audioCtxRef.current ||
            new (window.AudioContext ||
              (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
          audioCtxRef.current = audioCtx;
          const osc = audioCtx.createOscillator();
          const dst = audioCtx.createMediaStreamDestination();
          osc.connect(dst);
          osc.start();
          localStreamRef.current = dst.stream;
          setMicActive(true);
          addLog('info', 'Microphone not granted: initialized clean synthetic audio track for WebRTC.');
        } catch {
          addLog('error', `Failed to initialize audio: ${(err as Error).message}`);
        }
      }
    }
  };

  // Fetch initial system state and office layout
  const refreshOfficeLayout = useCallback(async (officeId: string) => {
    try {
      const res = await fetch(`/api/offices/${officeId}/layout`);
      if (res.ok) {
        const layout = await res.json();
        setCurrentOffice((prev) => (prev ? { ...prev, ...layout } : layout));
      }
    } catch {
      // fallback
    }
  }, []);

  useEffect(() => {
    const fetchSystemInfo = async () => {
      try {
        const healthRes = await fetch('/health');
        if (healthRes.ok) {
          const h = await healthRes.json();
          setHealthStatus(h);
        }

        const officesRes = await fetch('/api/offices');
        if (officesRes.ok) {
          const o = await officesRes.json();
          setOffices(o);
          if (!currentOffice && o.length > 0) {
            const initial = o.find((item: Office) => item.id === selectedOfficeId) || o[0];
            setCurrentOffice(initial);
          }
        }

        const usersRes = await fetch('/api/auth/demo-users');
        if (usersRes.ok) {
          const u: DemoAccount[] = await usersRes.json();
          setDemoAccounts(u);
          if (u.length > 0 && !selectedUser) {
            setSelectedUser(u[0]); // Default to Alice
          }
        }

        const configRes = await fetch('/api/proximity/config');
        if (configRes.ok) {
          const c = await configRes.json();
          if (c.entryRadius) setProximityConfig(c);
        }
      } catch (err) {
        console.error('Failed to query backend info:', err);
      }
    };

    fetchSystemInfo();
    const interval = setInterval(fetchSystemInfo, 6000);
    return () => clearInterval(interval);
  }, [currentOffice, selectedOfficeId, selectedUser]);

  // Permanent Continuous Spatial Audio Engine:
  // Evaluates real-time proximity directly from coordinates on every step so audio NEVER stops
  useEffect(() => {
    if (!spatialAudioEnabled || !inOffice || !currentOffice || !selectedUser) {
      peerAudioNodesRef.current.forEach((node) => {
        if (audioCtxRef.current) {
          node.gain.gain.setValueAtTime(0, audioCtxRef.current.currentTime);
        }
      });
      return;
    }

    initSpatialAudioEngine();

    const otherUsers = activeUsers.filter((u) => u.userId !== selectedUser.user.id);
    const activePeersList: ProximityPeer[] = [];
    const audiblePeerIds = new Set<string>();

    otherUsers.forEach((remoteUser) => {
      const dist = Math.hypot(remoteUser.position.x - myPosition.x, remoteUser.position.y - myPosition.y);
      const exitLimit = proximityConfig.exitRadius || 110;

      if (dist <= exitLimit) {
        audiblePeerIds.add(remoteUser.userId);
        activePeersList.push({
          userId: remoteUser.userId,
          distance: Math.round(dist * 10) / 10,
        });

        const occlusion = clientGeometry.checkSoundObstruction(
          { x: myPosition.x, y: myPosition.y },
          { x: remoteUser.position.x, y: remoteUser.position.y },
          currentOffice.obstacles
        );

        // Update permanent audio with continuous distance attenuation & occlusion
        updateSpatialAudio(
          remoteUser.userId,
          dist,
          occlusion.totalTransmission,
          remoteUser.position.x - myPosition.x
        );
      }
    });

    // Update proximity peers state so UI meters and cards reflect immediately
    setProximityPeers(activePeersList);

    // Silence peers that moved out of earshot
    peerAudioNodesRef.current.forEach((_val, peerId) => {
      if (!audiblePeerIds.has(peerId)) {
        silencePeerAudio(peerId);
      }
    });
  }, [
    myPosition,
    activeUsers,
    inOffice,
    currentOffice,
    selectedUser,
    spatialAudioEnabled,
    proximityConfig,
    updateSpatialAudio,
    silencePeerAudio,
    initSpatialAudioEngine,
  ]);

  // Keep-Alive Heartbeat: Pings backend every 3 seconds so user presence & sound never expire
  useEffect(() => {
    if (!connected || !inOffice || !socketRef.current) return;

    const pingTimer = setInterval(() => {
      socketRef.current?.emit('presence:ping');
    }, 3000);

    return () => clearInterval(pingTimer);
  }, [connected, inOffice]);

  // Simulated Bots Keep-Alive Heartbeat: Keeps spawned bots permanently fresh and audible
  useEffect(() => {
    const botPingTimer = setInterval(() => {
      simBots.forEach((bot) => {
        if (bot.active) {
          const sock = botSocketsRef.current.get(bot.userId);
          sock?.emit('presence:ping');
        }
      });
    }, 3000);

    return () => clearInterval(botPingTimer);
  }, [simBots]);

  // Cleanup helper for WebRTC peer connection
  const closePeerConnection = useCallback(
    (peerUserId: string, reason: string) => {
      const existing = activePeerConnectionsRef.current.get(peerUserId);
      if (existing) {
        existing.pc.close();
        activePeerConnectionsRef.current.delete(peerUserId);
        setPeerConnections((prev) => {
          const next = { ...prev };
          delete next[peerUserId];
          return next;
        });
        silencePeerAudio(peerUserId);
        addLog('warn', `WebRTC peer connection closed with ${peerUserId} (${reason})`);
      }
    },
    [addLog, silencePeerAudio]
  );

  // Connect or switch active socket
  const handleConnect = useCallback(
    (account: DemoAccount) => {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }

      activePeerConnectionsRef.current.forEach(({ pc }) => pc.close());
      activePeerConnectionsRef.current.clear();
      setPeerConnections({});

      addLog('info', `Connecting socket as ${account.user.displayName} (${account.simpleToken})...`);

      const s: TypedClientSocket = ClientSocket({
        auth: { token: account.simpleToken },
        transports: ['websocket', 'polling'],
      });

      s.on('connect', () => {
        setConnected(true);
        setLastError(null);
        addLog('success', `Socket connected [id: ${s.id}] for ${account.user.displayName}`);
      });

      s.on('connect_error', (err) => {
        setConnected(false);
        setLastError(err.message);
        addLog('error', `Connection error: ${err.message}`);
      });

      s.on('disconnect', () => {
        setConnected(false);
        setInOffice(false);
        activePeerConnectionsRef.current.forEach(({ pc }) => pc.close());
        activePeerConnectionsRef.current.clear();
        setPeerConnections({});
        addLog('warn', 'Socket disconnected');
      });

      s.on('presence:joined', (data) => {
        addLog(
          'info',
          `Member joined office: ${data.member.user.displayName} at (${data.member.position.x}, ${data.member.position.y})`
        );
        setActiveUsers((prev) => {
          const filtered = prev.filter((p) => p.userId !== data.member.userId);
          return [...filtered, data.member];
        });
      });

      s.on('presence:left', (data) => {
        addLog('warn', `User left office: ${data.userId} (${data.reason || 'left'})`);
        setActiveUsers((prev) => prev.filter((p) => p.userId !== data.userId));
        closePeerConnection(data.userId, 'user left office');
      });

      s.on('avatar:moved', (data) => {
        setActiveUsers((prev) =>
          prev.map((u) => (u.userId === data.userId ? { ...u, position: data.position } : u))
        );
      });

      s.on('proximity:update' as any, (data: any) => {
        if (data && Array.isArray(data.peers)) {
          setProximityPeers(data.peers);
        }
      });

      s.on('avatar:move_rejected', (data) => {
        addLog('error', `Movement rejected: ${data.reason} (${data.code})`);
        setMyPosition(data.currentPosition);
      });

      // Office layout update event (Person 4)
      s.on('office:layout_updated' as any, (data: any) => {
        addLog(
          'info',
          `[Office Layout Updated] New version #${data.layout.layoutVersion} broadcast received.`
        );
        setCurrentOffice((prev) => (prev ? { ...prev, ...data.layout } : data.layout));
      });

      // WebRTC Signaling Handlers (Person 3)
      s.on('signal:peer_eligible', async (data: PeerEligibleEvent) => {
        addLog(
          'info',
          `[WebRTC Signaling] Peer eligible: ${data.peerUserId} (negId: ${data.negotiationId.slice(-8)}, initiate: ${data.shouldInitiate}, polite: ${data.isPolite})`
        );

        const pc = new RTCPeerConnection(RTC_CONFIG);
        activePeerConnectionsRef.current.set(data.peerUserId, {
          pc,
          negotiationId: data.negotiationId,
          isPolite: data.isPolite,
        });

        setPeerConnections((prev) => ({
          ...prev,
          [data.peerUserId]: {
            peerUserId: data.peerUserId,
            negotiationId: data.negotiationId,
            connectionState: pc.connectionState,
            iceConnectionState: pc.iceConnectionState,
            isOfferer: data.shouldInitiate,
            hasAudio: false,
          },
        }));

        if (localStreamRef.current) {
          localStreamRef.current
            .getTracks()
            .forEach((track) => pc.addTrack(track, localStreamRef.current!));
        }

        pc.ontrack = (event) => {
          addLog('success', `Received audio stream from peer ${data.peerUserId}`);
          const remoteAudio = new Audio();
          remoteAudio.srcObject = event.streams[0];
          remoteAudio.play().catch(() => {});
          setPeerConnections((prev) => ({
            ...prev,
            [data.peerUserId]: { ...prev[data.peerUserId], hasAudio: true },
          }));
        };

        pc.onicecandidate = (event) => {
          if (event.candidate) {
            s.emit('signal:ice', {
              targetUserId: data.peerUserId,
              negotiationId: data.negotiationId,
              candidate: event.candidate.toJSON(),
            });
          }
        };

        pc.onconnectionstatechange = () => {
          setPeerConnections((prev) => {
            if (!prev[data.peerUserId]) return prev;
            return {
              ...prev,
              [data.peerUserId]: {
                ...prev[data.peerUserId],
                connectionState: pc.connectionState,
                iceConnectionState: pc.iceConnectionState,
              },
            };
          });
        };

        if (data.shouldInitiate) {
          try {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            s.emit(
              'signal:offer',
              {
                targetUserId: data.peerUserId,
                negotiationId: data.negotiationId,
                sdp: { type: offer.type, sdp: offer.sdp },
              },
              (res) => {
                if (!res.success) {
                  addLog('error', `Failed to send offer to ${data.peerUserId}: ${res.error}`);
                } else {
                  addLog('info', `Sent SDP offer to ${data.peerUserId}`);
                }
              }
            );
          } catch (err) {
            addLog('error', `Error creating offer: ${(err as Error).message}`);
          }
        }
      });

      s.on('signal:offer', async (data: InboundOfferEvent) => {
        addLog('info', `[WebRTC Signaling] Received SDP offer from ${data.senderUserId}`);
        let entry = activePeerConnectionsRef.current.get(data.senderUserId);

        if (!entry) {
          const pc = new RTCPeerConnection(RTC_CONFIG);
          entry = { pc, negotiationId: data.negotiationId, isPolite: data.isPolite };
          activePeerConnectionsRef.current.set(data.senderUserId, entry);
        }

        const { pc } = entry;

        try {
          if (pc.signalingState !== 'stable') {
            if (data.isPolite) {
              await pc.setLocalDescription({ type: 'rollback' });
            } else {
              addLog('warn', `Offer collision: impolite peer maintaining state`);
            }
          }

          await pc.setRemoteDescription(
            new RTCSessionDescription(data.sdp as RTCSessionDescriptionInit)
          );
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);

          s.emit(
            'signal:answer',
            {
              targetUserId: data.senderUserId,
              negotiationId: data.negotiationId,
              sdp: { type: answer.type, sdp: answer.sdp },
            },
            (res) => {
              if (!res.success) {
                addLog('error', `Failed to send answer to ${data.senderUserId}: ${res.error}`);
              } else {
                addLog('info', `Sent SDP answer to ${data.senderUserId}`);
              }
            }
          );
        } catch (err) {
          addLog(
            'error',
            `Error processing offer from ${data.senderUserId}: ${(err as Error).message}`
          );
        }
      });

      s.on('signal:answer', async (data: InboundAnswerEvent) => {
        addLog('info', `[WebRTC Signaling] Received SDP answer from ${data.senderUserId}`);
        const entry = activePeerConnectionsRef.current.get(data.senderUserId);
        if (entry) {
          try {
            await entry.pc.setRemoteDescription(
              new RTCSessionDescription(data.sdp as RTCSessionDescriptionInit)
            );
            addLog('success', `Established signaling session with ${data.senderUserId}`);
          } catch (err) {
            addLog('error', `Error setting remote answer: ${(err as Error).message}`);
          }
        }
      });

      s.on('signal:ice', async (data: InboundIceEvent) => {
        const entry = activePeerConnectionsRef.current.get(data.senderUserId);
        if (entry) {
          try {
            await entry.pc.addIceCandidate(
              new RTCIceCandidate(data.candidate as RTCIceCandidateInit)
            );
          } catch {
            // ignore
          }
        }
      });

      s.on('signal:peer_ineligible', (data: PeerIneligibleEvent) => {
        closePeerConnection(data.peerUserId, data.reason);
      });

      socketRef.current = s;
    },
    [addLog, closePeerConnection]
  );

  // Join designated office
  const handleJoinOffice = useCallback(
    (officeId: string) => {
      if (!socketRef.current || !connected) {
        addLog('warn', 'Socket not connected. Connect user first.');
        return;
      }

      refreshOfficeLayout(officeId);
      addLog('info', `Requesting entry to office '${officeId}'...`);

      socketRef.current.emit(
        'office:join',
        { officeId },
        (response: {
          success: boolean;
          error?: string;
          code?: string;
          snapshot?: PresenceSnapshot;
        }) => {
          if (!response.success) {
            setLastError(response.error || 'Failed to enter office');
            addLog('error', `Access Denied: ${response.error} [${response.code}]`);
            return;
          }

          setInOffice(true);
          setLastError(null);
          addLog(
            'success',
            `Joined office '${officeId}'. Initial snapshot received (${response.snapshot?.members.length ?? 0} active).`
          );

          if (response.snapshot) {
            setActiveUsers(response.snapshot.members);
            const self = response.snapshot.members.find(
              (m) => m.userId === selectedUser?.user.id
            );
            if (self) {
              setMyPosition(self.position);
              sequenceRef.current = self.position.sequence + 1;
            }
          }
        }
      );
    },
    [connected, refreshOfficeLayout, selectedUser, addLog]
  );

  const handleLeaveOffice = useCallback(() => {
    if (!socketRef.current || !selectedOfficeId) return;
    socketRef.current.emit('office:leave', { officeId: selectedOfficeId }, () => {
      setInOffice(false);
      walkTargetRef.current = null;
      setActiveUsers([]);
      setProximityPeers([]);
      peerAudioNodesRef.current.forEach((node) => {
        if (audioCtxRef.current) {
          node.gain.gain.setValueAtTime(0, audioCtxRef.current.currentTime);
        }
      });
      activePeerConnectionsRef.current.forEach(({ pc }) => pc.close());
      activePeerConnectionsRef.current.clear();
      setPeerConnections({});
      addLog('info', `Left office ${selectedOfficeId}`);
    });
  }, [selectedOfficeId, addLog]);

  // Send movement update with instant optimistic avatar synchronization
  const sendMove = useCallback(
    (targetX: number, targetY: number, label?: string) => {
      if (!socketRef.current || !inOffice || !selectedUser) return;

      const nextSeq = sequenceRef.current++;
      const now = Date.now();

      // OPTIMISTIC UPDATE: Sync myPosition and activeUsers immediately so avatar & circle move in lockstep
      const optimisticPos: AvatarPosition = {
        x: targetX,
        y: targetY,
        sequence: nextSeq,
        timestamp: now,
      };

      setMyPosition(optimisticPos);
      myPositionRef.current = optimisticPos;
      setActiveUsers((prev) =>
        prev.map((u) =>
          u.userId === selectedUser.user.id ? { ...u, position: optimisticPos } : u
        )
      );

      socketRef.current.emit(
        'avatar:move',
        {
          officeId: selectedOfficeId,
          x: targetX,
          y: targetY,
          sequence: nextSeq,
          timestamp: now,
        },
        (res) => {
          if (res && !res.success) {
            addLog('error', `Move to (${targetX}, ${targetY}) rejected: ${res.error}`);
            if (res.position) {
              setMyPosition(res.position);
              myPositionRef.current = res.position;
              sequenceRef.current = res.position.sequence + 1;
              setActiveUsers((prev) =>
                prev.map((u) => (u.userId === selectedUser.user.id ? { ...u, position: res.position! } : u))
              );
            }
          } else if (res && res.position) {
            setMyPosition(res.position);
            myPositionRef.current = res.position;
            sequenceRef.current = res.position.sequence + 1;
            setActiveUsers((prev) =>
              prev.map((u) => (u.userId === selectedUser.user.id ? { ...u, position: res.position! } : u))
            );
            if (label) {
              addLog(
                'info',
                `Moved ${label} to (${res.position.x}, ${res.position.y}) seq: ${res.position.sequence}`
              );
            }
          }
        }
      );
    },
    [inOffice, selectedOfficeId, selectedUser, addLog]
  );

  // Handle click on canvas with smooth waypoint walking
  const handleMapClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!mapCanvasRef.current || !inOffice || !currentOffice) return;

    const rect = mapCanvasRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    const maxX = currentOffice.bounds?.maxX || currentOffice.width || 1200;
    const maxY = currentOffice.bounds?.maxY || currentOffice.height || 800;

    const scaleX = maxX / rect.width;
    const scaleY = maxY / rect.height;

    const actualX = Math.round(Math.max(20, Math.min(maxX - 20, clickX * scaleX)));
    const actualY = Math.round(Math.max(20, Math.min(maxY - 20, clickY * scaleY)));

    // Cancel any previous key hold and set target
    walkTargetRef.current = { x: actualX, y: actualY };
    addLog('info', `Target set to (${actualX}, ${actualY}) via click`);
  };

  // Keyboard and Waypoint Walk Game Loop
  useEffect(() => {
    if (!inOffice || !currentOffice) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd'].includes(k)) {
        e.preventDefault();
        keysDownRef.current.add(k);
        walkTargetRef.current = null; // Clear click walk on manual key press
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      keysDownRef.current.delete(k);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    // 60ms Smooth Movement Loop
    const moveTimer = setInterval(() => {
      if (!inOffice || !currentOffice || !socketRef.current) return;

      const keys = keysDownRef.current;
      const cur = myPositionRef.current;
      const bounds = currentOffice.bounds || { minX: 0, minY: 0, maxX: 1200, maxY: 800 };
      const radius = 14;

      let dx = 0;
      let dy = 0;

      if (keys.size > 0) {
        const step = 16;
        if (keys.has('arrowup') || keys.has('w')) dy -= step;
        if (keys.has('arrowdown') || keys.has('s')) dy += step;
        if (keys.has('arrowleft') || keys.has('a')) dx -= step;
        if (keys.has('arrowright') || keys.has('d')) dx += step;

        if (dx !== 0 && dy !== 0) {
          dx = Math.round(dx * 0.707);
          dy = Math.round(dy * 0.707);
        }
      } else if (walkTargetRef.current) {
        const target = walkTargetRef.current;
        const toX = target.x - cur.x;
        const toY = target.y - cur.y;
        const dist = Math.hypot(toX, toY);

        if (dist <= 12) {
          walkTargetRef.current = null;
        } else {
          const step = Math.min(dist, 16);
          dx = Math.round((toX / dist) * step);
          dy = Math.round((toY / dist) * step);
        }
      }

      if (dx === 0 && dy === 0) return;

      let nextX = Math.max(bounds.minX + radius, Math.min(bounds.maxX - radius, cur.x + dx));
      let nextY = Math.max(bounds.minY + radius, Math.min(bounds.maxY - radius, cur.y + dy));

      // Check collision
      const collides = clientGeometry.checkAvatarCollision(nextX, nextY, radius, currentOffice.obstacles);

      if (collides) {
        // Wall sliding: try X only
        const collideX = clientGeometry.checkAvatarCollision(nextX, cur.y, radius, currentOffice.obstacles);
        if (!collideX && nextX !== cur.x) {
          nextY = cur.y;
        } else {
          // Try Y only
          const collideY = clientGeometry.checkAvatarCollision(cur.x, nextY, radius, currentOffice.obstacles);
          if (!collideY && nextY !== cur.y) {
            nextX = cur.x;
          } else {
            // Blocked completely
            if (walkTargetRef.current) walkTargetRef.current = null;
            return;
          }
        }
      }

      const facing: FacingDirection =
        Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');

      sendMove(nextX, nextY);
    }, 60);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      clearInterval(moveTimer);
    };
  }, [inOffice, currentOffice, sendMove]);

  // Automated Simulated Multi-Peer Bot Control
  const toggleBot = useCallback(
    (bot: SimulatedBot) => {
      const isCurrentlyActive = bot.active;
      const botKey = bot.userId;

      if (isCurrentlyActive) {
        // Disconnect bot
        const sock = botSocketsRef.current.get(botKey);
        if (sock) {
          sock.disconnect();
          botSocketsRef.current.delete(botKey);
        }
        const pc = botPcsRef.current.get(botKey);
        if (pc) {
          pc.close();
          botPcsRef.current.delete(botKey);
        }
        setSimBots((prev) =>
          prev.map((b) => (b.userId === bot.userId ? { ...b, active: false, patrolActive: false } : b))
        );
        addLog('warn', `Simulated bot ${bot.displayName} disconnected.`);
      } else {
        // Connect bot via real socket
        addLog('info', `Spawning simulated peer ${bot.displayName} [${bot.token}]...`);
        const sock: TypedClientSocket = ClientSocket({
          auth: { token: bot.token },
          transports: ['websocket'],
        });

        sock.on('connect', () => {
          sock.emit(
            'office:join',
            { officeId: selectedOfficeId, initialPosition: bot.position },
            (res) => {
              if (res.success) {
                addLog('success', `Bot ${bot.displayName} entered ${selectedOfficeId} at (${bot.position.x}, ${bot.position.y})`);
                setSimBots((prev) =>
                  prev.map((b) => (b.userId === bot.userId ? { ...b, active: true } : b))
                );
              } else {
                addLog('error', `Bot ${bot.displayName} failed to enter: ${res.error}`);
              }
            }
          );
        });

        sock.on('signal:peer_eligible', async (data: PeerEligibleEvent) => {
          if (data.shouldInitiate) {
            const pc = new RTCPeerConnection(RTC_CONFIG);
            botPcsRef.current.set(`${botKey}:${data.peerUserId}`, pc);

            pc.onicecandidate = (evt) => {
              if (evt.candidate) {
                sock.emit('signal:ice', {
                  targetUserId: data.peerUserId,
                  negotiationId: data.negotiationId,
                  candidate: evt.candidate.toJSON(),
                });
              }
            };

            try {
              const offer = await pc.createOffer();
              await pc.setLocalDescription(offer);
              sock.emit('signal:offer', {
                targetUserId: data.peerUserId,
                negotiationId: data.negotiationId,
                sdp: { type: offer.type, sdp: offer.sdp },
              });
              addLog('info', `Bot ${bot.displayName} initiated WebRTC offer to ${data.peerUserId}`);
            } catch (err) {
              addLog('error', `Bot ${bot.displayName} offer error: ${(err as Error).message}`);
            }
          }
        });

        sock.on('signal:offer', async (data: InboundOfferEvent) => {
          addLog('info', `Bot ${bot.displayName} received offer from ${data.senderUserId}; returning answer...`);
          const pc = new RTCPeerConnection(RTC_CONFIG);
          botPcsRef.current.set(`${botKey}:${data.senderUserId}`, pc);

          pc.onicecandidate = (evt) => {
            if (evt.candidate) {
              sock.emit('signal:ice', {
                targetUserId: data.senderUserId,
                negotiationId: data.negotiationId,
                candidate: evt.candidate.toJSON(),
              });
            }
          };

          try {
            await pc.setRemoteDescription(new RTCSessionDescription(data.sdp as RTCSessionDescriptionInit));
            const ans = await pc.createAnswer();
            await pc.setLocalDescription(ans);
            sock.emit('signal:answer', {
              targetUserId: data.senderUserId,
              negotiationId: data.negotiationId,
              sdp: { type: ans.type, sdp: ans.sdp },
            });
            addLog('success', `Bot ${bot.displayName} answered WebRTC offer.`);
          } catch (e) {
            addLog('error', `Bot ${bot.displayName} failed answer: ${(e as Error).message}`);
          }
        });

        sock.on('signal:answer', async (data: InboundAnswerEvent) => {
          const pc = botPcsRef.current.get(`${botKey}:${data.senderUserId}`);
          if (pc) {
            try {
              await pc.setRemoteDescription(new RTCSessionDescription(data.sdp as RTCSessionDescriptionInit));
              addLog('success', `Bot ${bot.displayName} connected WebRTC audio channel with ${data.senderUserId}`);
            } catch {
              // ignore
            }
          }
        });

        sock.on('signal:ice', async (data: InboundIceEvent) => {
          const pc = botPcsRef.current.get(botKey);
          if (pc) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(data.candidate as RTCIceCandidateInit));
            } catch {
              // ignore
            }
          }
        });

        sock.on('signal:peer_ineligible', () => {
          const pc = botPcsRef.current.get(botKey);
          if (pc) {
            pc.close();
            botPcsRef.current.delete(botKey);
            addLog('info', `Bot ${bot.displayName} teardown WebRTC link.`);
          }
        });

        botSocketsRef.current.set(botKey, sock);
      }
    },
    [selectedOfficeId, addLog]
  );

  // Toggle Bot Patrol Mode
  const toggleBotPatrol = useCallback((userId: string) => {
    setSimBots((prev) =>
      prev.map((b) => (b.userId === userId ? { ...b, patrolActive: !b.patrolActive } : b))
    );
  }, []);

  // Bot patrol movement ticker
  useEffect(() => {
    const patrolInterval = setInterval(() => {
      simBots.forEach((bot) => {
        if (!bot.active || !bot.patrolActive) return;
        const sock = botSocketsRef.current.get(bot.userId);
        if (!sock) return;

        const currentTarget = bot.waypoints[bot.currentWaypointIndex];
        const dx = currentTarget.x - bot.position.x;
        const dy = currentTarget.y - bot.position.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        let nextX = bot.position.x;
        let nextY = bot.position.y;
        let nextIndex = bot.currentWaypointIndex;

        if (dist < 15) {
          nextIndex = (bot.currentWaypointIndex + 1) % bot.waypoints.length;
        } else {
          const step = 15;
          nextX = Math.round(bot.position.x + (dx / dist) * step);
          nextY = Math.round(bot.position.y + (dy / dist) * step);
        }

        const nextBotSeq = (botSequencesRef.current.get(bot.userId) ?? 1) + 1;
        botSequencesRef.current.set(bot.userId, nextBotSeq);
        sock.emit(
          'avatar:move',
          {
            officeId: selectedOfficeId,
            x: nextX,
            y: nextY,
            sequence: nextBotSeq,
            timestamp: Date.now(),
          },
          (res) => {
            if (res.success && res.position) {
              setSimBots((prev) =>
                prev.map((b) =>
                  b.userId === bot.userId
                    ? {
                        ...b,
                        position: { x: res.position!.x, y: res.position!.y },
                        currentWaypointIndex: nextIndex,
                      }
                    : b
                )
              );
            }
          }
        );
      });
    }, 450);

    return () => clearInterval(patrolInterval);
  }, [simBots, selectedOfficeId]);

  // Test layout update as Admin (Alice / Maya)
  const handleAdminUpdateLayout = async () => {
    if (!selectedUser) return;
    try {
      const res = await fetch(`/api/offices/${selectedOfficeId}/layout`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: selectedUser.simpleToken,
        },
        body: JSON.stringify({
          name: `${currentOffice?.name} (Renovated)`,
          obstacles: [
            ...(currentOffice?.obstacles || []),
            {
              id: `partition-wall-${Date.now()}`,
              name: 'Modular Acoustic Partition',
              shape: 'wall',
              x1: 580,
              y1: 120,
              x2: 580,
              y2: 440,
              thickness: 12,
              blocksMovement: true,
              blocksSound: true,
              attenuation: 0,
            },
          ],
        }),
      });

      const data = await res.json();
      if (res.ok) {
        addLog(
          'success',
          `Layout updated successfully by ${selectedUser.user.displayName}! Version: #${data.layout.layoutVersion}`
        );
        setCurrentOffice(data.layout);
      } else {
        addLog('error', `Layout update failed (${res.status}): ${data.error}`);
      }
    } catch (err) {
      addLog('error', `Error updating layout: ${(err as Error).message}`);
    }
  };

  const maxX = currentOffice?.bounds?.maxX || currentOffice?.width || 1200;
  const maxY = currentOffice?.bounds?.maxY || currentOffice?.height || 800;

  // Filter accounts by department
  const filteredAccounts = demoAccounts.filter((acc) => {
    if (departmentFilter === 'all') return true;
    if (departmentFilter === 'engineering') {
      return ['user-alice', 'user-bob', 'user-liam', 'user-marcus'].includes(acc.user.id);
    }
    if (departmentFilter === 'product') {
      return ['user-charlie', 'user-maya', 'user-zara'].includes(acc.user.id);
    }
    if (departmentFilter === 'research') {
      return ['user-elena', 'user-bob'].includes(acc.user.id);
    }
    if (departmentFilter === 'bots') {
      return ['user-dexter', 'user-eve'].includes(acc.user.id);
    }
    return true;
  });

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans select-none">
      {/* Top Header Navigation */}
      <header className="border-b border-slate-800 bg-slate-900/90 backdrop-blur px-6 py-3.5 flex flex-wrap items-center justify-between gap-4 sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-gradient-to-tr from-indigo-600 to-purple-600 flex items-center justify-center font-bold shadow-lg shadow-indigo-500/25 text-white">
            <Radio className="h-5 w-5 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight text-white">ProxiSpeak</h1>
              <span className="px-2 py-0.5 text-[11px] font-semibold rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                P1: Presence
              </span>
              <span className="px-2 py-0.5 text-[11px] font-semibold rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                P2: Geospatial 100px
              </span>
              <span className="px-2 py-0.5 text-[11px] font-semibold rounded bg-purple-500/10 text-purple-400 border border-purple-500/20">
                P3: WebRTC
              </span>
              <span className="px-2 py-0.5 text-[11px] font-semibold rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 flex items-center gap-1">
                <Building className="h-3 w-3" /> P4: Occlusion
              </span>
            </div>
            <p className="text-xs text-slate-400">
              MongoDB 2D Flat Index • 100px Entry / 110px Exit Hysteresis • Soundproof Raycast Occlusion • Perfect Negotiation
            </p>
          </div>
        </div>

        {/* Server Status & Controls */}
        <div className="flex items-center gap-2.5 text-xs">
          <button
            onClick={() => setSpatialAudioEnabled(!spatialAudioEnabled)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border font-medium transition ${
              spatialAudioEnabled
                ? 'bg-purple-600/20 border-purple-500/40 text-purple-300'
                : 'bg-slate-800 border-slate-700 text-slate-400'
            }`}
            title="Toggle Web Audio spatial synthesizer tone simulation"
          >
            <Headphones className="h-3.5 w-3.5" />
            <span>Spatial Audio {spatialAudioEnabled ? 'ON' : 'OFF'}</span>
          </button>

          <button
            onClick={toggleMicrophone}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border font-medium transition ${
              micActive
                ? 'bg-emerald-600/20 border-emerald-500/40 text-emerald-300 hover:bg-emerald-600/30'
                : 'bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700'
            }`}
          >
            {micActive ? <Mic className="h-3.5 w-3.5 text-emerald-400" /> : <MicOff className="h-3.5 w-3.5 text-slate-400" />}
            <span>{micActive ? 'Mic Active' : 'Enable Mic'}</span>
          </button>

          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800/80 border border-slate-700 font-mono">
            <ServerIcon className="h-3.5 w-3.5 text-emerald-400" />
            <span className="text-slate-400">API:</span>
            <span className="text-emerald-400 font-semibold">{healthStatus?.status === 'ok' ? 'Online' : 'Checking'}</span>
          </div>

          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800/80 border border-slate-700 font-mono">
            <Activity className="h-3.5 w-3.5 text-indigo-400" />
            <span className="text-slate-400">Socket:</span>
            <span className={`font-semibold ${connected ? 'text-emerald-400' : 'text-amber-400'}`}>
              {connected ? 'Active' : 'Offline'}
            </span>
          </div>
        </div>
      </header>

      {/* Main Workspace 3-Column Layout */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-5 p-5 overflow-hidden">
        {/* Left Column: Character Selection & Office Management (3 cols) */}
        <div className="lg:col-span-3 space-y-5 overflow-y-auto max-h-[calc(100vh-100px)] pr-1">
          {/* 1. Character Roster Card */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-indigo-400" />
                1. Select Character Avatar
              </h2>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-300 font-mono">
                {demoAccounts.length} Available
              </span>
            </div>

            {/* Department Filter Tabs */}
            <div className="flex gap-1 mb-3 overflow-x-auto pb-1 text-[10px]">
              {[
                { id: 'all', label: 'All' },
                { id: 'engineering', label: 'Eng' },
                { id: 'product', label: 'Design' },
                { id: 'research', label: 'Research' },
                { id: 'bots', label: 'Bots & Guests' },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setDepartmentFilter(tab.id)}
                  className={`px-2 py-1 rounded transition ${
                    departmentFilter === tab.id
                      ? 'bg-indigo-600 text-white font-semibold'
                      : 'bg-slate-800/60 text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Character Scroll List */}
            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {filteredAccounts.map((acc) => {
                const isSelected = selectedUser?.user.id === acc.user.id;
                const isAdmin = acc.user.id === 'user-alice' || acc.user.id === 'user-maya';
                const userTheme = acc.user.themeColor || '#6366f1';

                return (
                  <div
                    key={acc.user.id}
                    onClick={() => {
                      setSelectedUser(acc);
                      if (connected) handleConnect(acc);
                    }}
                    className={`w-full text-left p-2 rounded-lg border text-xs cursor-pointer transition flex items-center justify-between ${
                      isSelected
                        ? 'border-indigo-500 bg-indigo-500/15 shadow-sm'
                        : 'border-slate-800 bg-slate-950/40 text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <div
                        className="relative h-8 w-8 rounded-full border flex items-center justify-center overflow-hidden shrink-0"
                        style={{ borderColor: userTheme }}
                      >
                        <img
                          src={acc.user.avatarUrl}
                          alt={acc.user.displayName}
                          className="h-full w-full object-cover"
                        />
                      </div>
                      <div className="min-w-0">
                        <div className="font-semibold text-slate-100 flex items-center gap-1.5 truncate">
                          <span>{acc.user.displayName}</span>
                          {acc.user.badge && (
                            <span
                              className="text-[9px] px-1.5 py-0.2 rounded font-bold uppercase tracking-tight"
                              style={{
                                backgroundColor: `${userTheme}25`,
                                color: userTheme,
                                borderColor: `${userTheme}50`,
                                borderWidth: '1px',
                              }}
                            >
                              {acc.user.badge}
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-slate-400 truncate">
                          {acc.user.roleTitle || acc.user.department || acc.simpleToken}
                        </div>
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <span className="text-[9px] font-mono text-slate-500">
                        {acc.simpleToken.replace('token-', '')}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            {selectedUser && (
              <div className="mt-3 pt-3 border-t border-slate-800/80">
                <div className="flex items-center justify-between text-[11px] text-slate-400 mb-2 font-mono">
                  <span>Active Token:</span>
                  <span className="text-indigo-400 font-semibold">{selectedUser.simpleToken}</span>
                </div>
                <button
                  onClick={() => handleConnect(selectedUser)}
                  className="w-full py-2 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md shadow-indigo-600/20 transition flex items-center justify-center gap-2"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  {connected ? 'Switch / Reconnect Socket' : 'Connect & Authenticate'}
                </button>
              </div>
            )}
          </div>

            {/* 2. Office Selection & Persisted Layouts */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-sm">
            <h2 className="text-xs font-bold text-slate-200 uppercase tracking-wider mb-2.5 flex items-center gap-2">
              <Building className="h-4 w-4 text-amber-400" />
              2. Persisted Virtual Offices
            </h2>

            <div className="space-y-2 mb-3">
              {offices.map((off) => {
                const isSelected = selectedOfficeId === off.id;
                const isRestricted = off.accessPolicy === 'members_only';

                return (
                  <div
                    key={off.id}
                    onClick={() => {
                      setSelectedOfficeId(off.id);
                      refreshOfficeLayout(off.id);
                    }}
                    className={`p-2.5 rounded-lg border cursor-pointer transition ${
                      isSelected
                        ? 'border-amber-500/60 bg-amber-500/10 text-white'
                        : 'border-slate-800 bg-slate-950/40 text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-semibold text-xs text-slate-200">{off.name}</span>
                      {isRestricted ? (
                        <span className="flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-400 border border-rose-500/20">
                          <Lock className="h-2.5 w-2.5" /> Restricted
                        </span>
                      ) : (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                          Public
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-slate-400 line-clamp-1">{off.description}</div>
                    <div className="text-[9px] text-slate-500 mt-1 font-mono flex justify-between">
                      <span>Dimensions: {off.bounds?.maxX || off.width}x{off.bounds?.maxY || off.height}px</span>
                      <span className="text-amber-400">Version: #{off.layoutVersion || 1}</span>
                    </div>
                  </div>
                );
              })}
            </div>

            {inOffice ? (
              <div className="space-y-2">
                <button
                  onClick={handleLeaveOffice}
                  className="w-full py-2 px-3 rounded-lg bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/30 text-xs font-semibold transition flex items-center justify-center gap-2"
                >
                  <LogOut className="h-3.5 w-3.5" /> Leave Office Room
                </button>

                <button
                  onClick={handleAdminUpdateLayout}
                  className="w-full py-2 px-3 rounded-lg bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-500/30 text-xs font-semibold transition flex items-center justify-center gap-2"
                >
                  <Sliders className="h-3.5 w-3.5" /> Add Wall Partition (PUT API)
                </button>
              </div>
            ) : (
              <button
                onClick={() => handleJoinOffice(selectedOfficeId)}
                disabled={!connected}
                className="w-full py-2 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold shadow-md shadow-emerald-600/20 transition flex items-center justify-center gap-2"
              >
                <ArrowRight className="h-3.5 w-3.5" /> Enter Selected Office
              </button>
            )}

            {lastError && (
              <div className="mt-2.5 p-2 rounded-lg bg-rose-950/60 border border-rose-800/80 text-rose-300 text-xs flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400 mt-0.5" />
                <span>{lastError}</span>
              </div>
            )}
          </div>

          {/* 3. Multi-Bot Simulator Engine */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
                <Bot className="h-4 w-4 text-purple-400" />
                3. Peer Bot Simulators
              </h2>
              <span className="text-[10px] text-slate-500 font-mono">Multi-Socket</span>
            </div>
            <p className="text-[11px] text-slate-400 mb-3">
              Spawn automated peers into this office to test proximity entry/exit hysteresis, audio signaling, and wall occlusion.
            </p>

            <div className="space-y-2.5">
              {simBots.map((bot) => (
                <div
                  key={bot.userId}
                  className="p-2.5 rounded-lg bg-slate-950/60 border border-slate-800 flex flex-col gap-2"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div
                        className="h-3 w-3 rounded-full"
                        style={{ backgroundColor: bot.color }}
                      />
                      <span className="text-xs font-semibold text-slate-200">{bot.displayName}</span>
                      <span className="text-[9px] text-slate-500">({bot.roleTitle})</span>
                    </div>
                    <span
                      className={`text-[9px] px-1.5 py-0.5 rounded font-mono ${
                        bot.active
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                          : 'bg-slate-800 text-slate-500'
                      }`}
                    >
                      {bot.active ? 'Spawned' : 'Offline'}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => toggleBot(bot)}
                      className={`flex-1 py-1 px-2 rounded text-[11px] font-semibold border transition ${
                        bot.active
                          ? 'bg-rose-600/20 border-rose-500/40 text-rose-300 hover:bg-rose-600/30'
                          : 'bg-indigo-600/20 border-indigo-500/40 text-indigo-300 hover:bg-indigo-600/30'
                      }`}
                    >
                      {bot.active ? 'Despawn' : 'Spawn into Office'}
                    </button>

                    {bot.active && (
                      <button
                        onClick={() => toggleBotPatrol(bot.userId)}
                        className={`py-1 px-2.5 rounded text-[11px] font-semibold border transition flex items-center gap-1 ${
                          bot.patrolActive
                            ? 'bg-amber-600/20 border-amber-500/40 text-amber-300'
                            : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200'
                        }`}
                        title="Autonomous walking through proximity zone and behind walls"
                      >
                        {bot.patrolActive ? <Square className="h-3 w-3 text-amber-400" /> : <Play className="h-3 w-3 text-emerald-400" />}
                        <span>Patrol</span>
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Center Column: Live 2D Spatial Office Canvas (6 cols) */}
        <div className="lg:col-span-6 flex flex-col space-y-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex-1 flex flex-col shadow-sm">
            {/* Canvas Header */}
            <div className="flex items-center justify-between mb-2.5">
              <div className="flex items-center gap-2">
                <Move className="h-4 w-4 text-indigo-400" />
                <h3 className="font-bold text-sm text-slate-200">
                  {currentOffice ? currentOffice.name : 'Virtual Office Canvas'}
                </h3>
              </div>
              <div className="flex items-center gap-3 text-xs font-mono">
                {inOffice && (
                  <>
                    <span className="text-slate-400">
                      Pos: <strong className="text-white">({myPosition.x}, {myPosition.y})</strong>
                    </span>
                    <span className="text-emerald-400">
                      Online: <strong>{activeUsers.length}</strong>
                    </span>
                    <span className="text-amber-400">
                      Version: <strong>#{currentOffice?.layoutVersion || 1}</strong>
                    </span>
                  </>
                )}
              </div>
            </div>

            {/* 2D Interactive Map Container */}
            <div
              ref={mapCanvasRef}
              onClick={handleMapClick}
              className="relative w-full aspect-[4/3] max-h-[560px] rounded-xl bg-slate-950 border-2 border-slate-800 cursor-crosshair overflow-hidden shadow-2xl flex-1 select-none"
              style={{
                backgroundImage:
                  'radial-gradient(circle, #334155 1.2px, transparent 1.2px), linear-gradient(to right, #0f172a 1px, transparent 1px), linear-gradient(to bottom, #0f172a 1px, transparent 1px)',
                backgroundSize: '24px 24px, 120px 120px, 120px 120px',
              }}
            >
              {!inOffice && (
                <div className="absolute inset-0 bg-slate-950/85 backdrop-blur-xs flex flex-col items-center justify-center p-6 text-center z-30">
                  <div className="h-12 w-12 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center mb-3 text-slate-500 shadow-inner">
                    <Lock className="h-6 w-6 text-indigo-400" />
                  </div>
                  <p className="text-base font-semibold text-slate-200">Office Session Inactive</p>
                  <p className="text-xs text-slate-400 max-w-sm mt-1 mb-4 leading-relaxed">
                    Connect an authenticated character profile on the left and click &ldquo;Enter Selected Office&rdquo; to experience real-time spatial audio and server-validated movement.
                  </p>
                  <button
                    onClick={() => handleJoinOffice(selectedOfficeId)}
                    disabled={!connected}
                    className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold shadow transition"
                  >
                    Enter Office Now
                  </button>
                </div>
              )}

              {/* Render Obstacles / Walls / Desks */}
              {currentOffice?.obstacles.map((obs) => {
                const isWall = obs.shape === 'wall' || ('x1' in obs && 'y1' in obs);

                if (isWall) {
                  const w = obs as any;
                  const leftPct = (Math.min(w.x1, w.x2) / maxX) * 100;
                  const topPct = (Math.min(w.y1, w.y2) / maxY) * 100;
                  const widthPct = (Math.max(Math.abs(w.x2 - w.x1), w.thickness || 10) / maxX) * 100;
                  const heightPct = (Math.max(Math.abs(w.y2 - w.y1), w.thickness || 10) / maxY) * 100;

                  return (
                    <div
                      key={obs.id}
                      className="absolute bg-rose-600/50 border-2 border-rose-400 rounded shadow-lg pointer-events-none z-10 flex items-center justify-center"
                      style={{
                        left: `${leftPct}%`,
                        top: `${topPct}%`,
                        width: `${widthPct}%`,
                        height: `${heightPct}%`,
                      }}
                    >
                      <span className="text-[9px] font-mono text-rose-200 font-bold px-1 whitespace-nowrap bg-slate-950/80 rounded border border-rose-500/30">
                        {obs.name} {obs.blocksSound ? '• Soundproof' : ''}
                      </span>
                    </div>
                  );
                }

                // Rectangle furniture/room
                const r = obs as any;
                const leftPct = (r.x / maxX) * 100;
                const topPct = (r.y / maxY) * 100;
                const widthPct = (r.width / maxX) * 100;
                const heightPct = (r.height / maxY) * 100;
                const isSoundproof = obs.blocksSound && obs.attenuation === 0;

                return (
                  <div
                    key={obs.id}
                    className={`absolute rounded-lg flex flex-col items-center justify-center p-1.5 shadow pointer-events-none border z-10 ${
                      isSoundproof
                        ? 'bg-rose-950/40 border-rose-500/70'
                        : 'bg-slate-800/70 border-slate-700/80 backdrop-blur-xs'
                    }`}
                    style={{
                      left: `${leftPct}%`,
                      top: `${topPct}%`,
                      width: `${widthPct}%`,
                      height: `${heightPct}%`,
                    }}
                  >
                    <span className="text-[10px] font-bold text-slate-200 tracking-wider text-center px-1">
                      {obs.name}
                    </span>
                    <span className="text-[9px] text-slate-400 font-mono">
                      {obs.blocksSound
                        ? `Acoustic Partition (${Math.round((obs.attenuation ?? 0) * 100)}% transmission)`
                        : 'Desk / Furniture'}
                    </span>
                  </div>
                );
              })}

              {/* Render Proximity Circles for Active User */}
              {inOffice && currentOffice && (
                <>
                  {/* Exit Radius Hysteresis: 110px */}
                  <div
                    className="absolute rounded-full border border-dashed border-amber-400/50 pointer-events-none -translate-x-1/2 -translate-y-1/2 transition-all duration-100"
                    style={{
                      left: `${(myPosition.x / maxX) * 100}%`,
                      top: `${(myPosition.y / maxY) * 100}%`,
                      width: `${((proximityConfig.exitRadius * 2) / maxX) * 100}%`,
                      height: `${((proximityConfig.exitRadius * 2) / maxY) * 100}%`,
                    }}
                  />
                  {/* Entry Radius: 100px */}
                  <div
                    className="absolute rounded-full border-2 border-emerald-500/50 bg-emerald-500/5 pointer-events-none -translate-x-1/2 -translate-y-1/2 shadow-lg shadow-emerald-500/10 transition-all duration-100"
                    style={{
                      left: `${(myPosition.x / maxX) * 100}%`,
                      top: `${(myPosition.y / maxY) * 100}%`,
                      width: `${((proximityConfig.entryRadius * 2) / maxX) * 100}%`,
                      height: `${((proximityConfig.entryRadius * 2) / maxY) * 100}%`,
                    }}
                  />
                </>
              )}

              {/* Render Acoustic Occlusion Raycasts (SVG Layer) */}
              {inOffice && currentOffice && (
                <svg className="absolute inset-0 w-full h-full pointer-events-none z-15">
                  {activeUsers
                    .filter((u) => u.userId !== selectedUser?.user.id)
                    .map((remoteUser) => {
                      const peerInfo = proximityPeers.find((p) => p.userId === remoteUser.userId);
                      if (!peerInfo) return null;

                      const occlusion = clientGeometry.checkSoundObstruction(
                        { x: myPosition.x, y: myPosition.y },
                        { x: remoteUser.position.x, y: remoteUser.position.y },
                        currentOffice.obstacles
                      );

                      const x1 = (myPosition.x / maxX) * 100;
                      const y1 = (myPosition.y / maxY) * 100;
                      const x2 = (remoteUser.position.x / maxX) * 100;
                      const y2 = (remoteUser.position.y / maxY) * 100;

                      return (
                        <g key={`ray-${remoteUser.userId}`}>
                          <line
                            x1={`${x1}%`}
                            y1={`${y1}%`}
                            x2={`${x2}%`}
                            y2={`${y2}%`}
                            stroke={
                              occlusion.isBlocked
                                ? '#f43f5e'
                                : occlusion.totalTransmission < 1
                                ? '#eab308'
                                : '#10b981'
                            }
                            strokeWidth={occlusion.isBlocked ? '2' : '2.5'}
                            strokeDasharray={occlusion.isBlocked ? '4 4' : 'none'}
                            strokeOpacity={occlusion.isBlocked ? '0.7' : '0.9'}
                          />
                        </g>
                      );
                    })}
                </svg>
              )}

              {/* Active Click-to-Move Walk Waypoint Target */}
              {walkTargetRef.current && inOffice && currentOffice && (
                <div
                  className="absolute pointer-events-none -translate-x-1/2 -translate-y-1/2 z-18 animate-pulse"
                  style={{
                    left: `${(walkTargetRef.current.x / maxX) * 100}%`,
                    top: `${(walkTargetRef.current.y / maxY) * 100}%`,
                  }}
                >
                  <div className="h-5 w-5 rounded-full border-2 border-indigo-400 bg-indigo-500/30 flex items-center justify-center">
                    <div className="h-1.5 w-1.5 rounded-full bg-white" />
                  </div>
                </div>
              )}

              {/* Render Avatars - Synchronized with myPosition */}
              {inOffice && (() => {
                const list = [...activeUsers];
                if (selectedUser && !list.some((u) => u.userId === selectedUser.user.id)) {
                  list.push({
                    userId: selectedUser.user.id,
                    user: selectedUser.user,
                    officeId: selectedOfficeId,
                    position: myPosition,
                    isOnline: true,
                    joinedAt: Date.now(),
                    lastSeenAt: Date.now(),
                  });
                }
                return list.map((member) => {
                  const isMe = member.userId === selectedUser?.user.id;
                  const curX = isMe ? myPosition.x : member.position.x;
                  const curY = isMe ? myPosition.y : member.position.y;
                  const leftPct = (curX / maxX) * 100;
                  const topPct = (curY / maxY) * 100;
                  const isPeer = proximityPeers.some((p) => p.userId === member.userId);
                  const hasWebRtc = peerConnections[member.userId]?.connectionState === 'connected';

                  let soundOcclusion: SoundOcclusionResult | null = null;
                  if (!isMe && isPeer && currentOffice) {
                    soundOcclusion = clientGeometry.checkSoundObstruction(
                      { x: myPosition.x, y: myPosition.y },
                      { x: member.position.x, y: member.position.y },
                      currentOffice.obstacles
                    );
                  }

                  const avatarColor = member.user.themeColor || (isMe ? '#6366f1' : '#a855f7');

                  return (
                    <div
                      key={member.userId}
                      className="absolute transition-all duration-150 ease-out -translate-x-1/2 -translate-y-1/2 flex flex-col items-center pointer-events-none z-20"
                      style={{
                        left: `${leftPct}%`,
                        top: `${topPct}%`,
                      }}
                    >
                      {/* Avatar Ring */}
                      <div
                        className={`h-9 w-9 rounded-full border-2 flex items-center justify-center shadow-xl transition-transform ${
                          isMe
                            ? 'ring-4 ring-indigo-500/40 scale-110'
                            : isPeer
                            ? soundOcclusion?.isBlocked
                              ? 'ring-4 ring-rose-500/50'
                              : 'ring-4 ring-emerald-500/50 animate-pulse'
                            : 'opacity-80'
                        }`}
                        style={{
                          backgroundColor: `${avatarColor}33`,
                          borderColor: avatarColor,
                        }}
                      >
                        <img
                          src={member.user.avatarUrl}
                          alt={member.user.displayName}
                          className="h-7 w-7 rounded-full object-cover"
                        />
                      </div>

                      {/* Name Badge */}
                      <div className="mt-1 px-1.5 py-0.5 rounded-md bg-slate-900/95 border border-slate-700/80 text-[10px] font-semibold text-white whitespace-nowrap shadow-md flex items-center gap-1">
                        {soundOcclusion?.isBlocked ? (
                          <VolumeX className="h-2.5 w-2.5 text-rose-400" />
                        ) : isPeer ? (
                          <Volume2 className="h-2.5 w-2.5 text-emerald-400" />
                        ) : null}
                        <span>{member.user.displayName} {isMe ? '(You)' : ''}</span>
                        {soundOcclusion && (() => {
                          const liveDist = Math.round(Math.hypot(member.position.x - myPosition.x, member.position.y - myPosition.y));
                          const distanceFactor = Math.max(0, 1 - liveDist / (proximityConfig.exitRadius || 110));
                          const liveVol = soundOcclusion.isBlocked ? 0 : Math.round(distanceFactor * soundOcclusion.totalTransmission * 100);
                          return (
                            <span
                              className={`text-[9px] font-mono ${
                                soundOcclusion.isBlocked ? 'text-rose-400 font-bold' : 'text-emerald-400'
                              }`}
                            >
                              {soundOcclusion.isBlocked
                                ? '[Muted by Wall]'
                                : `[${liveVol}% vol • ${liveDist}px]`}
                            </span>
                          );
                        })()}
                      </div>
                    </div>
                  );
                });
              })()}
            </div>

            {/* Canvas Legend & Movement Instructions */}
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs border-t border-slate-800/80 pt-3">
              <div className="flex items-center gap-3 text-[11px] text-slate-400">
                <span className="flex items-center gap-1">
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 inline-block" /> 100px Hearing Earshot
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-2.5 w-2.5 rounded-full border border-dashed border-amber-400 inline-block" /> 110px Exit Hysteresis
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-2.5 w-2.5 rounded bg-rose-500 inline-block" /> Soundproof Partition Wall
                </span>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-[11px] font-mono text-slate-400 hidden sm:block">
                  Controls: <strong>WASD / Arrow Keys</strong> or Click Canvas
                </div>

                {/* On-Screen Interactive Directional Pad */}
                <div className="flex items-center gap-1 bg-slate-950/80 p-1 rounded-lg border border-slate-800">
                  <button
                    type="button"
                    onClick={() => {
                      walkTargetRef.current = null;
                      keysDownRef.current.add('arrowleft');
                      setTimeout(() => keysDownRef.current.delete('arrowleft'), 120);
                    }}
                    title="Move Left (A / Left Arrow)"
                    className="p-1 rounded bg-slate-900 hover:bg-indigo-600 text-slate-300 hover:text-white border border-slate-700/60 transition active:scale-95"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" />
                  </button>

                  <div className="flex flex-col gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        walkTargetRef.current = null;
                        keysDownRef.current.add('arrowup');
                        setTimeout(() => keysDownRef.current.delete('arrowup'), 120);
                      }}
                      title="Move Up (W / Up Arrow)"
                      className="p-1 rounded bg-slate-900 hover:bg-indigo-600 text-slate-300 hover:text-white border border-slate-700/60 transition active:scale-95"
                    >
                      <ArrowUp className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        walkTargetRef.current = null;
                        keysDownRef.current.add('arrowdown');
                        setTimeout(() => keysDownRef.current.delete('arrowdown'), 120);
                      }}
                      title="Move Down (S / Down Arrow)"
                      className="p-1 rounded bg-slate-900 hover:bg-indigo-600 text-slate-300 hover:text-white border border-slate-700/60 transition active:scale-95"
                    >
                      <ArrowDown className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      walkTargetRef.current = null;
                      keysDownRef.current.add('arrowright');
                      setTimeout(() => keysDownRef.current.delete('arrowright'), 120);
                    }}
                    title="Move Right (D / Right Arrow)"
                    className="p-1 rounded bg-slate-900 hover:bg-indigo-600 text-slate-300 hover:text-white border border-slate-700/60 transition active:scale-95"
                  >
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: WebRTC Audio Channels & System Inspector (3 cols) */}
        <div className="lg:col-span-3 space-y-5 overflow-y-auto max-h-[calc(100vh-100px)] pr-1">
          {/* Active Audio Channels & Occlusion Inspector */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-sm">
            <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider mb-2.5 flex items-center justify-between">
              <span className="flex items-center gap-2">
                <PhoneCall className="h-4 w-4 text-purple-400" />
                Audio Channels & Occlusion
              </span>
              <span className="text-[10px] px-2 py-0.5 rounded bg-purple-500/10 text-purple-400 font-mono">
                {proximityPeers.length} in earshot
              </span>
            </h3>

            {proximityPeers.length === 0 ? (
              <div className="p-4 rounded-lg bg-slate-950/40 border border-slate-800 text-center">
                <PhoneOff className="h-6 w-6 text-slate-600 mx-auto mb-1.5" />
                <p className="text-xs text-slate-400">No peers within 100px listening radius.</p>
                <p className="text-[11px] text-slate-500 mt-1">
                  Walk close to a peer or spawn a bot to test spatial audio.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {proximityPeers.map((peer) => {
                  const member = activeUsers.find((u) => u.userId === peer.userId);
                  const occlusion = currentOffice
                    ? clientGeometry.checkSoundObstruction(
                        { x: myPosition.x, y: myPosition.y },
                        { x: member?.position.x ?? 0, y: member?.position.y ?? 0 },
                        currentOffice.obstacles
                      )
                    : null;

                  const isBlocked = occlusion?.isBlocked;
                  const transmission = occlusion?.totalTransmission ?? 1;

                  return (
                    <div
                      key={peer.userId}
                      className={`p-2.5 rounded-lg border text-xs flex flex-col gap-1.5 ${
                        isBlocked
                          ? 'bg-rose-950/20 border-rose-500/30'
                          : 'bg-purple-950/20 border-purple-500/30'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {isBlocked ? (
                            <VolumeX className="h-3.5 w-3.5 text-rose-400" />
                          ) : (
                            <Volume2 className="h-3.5 w-3.5 text-purple-400 animate-pulse" />
                          )}
                          <span className="font-semibold text-slate-200">
                            {member?.user.displayName ?? peer.userId}
                          </span>
                        </div>
                        <span
                          className={`text-[9px] px-1.5 py-0.5 rounded font-mono ${
                            isBlocked
                              ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                              : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                          }`}
                        >
                          {isBlocked ? 'Wall Muted (0%)' : `Audible (${Math.round(transmission * 100)}%)`}
                        </span>
                      </div>

                      {/* Dynamic Proximity Audio & WebRTC Gain Meter */}
                      {(() => {
                        const liveDist = member
                          ? Math.round(Math.hypot(member.position.x - myPosition.x, member.position.y - myPosition.y))
                          : Math.round(peer.distance);
                        const distanceFactor = Math.max(0, 1 - liveDist / (proximityConfig.exitRadius || 110));
                        const liveVolume = isBlocked ? 0 : Math.round(distanceFactor * transmission * 100);

                        return (
                          <div className="space-y-1 mt-1">
                            <div className="flex justify-between text-[10px] text-slate-400 font-mono">
                              <span>Distance: <strong className="text-white">{liveDist}px</strong></span>
                              <span>Volume: <strong className={liveVolume > 50 ? 'text-emerald-400' : liveVolume > 0 ? 'text-amber-400' : 'text-rose-400'}>{liveVolume}%</strong></span>
                            </div>
                            <div className="h-2 w-full bg-slate-800 rounded-full overflow-hidden">
                              <div
                                className={`h-full transition-all duration-75 ${
                                  isBlocked
                                    ? 'bg-rose-500'
                                    : liveVolume > 60
                                    ? 'bg-emerald-400'
                                    : liveVolume > 20
                                    ? 'bg-amber-400'
                                    : 'bg-indigo-400'
                                }`}
                                style={{
                                  width: `${liveVolume}%`,
                                }}
                              />
                            </div>
                            <div className="flex justify-between text-[9px] text-slate-500 font-mono">
                              <span>Acoustics: {Math.round(transmission * 100)}% through wall</span>
                              <span className="text-indigo-400">P2P Audio: Active</span>
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Proximity Performance & Benchmarks */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-sm">
            <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider mb-2 flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Gauge className="h-4 w-4 text-emerald-400" />
                Geospatial Engine Specs
              </span>
              <span className="text-[10px] text-emerald-400 font-mono">MongoDB 2D Flat</span>
            </h3>
            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <div className="bg-slate-950/60 p-2 rounded-lg border border-slate-800">
                <div className="text-[10px] text-slate-400">50 Users</div>
                <div className="font-bold text-emerald-400 font-mono mt-0.5">&lt; 0.13 ms</div>
                <div className="text-[9px] text-slate-500">P95 Latency</div>
              </div>
              <div className="bg-slate-950/60 p-2 rounded-lg border border-slate-800">
                <div className="text-[10px] text-slate-400">100 Users</div>
                <div className="font-bold text-emerald-400 font-mono mt-0.5">&lt; 0.10 ms</div>
                <div className="text-[9px] text-slate-500">P95 Latency</div>
              </div>
              <div className="bg-slate-950/60 p-2 rounded-lg border border-slate-800">
                <div className="text-[10px] text-slate-400">250 Users</div>
                <div className="font-bold text-emerald-400 font-mono mt-0.5">&lt; 0.22 ms</div>
                <div className="text-[9px] text-slate-500">P95 Latency</div>
              </div>
            </div>
          </div>

          {/* Integration Event Log */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-sm flex flex-col h-64">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
                <Layers className="h-4 w-4 text-indigo-400" />
                Live Integration Audit Log
              </h3>
              <button
                onClick={() => setLogs([])}
                className="text-[10px] text-slate-400 hover:text-slate-200"
              >
                Clear
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-1 font-mono text-[10px] pr-1">
              {logs.length === 0 ? (
                <p className="text-slate-600 text-xs italic py-2">Waiting for events...</p>
              ) : (
                logs.map((log) => {
                  let color = 'text-slate-400';
                  if (log.type === 'success') color = 'text-emerald-400';
                  if (log.type === 'warn') color = 'text-amber-400';
                  if (log.type === 'error') color = 'text-rose-400';

                  return (
                    <div
                      key={log.id}
                      className="p-1 rounded bg-slate-950/50 border border-slate-800/60 leading-tight"
                    >
                      <span className="text-slate-500 text-[9px] mr-1">[{log.timestamp}]</span>
                      <span className={color}>{log.message}</span>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
