import { IUserRepository, IOfficeRepository, IMembershipRepository } from '../shared/contracts/repository.interfaces';
import { User } from '../shared/contracts/user.types';
import { Office, OfficeMembership, OfficeRole } from '../shared/contracts/office.types';

export class InMemoryUserRepository implements IUserRepository {
  private users = new Map<string, User>();

  constructor(initialUsers: User[] = []) {
    for (const u of initialUsers) {
      this.users.set(u.id, u);
    }
  }

  async findById(id: string): Promise<User | null> {
    return this.users.get(id) ?? null;
  }

  async findByUsername(username: string): Promise<User | null> {
    for (const u of this.users.values()) {
      if (u.username.toLowerCase() === username.toLowerCase()) {
        return u;
      }
    }
    return null;
  }

  async create(user: Omit<User, 'createdAt'>): Promise<User> {
    const newUser: User = {
      ...user,
      createdAt: new Date(),
    };
    this.users.set(newUser.id, newUser);
    return newUser;
  }

  async listUsers(): Promise<User[]> {
    return Array.from(this.users.values());
  }
}

export class InMemoryOfficeRepository implements IOfficeRepository {
  private offices = new Map<string, Office>();

  constructor(initialOffices: Office[] = []) {
    for (const o of initialOffices) {
      this.offices.set(o.id, o);
    }
  }

  async findById(id: string): Promise<Office | null> {
    return this.offices.get(id) ?? null;
  }

  async listOffices(): Promise<Office[]> {
    return Array.from(this.offices.values());
  }

  async create(office: Omit<Office, 'createdAt'>): Promise<Office> {
    const newOffice: Office = {
      ...office,
      layoutVersion: office.layoutVersion ?? 1,
      createdAt: new Date(),
    };
    this.offices.set(newOffice.id, newOffice);
    return newOffice;
  }

  async updateLayout(officeId: string, layout: Partial<import('../shared/contracts/office.types').OfficeLayoutDto>): Promise<Office | null> {
    const office = this.offices.get(officeId);
    if (!office) return null;

    if (layout.name) office.name = layout.name;
    if (layout.bounds) office.bounds = layout.bounds;
    if (layout.width !== undefined && layout.height !== undefined) {
      office.width = layout.width;
      office.height = layout.height;
      office.bounds = { minX: 0, minY: 0, maxX: layout.width, maxY: layout.height };
    }
    if (layout.obstacles) office.obstacles = layout.obstacles;
    office.layoutVersion = (office.layoutVersion ?? 0) + 1;
    office.updatedAt = new Date();

    return office;
  }
}

export class InMemoryMembershipRepository implements IMembershipRepository {
  private memberships: OfficeMembership[] = [];

  constructor(initialMemberships: OfficeMembership[] = []) {
    this.memberships = [...initialMemberships];
  }

  async findMembership(userId: string, officeId: string): Promise<OfficeMembership | null> {
    const found = this.memberships.find(
      (m) => m.userId === userId && m.officeId === officeId
    );
    return found ?? null;
  }

  async isUserMemberOfOffice(userId: string, officeId: string): Promise<boolean> {
    return this.memberships.some(
      (m) => m.userId === userId && m.officeId === officeId
    );
  }

  async getOfficeMembers(officeId: string): Promise<OfficeMembership[]> {
    return this.memberships.filter((m) => m.officeId === officeId);
  }

  async getUserMemberships(userId: string): Promise<OfficeMembership[]> {
    return this.memberships.filter((m) => m.userId === userId);
  }

