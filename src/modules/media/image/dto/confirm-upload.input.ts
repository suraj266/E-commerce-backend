import { InputType, Field, ID } from '@nestjs/graphql';
import { ImageOwnerType, ImagePurpose } from '@prisma/client';
import { IsEnum, IsOptional, IsString, IsUUID, Length } from 'class-validator';

@InputType()
export class ConfirmUploadInput {
  @Field(() => String)
  @IsString()
  externalId: string;

  @Field(() => ImagePurpose)
  @IsEnum(ImagePurpose)
  purpose: ImagePurpose;

  @Field(() => ImageOwnerType, { nullable: true })
  @IsOptional()
  @IsEnum(ImageOwnerType)
  ownerType?: ImageOwnerType;

  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsUUID()
  ownerId?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @Length(0, 300)
  alt?: string;
}
