import { ObjectType, Field, ID, Int, registerEnumType } from '@nestjs/graphql';
import { ImageOwnerType, ImagePurpose } from '@prisma/client';

registerEnumType(ImageOwnerType, { name: 'ImageOwnerType' });
registerEnumType(ImagePurpose, { name: 'ImagePurpose' });

@ObjectType()
export class Image {
  @Field(() => ID)
  id: string;

  @Field(() => String, { description: 'local | s3 | cloudinary' })
  provider: string;

  @Field(() => String)
  externalId: string;

  @Field(() => String, { description: 'Canonical URL — render directly or via variants.' })
  url: string;

  @Field(() => String)
  format: string;

  @Field(() => Int)
  width: number;

  @Field(() => Int)
  height: number;

  @Field(() => Int)
  sizeBytes: number;

  @Field(() => ImageOwnerType)
  ownerType: ImageOwnerType;

  @Field(() => ID, { nullable: true })
  ownerId?: string | null;

  @Field(() => ImagePurpose)
  purpose: ImagePurpose;

  @Field(() => String, { nullable: true })
  alt?: string | null;

  @Field(() => Date)
  createdAt: Date;
}

@ObjectType()
export class PresignUploadPayload {
  @Field(() => String)
  uploadUrl: string;

  @Field(() => String)
  method: string;

  @Field(() => String, {
    description: 'JSON-encoded extra form fields for multipart POST uploads.',
  })
  fields: string;

  @Field(() => String)
  externalId: string;

  @Field(() => Int)
  expiresIn: number;

  @Field(() => String)
  provider: string;
}
