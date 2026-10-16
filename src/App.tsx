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

  // Simulation of secondary peer (Bob)
  const [simBobActive, setSimBobActive] = useState(false);
  const simBobSocketRef = useRef<TypedClientSocket | null>(null);
  const [simBobPos, setSimBobPos] = useState<{ x: number; y: number; seq: number }>({ x: 240, y: 220, seq: 1 });

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

  // Fetch initial system state
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
      } catch (err) {
        console.error('Failed to query backend info:', err);
      }
    };

    fetchSystemInfo();
    const interval = setInterval(fetchSystemInfo, 6000);
    return () => clearInterval(interval);
  }, []);

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
          { officeId: selectedOfficeId, initialPosition: { x: 300, y: 220 } },
          (res) => {
            if (res.success) {
              addLog('info', 'Simulated Bob joined office.');
              setSimBobActive(true);
            }
          }
        );
      });

      simBobSocketRef.current = bobSocket;
    }
  };

  // Make Bob walk back and forth if simulation active
  useEffect(() => {
    if (!simBobActive || !simBobSocketRef.current) return;
    const timer = setInterval(() => {
      setSimBobPos((prev) => {
        const nextX = prev.x > 380 ? 250 : prev.x + 25;
        const nextSeq = prev.seq + 1;
        simBobSocketRef.current?.emit('avatar:move', {
          officeId: selectedOfficeId,
          x: nextX,
          y: prev.y,
          sequence: nextSeq,
          timestamp: Date.now(),
        });
        return { ...prev, x: nextX, seq: nextSeq };
      });
    }, 2000);

    return () => clearInterval(timer);
  }, [simBobActive, selectedOfficeId]);

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
                Person 1: Foundation Owner
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Shared Backend Foundation • Auth • Presence Sockets • Authoritative Movement
            </p>
          </div>
        </div>

        {/* Server & Health Metrics */}
        <div className="flex items-center gap-4 text-xs">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700">
            <ServerIcon className="h-4 w-4 text-emerald-400" />
            <span className="text-slate-400">Health:</span>
            <span className="font-semibold text-emerald-400">
              {healthStatus?.status === 'ok' ? 'Online' : 'Checking...'}
            </span>
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
            <p className="text-xs text-slate-400 mb-4">
              Select a seeded user account to authenticate via handshake token:
            </p>

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
                    <p className="text-[11px] text-slate-400 line-clamp-1">{off.description}</p>
                    <div className="text-[10px] text-slate-500 mt-1 font-mono">
                      Bounds: {off.bounds.maxX}x{off.bounds.maxY}px • {off.obstacles.length} Obstacles
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

          {/* Multi-Client Peer Simulation */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-200 uppercase tracking-wider mb-2 flex items-center gap-2">
              <Compass className="h-4 w-4 text-cyan-400" />
              Multi-Client Peer Simulator
            </h2>
            <p className="text-xs text-slate-400 mb-3">
              Spawn a simulated second user (Bob) on a parallel WebSocket to test live synchronized presence:
            </p>
            <button
              onClick={toggleSimBob}
              className={`w-full py-2 px-3 rounded-lg text-xs font-semibold border transition ${
                simBobActive
                  ? 'bg-amber-600/20 border-amber-500/40 text-amber-300 hover:bg-amber-600/30'
                  : 'bg-cyan-600/20 border-cyan-500/40 text-cyan-300 hover:bg-cyan-600/30'
              }`}
            >
              {simBobActive ? 'Stop Bob Simulation' : 'Spawn Bob in Current Office'}
            </button>
          </div>
        </div>

        {/* Center Canvas: Live 2D Office & Authoritative Movement */}
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
                    <span>Seq: #{myPosition.sequence}</span>
                    <span className="text-emerald-400">Online: {activeUsers.length}</span>
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
                      Obstacle / Wall
                    </span>
                  </div>
                );
              })}

              {/* Render Active Member Avatars */}
              {inOffice &&
                currentOffice &&
                activeUsers.map((member) => {
                  const isMe = member.userId === selectedUser?.user.id;
                  const pos = isMe ? myPosition : member.position;
                  const leftPct = (pos.x / currentOffice.bounds.maxX) * 100;
                  const topPct = (pos.y / currentOffice.bounds.maxY) * 100;

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
                        className={`h-8 w-8 rounded-full border-2 flex items-center justify-center shadow-lg ${
                          isMe
                            ? 'border-indigo-400 bg-indigo-600 shadow-indigo-500/50'
                            : 'border-emerald-400 bg-emerald-600 shadow-emerald-500/40'
                        }`}
                      >
                        <img
                          src={member.user.avatarUrl}
                          alt={member.user.displayName}
                          className="h-6 w-6 rounded-full"
                        />
                      </div>
                      <div className="mt-1 px-1.5 py-0.5 rounded bg-slate-900/90 border border-slate-700 text-[10px] font-semibold text-white whitespace-nowrap shadow">
                        {member.user.displayName} {isMe ? '(You)' : ''}
                      </div>
                    </div>
                  );
                })}
            </div>

            {/* Quick Test Actions */}
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="text-slate-400 flex items-center gap-1.5">
                <span className="font-semibold text-slate-300">Controls:</span>
                <span>Click canvas or use WASD / Arrow Keys to move avatar.</span>
              </div>

              {/* Edge Case Test Buttons */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => sendMove(-50, 200, 'Test Out-of-Bounds')}
                  disabled={!inOffice}
                  className="px-2.5 py-1.5 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-[11px] font-medium text-slate-300 border border-slate-700"
                >
                  Test Negative Coord
                </button>
                <button
                  onClick={() => {
                    if (currentOffice?.obstacles[0]) {
                      const obs = currentOffice.obstacles[0];
                      sendMove(obs.x + 10, obs.y + 10, 'Test Wall Collision');
                    }
                  }}
                  disabled={!inOffice}
                  className="px-2.5 py-1.5 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-[11px] font-medium text-slate-300 border border-slate-700"
                >
                  Test Wall Collision
                </button>
                <button
                  onClick={() => sendMove(myPosition.x + 800, myPosition.y, 'Test Excessive Speed')}
                  disabled={!inOffice}
                  className="px-2.5 py-1.5 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-[11px] font-medium text-slate-300 border border-slate-700"
                >
                  Test Teleport Rejection
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Live Event Audit & Sockets Inspector */}
        <div className="space-y-6 lg:col-span-1">
          {/* Active Members Snapshot */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-slate-200 uppercase tracking-wider mb-3 flex items-center justify-between">
              <span>Office Presence</span>
              <span className="text-xs px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-mono">
                {activeUsers.length} in room
              </span>
            </h3>

            {activeUsers.length === 0 ? (
              <p className="text-xs text-slate-500 italic">No users currently in this office.</p>
            ) : (
              <div className="space-y-2">
                {activeUsers.map((m) => (
                  <div
                    key={m.userId}
                    className="p-2 rounded-lg bg-slate-950/60 border border-slate-800 text-xs flex items-center justify-between"
                  >
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                      <span className="font-medium text-slate-200">{m.user.displayName}</span>
                    </div>
                    <span className="text-[10px] font-mono text-slate-400">
                      ({m.position.x}, {m.position.y})
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Live Socket Event Audit Log */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm flex flex-col h-80">
            <h3 className="text-sm font-semibold text-slate-200 uppercase tracking-wider mb-2 flex items-center justify-between">
              <span>Socket Event Log</span>
              <button
                onClick={() => setLogs([])}
                className="text-[10px] text-slate-400 hover:text-slate-200"
              >
                Clear
              </button>
            </h3>

            <div className="flex-1 overflow-y-auto space-y-1.5 font-mono text-[11px] pr-1">
              {logs.length === 0 ? (
                <p className="text-slate-600 text-xs italic py-2">Waiting for socket activity...</p>
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
