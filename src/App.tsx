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
  PhoneCall,
  PhoneOff,
} from 'lucide-react';
import { Office } from './shared/contracts/office.types';
import {
  AvatarPosition,
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
}

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

export default function App() {
  const [healthStatus, setHealthStatus] = useState<{ status: string; uptime: number } | null>(null);
  const [demoAccounts, setDemoAccounts] = useState<DemoAccount[]>([]);
  const [offices, setOffices] = useState<Office[]>([]);
  const [selectedUser, setSelectedUser] = useState<DemoAccount | null>(null);
  const [selectedOfficeId, setSelectedOfficeId] = useState<string>('infotact-office');

  // Connection state
  const [connected, setConnected] = useState(false);
  const [inOffice, setInOffice] = useState(false);
  const [currentOffice, setCurrentOffice] = useState<Office | null>(null);
  const [activeUsers, setActiveUsers] = useState<PresenceUser[]>([]);
  const [myPosition, setMyPosition] = useState<AvatarPosition>({ x: 200, y: 200, sequence: 0, timestamp: Date.now(), facing: 'down' });
  const [lastError, setLastError] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);

  // Proximity & Peer Eligibility state (Person 2)
  const [proximityPeers, setProximityPeers] = useState<ProximityPeer[]>([]);
  const [proximityConfig, setProximityConfig] = useState<{ entryRadius: number; exitRadius: number; staleTimeoutMs: number }>({
    entryRadius: 100,
    exitRadius: 110,
    staleTimeoutMs: 15000,
  });

  // WebRTC Audio & Signaling State (Person 3)
  const [micActive, setMicActive] = useState(false);
  const [peerConnections, setPeerConnections] = useState<Record<string, PeerConnectionState>>({});
  const localStreamRef = useRef<MediaStream | null>(null);
  const activePeerConnectionsRef = useRef<Map<string, { pc: RTCPeerConnection; negotiationId: string; isPolite: boolean }>>(new Map());

  // Simulation of secondary peer (Bob)
  const [simBobActive, setSimBobActive] = useState(false);
  const simBobSocketRef = useRef<TypedClientSocket | null>(null);
  const simBobPcRef = useRef<RTCPeerConnection | null>(null);
  const [simBobPos, setSimBobPos] = useState<{ x: number; y: number; seq: number }>({ x: 260, y: 240, seq: 1 });

  const socketRef = useRef<TypedClientSocket | null>(null);
  const sequenceRef = useRef(1);
  const mapCanvasRef = useRef<HTMLDivElement | null>(null);

  const addLog = useCallback((type: LogEntry['type'], message: string) => {
    const entry: LogEntry = {
      id: Math.random().toString(36).substring(2, 9),
      timestamp: new Date().toLocaleTimeString(),
      type,
      message,
    };
    setLogs((prev) => [entry, ...prev.slice(0, 49)]);
  }, []);

  // Initialize synthetic or microphone audio track
  const toggleMicrophone = async () => {
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

        // Add track to all active peer connections
        const audioTrack = stream.getAudioTracks()[0];
        activePeerConnectionsRef.current.forEach(({ pc }) => {
          pc.getSenders().forEach((s) => {
            if (s.track?.kind === 'audio') {
              s.replaceTrack(audioTrack);
            }
          });
        });
      } catch (err) {
        // Fallback to Web Audio synthetic tone so testing works without hardware mic permissions!
        try {
          const audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
          const osc = audioCtx.createOscillator();
          const dst = audioCtx.createMediaStreamDestination();
          osc.connect(dst);
          osc.start();
          localStreamRef.current = dst.stream;
          setMicActive(true);
          addLog('info', 'Microphone permission not granted: initialized synthetic audio track for testing.');
        } catch {
          addLog('error', `Failed to initialize audio: ${(err as Error).message}`);
        }
      }
    }
  };

  // Fetch initial system state and proximity config
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
        }

        const usersRes = await fetch('/api/auth/demo-users');
        if (usersRes.ok) {
          const u = await usersRes.json();
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
  }, []);

  // Poll proximity peers for active user
  useEffect(() => {
    if (!selectedUser || !inOffice) {
      setProximityPeers([]);
      return;
    }

    const fetchPeers = async () => {
      try {
        const res = await fetch(`/api/proximity/peers/${selectedUser.user.id}`);
        if (res.ok) {
          const data = await res.json();
          setProximityPeers(data.peers || []);
        }
      } catch {
        // silent fallback
      }
    };

    fetchPeers();
    const peerInterval = setInterval(fetchPeers, 1000);
    return () => clearInterval(peerInterval);
  }, [selectedUser, inOffice, myPosition]);

  // Cleanup helper for WebRTC peer connection
  const closePeerConnection = useCallback((peerUserId: string, reason: string) => {
    const existing = activePeerConnectionsRef.current.get(peerUserId);
    if (existing) {
      existing.pc.close();
      activePeerConnectionsRef.current.delete(peerUserId);
      setPeerConnections((prev) => {
        const next = { ...prev };
        delete next[peerUserId];
        return next;
      });
      addLog('warn', `WebRTC peer connection closed with ${peerUserId} (${reason})`);
    }
  }, [addLog]);

  // Connect or switch active socket
  const handleConnect = useCallback((account: DemoAccount) => {
    if (socketRef.current) {
      socketRef.current.disconnect();
    }

    // Teardown all existing peer connections
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
      addLog('info', `Member joined office: ${data.member.user.displayName} at (${data.member.position.x}, ${data.member.position.y})`);
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

    s.on('avatar:move_rejected', (data) => {
      addLog('error', `Movement rejected: ${data.reason} (${data.code})`);
      setMyPosition(data.currentPosition);
    });

    // --- WebRTC Signaling Handlers (Person 3) ---

    // 1. Proximity Eligibility Trigger: Server indicates peer entered earshot!
    s.on('signal:peer_eligible', async (data: PeerEligibleEvent) => {
      addLog('info', `[WebRTC Signaling] Peer eligible: ${data.peerUserId} (negId: ${data.negotiationId.slice(-8)}, initiate: ${data.shouldInitiate})`);

      const pc = new RTCPeerConnection(RTC_CONFIG);
      activePeerConnectionsRef.current.set(data.peerUserId, {
        pc,
        negotiationId: data.negotiationId,
        isPolite: data.isPolite,
      });

      // Update state for UI
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

      // Attach local audio track if available
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => pc.addTrack(track, localStreamRef.current!));
      }

      // Handle remote audio stream
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

      // Handle ICE Candidates
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

      // Deterministic offerer initiates SDP offer
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

    // 2. Incoming SDP Offer
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
            addLog('warn', `Offer collision: impolite peer ${data.senderUserId} maintaining state`);
          }
        }

        await pc.setRemoteDescription(new RTCSessionDescription(data.sdp as RTCSessionDescriptionInit));
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
        addLog('error', `Error processing offer from ${data.senderUserId}: ${(err as Error).message}`);
      }
    });

    // 3. Incoming SDP Answer
    s.on('signal:answer', async (data: InboundAnswerEvent) => {
      addLog('info', `[WebRTC Signaling] Received SDP answer from ${data.senderUserId}`);
      const entry = activePeerConnectionsRef.current.get(data.senderUserId);
      if (entry) {
        try {
          await entry.pc.setRemoteDescription(new RTCSessionDescription(data.sdp as RTCSessionDescriptionInit));
          addLog('success', `Established signaling session with ${data.senderUserId}`);
        } catch (err) {
          addLog('error', `Error setting remote answer: ${(err as Error).message}`);
        }
      }
    });

    // 4. Incoming ICE Candidate
    s.on('signal:ice', async (data: InboundIceEvent) => {
      const entry = activePeerConnectionsRef.current.get(data.senderUserId);
      if (entry) {
        try {
          await entry.pc.addIceCandidate(new RTCIceCandidate(data.candidate as RTCIceCandidateInit));
        } catch {
          // ignore transient candidates
        }
      }
    });

    // 5. Peer Exited Earshot
    s.on('signal:peer_ineligible', (data: PeerIneligibleEvent) => {
      closePeerConnection(data.peerUserId, data.reason);
    });

    socketRef.current = s;
  }, [addLog, closePeerConnection]);

  // Join designated office
  const handleJoinOffice = useCallback((officeId: string) => {
    if (!socketRef.current || !connected) {
      addLog('warn', 'Socket not connected. Connect user first.');
      return;
    }

    const office = offices.find((o) => o.id === officeId);
    setCurrentOffice(office ?? null);
    addLog('info', `Requesting entry to office '${officeId}'...`);

    socketRef.current.emit(
      'office:join',
      { officeId },
      (response: { success: boolean; error?: string; code?: string; snapshot?: PresenceSnapshot }) => {
        if (!response.success) {
          setLastError(response.error || 'Failed to enter office');
          addLog('error', `Access Denied: ${response.error} [${response.code}]`);
          return;
        }

        setInOffice(true);
        setLastError(null);
        addLog('success', `Joined office '${officeId}'. Initial snapshot received (${response.snapshot?.members.length ?? 0} active).`);

        if (response.snapshot) {
          setActiveUsers(response.snapshot.members);
          const self = response.snapshot.members.find((m) => m.userId === selectedUser?.user.id);
          if (self) {
            setMyPosition(self.position);
            sequenceRef.current = self.position.sequence + 1;
          }
        }
      }
    );
  }, [connected, offices, selectedUser, addLog]);

  const handleLeaveOffice = useCallback(() => {
    if (!socketRef.current || !selectedOfficeId) return;
    socketRef.current.emit('office:leave', { officeId: selectedOfficeId }, () => {
      setInOffice(false);
      setActiveUsers([]);
      setProximityPeers([]);
      activePeerConnectionsRef.current.forEach(({ pc }) => pc.close());
      activePeerConnectionsRef.current.clear();
      setPeerConnections({});
      addLog('info', `Left office ${selectedOfficeId}`);
    });
  }, [selectedOfficeId, addLog]);

  // Send movement update
  const sendMove = useCallback((targetX: number, targetY: number, label?: string) => {
    if (!socketRef.current || !inOffice) return;

    const nextSeq = sequenceRef.current++;
    const now = Date.now();

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
          }
        } else if (res && res.position) {
          setMyPosition(res.position);
          if (label) {
            addLog('info', `Moved ${label} to (${res.position.x}, ${res.position.y}) seq: ${res.position.sequence}`);
          }
        }
      }
    );
  }, [inOffice, selectedOfficeId, addLog]);

  // Handle click on canvas
  const handleMapClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!mapCanvasRef.current || !inOffice || !currentOffice) return;
    const rect = mapCanvasRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    const scaleX = currentOffice.bounds.maxX / rect.width;
    const scaleY = currentOffice.bounds.maxY / rect.height;

    const actualX = Math.round(clickX * scaleX);
    const actualY = Math.round(clickY * scaleY);

    sendMove(actualX, actualY, `via Click`);
  };

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!inOffice) return;
      const step = 20;
      let dx = 0;
      let dy = 0;

      if (e.key === 'ArrowUp' || e.key === 'w') dy = -step;
      else if (e.key === 'ArrowDown' || e.key === 's') dy = step;
      else if (e.key === 'ArrowLeft' || e.key === 'a') dx = -step;
      else if (e.key === 'ArrowRight' || e.key === 'd') dx = step;
      else return;

      e.preventDefault();
      sendMove(myPosition.x + dx, myPosition.y + dy);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [inOffice, myPosition, sendMove]);

  // Secondary client (Bob) simulation with full WebRTC signaling response
  const toggleSimBob = () => {
    if (simBobActive) {
      if (simBobSocketRef.current) {
        simBobSocketRef.current.disconnect();
        simBobSocketRef.current = null;
      }
      if (simBobPcRef.current) {
        simBobPcRef.current.close();
        simBobPcRef.current = null;
      }
      setSimBobActive(false);
      addLog('warn', 'Simulated Bob disconnected.');
    } else {
      const bobSocket: TypedClientSocket = ClientSocket({
        auth: { token: 'token-bob' },
        transports: ['websocket'],
      });

      bobSocket.on('connect', () => {
        addLog('success', 'Simulated Bob socket connected.');
        bobSocket.emit(
          'office:join',
          { officeId: selectedOfficeId, initialPosition: { x: 260, y: 240 } },
          (res) => {
            if (res.success) {
              addLog('info', 'Simulated Bob joined office at (260, 240).');
              setSimBobActive(true);
            }
          }
        );
      });

      // Bob WebRTC responder logic
      bobSocket.on('signal:offer', async (data: InboundOfferEvent) => {
        addLog('info', `Simulated Bob received offer from ${data.senderUserId}; generating answer...`);
        const bobPc = new RTCPeerConnection(RTC_CONFIG);
        simBobPcRef.current = bobPc;

        bobPc.onicecandidate = (evt) => {
          if (evt.candidate) {
            bobSocket.emit('signal:ice', {
              targetUserId: data.senderUserId,
              negotiationId: data.negotiationId,
              candidate: evt.candidate.toJSON(),
            });
          }
        };

        try {
          await bobPc.setRemoteDescription(new RTCSessionDescription(data.sdp as RTCSessionDescriptionInit));
          const ans = await bobPc.createAnswer();
          await bobPc.setLocalDescription(ans);
          bobSocket.emit('signal:answer', {
            targetUserId: data.senderUserId,
            negotiationId: data.negotiationId,
            sdp: { type: ans.type, sdp: ans.sdp },
          });
          addLog('success', `Simulated Bob answered WebRTC offer from ${data.senderUserId}`);
        } catch (e) {
          addLog('error', `Bob failed to answer offer: ${(e as Error).message}`);
        }
      });

      bobSocket.on('signal:ice', async (data: InboundIceEvent) => {
        if (simBobPcRef.current) {
          try {
            await simBobPcRef.current.addIceCandidate(new RTCIceCandidate(data.candidate as RTCIceCandidateInit));
          } catch {
            // ignore
          }
        }
      });

      bobSocket.on('signal:peer_ineligible', () => {
        if (simBobPcRef.current) {
          simBobPcRef.current.close();
          simBobPcRef.current = null;
          addLog('info', 'Simulated Bob closed peer connection (out of earshot).');
        }
      });

      simBobSocketRef.current = bobSocket;
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* Header bar */}
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur px-6 py-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-indigo-600 flex items-center justify-center font-bold shadow-lg shadow-indigo-500/20 text-white">
            <Radio className="h-5 w-5 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight text-white">ProxiSpeak</h1>
              <span className="px-2 py-0.5 text-xs font-semibold rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                P1: Foundation
              </span>
              <span className="px-2 py-0.5 text-xs font-semibold rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                P2: Proximity
              </span>
              <span className="px-2 py-0.5 text-xs font-semibold rounded bg-purple-500/10 text-purple-400 border border-purple-500/20 flex items-center gap-1">
                <Volume2 className="h-3 w-3" /> P3: WebRTC Signaling
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Proximity-Authorized WebRTC Signaling • SDP Offer/Answer • ICE Exchange • Perfect Negotiation • Hysteresis
            </p>
          </div>
        </div>

        {/* Server & Audio Health Metrics */}
        <div className="flex items-center gap-3 text-xs">
          <button
            onClick={toggleMicrophone}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border font-semibold transition ${
              micActive
                ? 'bg-emerald-600/20 border-emerald-500/50 text-emerald-300 hover:bg-emerald-600/30'
                : 'bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700'
            }`}
          >
            {micActive ? <Mic className="h-4 w-4 text-emerald-400" /> : <MicOff className="h-4 w-4 text-slate-400" />}
            <span>{micActive ? 'Microphone Active' : 'Enable Audio/Mic'}</span>
          </button>

          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700">
            <PhoneCall className="h-4 w-4 text-purple-400" />
            <span className="text-slate-400">WebRTC Channels:</span>
            <span className="font-semibold text-purple-300">{Object.keys(peerConnections).length}</span>
          </div>

          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700">
            <Activity className="h-4 w-4 text-indigo-400" />
            <span className="text-slate-400">Socket:</span>
            <span className={`font-semibold ${connected ? 'text-emerald-400' : 'text-amber-400'}`}>
              {connected ? 'Authenticated' : 'Disconnected'}
            </span>
          </div>
        </div>
      </header>

      {/* Main Workspace Layout */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-4 gap-6 p-6 overflow-hidden">
        {/* Left Column: Auth, Office Selector & Controls */}
        <div className="space-y-6 lg:col-span-1">
          {/* Identity & Authentication Card */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-200 uppercase tracking-wider mb-3 flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-indigo-400" />
              1. Authenticated Account
            </h2>

            <div className="space-y-2 mb-4">
              {demoAccounts.map((acc) => {
                const isSelected = selectedUser?.user.id === acc.user.id;
                return (
                  <button
                    key={acc.user.id}
                    onClick={() => {
                      setSelectedUser(acc);
                      if (connected) handleConnect(acc);
                    }}
                    className={`w-full text-left p-2.5 rounded-lg border text-xs flex items-center justify-between transition ${
                      isSelected
                        ? 'border-indigo-500 bg-indigo-500/10 text-white font-medium'
                        : 'border-slate-800 bg-slate-950/40 text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <img
                        src={acc.user.avatarUrl}
                        alt={acc.user.displayName}
                        className="h-7 w-7 rounded-full bg-slate-800 border border-slate-700"
                      />
                      <div>
                        <div className="font-semibold">{acc.user.displayName}</div>
                        <div className="text-[10px] text-slate-400 font-mono">
                          {acc.simpleToken}
                        </div>
                      </div>
                    </div>
                    {acc.user.id === 'user-eve' && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
                        Guest
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <button
              onClick={() => selectedUser && handleConnect(selectedUser)}
              className="w-full py-2 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow transition flex items-center justify-center gap-2"
            >
              {connected ? 'Switch / Reconnect Socket' : 'Connect & Authenticate'}
            </button>
          </div>

          {/* Office Selection & Membership Card */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-200 uppercase tracking-wider mb-3 flex items-center gap-2">
              <Users className="h-4 w-4 text-emerald-400" />
              2. Virtual Office Room
            </h2>

            <div className="space-y-3 mb-4">
              {offices.map((off) => {
                const isSelected = selectedOfficeId === off.id;
                const isRestricted = off.accessPolicy === 'members_only';
                return (
                  <div
                    key={off.id}
                    onClick={() => setSelectedOfficeId(off.id)}
                    className={`p-3 rounded-lg border cursor-pointer transition ${
                      isSelected
                        ? 'border-emerald-500/60 bg-emerald-500/10 text-white'
                        : 'border-slate-800 bg-slate-950/40 text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-semibold text-xs">{off.name}</span>
                      {isRestricted ? (
                        <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-400 border border-rose-500/20">
                          <Lock className="h-2.5 w-2.5" /> Restricted
                        </span>
                      ) : (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                          Public
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-slate-500 mt-1 font-mono">
                      Bounds: {off.bounds.maxX}x{off.bounds.maxY}px
                    </div>
                  </div>
                );
              })}
            </div>

            {inOffice ? (
              <button
                onClick={handleLeaveOffice}
                className="w-full py-2 px-3 rounded-lg bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/30 text-xs font-semibold transition flex items-center justify-center gap-2"
              >
                <LogOut className="h-3.5 w-3.5" /> Leave Office
              </button>
            ) : (
              <button
                onClick={() => handleJoinOffice(selectedOfficeId)}
                disabled={!connected}
                className="w-full py-2 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold shadow transition flex items-center justify-center gap-2"
              >
                <ArrowRight className="h-3.5 w-3.5" /> Enter Selected Office
              </button>
            )}

            {lastError && (
              <div className="mt-3 p-2.5 rounded-lg bg-rose-950/50 border border-rose-800/80 text-rose-300 text-xs flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400 mt-0.5" />
                <span>{lastError}</span>
              </div>
            )}
          </div>

          {/* WebRTC Peer Simulator Card */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-200 uppercase tracking-wider mb-2 flex items-center gap-2">
              <Zap className="h-4 w-4 text-purple-400" />
              WebRTC Audio Peer Simulator
            </h2>
            <p className="text-xs text-slate-400 mb-3">
              Spawn Bob in the room to test proximity-triggered SDP offer/answer relay and ICE candidate exchange:
            </p>

            <button
              onClick={toggleSimBob}
              className={`w-full py-2 px-3 rounded-lg text-xs font-semibold border transition ${
                simBobActive
                  ? 'bg-purple-600/20 border-purple-500/40 text-purple-300 hover:bg-purple-600/30'
                  : 'bg-indigo-600/20 border-indigo-500/40 text-indigo-300 hover:bg-indigo-600/30'
              }`}
            >
              {simBobActive ? 'Disconnect Bob WebRTC Peer' : 'Spawn Bob to Test WebRTC Signaling'}
            </button>
          </div>
        </div>

        {/* Center Canvas: Live 2D Office with Visual Earshot Radius & Audio Connections */}
        <div className="lg:col-span-2 flex flex-col space-y-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex-1 flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Move className="h-4 w-4 text-indigo-400" />
                <h3 className="font-semibold text-sm text-slate-200">
                  {currentOffice ? currentOffice.name : 'Virtual Office Canvas'}
                </h3>
              </div>
              <div className="flex items-center gap-3 text-xs text-slate-400 font-mono">
                {inOffice && (
                  <>
                    <span>Position: ({myPosition.x}, {myPosition.y})</span>
                    <span className="text-emerald-400">Online: {activeUsers.length}</span>
                    <span className="text-purple-400">WebRTC Channels: {Object.keys(peerConnections).length}</span>
                  </>
                )}
              </div>
            </div>

            {/* 2D Interactive Map */}
            <div
              ref={mapCanvasRef}
              onClick={handleMapClick}
              className="relative w-full aspect-[4/3] max-h-[520px] rounded-lg bg-slate-950 border-2 border-slate-800 cursor-crosshair overflow-hidden shadow-inner flex-1 select-none"
              style={{
                backgroundImage: 'radial-gradient(circle, #1e293b 1px, transparent 1px)',
                backgroundSize: '24px 24px',
              }}
            >
              {!inOffice && (
                <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-xs flex flex-col items-center justify-center p-6 text-center z-20">
                  <Lock className="h-8 w-8 text-slate-600 mb-2" />
                  <p className="text-sm font-medium text-slate-300">Office Room Not Active</p>
                  <p className="text-xs text-slate-500 max-w-sm mt-1">
                    Connect an authenticated socket and click &ldquo;Enter Selected Office&rdquo; to test real-time WebRTC audio signaling.
                  </p>
                </div>
              )}

              {/* Render Obstacles / Walls / Desks */}
              {currentOffice?.obstacles.map((obs) => {
                const leftPct = (obs.x / currentOffice.bounds.maxX) * 100;
                const topPct = (obs.y / currentOffice.bounds.maxY) * 100;
                const widthPct = (obs.width / currentOffice.bounds.maxX) * 100;
                const heightPct = (obs.height / currentOffice.bounds.maxY) * 100;

                return (
                  <div
                    key={obs.id}
                    className="absolute bg-rose-950/40 border border-rose-500/40 rounded flex flex-col items-center justify-center p-1 shadow pointer-events-none"
                    style={{
                      left: `${leftPct}%`,
                      top: `${topPct}%`,
                      width: `${widthPct}%`,
                      height: `${heightPct}%`,
                    }}
                  >
                    <span className="text-[10px] font-bold text-rose-300 tracking-wider uppercase text-center px-1">
                      {obs.name}
                    </span>
                    <span className="text-[9px] text-rose-400/80 font-mono">
                      Obstacle
                    </span>
                  </div>
                );
              })}

              {/* Render Proximity Radius Circles around active user */}
              {inOffice && currentOffice && (
                <>
                  {/* 110px Hysteresis Exit Circle (dashed amber) */}
                  <div
                    className="absolute rounded-full border border-dashed border-amber-400/40 pointer-events-none -translate-x-1/2 -translate-y-1/2"
                    style={{
                      left: `${(myPosition.x / currentOffice.bounds.maxX) * 100}%`,
                      top: `${(myPosition.y / currentOffice.bounds.maxY) * 100}%`,
                      width: `${((proximityConfig.exitRadius * 2) / currentOffice.bounds.maxX) * 100}%`,
                      height: `${((proximityConfig.exitRadius * 2) / currentOffice.bounds.maxY) * 100}%`,
                    }}
                  />
                  {/* 100px Entry Earshot Circle (solid emerald with subtle glow) */}
                  <div
                    className="absolute rounded-full border-2 border-emerald-500/40 bg-emerald-500/5 pointer-events-none -translate-x-1/2 -translate-y-1/2 shadow-lg shadow-emerald-500/10"
                    style={{
                      left: `${(myPosition.x / currentOffice.bounds.maxX) * 100}%`,
                      top: `${(myPosition.y / currentOffice.bounds.maxY) * 100}%`,
                      width: `${((proximityConfig.entryRadius * 2) / currentOffice.bounds.maxX) * 100}%`,
                      height: `${((proximityConfig.entryRadius * 2) / currentOffice.bounds.maxY) * 100}%`,
                    }}
                  />
                </>
              )}

              {/* Render Active Member Avatars */}
              {inOffice &&
                currentOffice &&
                activeUsers.map((member) => {
                  const isMe = member.userId === selectedUser?.user.id;
                  const pos = isMe ? myPosition : member.position;
                  const leftPct = (pos.x / currentOffice.bounds.maxX) * 100;
                  const topPct = (pos.y / currentOffice.bounds.maxY) * 100;

                  const hasWebRtc = Boolean(peerConnections[member.userId]);
                  const peerState = peerConnections[member.userId];

                  return (
                    <div
                      key={member.userId}
                      className="absolute transition-all duration-150 ease-out -translate-x-1/2 -translate-y-1/2 flex flex-col items-center pointer-events-none z-10"
                      style={{
                        left: `${leftPct}%`,
                        top: `${topPct}%`,
                      }}
                    >
                      <div
                        className={`h-8 w-8 rounded-full border-2 flex items-center justify-center shadow-lg transition-transform ${
                          isMe
                            ? 'border-indigo-400 bg-indigo-600 shadow-indigo-500/50 scale-105'
                            : hasWebRtc
                            ? 'border-purple-400 bg-purple-600 shadow-purple-500/60 ring-2 ring-purple-400/50'
                            : 'border-slate-500 bg-slate-700 shadow-slate-900/40'
                        }`}
                      >
                        <img
                          src={member.user.avatarUrl}
                          alt={member.user.displayName}
                          className="h-6 w-6 rounded-full"
                        />
                      </div>
                      <div className="mt-1 px-1.5 py-0.5 rounded bg-slate-900/90 border border-slate-700 text-[10px] font-semibold text-white whitespace-nowrap shadow flex items-center gap-1">
                        {hasWebRtc && <Volume2 className="h-2.5 w-2.5 text-purple-400 animate-pulse" />}
                        <span>{member.user.displayName} {isMe ? '(You)' : ''}</span>
                        {peerState && (
                          <span className="text-[9px] text-purple-300 font-mono">
                            [{peerState.connectionState || 'connecting'}]
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>

            {/* Controls footnote */}
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="text-slate-400 flex items-center gap-1.5">
                <span className="font-semibold text-slate-300">Controls:</span>
                <span>Click canvas or use WASD/Arrows to walk. WebRTC signaling automatically triggers when within 100px.</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: WebRTC Peer Connections & Live Signaling Audit */}
        <div className="space-y-6 lg:col-span-1">
          {/* Active WebRTC Peer Channels */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-slate-200 uppercase tracking-wider mb-3 flex items-center justify-between">
              <span className="flex items-center gap-2">
                <PhoneCall className="h-4 w-4 text-purple-400" />
                Active WebRTC Peers
              </span>
              <span className="text-xs px-2 py-0.5 rounded bg-purple-500/10 text-purple-400 font-mono">
                {Object.keys(peerConnections).length} active
              </span>
            </h3>

            {Object.keys(peerConnections).length === 0 ? (
              <div className="p-4 rounded-lg bg-slate-950/40 border border-slate-800/80 text-center">
                <PhoneOff className="h-6 w-6 text-slate-600 mx-auto mb-1.5" />
                <p className="text-xs text-slate-400">No WebRTC peer connections.</p>
                <p className="text-[11px] text-slate-500 mt-1">Walk within 100px of another user or spawn Bob.</p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {Object.values(peerConnections).map((peer) => {
                  const member = activeUsers.find((u) => u.userId === peer.peerUserId);
                  return (
                    <div
                      key={peer.peerUserId}
                      className="p-2.5 rounded-lg bg-purple-950/20 border border-purple-500/30 text-xs flex flex-col gap-1.5"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="h-2 w-2 rounded-full bg-purple-400 animate-ping" />
                          <span className="font-semibold text-slate-200">
                            {member?.user.displayName ?? peer.peerUserId}
                          </span>
                        </div>
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30 font-mono">
                          {peer.isOfferer ? 'Offerer' : 'Answerer (Polite)'}
                        </span>
                      </div>

                      <div className="text-[10px] text-slate-400 font-mono grid grid-cols-2 gap-1 bg-slate-950/60 p-1.5 rounded">
                        <div>State: <span className="text-purple-300 font-semibold">{peer.connectionState || 'connecting'}</span></div>
                        <div>ICE: <span className="text-cyan-300 font-semibold">{peer.iceConnectionState || 'new'}</span></div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Live Socket Event Audit Log */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm flex flex-col h-80">
            <h3 className="text-sm font-semibold text-slate-200 uppercase tracking-wider mb-2 flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Layers className="h-4 w-4 text-indigo-400" />
                Signaling Event Log
              </span>
              <button
                onClick={() => setLogs([])}
                className="text-[10px] text-slate-400 hover:text-slate-200"
              >
                Clear
              </button>
            </h3>

            <div className="flex-1 overflow-y-auto space-y-1.5 font-mono text-[11px] pr-1">
              {logs.length === 0 ? (
                <p className="text-slate-600 text-xs italic py-2">Waiting for WebRTC signaling events...</p>
              ) : (
                logs.map((log) => {
                  let color = 'text-slate-400';
                  if (log.type === 'success') color = 'text-emerald-400';
                  if (log.type === 'warn') color = 'text-amber-400';
                  if (log.type === 'error') color = 'text-rose-400';

                  return (
                    <div
                      key={log.id}
                      className="p-1.5 rounded bg-slate-950/50 border border-slate-800/60 leading-tight"
                    >
                      <span className="text-slate-500 text-[10px] mr-1.5">[{log.timestamp}]</span>
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
