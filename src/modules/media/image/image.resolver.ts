import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { Image, PresignUploadPayload } from './entities/image.entity';
import { ImageService } from './image.service';
import { PresignUploadInput } from './dto/presign-upload.input';
import { ConfirmUploadInput } from './dto/confirm-upload.input';
import { JwtAuthGuard } from '@/modules/identity/auth/jwt-auth.guard';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import type { CurrentUserPayload } from '@/common/decorators/current-user.decorator';

@Resolver(() => Image)
export class ImageResolver {
  constructor(private readonly service: ImageService) {}

  @UseGuards(JwtAuthGuard)
  @Mutation(() => PresignUploadPayload)
  async presignImageUpload(
    @CurrentUser() user: CurrentUserPayload,
    @Args('presignUploadInput') input: PresignUploadInput,
  ): Promise<PresignUploadPayload> {
    const result = await this.service.presignUpload(input, user.userId);
    return {
      uploadUrl: result.uploadUrl,
      method: result.method,
      fields: JSON.stringify(result.fields ?? {}),
      externalId: result.externalId,
      expiresIn: result.expiresIn,
      provider: this.service.activeProvider,
    };
  }

  @UseGuards(JwtAuthGuard)
  @Mutation(() => Image)
  confirmImageUpload(
    @CurrentUser() user: CurrentUserPayload,
    @Args('confirmUploadInput') input: ConfirmUploadInput,
  ) {
    return this.service.confirmUpload(input, user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Mutation(() => Image)
  deleteImage(
    @CurrentUser() user: CurrentUserPayload,
    @Args('id', { type: () => ID }) id: string,
  ) {
    return this.service.deleteImage(id, user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Query(() => Image, { name: 'image', nullable: true })
  findOne(@Args('id', { type: () => ID }) id: string) {
    return this.service.findById(id);
  }
}
