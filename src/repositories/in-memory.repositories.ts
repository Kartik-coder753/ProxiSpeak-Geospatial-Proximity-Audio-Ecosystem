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
      createdAt: new Date(),
    };
    this.offices.set(newOffice.id, newOffice);
    return newOffice;
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
      createdAt: new Date(),
    },
    {
      id: 'user-bob',
      username: 'bob',
      displayName: 'Bob Martin',
      avatarUrl: 'https://api.dicebear.com/7.x/bottts/svg?seed=Bob',
      email: 'bob@infotact.com',
      createdAt: new Date(),
    },
    {
      id: 'user-charlie',
      username: 'charlie',
      displayName: 'Charlie Kim',
      avatarUrl: 'https://api.dicebear.com/7.x/bottts/svg?seed=Charlie',
      email: 'charlie@infotact.com',
      createdAt: new Date(),
    },
    {
      id: 'user-eve',
      username: 'eve',
      displayName: 'Eve Vance',
      avatarUrl: 'https://api.dicebear.com/7.x/bottts/svg?seed=Eve',
      email: 'eve@external-contractor.com',
      createdAt: new Date(),
    },
  ];

  const offices: Office[] = [
    {
      id: 'infotact-office',
      name: 'Infotact Main Campus',
      description: 'Primary collaborative workspace for engineering and product teams.',
      bounds: { minX: 0, minY: 0, maxX: 1200, maxY: 800 },
      accessPolicy: 'members_only',
      defaultSpawnPosition: { x: 200, y: 200 },
      obstacles: [
        {
          id: 'pod-1',
          name: 'Engineering Desks',
          x: 400,
          y: 250,
          width: 250,
          height: 140,
        },
        {
          id: 'partition-wall',
          name: 'Conference Partition',
          x: 800,
          y: 100,
          width: 30,
          height: 380,
        },
        {
          id: 'coffee-lounge',
          name: 'Coffee Bar',
          x: 100,
          y: 550,
          width: 180,
          height: 100,
        },
      ],
      createdAt: new Date(),
    },
    {
      id: 'executive-boardroom',
      name: 'Executive Boardroom',
      description: 'Private restricted boardroom for executive staff.',
      bounds: { minX: 0, minY: 0, maxX: 800, maxY: 600 },
      accessPolicy: 'members_only',
      defaultSpawnPosition: { x: 150, y: 150 },
      obstacles: [
        {
          id: 'board-table',
          name: 'Conference Table',
          x: 250,
          y: 200,
          width: 300,
          height: 200,
        },
      ],
      createdAt: new Date(),
    },
    {
      id: 'public-townhall',
      name: 'Open Townhall',
      description: 'Public auditorium open to all visitors.',
      bounds: { minX: 0, minY: 0, maxX: 1600, maxY: 1000 },
      accessPolicy: 'public',
      defaultSpawnPosition: { x: 300, y: 300 },
      obstacles: [
        {
          id: 'stage-podium',
          name: 'Stage',
          x: 600,
          y: 50,
          width: 400,
          height: 120,
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

    // Executive Boardroom Members (Alice and Bob ONLY; Eve and Charlie are NOT members!)
    { id: 'm5', officeId: 'executive-boardroom', userId: 'user-alice', role: 'owner', joinedAt: new Date() },
    { id: 'm6', officeId: 'executive-boardroom', userId: 'user-bob', role: 'member', joinedAt: new Date() },
  ];

  return {
    userRepo: new InMemoryUserRepository(users),
    officeRepo: new InMemoryOfficeRepository(offices),
    membershipRepo: new InMemoryMembershipRepository(memberships),
  };
}
