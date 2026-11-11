import React, { useEffect, useState, useRef, useCallback } from 'react';
import { PeerAudioWaveform, SpatialAudioProfile } from './components/PeerAudioWaveform';
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
  HelpCircle,
  X,
  Search,
} from 'lucide-react';
import { Office, Obstacle, SoundOcclusionResult } from './shared/contracts/office.types';
import {
  AvatarPosition,
  FacingDirection,
  PresenceSnapshot,
  PresenceUser,
  UserStatus,
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
  status?: UserStatus;
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

const DEFAULT_OFFICE: Office = {
  id: 'infotact-office',
  name: 'Infotact Main Campus',
  description: 'Primary collaborative workspace for engineering and product teams.',
  capacity: 45,
  bounds: { minX: 0, minY: 0, maxX: 1200, maxY: 800 },
  width: 1200,
  height: 800,
  layoutVersion: 1,
  accessPolicy: 'members_only',
  defaultSpawnPosition: { x: 200, y: 200 },
  obstacles: [
    {
      id: 'pod-1',
      name: 'Engineering Desks',
      shape: 'rectangle',
      x: 400,
      y: 250,
      width: 250,
      height: 140,
      blocksMovement: true,
      blocksSound: false,
      attenuation: 0.8,
    },
    {
      id: 'partition-wall',
      name: 'Conference Partition',
      shape: 'rectangle',
      x: 800,
      y: 100,
      width: 30,
      height: 380,
      blocksMovement: true,
      blocksSound: true,
      attenuation: 0,
    },
    {
      id: 'coffee-lounge',
      name: 'Coffee Bar',
      shape: 'rectangle',
      x: 100,
      y: 550,
      width: 180,
      height: 100,
      blocksMovement: true,
      blocksSound: false,
      attenuation: 0.9,
    },
  ],
  createdAt: new Date(),
};

const DEFAULT_DEMO_ACCOUNTS: DemoAccount[] = [
  {
    user: {
      id: 'user-alice',
      username: 'alice',
      displayName: 'Alice Chen',
      avatarUrl: 'https://api.dicebear.com/7.x/bottts/svg?seed=Alice',
      email: 'alice@infotact.com',
      roleTitle: 'Lead Platform Architect',
      department: 'Core Infrastructure',
      themeColor: '#6366f1',
      statusText: 'Reviewing geospatial indexing & office bounds',
      badge: 'Admin',
      createdAt: new Date(),
    },
    token: 'token-alice',
    simpleToken: 'token-alice',
  },
  {
    user: {
      id: 'user-bob',
      username: 'bob',
      displayName: 'Bob Martin',
      avatarUrl: 'https://api.dicebear.com/7.x/bottts/svg?seed=Bob',
      email: 'bob@infotact.com',
      roleTitle: 'Spatial Audio Engineer',
      department: 'Acoustic Labs',
      themeColor: '#a855f7',
      statusText: 'Calibrating WebRTC perfect negotiation',
      badge: 'Audio',
      createdAt: new Date(),
    },
    token: 'token-bob',
    simpleToken: 'token-bob',
  },
  {
    user: {
      id: 'user-charlie',
      username: 'charlie',
      displayName: 'Charlie Kim',
      avatarUrl: 'https://api.dicebear.com/7.x/bottts/svg?seed=Charlie',
      email: 'charlie@infotact.com',
      roleTitle: 'Lead UI/UX Designer',
      department: 'Product Experience',
      themeColor: '#ec4899',
      statusText: 'Designing 2D spatial canvas & collision visuals',
      badge: 'Design',
      createdAt: new Date(),
    },
    token: 'token-charlie',
    simpleToken: 'token-charlie',
  },
  {
    user: {
      id: 'user-eve',
      username: 'eve',
      displayName: 'Eve Vance',
      avatarUrl: 'https://api.dicebear.com/7.x/bottts/svg?seed=Eve',
      email: 'eve@external-contractor.com',
      roleTitle: 'Security Auditor',
      department: 'External Compliance',
      themeColor: '#f59e0b',
      statusText: 'Testing office boundary & token isolation',
      badge: 'Guest',
      createdAt: new Date(),
    },
    token: 'token-eve',
    simpleToken: 'token-eve',
  },
  {
    user: {
      id: 'user-maya',
      username: 'maya',
      displayName: 'Maya Patel',
      avatarUrl: 'https://api.dicebear.com/7.x/bottts/svg?seed=Maya',
      email: 'maya@infotact.com',
      roleTitle: 'VP of Workplace Strategy',
      department: 'Executive',
      themeColor: '#10b981',
      statusText: 'Scheduling cross-functional all-hands',
      badge: 'Executive',
      createdAt: new Date(),
    },
    token: 'token-maya',
    simpleToken: 'token-maya',
  },
  {
    user: {
      id: 'user-liam',
      username: 'liam',
      displayName: 'Liam Gallagher',
      avatarUrl: 'https://api.dicebear.com/7.x/bottts/svg?seed=Liam',
      email: 'liam@infotact.com',
      roleTitle: 'Real-Time Protocol Engineer',
      department: 'Networking Systems',
      themeColor: '#06b6d4',
      statusText: 'Optimizing Socket.io Redis adapter cluster',
      badge: 'Network',
      createdAt: new Date(),
    },
    token: 'token-liam',
    simpleToken: 'token-liam',
  },
  {
    user: {
      id: 'user-elena',
      username: 'elena',
      displayName: 'Elena Rostova',
      avatarUrl: 'https://api.dicebear.com/7.x/bottts/svg?seed=Elena',
      email: 'elena@infotact.com',
      roleTitle: 'Acoustic ML Scientist',
      department: 'Sound Intelligence',
      themeColor: '#3b82f6',
      statusText: 'Simulating sound attenuation through wall partitions',
      badge: 'Acoustics',
      createdAt: new Date(),
    },
    token: 'token-elena',
    simpleToken: 'token-elena',
  },
  {
    user: {
      id: 'user-marcus',
      username: 'marcus',
      displayName: 'Marcus Thorne',
      avatarUrl: 'https://api.dicebear.com/7.x/bottts/svg?seed=Marcus',
      email: 'marcus@infotact.com',
      roleTitle: 'Site Reliability Architect',
      department: 'Cloud Ops',
      themeColor: '#84cc16',
      statusText: 'Watching Redis sentinel & MongoDB latency',
      badge: 'DevOps',
      createdAt: new Date(),
    },
    token: 'token-marcus',
    simpleToken: 'token-marcus',
  },
  {
    user: {
      id: 'user-zara',
      username: 'zara',
      displayName: 'Zara Al-Mansoor',
      avatarUrl: 'https://api.dicebear.com/7.x/bottts/svg?seed=Zara',
      email: 'zara@infotact.com',
      roleTitle: 'Community & Culture Lead',
      department: 'People Operations',
      themeColor: '#f43f5e',
      statusText: 'Hosting coffee lounge informal break',
      badge: 'Culture',
      createdAt: new Date(),
    },
    token: 'token-zara',
    simpleToken: 'token-zara',
  },
  {
    user: {
      id: 'user-dexter',
      username: 'dexter',
      displayName: 'Dexter-9 (Bot)',
      avatarUrl: 'https://api.dicebear.com/7.x/bottts/svg?seed=Dexter',
      email: 'bot@infotact.com',
      roleTitle: 'Autonomous Telepresence Agent',
      department: 'Office Robotics',
      themeColor: '#eab308',
      statusText: 'Patrolling 100px proximity perimeters',
      badge: 'Robot',
      createdAt: new Date(),
    },
    token: 'token-dexter',
    simpleToken: 'token-dexter',
  },
  {
    user: {
      id: 'user-kenji',
      username: 'kenji',
      displayName: 'Kenji Sato',
      avatarUrl: 'https://api.dicebear.com/7.x/bottts/svg?seed=Kenji',
      email: 'kenji@infotact.com',
      roleTitle: 'Principal AI Systems Engineer',
      department: 'Core Infrastructure',
      themeColor: '#0ea5e9',
      statusText: 'Benchmarking neural audio noise suppression',
      badge: 'AI',
      createdAt: new Date(),
    },
    token: 'token-kenji',
    simpleToken: 'token-kenji',
  },
  {
    user: {
      id: 'user-priya',
      username: 'priya',
      displayName: 'Priya Nair',
      avatarUrl: 'https://api.dicebear.com/7.x/bottts/svg?seed=Priya',
      email: 'priya@infotact.com',
      roleTitle: 'Head of Spatial Computer Vision',
      department: 'Acoustic Labs',
      themeColor: '#8b5cf6',
      statusText: 'Mapping 3D occlusion raycasts to room boundaries',
      badge: 'Vision',
      createdAt: new Date(),
    },
    token: 'token-priya',
    simpleToken: 'token-priya',
  },
  {
    user: {
      id: 'user-sofia',
      username: 'sofia',
      displayName: 'Sofia Rodriguez',
      avatarUrl: 'https://api.dicebear.com/7.x/bottts/svg?seed=Sofia',
      email: 'sofia@infotact.com',
      roleTitle: 'Staff Product Designer',
      department: 'Product Experience',
      themeColor: '#ec4899',
      statusText: 'Prototyping spatial sound wave visualizers',
      badge: 'Design',
      createdAt: new Date(),
    },
    token: 'token-sofia',
    simpleToken: 'token-sofia',
  },
  {
    user: {
      id: 'user-tariq',
      username: 'tariq',
      displayName: 'Tariq Al-Hassan',
      avatarUrl: 'https://api.dicebear.com/7.x/bottts/svg?seed=Tariq',
      email: 'tariq@infotact.com',
      roleTitle: 'Zero-Trust Cryptographic Architect',
      department: 'External Compliance',
      themeColor: '#e11d48',
      statusText: 'Auditing WebRTC DTLS-SRTP key exchanges',
      badge: 'SecOps',
      createdAt: new Date(),
    },
    token: 'token-tariq',
    simpleToken: 'token-tariq',
  },
  {
    user: {
      id: 'user-david',
      username: 'david',
      displayName: 'David Kim',
      avatarUrl: 'https://api.dicebear.com/7.x/bottts/svg?seed=David',
      email: 'david@infotact.com',
      roleTitle: 'Chief Technology Officer',
      department: 'Executive',
      themeColor: '#4f46e5',
      statusText: 'Evaluating global spatial presence roadmap',
      badge: 'Executive',
      createdAt: new Date(),
    },
    token: 'token-david',
    simpleToken: 'token-david',
  },
  {
    user: {
      id: 'user-hannah',
      username: 'hannah',
      displayName: 'Hannah Schmidt',
      avatarUrl: 'https://api.dicebear.com/7.x/bottts/svg?seed=Hannah',
      email: 'hannah@infotact.com',
      roleTitle: 'Psychoacoustics Research Lead',
      department: 'Sound Intelligence',
      themeColor: '#d97706',
      statusText: 'Calibrating HRTF head-shadow interaural delays',
      badge: 'Acoustics',
      createdAt: new Date(),
    },
    token: 'token-hannah',
    simpleToken: 'token-hannah',
  },
  {
    user: {
      id: 'user-oliver',
      username: 'oliver',
      displayName: 'Oliver Vance',
      avatarUrl: 'https://api.dicebear.com/7.x/bottts/svg?seed=Oliver',
      email: 'oliver@infotact.com',
      roleTitle: 'Developer Relations & SDK Lead',
      department: 'Product Experience',
      themeColor: '#14b8a6',
      statusText: 'Writing spatial audio WebRTC integration docs',
      badge: 'DevRel',
      createdAt: new Date(),
    },
    token: 'token-oliver',
    simpleToken: 'token-oliver',
  },
  {
    user: {
      id: 'user-nadia',
      username: 'nadia',
      displayName: 'Nadia O\'Connor',
      avatarUrl: 'https://api.dicebear.com/7.x/bottts/svg?seed=Nadia',
      email: 'nadia@infotact.com',
      roleTitle: 'Workplace Operations Director',
      department: 'People Operations',
      themeColor: '#10b981',
      statusText: 'Optimizing collaborative office floorplans',
      badge: 'Ops',
      createdAt: new Date(),
    },
    token: 'token-nadia',
    simpleToken: 'token-nadia',
  },
  {
    user: {
      id: 'user-rover',
      username: 'rover',
      displayName: 'Rover-7 (Bot)',
      avatarUrl: 'https://api.dicebear.com/7.x/bottts/svg?seed=Rover',
      email: 'rover@infotact.com',
      roleTitle: 'Autonomous Telepresence Sentry',
      department: 'Office Robotics',
      themeColor: '#f59e0b',
      statusText: 'Patrolling conference room boundaries',
      badge: 'Robot',
      createdAt: new Date(),
    },
    token: 'token-rover',
    simpleToken: 'token-rover',
  },
  {
    user: {
      id: 'user-atlas',
      username: 'atlas',
      displayName: 'Atlas-3 (Drone)',
      avatarUrl: 'https://api.dicebear.com/7.x/bottts/svg?seed=Atlas',
      email: 'atlas@infotact.com',
      roleTitle: 'Acoustic Calibration Drone',
      department: 'Office Robotics',
      themeColor: '#06b6d4',
      statusText: 'Mapping audio reflection coefficients',
      badge: 'Drone',
      createdAt: new Date(),
    },
    token: 'token-atlas',
    simpleToken: 'token-atlas',
  },
];

/**
 * Safely fetches and parses JSON, verifying Content-Type before calling .json()
 * Protects against SyntaxError: Unexpected token '<' when receiving HTML fallbacks.
 */
async function safeFetchJson<T = any>(url: string, options?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(url, options);
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.toLowerCase().includes('application/json')) {
      return null;
    }
    return (await res.json()) as T;
  } catch {
    // Transient network drops or server warmups silently resolve to null
    return null;
  }
}

