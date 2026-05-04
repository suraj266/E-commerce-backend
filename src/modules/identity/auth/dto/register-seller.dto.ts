import { IsEmail, IsNotEmpty, Matches, MinLength, Length } from 'class-validator';

const PHONE_REGEX = /^(\+?91)?[6-9][0-9]{9}$/;

export class RegisterSellerDto {
  @IsNotEmpty()
  @Length(2, 100)
  name: string;

  @IsEmail()
  email: string;

  @IsNotEmpty()
  @Matches(PHONE_REGEX, { message: 'phone must be a valid India phone number' })
  phone: string;

  @IsNotEmpty()
  @MinLength(8, { message: 'password must be at least 8 characters' })
  password: string;
}
