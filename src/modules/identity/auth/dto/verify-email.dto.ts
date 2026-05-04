import { IsNotEmpty, IsString, IsEmail, IsUUID } from 'class-validator';

export class VerifyEmailDto {
  @IsNotEmpty()
  @IsString()
  token: string;
}

export class ResendVerificationDto {
  @IsEmail()
  email: string;
}

export class AdminVerifyEmailDto {
  @IsUUID()
  userId: string;
}
