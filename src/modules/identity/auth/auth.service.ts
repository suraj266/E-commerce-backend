import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { StringValue } from 'ms';
import { LoginUserDto } from './dto/login-user.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterSellerDto } from './dto/register-seller.dto';
import {
  AdminVerifyEmailDto,
  ResendVerificationDto,
  VerifyEmailDto,
} from './dto/verify-email.dto';
import { LoginResponse } from './entities/login.entity';
import { PrismaService } from 'src/prisma/prisma.service';
import { verify, hash } from 'argon2';
import { JwtService } from '@nestjs/jwt';
import { config } from '@/common/config/config';

const VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24h

@Injectable()
export class AuthService {

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService
  ) { }

  // ========================
  // SELLER REGISTRATION
  // ========================
  /**
   * Register a new user with the `seller` role. Creates a User row with
   * emailVerifiedAt = null and issues an EmailVerificationToken.
   *
   * In dev, the token is returned in the response so the frontend can show
   * a click-through link. In production this would be sent only via email.
   */
  async registerSeller(input: RegisterSellerDto) {
    const normalizedEmail = input.email.toLowerCase();
    const normalizedPhone = input.phone.replace(/\s+/g, '').replace(/^\+91/, '');

    const sellerRole = await this.prisma.role.findUnique({
      where: { name: 'seller' },
    });
    if (!sellerRole) {
      throw new BadRequestException(
        'Seller role missing. Run prisma seed.',
      );
    }

    const [emailExists, phoneExists] = await Promise.all([
      this.prisma.user.findUnique({ where: { email: normalizedEmail } }),
      this.prisma.user.findUnique({ where: { phone: normalizedPhone } }),
    ]);
    if (emailExists) throw new ConflictException('Email already registered');
    if (phoneExists) throw new ConflictException('Phone already registered');

    const passwordHash = await hash(input.password);

    const user = await this.prisma.user.create({
      data: {
        name: input.name,
        email: normalizedEmail,
        phone: normalizedPhone,
        password: passwordHash,
        roleId: sellerRole.id,
        status: 'active',
      },
    });

    const token = await this.issueEmailVerificationToken(user.id);

    return {
      message: 'Registration successful. Please verify your email.',
      userId: user.id,
      // Dev convenience — exposes the token. Remove or gate by NODE_ENV in prod.
      verificationToken: token,
      verificationUrl: `${config.FRONTEND_URL ?? ''}/seller/verify-email?token=${token}`,
    };
  }

  // ========================
  // EMAIL VERIFICATION
  // ========================
  async verifyEmail(input: VerifyEmailDto) {
    const record = await this.prisma.emailVerificationToken.findUnique({
      where: { token: input.token },
      include: { user: true },
    });
    if (!record) throw new NotFoundException('Invalid token');
    if (record.usedAt) throw new BadRequestException('Token already used');
    if (record.expiresAt < new Date()) {
      throw new BadRequestException('Token expired. Request a new one.');
    }

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: record.userId },
        data: { emailVerifiedAt: new Date() },
      }),
      this.prisma.emailVerificationToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
    ]);

    return {
      message: 'Email verified successfully',
      email: record.user.email,
    };
  }

  async resendVerification(input: ResendVerificationDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: input.email.toLowerCase() },
    });
    // Don't reveal whether email exists
    if (!user) return { message: 'If the email exists, a new link was sent.' };
    if (user.emailVerifiedAt) {
      return { message: 'Email already verified.' };
    }

    // Invalidate any older unused tokens for this user
    await this.prisma.emailVerificationToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });

    const token = await this.issueEmailVerificationToken(user.id);
    return {
      message: 'Verification link sent.',
      verificationToken: token,
      verificationUrl: `${config.FRONTEND_URL ?? ''}/seller/verify-email?token=${token}`,
    };
  }

  /**
   * Admin manually marks a user's email as verified. Use when the seller can't
   * receive the email (typo / lost access) and the admin verified identity OOB.
   */
  async adminVerifyEmail(input: AdminVerifyEmailDto) {
    const user = await this.prisma.user.findUnique({ where: { id: input.userId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.emailVerifiedAt) {
      return { message: 'Already verified', userId: user.id };
    }
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: user.id },
        data: { emailVerifiedAt: new Date() },
      }),
      this.prisma.emailVerificationToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      }),
    ]);
    return { message: 'Verified by admin', userId: user.id };
  }

  // ========================
  // LOGIN
  // ========================
  async login(loginUserInput: LoginUserDto): Promise<LoginResponse> {
    const user = await this.prisma.user.findUnique({
      where: { email: loginUserInput.email.toLowerCase() },
      include: { role: true }
    })
    if (!user) {
      throw new NotFoundException("User not found")
    }
    const isMatch = await verify(user.password, loginUserInput.password)
    if (!isMatch) {
      throw new UnauthorizedException("Invalid password")
    }

    // Block unverified emails for non-admin roles. Admin role is pre-verified
    // via the seed, so this only affects sellers / customers.
    if (!user.emailVerifiedAt && user.role?.name !== 'superAdmin') {
      throw new ForbiddenException('Please verify your email before logging in.');
    }

    const { id, name, email, role } = user;

    // Generate tokens
    const accessToken = this.generateAccessToken(id, email);
    const refreshToken = this.generateRefreshToken(id, email);

    // Hash refresh token and store in DB
    const hashedRefreshToken = await hash(refreshToken);
    await this.prisma.refreshToken.create({
      data: {
        token: hashedRefreshToken,
        userId: id,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      }
    });

    return {
      accessToken,
      refreshToken,
      user: { id, name, email, role: { id: role?.id, name: role?.name } }
    };
  }

  // ========================
  // SESSION (read-only — for server-side role check in Next.js layouts)
  // ========================
  /**
   * Validates the refresh token cookie and returns the user's identity + role.
   * Does NOT rotate tokens. Used by frontend AuthProxy for role-based routing.
   */
  async getSession(refreshToken: string) {
    if (!refreshToken) throw new UnauthorizedException('No session');

    let payload: any;
    try {
      payload = this.jwtService.verify(refreshToken, {
        secret: config.REFRESH_TOKEN_SECRET,
      });
    } catch {
      throw new UnauthorizedException('Invalid session');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: { role: true },
    });
    if (!user) throw new UnauthorizedException('User not found');

    return {
      userId: user.id,
      email: user.email,
      name: user.name,
      role: user.role ? { id: user.role.id, name: user.role.name } : null,
    };
  }

  // ========================
  // REFRESH TOKENS
  // ========================
  async refreshTokens(refreshTokenDto: RefreshTokenDto) {
    let payload: any;
    try {
      payload = this.jwtService.verify(refreshTokenDto.refreshToken, {
        secret: config.REFRESH_TOKEN_SECRET,
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const userTokens = await this.prisma.refreshToken.findMany({
      where: { userId: payload.sub },
    });

    let matchedToken: typeof userTokens[0] | null = null;
    for (const storedToken of userTokens) {
      const isMatch = await verify(storedToken.token, refreshTokenDto.refreshToken);
      if (isMatch) {
        matchedToken = storedToken;
        break;
      }
    }

    if (!matchedToken) {
      await this.prisma.refreshToken.deleteMany({ where: { userId: payload.sub } });
      throw new UnauthorizedException('Refresh token not found. All sessions revoked.');
    }

    if (matchedToken.expiresAt < new Date()) {
      await this.prisma.refreshToken.delete({ where: { id: matchedToken.id } });
      throw new UnauthorizedException('Refresh token expired');
    }

    await this.prisma.refreshToken.delete({ where: { id: matchedToken.id } });

    const newAccessToken = this.generateAccessToken(payload.sub, payload.email);
    const newRefreshToken = this.generateRefreshToken(payload.sub, payload.email);

    const hashedNewRefreshToken = await hash(newRefreshToken);
    await this.prisma.refreshToken.create({
      data: {
        token: hashedNewRefreshToken,
        userId: payload.sub,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      }
    });

    return {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
    };
  }

  // ========================
  // LOGOUT
  // ========================
  async logout(refreshTokenDto: RefreshTokenDto, userId: string) {
    const userTokens = await this.prisma.refreshToken.findMany({
      where: { userId },
    });

    for (const storedToken of userTokens) {
      const isMatch = await verify(storedToken.token, refreshTokenDto.refreshToken);
      if (isMatch) {
        await this.prisma.refreshToken.delete({ where: { id: storedToken.id } });
        return { message: 'Logged out successfully' };
      }
    }

    throw new UnauthorizedException('Invalid refresh token');
  }

  // ========================
  // PRIVATE HELPERS
  // ========================
  private async issueEmailVerificationToken(userId: string) {
    const token = randomBytes(32).toString('hex');
    await this.prisma.emailVerificationToken.create({
      data: {
        userId,
        token,
        expiresAt: new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS),
      },
    });
    return token;
  }

  private generateAccessToken(userId: string, email: string): string {
    return this.jwtService.sign(
      { sub: userId, email },
      {
        secret: config.JWT_SECRET,
        expiresIn: config.JWT_EXPIRES_IN,
        algorithm: config.JWT_ALGORITHM as any,
      }
    );
  }

  private generateRefreshToken(userId: string, email: string): string {
    return this.jwtService.sign(
      { sub: userId, email },
      {
        secret: config.REFRESH_TOKEN_SECRET,
        expiresIn: config.REFRESH_TOKEN_EXPIRES_IN as StringValue,
      }
    );
  }
}
