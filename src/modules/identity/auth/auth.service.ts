import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { StringValue } from 'ms';
import { LoginUserDto } from './dto/login-user.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterSellerDto } from './dto/register-seller.dto';
import { RegisterCustomerDto } from './dto/register-customer.dto';
import {
  RequestPasswordResetDto,
  ResetPasswordDto,
} from './dto/password-reset.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import {
  AdminVerifyEmailDto,
  ResendVerificationDto,
  VerifyEmailDto,
} from './dto/verify-email.dto';
import { LoginResponse } from './entities/login.entity';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { verify, hash } from 'argon2';
import { JwtService } from '@nestjs/jwt';
import { config } from '@/common/config/config';
import { EmailService } from '@/modules/admin/email/email.service';
import { CartService } from '@/modules/ecommerce/cart/cart.service';

const VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const MAX_FAILED_LOGIN_ATTEMPTS = 5; // lock after this many consecutive failures
const LOGIN_LOCKOUT_MS = 15 * 60 * 1000; // 15m auto-expiring lock (not permanent,
// so it can't be used to DoS a victim)
const PASSWORD_RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1h — short window
// because anyone with
// the token can take
// over the account.

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly email: EmailService,
    private readonly cartService: CartService,
  ) {}

  // Common context applied to every email — domain-derived `shopName` could
  // come from a SiteSetting later; for now we derive a sane default.
  private get shopName(): string {
    return 'Trueway';
  }

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
    const normalizedPhone = input.phone
      .replace(/\s+/g, '')
      .replace(/^\+91/, '');

    const sellerRole = await this.prisma.role.findUnique({
      where: { name: 'seller' },
    });
    if (!sellerRole) {
      throw new BadRequestException('Seller role missing. Run prisma seed.');
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
    const verificationUrl = `${config.FRONTEND_URL ?? ''}/seller/verify-email?token=${token}`;

    // Best-effort send — soft-fails if SMTP isn't configured. We still return
    // the token + URL so dev / staging flows continue to work.
    await this.email.send('email_verification', user.email, {
      customerName: user.name,
      verificationLink: verificationUrl,
      shopName: this.shopName,
    });

    return {
      message: 'Registration successful. Please verify your email.',
      userId: user.id,
      // The token is delivered by email. It is only echoed in the response for
      // local/staging convenience and is never exposed in production.
      ...(config.NODE_ENV !== 'production'
        ? { verificationToken: token, verificationUrl }
        : {}),
    };
  }

  // ========================
  // CUSTOMER REGISTRATION
  // ========================
  /**
   * Register a new user with the `customer` role. Same shape as the seller
   * flow (User row + EmailVerificationToken) PLUS a 1:1 Customer profile
   * extension row that holds storefront-specific prefs (currency, marketing
   * opt-in, etc.). Future cart/wishlist/order tables FK to `Customer.id`,
   * which keeps a future split of customers into a standalone identity
   * surface cheap. See CUSTOMER_SEPARATION_PLAYBOOK.md.
   *
   * Phone is intentionally not collected here — customers add it during
   * checkout via the address form.
   */
  async registerCustomer(input: RegisterCustomerDto) {
    const normalizedEmail = input.email.toLowerCase();

    const customerRole = await this.prisma.role.findUnique({
      where: { name: 'customer' },
    });
    if (!customerRole) {
      throw new BadRequestException('Customer role missing. Run prisma seed.');
    }

    const emailExists = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    });
    if (emailExists) throw new ConflictException('Email already registered');

    const passwordHash = await hash(input.password);

    // Atomic: create User + Customer extension together. Either both or
    // neither — never an orphan customer row.
    const user = await this.prisma.user.create({
      data: {
        name: input.name,
        email: normalizedEmail,
        password: passwordHash,
        roleId: customerRole.id,
        status: 'active',
        Customer: { create: {} },
      },
      include: { Customer: true },
    });

    const token = await this.issueEmailVerificationToken(user.id);
    const verificationUrl = `${config.FRONTEND_URL ?? ''}/verify-email?token=${token}`;

    await this.email.send('email_verification', user.email, {
      customerName: user.name,
      verificationLink: verificationUrl,
      shopName: this.shopName,
    });

    return {
      message: 'Registration successful. Please verify your email.',
      userId: user.id,
      // The token is delivered by email. Only echoed outside production.
      ...(config.NODE_ENV !== 'production'
        ? { verificationToken: token, verificationUrl }
        : {}),
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

    // Welcome message — fired once after first verification. Soft-fails so
    // a misconfigured SMTP doesn't block the verification response.
    await this.email.send('welcome', record.user.email, {
      customerName: record.user.name,
      shopName: this.shopName,
    });

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
    const verificationUrl = `${config.FRONTEND_URL ?? ''}/seller/verify-email?token=${token}`;

    await this.email.send('email_verification', user.email, {
      customerName: user.name,
      verificationLink: verificationUrl,
      shopName: this.shopName,
    });

    return {
      message: 'Verification link sent.',
      // The token is delivered by email. Only echoed outside production.
      ...(config.NODE_ENV !== 'production'
        ? { verificationToken: token, verificationUrl }
        : {}),
    };
  }

  /**
   * Admin manually marks a user's email as verified. Use when the seller can't
   * receive the email (typo / lost access) and the admin verified identity OOB.
   */
  async adminVerifyEmail(input: AdminVerifyEmailDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: input.userId },
    });
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
      include: { role: true },
    });
    // Generic message — never reveal whether the account exists (enumeration).
    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    // Per-account brute-force lockout. Independent of the coarse global
    // throttler, this stops password-guessing against a single account.
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new UnauthorizedException(
        'Account temporarily locked due to failed login attempts. Please try again later.',
      );
    }

    const isMatch = await verify(user.password, loginUserInput.password);
    if (!isMatch) {
      const attempts = (user.failedLoginAttempts ?? 0) + 1;
      const shouldLock = attempts >= MAX_FAILED_LOGIN_ATTEMPTS;
      await this.prisma.user.update({
        where: { id: user.id },
        data: shouldLock
          ? {
              failedLoginAttempts: 0,
              lockedUntil: new Date(Date.now() + LOGIN_LOCKOUT_MS),
            }
          : { failedLoginAttempts: attempts },
      });
      throw new UnauthorizedException('Invalid email or password');
    }

    // Correct credentials — clear any lockout state and record the login.
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
      },
    });

    // Account-type gate. The customer storefront, seller portal, and admin
    // panel each post their own `accountType` so users can't sign in with
    // the wrong kind of account from the wrong form. Mismatch returns the
    // same generic message a wrong password would, so attackers can't tell
    // whether they got the role or the password wrong.
    if (loginUserInput.accountType) {
      const roleName = user.role?.name ?? '';
      const allowed: Record<string, string[]> = {
        customer: ['customer'],
        seller: ['seller'],
        admin: ['admin', 'superAdmin'],
      };
      if (!allowed[loginUserInput.accountType]?.includes(roleName)) {
        throw new UnauthorizedException('Invalid credentials');
      }
    }

    // Block unverified emails for non-admin roles. Admin role is pre-verified
    // via the seed, so this only affects sellers / customers.
    if (!user.emailVerifiedAt && user.role?.name !== 'superAdmin') {
      throw new ForbiddenException(
        'Please verify your email before logging in.',
      );
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
      },
    });

    // Best-effort guest-cart merge. The login controller injects the
    // guestCartToken from the httpOnly cookie. This is intentionally
    // soft-fail — a merge error must NEVER block a successful sign-in.
    if (loginUserInput.guestCartToken) {
      try {
        await this.cartService.mergeGuestIntoCustomer(
          id,
          loginUserInput.guestCartToken,
        );
      } catch (err) {
        this.logger.warn(
          `Guest cart merge on login failed for user ${id}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    return {
      accessToken,
      refreshToken,
      user: { id, name, email, role: { id: role?.id, name: role?.name } },
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

    let matchedToken: (typeof userTokens)[0] | null = null;
    for (const storedToken of userTokens) {
      const isMatch = await verify(
        storedToken.token,
        refreshTokenDto.refreshToken,
      );
      if (isMatch) {
        matchedToken = storedToken;
        break;
      }
    }

    if (!matchedToken) {
      await this.prisma.refreshToken.deleteMany({
        where: { userId: payload.sub },
      });
      throw new UnauthorizedException(
        'Refresh token not found. All sessions revoked.',
      );
    }

    if (matchedToken.expiresAt < new Date()) {
      await this.prisma.refreshToken.delete({ where: { id: matchedToken.id } });
      throw new UnauthorizedException('Refresh token expired');
    }

    await this.prisma.refreshToken.delete({ where: { id: matchedToken.id } });

    const newAccessToken = this.generateAccessToken(payload.sub, payload.email);
    const newRefreshToken = this.generateRefreshToken(
      payload.sub,
      payload.email,
    );

    const hashedNewRefreshToken = await hash(newRefreshToken);
    await this.prisma.refreshToken.create({
      data: {
        token: hashedNewRefreshToken,
        userId: payload.sub,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
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
      const isMatch = await verify(
        storedToken.token,
        refreshTokenDto.refreshToken,
      );
      if (isMatch) {
        await this.prisma.refreshToken.delete({
          where: { id: storedToken.id },
        });
        return { message: 'Logged out successfully' };
      }
    }

    throw new UnauthorizedException('Invalid refresh token');
  }

  // ========================
  // SESSION REVOCATION (DPDP erasure — P3-07)
  // ========================
  /**
   * Revoke EVERY session + refresh token for a user — signs them out of all
   * devices. Called by PrivacyService.anonymizeUser during erasure to sever
   * access before the account is anonymized (also usable for a security
   * "log out everywhere" action).
   *
   * Idempotent: `deleteMany` over already-absent rows is a harmless no-op, so
   * it is safe for the erasure retry path to call this more than once. This is
   * an additive method — it does NOT touch the Wave-1 guest-cart-merge logic in
   * `login`.
   */
  async revokeAllSessions(
    userId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<{ sessions: number; refreshTokens: number }> {
    // Runs on the caller's tx when provided (so DPDP erasure revokes atomically
    // with the PII scrub); else self-contained. Idempotent deleteMany.
    const db = tx ?? this.prisma;
    const sessions = await db.session.deleteMany({ where: { userId } });
    const refreshTokens = await db.refreshToken.deleteMany({ where: { userId } });
    this.logger.log(
      `Revoked ${sessions.count} session(s) + ${refreshTokens.count} refresh token(s) for user ${userId}.`,
    );
    return { sessions: sessions.count, refreshTokens: refreshTokens.count };
  }

  // ========================
  // PASSWORD RESET
  // ========================

  /**
   * Forgot-password — generic OK response so callers can't enumerate
   * valid emails. If the email exists, we issue a single-use token
   * (valid 1h) and invalidate any older unused tokens for that user.
   *
   * Returns the token + dev URL so the frontend can show a click-through
   * link until SMTP is wired. In production, gate these fields behind
   * NODE_ENV the same way `verificationToken` is.
   */
  async requestPasswordReset(input: RequestPasswordResetDto) {
    const email = input.email.toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });

    // Always succeed externally — never leak account existence.
    if (!user) {
      return { message: 'If the email exists, a reset link was sent.' };
    }

    // Invalidate older unused tokens before issuing a fresh one — keeps
    // the attack surface small if the user reset multiple times.
    await this.prisma.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });

    const token = randomBytes(32).toString('hex');
    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        token,
        expiresAt: new Date(Date.now() + PASSWORD_RESET_TOKEN_TTL_MS),
      },
    });

    const resetUrl = `${config.FRONTEND_URL ?? ''}/reset-password?token=${token}`;

    await this.email.send('password_reset', user.email, {
      customerName: user.name,
      resetLink: resetUrl,
      shopName: this.shopName,
    });

    // The reset token is a direct account-takeover primitive and is NEVER
    // returned in the API response (in any environment) — it is only delivered
    // to the account's email. In development the link is logged server-side.
    if (config.NODE_ENV !== 'production') {
      this.logger.debug(`[dev] Password reset link for ${email}: ${resetUrl}`);
    }

    return {
      message: 'If the email exists, a reset link was sent.',
    };
  }

  /**
   * Apply the new password. Validates token freshness + single-use, then
   * argon2-hashes the new password and writes it. Also invalidates the
   * token by stamping `usedAt` so the same link can't be replayed.
   */
  async resetPassword(input: ResetPasswordDto) {
    const record = await this.prisma.passwordResetToken.findUnique({
      where: { token: input.token },
    });
    if (!record) throw new NotFoundException('Invalid reset link');
    if (record.usedAt) {
      throw new BadRequestException('This reset link has already been used');
    }
    if (record.expiresAt < new Date()) {
      throw new BadRequestException('Reset link expired. Request a new one.');
    }

    const passwordHash = await hash(input.password);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: record.userId },
        data: { password: passwordHash },
      }),
      this.prisma.passwordResetToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
      // Invalidate any active refresh tokens — force every device to
      // re-login with the new password. Keeps stolen sessions short.
      this.prisma.refreshToken.deleteMany({
        where: { userId: record.userId },
      }),
    ]);

    return { message: 'Password updated. You can now sign in.' };
  }

  // ========================
  // IN-ACCOUNT PASSWORD CHANGE
  // ========================
  /**
   * Change the password for a LOGGED-IN user. Proves ownership by verifying
   * the CURRENT password (argon2), then writes the new hash and revokes EVERY
   * existing session + refresh token (all devices) via `revokeAllSessions` — a
   * password change must invalidate anything minted under the old credential,
   * including the caller's own now-stale refresh token. A fresh session is then
   * minted for THIS device so the caller stays signed in while every OTHER
   * device is logged out (the controller sets the rotated cookie).
   *
   * Additive: reuses the existing `revokeAllSessions` + token-generation
   * helpers and touches no other auth internals.
   */
  async changePassword(
    userId: string,
    input: ChangePasswordDto,
  ): Promise<{ accessToken: string; refreshToken: string; message: string }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    // The JwtAuthGuard already proved a valid token; a missing user here means
    // the account was deleted mid-session — treat as unauthorized.
    if (!user) throw new UnauthorizedException('User not found');

    const isMatch = await verify(user.password, input.currentPassword);
    if (!isMatch) {
      throw new BadRequestException('Current password is incorrect');
    }

    // Reject a no-op change — the point is to rotate the secret.
    const sameAsOld = await verify(user.password, input.newPassword);
    if (sameAsOld) {
      throw new BadRequestException(
        'New password must be different from the current one',
      );
    }

    const passwordHash = await hash(input.newPassword);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { password: passwordHash },
    });

    // Sign the user out everywhere (incl. the current stale refresh token)...
    await this.revokeAllSessions(user.id);

    // ...then mint a brand-new session for this device so the caller isn't
    // abruptly logged out of the surface they just changed the password on.
    const accessToken = this.generateAccessToken(user.id, user.email);
    const refreshToken = this.generateRefreshToken(user.id, user.email);
    const hashedRefreshToken = await hash(refreshToken);
    await this.prisma.refreshToken.create({
      data: {
        token: hashedRefreshToken,
        userId: user.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      },
    });

    this.logger.log(
      `Password changed for user ${user.id}; all other sessions revoked.`,
    );

    return {
      accessToken,
      refreshToken,
      message: 'Password updated. You have been signed out of other devices.',
    };
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
      },
    );
  }

  private generateRefreshToken(userId: string, email: string): string {
    return this.jwtService.sign(
      { sub: userId, email },
      {
        secret: config.REFRESH_TOKEN_SECRET,
        expiresIn: config.REFRESH_TOKEN_EXPIRES_IN as StringValue,
      },
    );
  }
}
