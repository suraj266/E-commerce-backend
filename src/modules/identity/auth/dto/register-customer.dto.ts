import { IsEmail, IsNotEmpty, Length, MinLength } from 'class-validator';

/**
 * Customer self-signup payload. Intentionally minimal — name + email +
 * password. Phone is collected later via the address form during checkout
 * (or in /account/profile) since it isn't required to start browsing.
 */
export class RegisterCustomerDto {
  @IsNotEmpty()
  @Length(2, 100)
  name: string;

  @IsEmail()
  email: string;

  @IsNotEmpty()
  @MinLength(8, { message: 'password must be at least 8 characters' })
  password: string;
}
