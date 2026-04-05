import { Body, Controller, HttpCode, Post, Req, Res, UnauthorizedException, UseGuards } from "@nestjs/common";
import { AuthService } from "./auth.service";
import { LoginUserDto } from "./dto/login-user.dto";
import { JwtAuthGuard } from "./jwt-auth.guard";
import type { Response, Request } from "express";

@Controller('auth')
export class AuthController {
    constructor(private readonly authService: AuthService) { }

    @Post('login')
    @HttpCode(200)
    async login(@Body() loginUserInput: LoginUserDto, @Res({ passthrough: true }) res: Response) {
        const result = await this.authService.login(loginUserInput);

        // Set refresh token in HTTP-only cookie
        res.cookie('refreshToken', result.refreshToken, {
            httpOnly: true,       // JavaScript access nahi kar payega (XSS safe)
            secure: process.env.NODE_ENV === 'production',  // HTTPS only in production
            sameSite: 'strict',   // CSRF protection
            maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in ms
            path: '/auth',        // Sirf /auth routes pe bhejega
        });

        // Response mein sirf accessToken aur user data bhejo, refreshToken nahi
        return {
            accessToken: result.accessToken,
            user: result.user,
        };
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
            sameSite: 'strict',
            maxAge: 7 * 24 * 60 * 60 * 1000,
            path: '/auth',
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

        // Clear the cookie
        res.clearCookie('refreshToken', { path: '/auth' });

        return result;
    }
}