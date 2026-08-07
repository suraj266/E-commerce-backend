import { IsNotEmpty, IsString, MinLength } from 'class-validator';

/**
 * In-account password change for a LOGGED-IN user.
 *
 * Unlike the forgot-password reset flow (which trusts a one-time email token),
 * this proves ownership by requiring the CURRENT password before accepting a
 * new one. The new password is held to the same 8-char minimum the reset flow
 * enforces.
 */
export class ChangePasswordDto {
  @IsNotEmpty()
  @IsString()
  currentPassword: string;

  @IsNotEmpty()
  @MinLength(8, { message: 'password must be at least 8 characters' })
  newPassword: string;
}
