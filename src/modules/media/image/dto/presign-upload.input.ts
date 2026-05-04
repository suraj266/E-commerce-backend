import { InputType, Field } from '@nestjs/graphql';
import { ImagePurpose } from '@prisma/client';
import { IsEnum, IsOptional, IsString, Length } from 'class-validator';

@InputType()
export class PresignUploadInput {
  @Field(() => ImagePurpose)
  @IsEnum(ImagePurpose)
  purpose: ImagePurpose;

  @Field(() => String, { description: 'image/jpeg | image/png | image/webp' })
  @IsString()
  contentType: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @Length(0, 200)
  originalName?: string;
}
