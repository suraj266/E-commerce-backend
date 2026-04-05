import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { StringValue } from 'ms';
import { LoginUserDto } from './dto/login-user.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { LoginResponse } from './entities/login.entity';
import { PrismaService } from 'src/prisma/prisma.service';
import { verify, hash } from 'argon2';
import { JwtService } from '@nestjs/jwt';
import { config } from '@/common/config/config';

@Injectable()
export class AuthService {

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService
  ) { }

  // ========================
  // LOGIN
  // ========================
  async login(loginUserInput: LoginUserDto): Promise<LoginResponse> {
    const user = await this.prisma.user.findUnique({
      where: { email: loginUserInput.email },
      include: { role: true }
    })
    if (!user) {
      throw new NotFoundException("User not found")
    }
    const isMatch = await verify(user.password, loginUserInput.password)
    if (!isMatch) {
      throw new UnauthorizedException("Invalid password")
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
  // REFRESH TOKENS
  // ========================
  async refreshTokens(refreshTokenDto: RefreshTokenDto) {
    // Verify the refresh token JWT
    let payload: any;
    try {
      payload = this.jwtService.verify(refreshTokenDto.refreshToken, {
        secret: config.REFRESH_TOKEN_SECRET,
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    // Find all refresh tokens for this user
    const userTokens = await this.prisma.refreshToken.findMany({
      where: { userId: payload.sub },
    });

    // Find the matching token by comparing hashes
    let matchedToken: typeof userTokens[0] | null = null;
    for (const storedToken of userTokens) {
      const isMatch = await verify(storedToken.token, refreshTokenDto.refreshToken);
      if (isMatch) {
        matchedToken = storedToken;
        break;
      }
    }

    if (!matchedToken) {
      // Token reuse detected — revoke ALL tokens for this user (security)
      await this.prisma.refreshToken.deleteMany({ where: { userId: payload.sub } });
      throw new UnauthorizedException('Refresh token not found. All sessions revoked.');
    }

    // Check expiry
    if (matchedToken.expiresAt < new Date()) {
      await this.prisma.refreshToken.delete({ where: { id: matchedToken.id } });
      throw new UnauthorizedException('Refresh token expired');
    }

    // Token Rotation — delete old, create new
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

    // Find and delete the matching token
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
