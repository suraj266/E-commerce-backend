import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ImageController } from './image.controller';
import { ImageResolver } from './image.resolver';
import { ImageService } from './image.service';
import { LocalProvider } from './providers/local.provider';
import { S3Provider } from './providers/s3.provider';
import {
  IImageProvider,
  IMAGE_PROVIDER,
} from './providers/image-provider.interface';

/**
 * Image module — provides REST upload/serve + GraphQL control plane.
 *
 * The active provider is selected by the `IMAGE_PROVIDER` env var. Both
 * `LocalProvider` and `S3Provider` are always instantiated (cheap, no
 * external connections at construction) so callers can swap at runtime
 * without restarting. The `IMAGE_PROVIDER` token is bound to the active
 * one — that's what `ImageService` uses.
 */
@Module({
  imports: [ConfigModule],
  controllers: [ImageController],
  providers: [
    LocalProvider,
    S3Provider,
    {
      provide: IMAGE_PROVIDER,
      useFactory: (
        config: ConfigService,
        local: LocalProvider,
        s3: S3Provider,
      ): IImageProvider => {
        const which = (config.get<string>('IMAGE_PROVIDER') ?? 'local').toLowerCase();
        switch (which) {
          case 's3':
            return s3;
          case 'local':
          default:
            return local;
        }
      },
      inject: [ConfigService, LocalProvider, S3Provider],
    },
    ImageService,
    ImageResolver,
  ],
  exports: [ImageService],
})
export class ImageModule {}
