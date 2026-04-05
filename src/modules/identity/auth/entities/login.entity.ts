export class LoginResponse {
    accessToken: string;
    refreshToken: string;
    user: {
        id: string;
        name: string;
        email: string;
        role?: {
            id?: string;
            name?: string;
        };
    };
}