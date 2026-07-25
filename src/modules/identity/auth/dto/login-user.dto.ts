import { IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, MinLength } from "class-validator";

/**
 * Allowed surface for `accountType` — restricts which role can authenticate
 * via a given login form. Customer storefront sends 'customer'; the seller
 * portal sends 'seller'; the admin panel sends 'admin'. The auth service
 * silently rejects mismatches with the same "Invalid credentials" error
 * used for bad passwords (no role-based account enumeration).
 *
 * Omit accountType for legacy callers — login behaves as before (any role).
 */
export type LoginAccountType = 'customer' | 'seller' | 'admin';

export class LoginUserDto {

    @IsEmail()
    @IsNotEmpty()
    email: string;

    @IsNotEmpty()
    @MinLength(8)
    password: string;

    @IsOptional()
    @IsIn(['customer', 'seller', 'admin'])
    accountType?: LoginAccountType;

    /**
     * Opaque guest-cart session token (from the httpOnly `guestCartToken`
     * cookie, injected by the login controller). When present, the guest cart
     * is merged into this customer's cart on successful login — best-effort,
     * soft-fail: a merge failure NEVER blocks sign-in.
     */
    @IsOptional()
    @IsString()
    guestCartToken?: string;
}