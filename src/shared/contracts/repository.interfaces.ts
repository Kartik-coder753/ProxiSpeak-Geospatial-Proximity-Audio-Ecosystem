import { Office, OfficeLayoutDto, OfficeMembership, OfficeRole } from './office.types';
import { User } from './user.types';

export interface IUserRepository {
  findById(id: string): Promise<User | null>;
  findByUsername(username: string): Promise<User | null>;
  create(user: Omit<User, 'createdAt'>): Promise<User>;
  listUsers(): Promise<User[]>;
}

export interface IOfficeRepository {
  findById(id: string): Promise<Office | null>;
  listOffices(): Promise<Office[]>;
  create(office: Omit<Office, 'createdAt'>): Promise<Office>;
  updateLayout(officeId: string, layout: Partial<OfficeLayoutDto>): Promise<Office | null>;
}

export interface IMembershipRepository {
  findMembership(userId: string, officeId: string): Promise<OfficeMembership | null>;
  isUserMemberOfOffice(userId: string, officeId: string): Promise<boolean>;
  getOfficeMembers(officeId: string): Promise<OfficeMembership[]>;
  getUserMemberships(userId: string): Promise<OfficeMembership[]>;
  addMembership(userId: string, officeId: string, role: OfficeRole): Promise<OfficeMembership>;
  removeMembership(userId: string, officeId: string): Promise<boolean>;
}
