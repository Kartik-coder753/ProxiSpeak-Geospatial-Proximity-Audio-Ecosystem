export interface User {
  id: string;
  username: string;
  displayName: string;
  avatarUrl?: string;
  email?: string;
  createdAt: Date;
}

export interface AuthContext {
  userId: string;
  user: User;
  token: string;
}

export interface IAuthService {
  verifyToken(token: string): Promise<User | null>;
  generateToken(user: User): string;
}
