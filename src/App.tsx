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

  // Simulation of secondary peer (Bob)
  const [simBobActive, setSimBobActive] = useState(false);
  const simBobSocketRef = useRef<TypedClientSocket | null>(null);
  const [simBobPos, setSimBobPos] = useState<{ x: number; y: number; seq: number }>({ x: 260, y: 250, seq: 1 });

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

  // Connect or switch active socket
  const handleConnect = useCallback((account: DemoAccount) => {
    if (socketRef.current) {
      socketRef.current.disconnect();
    }

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

    socketRef.current = s;
  }, [addLog]);

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

    // Scale from displayed canvas size to actual office coordinates
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

  // Secondary client (Bob) simulation
  const toggleSimBob = () => {
    if (simBobActive) {
      if (simBobSocketRef.current) {
        simBobSocketRef.current.disconnect();
        simBobSocketRef.current = null;
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

      simBobSocketRef.current = bobSocket;
    }
  };

  // Make Bob oscillate near the 100px boundary to showcase hysteresis
  const testBobHysteresisOscillation = () => {
    if (!simBobSocketRef.current || !inOffice) return;
    addLog('info', 'Testing boundary oscillation (95px -> 105px -> 98px): observing zero connection churn...');
    // Alice is at myPosition. Move Bob to 95px away, then 105px away
    const seq = simBobPos.seq + 1;
    simBobSocketRef.current.emit('avatar:move', {
      officeId: selectedOfficeId,
      x: myPosition.x + 95,
      y: myPosition.y,
      sequence: seq,
      timestamp: Date.now(),
    });
    setSimBobPos({ x: myPosition.x + 95, y: myPosition.y, seq });
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
                Person 1: Foundation
              </span>
              <span className="px-2 py-0.5 text-xs font-semibold rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                <Compass className="h-3 w-3" /> Person 2: Geospatial & Proximity
              </span>
            </div>
            <p className="text-xs text-slate-400">
              MongoDB 2D Flat Geospatial Indexes • $near & $geoWithin • Euclidean Distance • 100px Radius • Exit Hysteresis
            </p>
          </div>
        </div>

        {/* Server & Health Metrics */}
        <div className="flex items-center gap-3 text-xs">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700">
            <ServerIcon className="h-4 w-4 text-emerald-400" />
            <span className="text-slate-400">Health:</span>
            <span className="font-semibold text-emerald-400">
              {healthStatus?.status === 'ok' ? 'Online' : 'Checking...'}
            </span>
          </div>

          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700">
            <Headphones className="h-4 w-4 text-cyan-400" />
            <span className="text-slate-400">Peers in Earshot:</span>
            <span className="font-semibold text-cyan-300">{proximityPeers.length}</span>
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
              1. Socket Authentication
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
              2. Office Membership & Entry
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

          {/* Spatial Proximity Rules Card */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-200 uppercase tracking-wider mb-2 flex items-center gap-2">
              <Zap className="h-4 w-4 text-amber-400" />
              Proximity Rules & Engine
            </h2>
            <div className="space-y-2 text-xs text-slate-400">
              <div className="flex justify-between border-b border-slate-800/80 pb-1.5">
                <span>Entry Earshot Radius:</span>
                <span className="font-mono text-emerald-400 font-semibold">{proximityConfig.entryRadius} px</span>
              </div>
              <div className="flex justify-between border-b border-slate-800/80 pb-1.5">
                <span>Exit Hysteresis Boundary:</span>
                <span className="font-mono text-amber-400 font-semibold">{proximityConfig.exitRadius} px</span>
              </div>
              <div className="flex justify-between border-b border-slate-800/80 pb-1.5">
                <span>MongoDB Geospatial Index:</span>
                <span className="font-mono text-cyan-400 font-semibold">&#123; position: &quot;2d&quot; &#125;</span>
              </div>
              <div className="flex justify-between pb-1">
                <span>Stale Position Timeout:</span>
                <span className="font-mono text-slate-300 font-semibold">15,000 ms</span>
              </div>
            </div>

            <div className="mt-3 pt-3 border-t border-slate-800 flex flex-col gap-2">
              <button
                onClick={toggleSimBob}
                className={`w-full py-2 px-3 rounded-lg text-xs font-semibold border transition ${
                  simBobActive
                    ? 'bg-amber-600/20 border-amber-500/40 text-amber-300 hover:bg-amber-600/30'
                    : 'bg-cyan-600/20 border-cyan-500/40 text-cyan-300 hover:bg-cyan-600/30'
                }`}
              >
                {simBobActive ? 'Stop Bob Simulation' : 'Spawn Bob to Test Earshot'}
              </button>

              {simBobActive && inOffice && (
                <button
                  onClick={testBobHysteresisOscillation}
                  className="w-full py-1.5 px-3 rounded-lg text-[11px] font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition"
                >
                  Step Bob to Hysteresis Zone (95px)
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Center Canvas: Live 2D Office with Visual Earshot Radius */}
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
                    <span className="text-cyan-400">Peers: {proximityPeers.length}</span>
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
                    Connect an authenticated socket and click &ldquo;Enter Selected Office&rdquo; to view real-time presence and test movement.
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

                  const isPeer = proximityPeers.some((p) => p.userId === member.userId);
                  const peerData = proximityPeers.find((p) => p.userId === member.userId);

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
                            : isPeer
                            ? 'border-emerald-400 bg-emerald-600 shadow-emerald-500/60 ring-2 ring-emerald-400/50'
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
                        {isPeer && <Headphones className="h-2.5 w-2.5 text-emerald-400" />}
                        <span>{member.user.displayName} {isMe ? '(You)' : ''}</span>
                        {peerData && (
                          <span className="text-[9px] text-emerald-400 font-mono">
                            {peerData.distance.toFixed(1)}px
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>

            {/* Quick Test Actions */}
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="text-slate-400 flex items-center gap-1.5">
                <span className="font-semibold text-slate-300">Controls:</span>
                <span>Click canvas or use WASD / Arrow Keys. Green circle shows 100px earshot; dashed circle shows 110px exit hysteresis.</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Peers In Earshot & Live Event Audit */}
        <div className="space-y-6 lg:col-span-1">
          {/* Active Audio Peers in Earshot */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-slate-200 uppercase tracking-wider mb-3 flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Headphones className="h-4 w-4 text-emerald-400" />
                Audio Peers In Range
              </span>
              <span className="text-xs px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-mono">
                {proximityPeers.length} eligible
              </span>
            </h3>

            {proximityPeers.length === 0 ? (
              <div className="p-4 rounded-lg bg-slate-950/40 border border-slate-800/80 text-center">
                <p className="text-xs text-slate-400">No peers within 100px earshot radius.</p>
                <p className="text-[11px] text-slate-500 mt-1">Move closer to other avatars or spawn Bob.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {proximityPeers.map((peer) => {
                  const member = activeUsers.find((u) => u.userId === peer.userId);
                  const isHysteresis = peer.distance > proximityConfig.entryRadius;
                  return (
                    <div
                      key={peer.userId}
                      className="p-2.5 rounded-lg bg-emerald-950/20 border border-emerald-500/30 text-xs flex items-center justify-between"
                    >
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
                        <div>
                          <div className="font-semibold text-slate-200">
                            {member?.user.displayName ?? peer.userId}
                          </div>
                          <div className="text-[10px] text-emerald-400 font-mono">
                            Euclidean: {peer.distance} px
                          </div>
                        </div>
                      </div>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                        isHysteresis
                          ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                          : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                      }`}>
                        {isHysteresis ? 'Hysteresis (Exit at 110px)' : 'In Earshot (<=100px)'}
                      </span>
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
                Event Audit Log
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
                <p className="text-slate-600 text-xs italic py-2">Waiting for proximity / presence activity...</p>
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
