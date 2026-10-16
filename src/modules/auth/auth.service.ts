import { IAuthService, User } from '../../shared/contracts/user.types';
import { IUserRepository } from '../../shared/contracts/repository.interfaces';

export class AuthService implements IAuthService {
  constructor(private readonly userRepo: IUserRepository) {}

  /**
   * Verify an auth token. Supports:
   * 1. Predefined development/test tokens: "token-<username>" or "user-<id>"
   * 2. JSON Base64 formatted bearer tokens { userId: string, exp?: number }
   * 3. Direct user ID lookup for testing flexibility
   */
  async verifyToken(token: string): Promise<User | null> {
    if (!token || typeof token !== 'string') {
      return null;
    }

    const trimmed = token.trim();

    // Check pre-defined demo token formats
    if (trimmed.startsWith('token-')) {
      const username = trimmed.replace('token-', '');
      const user = await this.userRepo.findByUsername(username);
      if (user) return user;
    }

    // Check bearer token prefix
    const cleanToken = trimmed.startsWith('Bearer ') ? trimmed.slice(7).trim() : trimmed;

    // Check base64 encoded token
    try {
      const decodedStr = Buffer.from(cleanToken, 'base64').toString('utf-8');
      if (decodedStr.startsWith('{') && decodedStr.endsWith('}')) {
        const payload = JSON.parse(decodedStr);
        if (payload.userId) {
          const user = await this.userRepo.findById(payload.userId);
          if (user) return user;
        }
      }
    } catch {
      // Not base64 json, continue to direct lookup
    }

    // Direct user ID check
    const userById = await this.userRepo.findById(cleanToken);
    if (userById) return userById;

    // Fallback: check username
    return await this.userRepo.findByUsername(cleanToken);
  }

  generateToken(user: User): string {
    const payload = {
      userId: user.id,
      username: user.username,
      iat: Date.now()
    };
    return Buffer.from(JSON.stringify(payload)).toString('base64');
  }
}
