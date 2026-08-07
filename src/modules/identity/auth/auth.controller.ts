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
import { ChangePasswordDto } from "./dto/change-password.dto";
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

    /** POST /auth/seller/register — register a seller (email unverified) + issue an email-verification token. Public. */
    @Post('seller/register')
    @HttpCode(201)
    async registerSeller(@Body() input: RegisterSellerDto) {
        return this.authService.registerSeller(input);
    }

    /** POST /auth/customer/register — register a customer (email unverified) + issue an email-verification token. Public. */
    @Post('customer/register')
    @HttpCode(201)
    async registerCustomer(@Body() input: RegisterCustomerDto) {
        return this.authService.registerCustomer(input);
    }

    /** POST /auth/verify-email — mark a user's email verified via a one-time token. Public. */
    @Post('verify-email')
    @HttpCode(200)
    async verifyEmail(@Body() input: VerifyEmailDto) {
        return this.authService.verifyEmail(input);
    }

    /** POST /auth/resend-verification — re-send the verification link; reply never reveals whether the email exists. Public. */
    @Post('resend-verification')
    @HttpCode(200)
    async resendVerification(@Body() input: ResendVerificationDto) {
        return this.authService.resendVerification(input);
    }

    // -------------------------------------------------------------------------
    // PASSWORD RESET (forgot-password)
    // -------------------------------------------------------------------------

    /** POST /auth/request-password-reset — email a reset link; always succeeds to avoid account enumeration. Public. */
    @Post('request-password-reset')
    @HttpCode(200)
    async requestPasswordReset(@Body() input: RequestPasswordResetDto) {
        return this.authService.requestPasswordReset(input);
    }

    /** POST /auth/reset-password — set a new password via a one-time reset token. Public. */
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

    /** POST /auth/login — email+password login; merges any guest cart and sets the refresh-token httpOnly cookie. Public. */
    @Post('login')
    @HttpCode(200)
    async login(@Body() loginUserInput: LoginUserDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
        // Merge any anonymous guest cart into the customer on login. The token
        // lives in an httpOnly cookie (JS can't read it), so the controller
        // reads it here and hands it to the (soft-fail) merge inside login.
        const guestCartToken = req.cookies?.guestCartToken;
        if (guestCartToken) {
            loginUserInput.guestCartToken = guestCartToken;
        }

        const result = await this.authService.login(loginUserInput);

        // Guest cart has been folded in (best-effort) — retire the cookie so the
        // now-empty guest cart token isn't reused. Path/domain must match how it
        // was set (see GuestCartResolver).
        if (guestCartToken) {
            res.clearCookie('guestCartToken', {
                path: '/',
                domain: process.env.NODE_ENV === 'production' ? process.env.COOKIE_DOMAIN : undefined,
            });
        }

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

    /** POST /auth/refresh — rotate tokens from the refreshToken cookie and set a fresh httpOnly cookie. Public (cookie-authenticated). */
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

    /** POST /auth/logout — revoke the refresh token and clear its cookie. Auth: logged-in user. */
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

    /**
     * POST /auth/change-password — a logged-in user rotates their own password.
     * Proves ownership with the current password, revokes every OTHER session,
     * and issues a fresh session for THIS device (cookie rotated below, new
     * access token returned). Auth: logged-in user.
     */
    @Post('change-password')
    @HttpCode(200)
    @UseGuards(JwtAuthGuard)
    async changePassword(
        @Req() req: any,
        @Body() input: ChangePasswordDto,
        @Res({ passthrough: true }) res: Response,
    ) {
        const result = await this.authService.changePassword(req.user.userId, input);

        // Rotate the refresh-token cookie onto the freshly-minted session (the
        // old one was just revoked). Options mirror login/refresh exactly.
        res.cookie('refreshToken', result.refreshToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
            maxAge: 7 * 24 * 60 * 60 * 1000,
            path: '/',
            domain: process.env.NODE_ENV === 'production' ? process.env.COOKIE_DOMAIN : undefined,
        });

        // Never return the refresh token in the body — it lives only in the cookie.
        return { accessToken: result.accessToken, message: result.message };
    }
}
