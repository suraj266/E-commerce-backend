import { Resolver, Query, Mutation, Args, ID } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { CollectionStatus } from '@prisma/client';
import { CollectionService } from './collection.service';
import { Collection } from './entities/collection.entity';
import { CreateCollectionInput } from './dto/create-collection.input';
import { UpdateCollectionInput } from './dto/update-collection.input';
import { JwtAuthGuard } from '@/modules/identity/auth/jwt-auth.guard';
import { PermissionsGuard } from '@/common/guards/permissions.guard';
import { Permissions } from '@/common/decorators/permissions.decorator';

@Resolver(() => Collection)
export class CollectionResolver {
  constructor(private readonly collections: CollectionService) {}

  // ---------------------------------------------------------------------------
  // Public
  // ---------------------------------------------------------------------------

  /** Active collections — homepage / nav. Public. */
  @Query(() => [Collection], { name: 'collections' })
  publicCollections(
    @Args('featuredOnly', { type: () => Boolean, nullable: true })
    featuredOnly?: boolean,
  ) {
    return this.collections.findAll('ACTIVE', featuredOnly ?? false);
  }

  /** Storefront collection by slug; ACTIVE only. Public. */
  @Query(() => Collection, { name: 'publicCollection' })
  publicCollection(@Args('slug', { type: () => String }) slug: string) {
    return this.collections.findPublic(slug);
  }

  // ---------------------------------------------------------------------------
  // Admin
  // ---------------------------------------------------------------------------

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  /** Admin collection list, any status. Auth: collection:read. */
  @Permissions('collection:read')
  @Query(() => [Collection], { name: 'adminCollections' })
  adminCollections(
    @Args('status', { type: () => CollectionStatus, nullable: true })
    status?: CollectionStatus,
  ) {
    return this.collections.findAll(status);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  /** Admin fetches one collection by id. Auth: collection:read. */
  @Permissions('collection:read')
  @Query(() => Collection, { name: 'collection' })
  collection(@Args('id', { type: () => ID }) id: string) {
    return this.collections.findOne(id);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  /** Creates a MANUAL (product junction) or SMART (rule-based) collection. Auth: collection:create. */
  @Permissions('collection:create')
  @Mutation(() => Collection)
  createCollection(@Args('createCollectionInput') input: CreateCollectionInput) {
    return this.collections.create(input);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  /** Edits a collection; switching to SMART clears manual membership. Auth: collection:update. */
  @Permissions('collection:update')
  @Mutation(() => Collection)
  updateCollection(@Args('updateCollectionInput') input: UpdateCollectionInput) {
    return this.collections.update(input);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  /** Soft-deletes a collection. Auth: collection:delete. */
  @Permissions('collection:delete')
  @Mutation(() => Collection)
  removeCollection(@Args('id', { type: () => ID }) id: string) {
    return this.collections.remove(id);
  }
}
