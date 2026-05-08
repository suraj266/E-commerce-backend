import { IsEmail, IsNotEmpty, IsString, MinLength } from 'class-validator';

/**
 * Forgot-password request — customer/seller/admin types in their email.
 * The service responds with a generic OK regardless of whether the email
 * exists, so we don't leak account presence to attackers.
 *
 * In dev the response includes a `resetToken` and `resetUrl` so the
 * frontend can show a click-through link. In prod those fields are
 * stripped — only the email is sent.
 */
export class RequestPasswordResetDto {
  @IsEmail()
  email: string;
}

/**
 * Apply a new password using the token sent in the email. The token
 * is single-use (`usedAt` stamped on first redemption) and expires
 * after a short window (1 hour) to limit exposure.
 */
export class ResetPasswordDto {
  @IsNotEmpty()
  @IsString()
  token: string;

  @IsNotEmpty()
  @MinLength(8, { message: 'password must be at least 8 characters' })
  password: string;
}