  async addMembership(userId: string, officeId: string, role: OfficeRole): Promise<OfficeMembership> {
    const existing = await this.findMembership(userId, officeId);
    if (existing) {
      existing.role = role;
      return existing;
    }

    const membership: OfficeMembership = {
      id: `m-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      officeId,
      userId,
      role,
      joinedAt: new Date(),
    };
    this.memberships.push(membership);
    return membership;
  }

  async removeMembership(userId: string, officeId: string): Promise<boolean> {
    const index = this.memberships.findIndex(
      (m) => m.userId === userId && m.officeId === officeId
    );
    if (index !== -1) {
      this.memberships.splice(index, 1);
      return true;
    }
    return false;
  }
}

/**
 * Factory to seed default test/demo datasets
 */
export function createSeedRepositories() {
  const users: User[] = [
    {
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
    {
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
    {
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
    {
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
    {
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
    {
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
    {
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
    {
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
    {
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
    {
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
  ];

  const offices: Office[] = [
    {
      id: 'infotact-office',
      name: 'Infotact Main Campus',
      description: 'Primary collaborative workspace for engineering and product teams.',
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
    },
    {
      id: 'executive-boardroom',
      name: 'Executive Boardroom',
      description: 'Private restricted boardroom for executive staff.',
      bounds: { minX: 0, minY: 0, maxX: 800, maxY: 600 },
      width: 800,
      height: 600,
      layoutVersion: 1,
      accessPolicy: 'members_only',
      defaultSpawnPosition: { x: 150, y: 150 },
      obstacles: [
        {
          id: 'board-table',
          name: 'Conference Table',
          shape: 'rectangle',
          x: 250,
          y: 200,
          width: 300,
          height: 200,
          blocksMovement: true,
          blocksSound: false,
          attenuation: 0.8,
        },
      ],
      createdAt: new Date(),
    },
    {
      id: 'public-townhall',
      name: 'Open Townhall',
      description: 'Public auditorium open to all visitors.',
      bounds: { minX: 0, minY: 0, maxX: 1600, maxY: 1000 },
      width: 1600,
      height: 1000,
      layoutVersion: 1,
      accessPolicy: 'public',
      defaultSpawnPosition: { x: 300, y: 300 },
      obstacles: [
        {
          id: 'stage-podium',
          name: 'Stage',
          shape: 'rectangle',
          x: 600,
          y: 50,
          width: 400,
          height: 120,
          blocksMovement: true,
          blocksSound: false,
          attenuation: 0.9,
        },
      ],
      createdAt: new Date(),
    },
  ];

  const memberships: OfficeMembership[] = [
    // Infotact Office Members
    { id: 'm1', officeId: 'infotact-office', userId: 'user-alice', role: 'admin', joinedAt: new Date() },
    { id: 'm2', officeId: 'infotact-office', userId: 'user-bob', role: 'member', joinedAt: new Date() },
    { id: 'm3', officeId: 'infotact-office', userId: 'user-charlie', role: 'member', joinedAt: new Date() },
    { id: 'm4', officeId: 'infotact-office', userId: 'user-eve', role: 'guest', joinedAt: new Date() },
    { id: 'm5', officeId: 'infotact-office', userId: 'user-maya', role: 'admin', joinedAt: new Date() },
    { id: 'm6', officeId: 'infotact-office', userId: 'user-liam', role: 'member', joinedAt: new Date() },
    { id: 'm7', officeId: 'infotact-office', userId: 'user-elena', role: 'member', joinedAt: new Date() },
    { id: 'm8', officeId: 'infotact-office', userId: 'user-marcus', role: 'member', joinedAt: new Date() },
    { id: 'm9', officeId: 'infotact-office', userId: 'user-zara', role: 'member', joinedAt: new Date() },
    { id: 'm10', officeId: 'infotact-office', userId: 'user-dexter', role: 'member', joinedAt: new Date() },

    // Executive Boardroom Members (Alice, Bob, and Maya ONLY; Eve and Charlie are NOT members!)
    { id: 'm11', officeId: 'executive-boardroom', userId: 'user-alice', role: 'owner', joinedAt: new Date() },
    { id: 'm12', officeId: 'executive-boardroom', userId: 'user-bob', role: 'member', joinedAt: new Date() },
    { id: 'm13', officeId: 'executive-boardroom', userId: 'user-maya', role: 'admin', joinedAt: new Date() },
  ];

  return {
    userRepo: new InMemoryUserRepository(users),
    officeRepo: new InMemoryOfficeRepository(offices),
    membershipRepo: new InMemoryMembershipRepository(memberships),
  };
}
