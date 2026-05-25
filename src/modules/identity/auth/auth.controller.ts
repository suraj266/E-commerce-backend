import { Body, Controller, Get, HttpCode, Post, Req, Res, UnauthorizedException, UseGuards } from "@nestjs/common";
import { AuthService } from "./auth.service";
import { LoginUserDto } from "./dto/login-user.dto";
import { RegisterSellerDto } from "./dto/register-seller.dto";
import { RegisterCustomerDto } from "./dto/register-customer.dto";
import {
    RequestPasswordResetDto,
    ResetPasswordDto,
} from "./dto/password-reset.dto";
import {
    AdminVerifyEmailDto,
    ResendVerificationDto,
    VerifyEmailDto,
} from "./dto/verify-email.dto";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { Permissions } from "@/common/decorators/permissions.decorator";
import { PermissionsGuard } from "@/common/guards/permissions.guard";
import type { Response, Request } from "express";

@Controller('auth')
export class AuthController {
    constructor(private readonly authService: AuthService) { }

    // -------------------------------------------------------------------------
    // SELLER REGISTRATION + EMAIL VERIFICATION
    // -------------------------------------------------------------------------

    @Post('seller/register')
    @HttpCode(201)
    async registerSeller(@Body() input: RegisterSellerDto) {
        return this.authService.registerSeller(input);
    }

    @Post('customer/register')
    @HttpCode(201)
    async registerCustomer(@Body() input: RegisterCustomerDto) {
        return this.authService.registerCustomer(input);
    }

    @Post('verify-email')
    @HttpCode(200)
    async verifyEmail(@Body() input: VerifyEmailDto) {
        return this.authService.verifyEmail(input);
    }

    @Post('resend-verification')
    @HttpCode(200)
    async resendVerification(@Body() input: ResendVerificationDto) {
        return this.authService.resendVerification(input);
    }

    // -------------------------------------------------------------------------
    // PASSWORD RESET (forgot-password)
    // -------------------------------------------------------------------------

    @Post('request-password-reset')
    @HttpCode(200)
    async requestPasswordReset(@Body() input: RequestPasswordResetDto) {
        return this.authService.requestPasswordReset(input);
    }

    @Post('reset-password')
    @HttpCode(200)
    async resetPassword(@Body() input: ResetPasswordDto) {
        return this.authService.resetPassword(input);
    }

    /** Admin-only: manually mark a user's email as verified. */
    @Post('admin/verify-email')
    @HttpCode(200)
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @Permissions('user:update')
    async adminVerifyEmail(@Body() input: AdminVerifyEmailDto) {
        return this.authService.adminVerifyEmail(input);
    }

    // -------------------------------------------------------------------------
    // LOGIN / REFRESH / LOGOUT
    // -------------------------------------------------------------------------

    @Post('login')
    @HttpCode(200)
    async login(@Body() loginUserInput: LoginUserDto, @Res({ passthrough: true }) res: Response) {
        const result = await this.authService.login(loginUserInput);

        // Set refresh token in HTTP-only cookie
        res.cookie('refreshToken', result.refreshToken, {
            httpOnly: true,       // JavaScript access nahi kar payega (XSS safe)
            secure: process.env.NODE_ENV === 'production',  // HTTPS only in production
            sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',   // CSRF protection
            maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in ms`
            path: '/',        // Sirf /auth routes pe bhejega
            domain: process.env.NODE_ENV === 'production' ? process.env.COOKIE_DOMAIN : undefined
        });

        // Response mein sirf accessToken aur user data bhejo, refreshToken nahi
        return {
            accessToken: result.accessToken,
            user: result.user,
        };
    }

    /**
     * Read-only session check for server-side role guards (Next.js AuthProxy).
     * Reads the refreshToken cookie, returns user identity + role. Does NOT
     * rotate tokens; safe to call on every protected page render.
     */
    @Get('session')
    @HttpCode(200)
    async session(@Req() req: Request) {
        const refreshToken = req.cookies?.refreshToken;
        if (!refreshToken) {
            throw new UnauthorizedException('No session');
        }
        return this.authService.getSession(refreshToken);
    }

    @Post('refresh')
    @HttpCode(200)
    async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
        const refreshToken = req.cookies?.refreshToken;
        if (!refreshToken) {
            throw new UnauthorizedException('No refresh token provided');
        }

        const result = await this.authService.refreshTokens({ refreshToken });

        // Set new refresh token in cookie (token rotation)
        res.cookie('refreshToken', result.refreshToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
            maxAge: 7 * 24 * 60 * 60 * 1000,
            path: '/',
            domain: process.env.NODE_ENV === 'production' ? process.env.COOKIE_DOMAIN : undefined
        });

        return { accessToken: result.accessToken };
    }

    @Post('logout')
    @HttpCode(200)
    @UseGuards(JwtAuthGuard)
    async logout(@Req() req: any, @Res({ passthrough: true }) res: Response) {
        const refreshToken = req.cookies?.refreshToken;
        if (!refreshToken) {
            throw new UnauthorizedException('No refresh token provided');
        }

        const result = await this.authService.logout({ refreshToken }, req.user.userId);

        // Clear the cookie (path must match the path used in res.cookie)
        res.clearCookie('refreshToken', { path: '/', domain: process.env.NODE_ENV === 'production' ? process.env.COOKIE_DOMAIN : undefined });

        return result;
    }
}