const clientGeometry = new GeometryService();

export default function App() {
  const [healthStatus, setHealthStatus] = useState<{ status: string; uptime: number } | null>({
    status: 'ok',
    uptime: 1,
  });
  const [demoAccounts, setDemoAccounts] = useState<DemoAccount[]>(DEFAULT_DEMO_ACCOUNTS);
  const [offices, setOffices] = useState<Office[]>([DEFAULT_OFFICE]);
  const [selectedUser, setSelectedUser] = useState<DemoAccount | null>(DEFAULT_DEMO_ACCOUNTS[0]);
  const [selectedOfficeId, setSelectedOfficeId] = useState<string>('infotact-office');
  const [departmentFilter, setDepartmentFilter] = useState<string>('all');
  const [officeSearchQuery, setOfficeSearchQuery] = useState<string>('');

  // Connection state
  const [connected, setConnected] = useState(false);
  const [inOffice, setInOffice] = useState(false);
  const [currentOffice, setCurrentOffice] = useState<Office | null>(DEFAULT_OFFICE);
  const [activeUsers, setActiveUsers] = useState<PresenceUser[]>([]);
  const [myStatus, setMyStatus] = useState<UserStatus>('online');
  const [myPosition, setMyPosition] = useState<AvatarPosition>({
    x: 200,
    y: 200,
    sequence: 0,
    timestamp: Date.now(),
    facing: 'down',
  });
  const [lastError, setLastError] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isLegendOpen, setIsLegendOpen] = useState<boolean>(false);

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
    Map<
      string,
      {
        osc: OscillatorNode;
        stereoPanner: StereoPannerNode;
        panner3D: PannerNode;
        gain: GainNode;
        analyser: AnalyserNode;
      }
    >
  >(new Map());
  const localAnalyserRef = useRef<AnalyserNode | null>(null);
  const [peerPlaybackVolumes, setPeerPlaybackVolumes] = useState<Record<string, number>>({});
  const [peerMuted, setPeerMuted] = useState<Record<string, boolean>>({});
  const peerPlaybackVolumesRef = useRef<Map<string, number>>(new Map());
  const peerMutedRef = useRef<Map<string, boolean>>(new Map());
  const [isMasterMuted, setIsMasterMuted] = useState<boolean>(false);
  const isMasterMutedRef = useRef<boolean>(false);
  const [spatialProfile, setSpatialProfile] = useState<SpatialAudioProfile>('stereo');
  const spatialProfileRef = useRef<SpatialAudioProfile>('stereo');
  const [isWindowFocused, setIsWindowFocused] = useState<boolean>(
    typeof document !== 'undefined' ? !document.hidden : true
  );
  const isWindowFocusedRef = useRef<boolean>(true);

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
    {
      userId: 'user-rover',
      username: 'rover',
      displayName: 'Rover-7 (Bot)',
      token: 'token-rover',
      roleTitle: 'Autonomous Telepresence Sentry',
      color: '#f59e0b',
      active: false,
      patrolActive: false,
      position: { x: 140, y: 580 },
      waypoints: [
        { x: 140, y: 580 },
        { x: 260, y: 620 },
        { x: 220, y: 520 },
        { x: 140, y: 580 },
      ],
      currentWaypointIndex: 0,
    },
    {
      userId: 'user-atlas',
      username: 'atlas',
      displayName: 'Atlas-3 (Drone)',
      token: 'token-atlas',
      roleTitle: 'Acoustic Calibration Drone',
      color: '#06b6d4',
      active: false,
      patrolActive: false,
      position: { x: 450, y: 350 },
      waypoints: [
        { x: 450, y: 350 },
        { x: 620, y: 300 },
        { x: 500, y: 220 },
        { x: 450, y: 350 },
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

  // Automatically silence spatial audio when window loses focus, re-enable when user returns
  useEffect(() => {
    const handleFocus = () => {
      setIsWindowFocused(true);
      isWindowFocusedRef.current = true;
      if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
        audioCtxRef.current.resume();
      }
      addLog('info', 'Window focused: Spatial audio resumed for active peers.');
    };

    const handleBlur = () => {
      setIsWindowFocused(false);
      isWindowFocusedRef.current = false;
      // Immediately ramp down gain of all active peer audio nodes to 0
      peerAudioNodesRef.current.forEach((node) => {
        if (audioCtxRef.current) {
          node.gain.gain.setTargetAtTime(0, audioCtxRef.current.currentTime, 0.04);
        }
      });
      addLog('info', 'Window unfocused: Automatically silenced all peer audio streams.');
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        handleBlur();
      } else {
        handleFocus();
      }
    };

    window.addEventListener('focus', handleFocus);
    window.addEventListener('blur', handleBlur);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('blur', handleBlur);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [addLog]);

  // Handle Escape key to close Legend modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isLegendOpen) {
        setIsLegendOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isLegendOpen]);

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
    (peerId: string, distance: number, occlusionTransmission: number, relativeX: number, relativeY: number = 0) => {
      if (!spatialAudioEnabled) return;
      initSpatialAudioEngine();
      const ctx = audioCtxRef.current;
      if (!ctx) return;

      let nodes = peerAudioNodesRef.current.get(peerId);
      if (!nodes) {
        try {
          const osc = ctx.createOscillator();
          const stereoPanner = ctx.createStereoPanner();
          const panner3D = ctx.createPanner();
          panner3D.panningModel = 'HRTF';
          panner3D.distanceModel = 'inverse';
          panner3D.refDistance = 20;
          panner3D.maxDistance = 150;
          panner3D.rolloffFactor = 1;
          panner3D.coneInnerAngle = 360;

          const gain = ctx.createGain();

          // Subtle melodic tone for each peer
          const hash = peerId.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
          osc.type = 'sine';
          osc.frequency.setValueAtTime(220 + (hash % 12) * 25, ctx.currentTime);

          gain.gain.setValueAtTime(0, ctx.currentTime);

          const analyser = ctx.createAnalyser();
          analyser.fftSize = 64;
          analyser.smoothingTimeConstant = 0.7;

          // Wire graph: osc -> stereoPanner -> panner3D -> gain -> analyser -> destination
          osc.connect(stereoPanner);
          stereoPanner.connect(panner3D);
          panner3D.connect(gain);
          gain.connect(analyser);
          analyser.connect(ctx.destination);
          osc.start();

          nodes = { osc, stereoPanner, panner3D, gain, analyser };
          peerAudioNodesRef.current.set(peerId, nodes);
        } catch {
          return;
        }
      }

      // Distance attenuation (0 to 100px), individual peer playback level, master mute, and window focus factor
      const userVolSetting = peerMutedRef.current.get(peerId)
        ? 0
        : (peerPlaybackVolumesRef.current.get(peerId) ?? 100) / 100;
      const masterMuteMultiplier = isMasterMutedRef.current ? 0 : 1;
      const focusMultiplier = isWindowFocusedRef.current ? 1 : 0;
      const distanceFactor = Math.max(0, 1 - distance / 110);
      const targetVolume =
        distanceFactor * occlusionTransmission * 0.12 * userVolSetting * masterMuteMultiplier * focusMultiplier;

      const profile = spatialProfileRef.current;
      const now = ctx.currentTime;

      // Apply rendering profile
      if (profile === 'mono') {
        // Mono profile: Center stereo pan and neutral 3D position (no spatial offset)
        nodes.stereoPanner.pan.setTargetAtTime(0, now, 0.08);
        if (nodes.panner3D.positionX) {
          nodes.panner3D.positionX.setTargetAtTime(0, now, 0.08);
          nodes.panner3D.positionY.setTargetAtTime(0, now, 0.08);
          nodes.panner3D.positionZ.setTargetAtTime(1, now, 0.08);
        } else {
          nodes.panner3D.setPosition(0, 0, 1);
        }
      } else if (profile === 'hrtf') {
        // HRTF Binaural 3D profile: neutral stereo panner, position in 3D binaural space with head shadowing
        nodes.stereoPanner.pan.setTargetAtTime(0, now, 0.08);
        const normX = relativeX / 80;
        const normY = relativeY / 80;
        const normZ = 0.5; // Slight forward plane elevation
        if (nodes.panner3D.positionX) {
          nodes.panner3D.positionX.setTargetAtTime(normX, now, 0.08);
          nodes.panner3D.positionY.setTargetAtTime(-normY, now, 0.08);
          nodes.panner3D.positionZ.setTargetAtTime(normZ, now, 0.08);
        } else {
          nodes.panner3D.setPosition(normX, -normY, normZ);
        }
      } else {
        // Stereo Panner profile (default): horizontal bidirectional stereo pan (-1.0 to +1.0)
        const targetPan = Math.max(-1, Math.min(1, relativeX / 150));
        nodes.stereoPanner.pan.setTargetAtTime(targetPan, now, 0.08);
        if (nodes.panner3D.positionX) {
          nodes.panner3D.positionX.setTargetAtTime(0, now, 0.08);
          nodes.panner3D.positionY.setTargetAtTime(0, now, 0.08);
          nodes.panner3D.positionZ.setTargetAtTime(1, now, 0.08);
        } else {
          nodes.panner3D.setPosition(0, 0, 1);
        }
      }

      nodes.gain.gain.setTargetAtTime(targetVolume, now, 0.08);
    },
    [spatialAudioEnabled, initSpatialAudioEngine]
  );

  const silencePeerAudio = useCallback((peerId: string) => {
    const nodes = peerAudioNodesRef.current.get(peerId);
    if (nodes && audioCtxRef.current) {
      nodes.gain.gain.setTargetAtTime(0, audioCtxRef.current.currentTime, 0.05);
    }
  }, []);

  // Master Mute All toggle handler
  const handleToggleMasterMute = useCallback(() => {
    const nextMasterMuted = !isMasterMutedRef.current;
    isMasterMutedRef.current = nextMasterMuted;
    setIsMasterMuted(nextMasterMuted);

    if (nextMasterMuted) {
      // Immediately ramp gain of all existing peer audio nodes to 0
      peerAudioNodesRef.current.forEach((node) => {
        if (audioCtxRef.current) {
          node.gain.gain.setTargetAtTime(0, audioCtxRef.current.currentTime, 0.03);
        }
      });
      addLog('warn', 'Master Mute enabled: All peer audio streams muted (persisting for new peers).');
    } else {
      // Restore peer audio levels based on current distance, occlusion, volume settings
      if (audioCtxRef.current && currentOffice) {
        const now = audioCtxRef.current.currentTime;
        peerAudioNodesRef.current.forEach((node, peerId) => {
          const isIndividuallyMuted = !!peerMutedRef.current.get(peerId);
          if (isIndividuallyMuted) {
            node.gain.gain.setTargetAtTime(0, now, 0.03);
            return;
          }
          const member = activeUsers.find((u) => u.userId === peerId);
          if (member) {
            const dist = Math.hypot(member.position.x - myPosition.x, member.position.y - myPosition.y);
            const distanceFactor = Math.max(0, 1 - dist / 110);
            const occlusion = clientGeometry.checkSoundObstruction(
              { x: myPosition.x, y: myPosition.y },
              { x: member.position.x, y: member.position.y },
              currentOffice.obstacles
            );
            const volSetting = (peerPlaybackVolumesRef.current.get(peerId) ?? 100) / 100;
            const focusMultiplier = isWindowFocusedRef.current ? 1 : 0;
            const targetVol = distanceFactor * occlusion.totalTransmission * 0.12 * volSetting * focusMultiplier;
            node.gain.gain.setTargetAtTime(targetVol, now, 0.03);
          }
        });
      }
      addLog('info', 'Master Mute disabled: Restored peer audio streams.');
    }
  }, [activeUsers, currentOffice, myPosition, addLog]);

  // Individual peer volume control handler
  const handlePeerVolumeChange = useCallback(
    (peerId: string, volume: number) => {
      setPeerPlaybackVolumes((prev) => ({ ...prev, [peerId]: volume }));
      peerPlaybackVolumesRef.current.set(peerId, volume);

      if (volume > 0 && peerMutedRef.current.get(peerId)) {
        setPeerMuted((prev) => ({ ...prev, [peerId]: false }));
        peerMutedRef.current.set(peerId, false);
      }

      // Immediately apply to Web Audio gain node
      const nodes = peerAudioNodesRef.current.get(peerId);
      if (nodes && audioCtxRef.current) {
        if (isMasterMutedRef.current) {
          nodes.gain.gain.setTargetAtTime(0, audioCtxRef.current.currentTime, 0.03);
          return;
        }
        const isMuted = volume === 0 || !!peerMutedRef.current.get(peerId);
        const volMultiplier = isMuted ? 0 : volume / 100;
        const member = activeUsers.find((u) => u.userId === peerId);
        if (member && currentOffice) {
          const dist = Math.hypot(member.position.x - myPosition.x, member.position.y - myPosition.y);
          const distanceFactor = Math.max(0, 1 - dist / 110);
          const occlusion = clientGeometry.checkSoundObstruction(
            { x: myPosition.x, y: myPosition.y },
            { x: member.position.x, y: member.position.y },
            currentOffice.obstacles
          );
          const targetVol = distanceFactor * occlusion.totalTransmission * 0.12 * volMultiplier;
          nodes.gain.gain.setTargetAtTime(targetVol, audioCtxRef.current.currentTime, 0.03);
        }
      }
    },
    [activeUsers, currentOffice, myPosition]
  );

  const handleTogglePeerMute = useCallback(
    (peerId: string) => {
      const nextMuted = !peerMutedRef.current.get(peerId);
      setPeerMuted((prev) => ({ ...prev, [peerId]: nextMuted }));
      peerMutedRef.current.set(peerId, nextMuted);

      const nodes = peerAudioNodesRef.current.get(peerId);
      if (nodes && audioCtxRef.current) {
        if (isMasterMutedRef.current || nextMuted) {
          nodes.gain.gain.setTargetAtTime(0, audioCtxRef.current.currentTime, 0.03);
        } else {
          const volMultiplier = (peerPlaybackVolumesRef.current.get(peerId) ?? 100) / 100;
          const member = activeUsers.find((u) => u.userId === peerId);
          if (member && currentOffice) {
            const dist = Math.hypot(member.position.x - myPosition.x, member.position.y - myPosition.y);
            const distanceFactor = Math.max(0, 1 - dist / 110);
            const occlusion = clientGeometry.checkSoundObstruction(
              { x: myPosition.x, y: myPosition.y },
              { x: member.position.x, y: member.position.y },
              currentOffice.obstacles
            );
            const targetVol = distanceFactor * occlusion.totalTransmission * 0.12 * volMultiplier;
            nodes.gain.gain.setTargetAtTime(targetVol, audioCtxRef.current.currentTime, 0.03);
          }
        }
      }
    },
    [activeUsers, currentOffice, myPosition]
  );

  // Switch between 'mono', 'stereo', and 'hrtf' spatial audio rendering profiles
  const handleSpatialProfileChange = useCallback(
    (newProfile: SpatialAudioProfile) => {
      setSpatialProfile(newProfile);
      spatialProfileRef.current = newProfile;
      initSpatialAudioEngine();

      const profileName =
        newProfile === 'hrtf'
          ? 'HRTF Binaural 3D'
          : newProfile === 'mono'
          ? 'Mono (No Panning)'
          : 'Stereo Panner';
      addLog('info', `Spatial Audio Profile switched to: ${profileName}`);

      // Immediately re-render all active peer audio nodes with the new profile settings
      if (audioCtxRef.current && currentOffice) {
        const otherUsers = activeUsers.filter((u) => u.userId !== selectedUser?.user.id);
        otherUsers.forEach((remoteUser) => {
          const dist = Math.hypot(remoteUser.position.x - myPosition.x, remoteUser.position.y - myPosition.y);
          const exitLimit = proximityConfig.exitRadius || 110;
          if (dist <= exitLimit) {
            const occlusion = clientGeometry.checkSoundObstruction(
              { x: myPosition.x, y: myPosition.y },
              { x: remoteUser.position.x, y: remoteUser.position.y },
              currentOffice.obstacles
            );
            updateSpatialAudio(
              remoteUser.userId,
              dist,
              occlusion.totalTransmission,
              remoteUser.position.x - myPosition.x,
              remoteUser.position.y - myPosition.y
            );
          }
        });
      }
    },
    [
      initSpatialAudioEngine,
      addLog,
      currentOffice,
      activeUsers,
      selectedUser,
      myPosition,
      proximityConfig.exitRadius,
      updateSpatialAudio,
    ]
  );

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
        if (audioCtxRef.current) {
          try {
            const src = audioCtxRef.current.createMediaStreamSource(stream);
            const localAnalyser = audioCtxRef.current.createAnalyser();
            localAnalyser.fftSize = 64;
            src.connect(localAnalyser);
            localAnalyserRef.current = localAnalyser;
          } catch {
            // ignore
          }
        }
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
    const layout = await safeFetchJson<Office>(`/api/offices/${officeId}/layout`);
    if (layout) {
      setCurrentOffice((prev) => (prev ? { ...prev, ...layout } : layout));
    }
  }, []);

  useEffect(() => {
    let isMounted = true;

    const fetchSystemInfo = async () => {
      // 1. Health status (available via /health or /api/health)
      const h = await safeFetchJson<{ status: string; uptime: number }>('/health');
      if (h && isMounted) {
        setHealthStatus(h);
      }

      // 2. Offices list
      const o = await safeFetchJson<Office[]>('/api/offices');
      if (o && isMounted && Array.isArray(o) && o.length > 0) {
        setOffices(o);
        setCurrentOffice((prev) => {
          if (prev) {
            const fresh = o.find((item: Office) => item.id === prev.id);
            return fresh ? { ...prev, ...fresh } : prev;
          }
          return o.find((item: Office) => item.id === selectedOfficeId) || o[0];
        });
      }

      // 3. Demo user accounts
      const u = await safeFetchJson<DemoAccount[]>('/api/auth/demo-users');
      if (u && isMounted && Array.isArray(u) && u.length > 0) {
        setDemoAccounts(u);
        setSelectedUser((prev) => prev ?? u[0]);
      }

      // 4. Proximity configuration
      const c = await safeFetchJson<{
        entryRadius: number;
        exitRadius: number;
        staleTimeoutMs: number;
      }>('/api/proximity/config');
      if (c && isMounted && c.entryRadius) {
        setProximityConfig((prev) => ({ ...prev, ...c }));
      }
    };

    fetchSystemInfo();
    const interval = setInterval(fetchSystemInfo, 6000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [selectedOfficeId]);

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

    // Automatically silence peer playback when window loses focus
    if (!isWindowFocused) {
      peerAudioNodesRef.current.forEach((node) => {
        if (audioCtxRef.current) {
          node.gain.gain.setTargetAtTime(0, audioCtxRef.current.currentTime, 0.04);
        }
      });
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

        // Update permanent audio with continuous distance attenuation, occlusion, and 2D relative offsets
        updateSpatialAudio(
          remoteUser.userId,
          dist,
          occlusion.totalTransmission,
          remoteUser.position.x - myPosition.x,
          remoteUser.position.y - myPosition.y
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
    isWindowFocused,
    isMasterMuted,
    spatialProfile,
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

      s.on('presence:status_updated', (data) => {
        addLog('info', `Status update: User ${data.userId} is now ${data.status.toUpperCase()}`);
        setActiveUsers((prev) =>
          prev.map((u) => (u.userId === data.userId ? { ...u, status: data.status } : u))
        );
        if (data.userId === account.user.id) {
          setMyStatus(data.status);
        }
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
          if (isMasterMutedRef.current || peerMutedRef.current.get(data.peerUserId)) {
            remoteAudio.muted = true;
          }
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
              if (self.status) setMyStatus(self.status);
              sequenceRef.current = self.position.sequence + 1;
            }
          }
        }
      );
    },
    [connected, refreshOfficeLayout, selectedUser, addLog]
  );

  // Update presence status ('online' | 'busy' | 'away')
  const handleUpdateStatus = useCallback(
    (newStatus: UserStatus) => {
      setMyStatus(newStatus);
      if (selectedUser) {
        setActiveUsers((prev) =>
          prev.map((u) => (u.userId === selectedUser.user.id ? { ...u, status: newStatus } : u))
        );
      }
      if (socketRef.current && inOffice) {
        socketRef.current.emit(
          'presence:update_status',
          { officeId: selectedOfficeId, status: newStatus },
          (res) => {
            if (res.success) {
              addLog('success', `Status updated to ${newStatus.toUpperCase()}`);
            } else {
              addLog('error', `Failed to update status: ${res.error}`);
            }
          }
        );
      }
    },
    [selectedUser, inOffice, selectedOfficeId, addLog]
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

  // Cycle bot presence status ('online' -> 'busy' -> 'away' -> 'online')
  const cycleBotStatus = useCallback((userId: string) => {
    const bot = simBots.find((b) => b.userId === userId);
    if (!bot || !bot.active) return;
    const sock = botSocketsRef.current.get(userId);
    if (!sock) return;

    const currentStatus = bot.status || 'online';
    const nextStatus: UserStatus =
      currentStatus === 'online' ? 'busy' : currentStatus === 'busy' ? 'away' : 'online';

    sock.emit('presence:update_status', { officeId: selectedOfficeId, status: nextStatus }, (res) => {
      if (res.success) {
        setSimBots((prev) =>
          prev.map((b) => (b.userId === userId ? { ...b, status: nextStatus } : b))
        );
        addLog('info', `Bot ${bot.displayName} status changed to ${nextStatus.toUpperCase()}`);
      }
    });
  }, [simBots, selectedOfficeId, addLog]);

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

      const contentType = res.headers.get('content-type') || '';
      if (!contentType.toLowerCase().includes('application/json')) {
        addLog('warn', `Server returned non-JSON response (${res.status})`);
        return;
      }

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
      return ['user-alice', 'user-bob', 'user-liam', 'user-marcus', 'user-kenji', 'user-priya'].includes(acc.user.id);
    }
    if (departmentFilter === 'product') {
      return ['user-charlie', 'user-maya', 'user-zara', 'user-sofia', 'user-oliver', 'user-nadia', 'user-david'].includes(acc.user.id);
    }
    if (departmentFilter === 'research') {
      return ['user-elena', 'user-bob', 'user-hannah', 'user-tariq', 'user-priya'].includes(acc.user.id);
    }
    if (departmentFilter === 'bots') {
      return ['user-dexter', 'user-rover', 'user-atlas', 'user-eve'].includes(acc.user.id);
    }
    return true;
  });

  // Filter offices by name, description, capacity, or access policy
  const filteredOffices = offices.filter((off) => {
    if (!officeSearchQuery.trim()) return true;
    const q = officeSearchQuery.toLowerCase().trim();
    const nameMatch = off.name.toLowerCase().includes(q);
    const descMatch = (off.description || '').toLowerCase().includes(q);
    const capStr = off.capacity !== undefined ? String(off.capacity) : '';
    const capMatch =
      capStr.includes(q) ||
      `${capStr} seats`.includes(q) ||
      `${capStr} capacity`.includes(q) ||
      `cap: ${capStr}`.includes(q);
    const accessMatch =
      off.accessPolicy.toLowerCase().includes(q) ||
      (off.accessPolicy === 'members_only' && 'restricted'.includes(q)) ||
      (off.accessPolicy === 'public' && 'public'.includes(q));

    return nameMatch || descMatch || capMatch || accessMatch;
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
          <div className="flex items-center gap-1.5 bg-slate-800/80 p-1 rounded-lg border border-slate-700">
            <button
              onClick={() => setSpatialAudioEnabled(!spatialAudioEnabled)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition ${
                spatialAudioEnabled
                  ? 'bg-purple-600/30 text-purple-200 border border-purple-500/40'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Toggle Web Audio spatial synthesizer tone simulation"
            >
              <Headphones className="h-3.5 w-3.5" />
              <span>Spatial Audio {spatialAudioEnabled ? 'ON' : 'OFF'}</span>
            </button>

            {/* Spatial Audio Rendering Profile Dropdown */}
            <div className="flex items-center gap-1 pl-1 border-l border-slate-700/80">
              <Compass className="h-3.5 w-3.5 text-indigo-400 shrink-0 hidden sm:inline" />
              <select
                value={spatialProfile}
                onChange={(e) => handleSpatialProfileChange(e.target.value as SpatialAudioProfile)}
                disabled={!spatialAudioEnabled}
                aria-label="Spatial Audio Rendering Profile"
                className="bg-slate-900 border border-slate-700 rounded text-slate-200 text-xs px-2 py-1 focus:outline-none focus:border-indigo-500 font-medium cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition"
                title="Switch spatial audio rendering profile: Mono, Stereo Panner, or HRTF Binaural 3D"
              >
                <option value="stereo">Stereo Panner</option>
                <option value="hrtf">HRTF Binaural</option>
                <option value="mono">Mono</option>
              </select>
            </div>
          </div>

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

          {/* Master Mute All Toggle Button */}
          <button
            onClick={handleToggleMasterMute}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border font-medium transition ${
              isMasterMuted
                ? 'bg-rose-600/20 border-rose-500/50 text-rose-300 ring-2 ring-rose-500/20 hover:bg-rose-600/30'
                : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700 hover:text-white'
            }`}
            title={
              isMasterMuted
                ? 'Master Mute is ON: All peer audio is muted (Click to Unmute All)'
                : 'Master Mute: Silence all incoming peer audio streams'
            }
          >
            {isMasterMuted ? (
              <VolumeX className="h-3.5 w-3.5 text-rose-400 animate-pulse" />
            ) : (
              <Volume2 className="h-3.5 w-3.5 text-slate-400" />
            )}
            <span>{isMasterMuted ? 'Muted All' : 'Mute All'}</span>
          </button>

          {/* Presence Status Selector */}
          <div className="flex items-center gap-1 bg-slate-800/80 p-1 rounded-lg border border-slate-700">
            <span className="text-[10px] text-slate-400 font-mono px-1">Status:</span>
            {(
              [
                { id: 'online', label: 'Online', color: 'bg-emerald-400', activeClass: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' },
                { id: 'busy', label: 'Busy', color: 'bg-rose-400', activeClass: 'bg-rose-500/20 text-rose-300 border-rose-500/40' },
                { id: 'away', label: 'Away', color: 'bg-amber-400', activeClass: 'bg-amber-500/20 text-amber-300 border-amber-500/40' },
              ] as const
            ).map((st) => (
              <button
                key={st.id}
                onClick={() => handleUpdateStatus(st.id)}
                className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium border transition ${
                  myStatus === st.id
                    ? `${st.activeClass} font-semibold`
                    : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-700/50'
                }`}
                title={`Set status to ${st.label}`}
              >
                <span className={`h-2 w-2 rounded-full ${st.color} ${myStatus === st.id ? 'animate-pulse' : ''}`} />
                <span>{st.label}</span>
              </button>
            ))}
          </div>

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

          <button
            onClick={() => setIsLegendOpen((prev) => !prev)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border font-medium transition ${
              isLegendOpen
                ? 'bg-indigo-600/30 border-indigo-500 text-indigo-300 ring-2 ring-indigo-500/20'
                : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700 hover:text-white'
            }`}
            title="Open UI Legend & Status Guide"
          >
            <HelpCircle className="h-3.5 w-3.5 text-indigo-400" />
            <span>Guide & Legend</span>
          </button>
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
                const isAdmin =
                  acc.user.id === 'user-alice' || acc.user.id === 'user-maya' || acc.user.id === 'user-david';
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
                        className="relative h-8 w-8 rounded-full border flex items-center justify-center overflow-visible shrink-0"
                        style={{ borderColor: userTheme }}
                      >
                        <img
                          src={acc.user.avatarUrl}
                          alt={acc.user.displayName}
                          className="h-full w-full rounded-full object-cover"
                        />
                        {(() => {
                          const userPresence = activeUsers.find((u) => u.userId === acc.user.id);
                          const status = isSelected
                            ? myStatus
                            : userPresence?.status || (userPresence?.isOnline ? 'online' : 'offline');
                          let dotColor = 'bg-slate-600';
                          if (status === 'online') dotColor = 'bg-emerald-400 ring-2 ring-slate-900';
                          if (status === 'busy') dotColor = 'bg-rose-500 ring-2 ring-slate-900';
                          if (status === 'away') dotColor = 'bg-amber-400 ring-2 ring-slate-900';

                          return (
                            <span
                              className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ${dotColor}`}
                              title={`Status: ${status}`}
                            />
                          );
                        })()}
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
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
                <Building className="h-4 w-4 text-amber-400" />
                2. Persisted Virtual Offices
              </h2>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-300 font-mono">
                {filteredOffices.length}{filteredOffices.length !== offices.length ? ` / ${offices.length}` : ''} Available
              </span>
            </div>

            {/* Office Search Input Bar */}
            <div className="relative mb-3">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
              <input
                type="text"
                value={officeSearchQuery}
                onChange={(e) => setOfficeSearchQuery(e.target.value)}
                placeholder="Search by name, description, capacity..."
                className="w-full bg-slate-950/70 border border-slate-700/80 rounded-lg pl-8 pr-7 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500/70 focus:ring-1 focus:ring-amber-500/40 transition"
              />
              {officeSearchQuery && (
                <button
                  type="button"
                  onClick={() => setOfficeSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white p-0.5 rounded transition"
                  title="Clear search"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>

            <div className="space-y-2 mb-3 max-h-64 overflow-y-auto pr-1">
              {filteredOffices.length === 0 ? (
                <div className="p-3.5 rounded-lg bg-slate-950/50 border border-dashed border-slate-800 text-center text-xs text-slate-400 space-y-1">
                  <p>No offices match &ldquo;{officeSearchQuery}&rdquo;</p>
                  <button
                    type="button"
                    onClick={() => setOfficeSearchQuery('')}
                    className="text-[11px] text-amber-400 hover:text-amber-300 underline font-medium"
                  >
                    Clear search filter
                  </button>
                </div>
              ) : (
                filteredOffices.map((off) => {
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
                        <div className="flex items-center gap-1.5">
                          <span className="flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded bg-slate-800 text-amber-300/90 border border-slate-700 font-mono">
                            <Users className="h-2.5 w-2.5 text-amber-400" />
                            <span>Cap: {off.capacity ? `${off.capacity}` : '45'}</span>
                          </span>
                          {isRestricted ? (
                            <span className="flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-400 border border-rose-500/20 font-medium">
                              <Lock className="h-2.5 w-2.5" /> Restricted
                            </span>
                          ) : (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-medium">
                              Public
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="text-[10px] text-slate-400 line-clamp-1">{off.description}</div>
                      <div className="text-[9px] text-slate-500 mt-1 font-mono flex justify-between">
                        <span>Dimensions: {off.bounds?.maxX || off.width}x{off.bounds?.maxY || off.height}px</span>
                        <span className="text-amber-400">Version: #{off.layoutVersion || 1}</span>
                      </div>
                    </div>
                  );
                })
              )}
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
                      <>
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

                        <button
                          onClick={() => cycleBotStatus(bot.userId)}
                          className={`py-1 px-2 rounded text-[10px] font-mono font-semibold border transition flex items-center gap-1 ${
                            (bot.status || 'online') === 'busy'
                              ? 'bg-rose-500/20 border-rose-500/40 text-rose-300'
                              : (bot.status || 'online') === 'away'
                              ? 'bg-amber-500/20 border-amber-500/40 text-amber-300'
                              : 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                          }`}
                          title="Click to toggle bot status (Online / Busy / Away)"
                        >
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${
                              (bot.status || 'online') === 'busy'
                                ? 'bg-rose-400'
                                : (bot.status || 'online') === 'away'
                                ? 'bg-amber-400'
                                : 'bg-emerald-400'
                            }`}
                          />
                          <span>{(bot.status || 'online').toUpperCase()}</span>
                        </button>
                      </>
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
                    status: myStatus,
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
                      {/* Avatar Ring with Status Indicator Dot */}
                      <div className="relative">
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
                        {/* Status Indicator Dot */}
                        {(() => {
                          const status = isMe ? myStatus : (member.status || 'online');
                          let statusColor = 'bg-emerald-400';
                          if (status === 'busy') statusColor = 'bg-rose-500';
                          if (status === 'away') statusColor = 'bg-amber-400';
                          return (
                            <span
                              className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-slate-900 ${statusColor}`}
                              title={`Status: ${status}`}
                            />
                          );
                        })()}
                      </div>

                      {/* Name Badge */}
                      <div className="mt-1 px-1.5 py-0.5 rounded-md bg-slate-900/95 border border-slate-700/80 text-[10px] font-semibold text-white whitespace-nowrap shadow-md flex items-center gap-1">
                        {(() => {
                          const status = isMe ? myStatus : (member.status || 'online');
                          let dotColor = 'bg-emerald-400';
                          if (status === 'busy') dotColor = 'bg-rose-500';
                          if (status === 'away') dotColor = 'bg-amber-400';
                          return <span className={`h-1.5 w-1.5 rounded-full ${dotColor}`} />;
                        })()}
                        {soundOcclusion?.isBlocked ? (
                          <VolumeX className="h-2.5 w-2.5 text-rose-400" />
                        ) : isPeer ? (
                          <Volume2 className="h-2.5 w-2.5 text-emerald-400" />
                        ) : null}
                        <span>{member.user.displayName} {isMe ? '(You)' : ''}</span>
                        {(() => {
                          const status = isMe ? myStatus : (member.status || 'online');
                          if (status !== 'online') {
                            const badgeColor = status === 'busy' ? 'text-rose-400' : 'text-amber-400';
                            return <span className={`text-[8px] font-mono uppercase ${badgeColor}`}>({status})</span>;
                          }
                          return null;
                        })()}
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
                <button
                  type="button"
                  onClick={() => setIsLegendOpen((prev) => !prev)}
                  className="flex items-center gap-1 text-[11px] text-indigo-400 hover:text-indigo-300 transition underline underline-offset-2 ml-1"
                >
                  <Info className="h-3 w-3" />
                  <span>Avatar & Status Legend</span>
                </button>
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
              <div className="flex items-center gap-2">
                {isMasterMuted ? (
                  <span
                    className="text-[9px] px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/40 font-mono flex items-center gap-1 animate-pulse"
                    title="Master Mute is ON: All incoming peer audio is muted"
                  >
                    <VolumeX className="h-3 w-3 text-rose-400" /> Master Muted
                  </span>
                ) : !isWindowFocused ? (
                  <span
                    className="text-[9px] px-2 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 font-mono flex items-center gap-1"
                    title="Window unfocused: Spatial audio automatically silenced until user returns"
                  >
                    <VolumeX className="h-3 w-3" /> Auto-Silenced
                  </span>
                ) : (
                  <span
                    className="text-[9px] px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-mono flex items-center gap-1"
                    title="Window focused: Real-time spatial audio active"
                  >
                    <Volume2 className="h-3 w-3" /> Active
                  </span>
                )}
                <span className="text-[10px] px-2 py-0.5 rounded bg-purple-500/10 text-purple-400 font-mono">
                  {proximityPeers.length} in earshot
                </span>
              </div>
            </h3>

            {/* Spatial Audio Settings & Profile Selector */}
            <div className="mb-3 p-2 rounded-lg bg-slate-950/70 border border-slate-800 flex items-center justify-between text-xs">
              <div className="flex items-center gap-1.5 text-slate-300 font-medium">
                <Sliders className="h-3.5 w-3.5 text-indigo-400" />
                <span>Spatial Profile:</span>
              </div>
              <select
                value={spatialProfile}
                onChange={(e) => handleSpatialProfileChange(e.target.value as SpatialAudioProfile)}
                aria-label="Audio Settings Spatial Rendering Profile"
                className="bg-slate-900 border border-slate-700 rounded-md text-slate-200 text-xs px-2.5 py-1 focus:outline-none focus:border-indigo-500 font-medium cursor-pointer transition"
              >
                <option value="stereo">Stereo Panner (2D)</option>
                <option value="hrtf">HRTF Binaural (3D)</option>
                <option value="mono">Mono (Centered)</option>
              </select>
            </div>

            {/* Real-Time Waveform Visualizations using Web Audio API & Recharts */}
            <div className="space-y-3">
              {/* Local Microphone Waveform (if enabled) */}
              {micActive && selectedUser && (
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono px-1">
                    <span className="flex items-center gap-1.5 text-indigo-400 font-semibold">
                      <Mic className="h-3 w-3" /> My Microphone (Local Audio)
                    </span>
                    <span className="text-emerald-400 font-medium">Transmitting</span>
                  </div>
                  <PeerAudioWaveform
                    peerId={selectedUser.user.id}
                    displayName={`${selectedUser.user.displayName} (You)`}
                    analyserNode={localAnalyserRef.current}
                    isBlocked={false}
                    transmission={1.0}
                    distance={0}
                    themeColor="#6366f1"
                    isSpatialAudioEnabled={true}
                    isLocalUser={true}
                  />
                </div>
              )}

              {/* Active Peer Audio Stream Waveforms */}
              {proximityPeers.length === 0 ? (
                <div className="p-4 rounded-lg bg-slate-950/40 border border-slate-800 text-center">
                  <PhoneOff className="h-6 w-6 text-slate-600 mx-auto mb-1.5" />
                  <p className="text-xs text-slate-400 font-medium">No peers within 100px listening radius.</p>
                  <p className="text-[11px] text-slate-500 mt-1">
                    Walk close to an avatar or spawn a bot to visualize real-time audio waveforms.
                  </p>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {proximityPeers.map((peer) => {
                    const member = activeUsers.find((u) => u.userId === peer.userId);
                    const occlusion = currentOffice
                      ? clientGeometry.checkSoundObstruction(
                          { x: myPosition.x, y: myPosition.y },
                          { x: member?.position.x ?? 0, y: member?.position.y ?? 0 },
                          currentOffice.obstacles
                        )
                      : null;
                    const isBlocked = occlusion?.isBlocked ?? false;
                    const transmission = occlusion?.totalTransmission ?? 1;
                    const liveDist = member
                      ? Math.round(
                          Math.hypot(
                            member.position.x - myPosition.x,
                            member.position.y - myPosition.y
                          )
                        )
                      : Math.round(peer.distance);
                    const relativeX = (member?.position.x ?? 0) - myPosition.x;
                    const pan = Math.max(-1, Math.min(1, relativeX / 150));
                    const analyserNode = peerAudioNodesRef.current.get(peer.userId)?.analyser;

                    return (
                      <PeerAudioWaveform
                        key={peer.userId}
                        peerId={peer.userId}
                        displayName={member?.user.displayName ?? peer.userId}
                        analyserNode={analyserNode}
                        isBlocked={isBlocked}
                        transmission={transmission}
                        distance={liveDist}
                        pan={pan}
                        relativeX={relativeX}
                        themeColor={member?.user.themeColor || '#10b981'}
                        isSpatialAudioEnabled={spatialAudioEnabled}
                        playbackVolume={peerPlaybackVolumes[peer.userId] ?? 100}
                        isMuted={peerMuted[peer.userId] ?? false}
                        onPlaybackVolumeChange={(vol) => handlePeerVolumeChange(peer.userId, vol)}
                        onToggleMute={() => handleTogglePeerMute(peer.userId)}
                        isWindowFocused={isWindowFocused}
                        isMasterMuted={isMasterMuted}
                        spatialProfile={spatialProfile}
                      />
                    );
                  })}
                </div>
              )}
            </div>
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

      {/* Legend & UI Guide Modal */}
      {isLegendOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="UI Legend and Status Guide"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-150"
          onClick={() => setIsLegendOpen(false)}
        >
          <div
            className="bg-slate-900 border border-slate-700/80 rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl p-6 text-slate-200 relative"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-start justify-between pb-4 border-b border-slate-800">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
                  <HelpCircle className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
                    ProxiSpeak UI & Status Guide
                  </h2>
                  <p className="text-xs text-slate-400">
                    Understanding presence status indicators, avatar rings, audio zones, and raycasts
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsLegendOpen(false)}
                className="h-8 w-8 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition border border-slate-700"
                title="Close modal (Esc)"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Modal Content Sections */}
            <div className="py-4 space-y-6 text-xs">
              {/* 1. User Presence Status Colors */}
              <div>
                <h3 className="text-xs font-bold text-slate-100 uppercase tracking-wider mb-2.5 flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-indigo-400" />
                  1. Presence Status Indicators
                </h3>
                <p className="text-slate-400 mb-3 text-[11px] leading-relaxed">
                  Every avatar on the canvas, roster card, and header displays a real-time status dot indicating peer availability:
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 flex flex-col gap-1.5">
                    <div className="flex items-center gap-2">
                      <span className="h-3 w-3 rounded-full bg-emerald-400 shadow-sm shadow-emerald-400/50" />
                      <span className="font-semibold text-emerald-300">Online</span>
                    </div>
                    <p className="text-[11px] text-slate-400 leading-normal">
                      User is active, connected to the office room, and ready for proximity voice chat.
                    </p>
                  </div>

                  <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 flex flex-col gap-1.5">
                    <div className="flex items-center gap-2">
                      <span className="h-3 w-3 rounded-full bg-rose-500 shadow-sm shadow-rose-500/50" />
                      <span className="font-semibold text-rose-300">Busy (DND)</span>
                    </div>
                    <p className="text-[11px] text-slate-400 leading-normal">
                      User is in a meeting, focused on deep work, or requests minimal interruption.
                    </p>
                  </div>

                  <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 flex flex-col gap-1.5">
                    <div className="flex items-center gap-2">
                      <span className="h-3 w-3 rounded-full bg-amber-400 shadow-sm shadow-amber-400/50" />
                      <span className="font-semibold text-amber-300">Away</span>
                    </div>
                    <p className="text-[11px] text-slate-400 leading-normal">
                      User has stepped away from their workstation or desk temporarily.
                    </p>
                  </div>
                </div>
              </div>

              {/* 2. Avatar Rings on Office Canvas */}
              <div>
                <h3 className="text-xs font-bold text-slate-100 uppercase tracking-wider mb-2.5 flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-indigo-400" />
                  2. Avatar Ring States
                </h3>
                <p className="text-slate-400 mb-3 text-[11px] leading-relaxed">
                  The colored ring surrounding an avatar indicates their proximity and acoustic state relative to your character:
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 flex items-start gap-3">
                    <div className="h-9 w-9 rounded-full border-2 border-indigo-400 bg-indigo-500/20 ring-4 ring-indigo-500/40 flex items-center justify-center shrink-0">
                      <span className="text-[10px] font-bold text-indigo-200">You</span>
                    </div>
                    <div>
                      <div className="font-semibold text-indigo-300 text-xs">Your Avatar (Local)</div>
                      <p className="text-[11px] text-slate-400 mt-0.5 leading-normal">
                        Indigo ring highlighting your current position. Moves via WASD, arrow keys, or clicking the map.
                      </p>
                    </div>
                  </div>

                  <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 flex items-start gap-3">
                    <div className="h-9 w-9 rounded-full border-2 border-emerald-400 bg-emerald-500/20 ring-4 ring-emerald-500/50 animate-pulse flex items-center justify-center shrink-0">
                      <Volume2 className="h-4 w-4 text-emerald-300" />
                    </div>
                    <div>
                      <div className="font-semibold text-emerald-300 text-xs">In Earshot & Audible</div>
                      <p className="text-[11px] text-slate-400 mt-0.5 leading-normal">
                        Pulsing green ring. Peer is within the 100px proximity radius with clear acoustic line-of-sight.
                      </p>
                    </div>
                  </div>

                  <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 flex items-start gap-3">
                    <div className="h-9 w-9 rounded-full border-2 border-rose-400 bg-rose-500/20 ring-4 ring-rose-500/50 flex items-center justify-center shrink-0">
                      <VolumeX className="h-4 w-4 text-rose-300" />
                    </div>
                    <div>
                      <div className="font-semibold text-rose-300 text-xs">Occluded by Soundproof Wall</div>
                      <p className="text-[11px] text-slate-400 mt-0.5 leading-normal">
                        Solid rose ring. Peer is within distance, but audio is blocked (0% transmission) by acoustic wall partitions.
                      </p>
                    </div>
                  </div>

                  <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 flex items-start gap-3">
                    <div className="h-9 w-9 rounded-full border border-slate-600 bg-slate-800/50 opacity-70 flex items-center justify-center shrink-0">
                      <PhoneOff className="h-4 w-4 text-slate-400" />
                    </div>
                    <div>
                      <div className="font-semibold text-slate-400 text-xs">Out of Range (&gt; 110px)</div>
                      <p className="text-[11px] text-slate-500 mt-0.5 leading-normal">
                        Subtle border without glowing rings. Peer is beyond hearing range; audio is silenced to save bandwidth.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* 3. Acoustic Boundaries & Occlusion Raycasts */}
              <div>
                <h3 className="text-xs font-bold text-slate-100 uppercase tracking-wider mb-2.5 flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-indigo-400" />
                  3. Geospatial Circles & Raycasts
                </h3>
                <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 space-y-2">
                  <div className="flex items-center gap-2 text-[11px]">
                    <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 shrink-0" />
                    <span className="text-slate-300 font-semibold">Solid Green Circle (100px):</span>
                    <span className="text-slate-400">Entry threshold for proximity audio eligibility.</span>
                  </div>
                  <div className="flex items-center gap-2 text-[11px]">
                    <span className="h-2.5 w-2.5 rounded-full border border-dashed border-amber-400 shrink-0" />
                    <span className="text-slate-300 font-semibold">Dashed Amber Circle (110px):</span>
                    <span className="text-slate-400">Hysteresis exit threshold preventing rapid connection flutter.</span>
                  </div>
                  <div className="flex items-center gap-2 text-[11px]">
                    <span className="h-1.5 w-5 bg-rose-500 rounded shrink-0" />
                    <span className="text-slate-300 font-semibold">Dashed Red Line:</span>
                    <span className="text-slate-400">Raycast ray blocked by soundproof wall partition (attenuation = 0).</span>
                  </div>
                  <div className="flex items-center gap-2 text-[11px]">
                    <span className="h-1.5 w-5 bg-emerald-500 rounded shrink-0" />
                    <span className="text-slate-300 font-semibold">Solid Green Line:</span>
                    <span className="text-slate-400">Unobstructed line-of-sight for direct WebRTC & spatial audio.</span>
                  </div>
                </div>
              </div>

              {/* 4. Master Mute & Volume Controls */}
              <div>
                <h3 className="text-xs font-bold text-slate-100 uppercase tracking-wider mb-2.5 flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-indigo-400" />
                  4. Master Audio Controls
                </h3>
                <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 space-y-2 text-[11px]">
                  <div className="flex items-center gap-2">
                    <VolumeX className="h-3.5 w-3.5 text-rose-400 shrink-0" />
                    <span className="text-slate-200 font-semibold">Master &ldquo;Mute All&rdquo; Button:</span>
                    <span className="text-slate-400">
                      Instantly ramps gain of all peer audio nodes to 0 and persists this mute state for any newly joined peers or newly created connections.
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Sliders className="h-3.5 w-3.5 text-indigo-400 shrink-0" />
                    <span className="text-slate-200 font-semibold">Per-Peer Volume &amp; Mute:</span>
                    <span className="text-slate-400">
                      Allows fine-grained volume adjustment (0%–150%) and individual mute toggling per channel.
                    </span>
                  </div>
                </div>
              </div>

              {/* 5. Spatial Audio Rendering Profiles */}
              <div>
                <h3 className="text-xs font-bold text-slate-100 uppercase tracking-wider mb-2.5 flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-indigo-400" />
                  5. Spatial Audio Rendering Profiles
                </h3>
                <p className="text-slate-400 mb-3 text-[11px] leading-relaxed">
                  Choose how peer audio is rendered in your headphones or speakers using the dropdown in the header or audio settings:
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 flex flex-col gap-1.5">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-slate-200">Mono</span>
                      <span className="text-[10px] text-slate-500 font-mono">Centered</span>
                    </div>
                    <p className="text-[11px] text-slate-400 leading-normal">
                      Equal intensity in both channels with zero horizontal panning. Ideal for single-earpiece setups or mono headsets.
                    </p>
                  </div>

                  <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 flex flex-col gap-1.5">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-indigo-300">Stereo Panner</span>
                      <span className="text-[10px] text-indigo-400/80 font-mono">2D L/R</span>
                    </div>
                    <p className="text-[11px] text-slate-400 leading-normal">
                      Bidirectional stereo panning based on horizontal displacement (-1.0 Left to +1.0 Right) using StereoPannerNode.
                    </p>
                  </div>

                  <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 flex flex-col gap-1.5">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-emerald-300">HRTF Binaural</span>
                      <span className="text-[10px] text-emerald-400/80 font-mono">3D Spatial</span>
                    </div>
                    <p className="text-[11px] text-slate-400 leading-normal">
                      Head-Related Transfer Function simulating acoustic head-shadowing and 3D positioning via Web Audio PannerNode.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="mt-4 pt-4 border-t border-slate-800 flex items-center justify-between">
              <span className="text-[11px] text-slate-500 font-mono">
                Click anywhere outside or press Esc to close
              </span>
              <button
                type="button"
                onClick={() => setIsLegendOpen(false)}
                className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs transition"
              >
                Got It
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
