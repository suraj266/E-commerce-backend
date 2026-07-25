import { Resolver, Query, Mutation, Args, ID } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { TagStatus } from '@prisma/client';
import { TagService } from './tag.service';
import { Tag } from './entities/tag.entity';
import { CreateTagInput } from './dto/create-tag.input';
import { UpdateTagInput } from './dto/update-tag.input';
import { SetTagStatusInput } from './dto/set-tag-status.input';
import { JwtAuthGuard } from '@/modules/identity/auth/jwt-auth.guard';
import { PermissionsGuard } from '@/common/guards/permissions.guard';
import { Permissions } from '@/common/decorators/permissions.decorator';

@Resolver(() => Tag)
export class TagResolver {
  constructor(private readonly tagService: TagService) {}

  // ---------------------------------------------------------------------------
  // Public
  // ---------------------------------------------------------------------------

  /**
   * Public list — sellers' product create form populates the tag picker
   * from this query. Returns ACTIVE tags by default. Public.
   */
  @Query(() => [Tag], { name: 'tags' })
  tags(
    @Args('status', { type: () => TagStatus, nullable: true })
    status?: TagStatus,
    @Args('featuredOnly', { type: () => Boolean, nullable: true })
    featuredOnly?: boolean,
  ) {
    return this.tagService.findAll(status ?? TagStatus.ACTIVE, featuredOnly ?? false);
  }

  /** Storefront tag landing by slug; ACTIVE only. Public. */
  @Query(() => Tag, { name: 'publicTag' })
  publicTag(@Args('slug', { type: () => String }) slug: string) {
    return this.tagService.findPublic(slug);
  }

  // ---------------------------------------------------------------------------
  // Admin
  // ---------------------------------------------------------------------------

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  /** Admin tag list, any status. Auth: tag:read. */
  @Permissions('tag:read')
  @Query(() => [Tag], { name: 'adminTags' })
  adminTags(
    @Args('status', { type: () => TagStatus, nullable: true })
    status?: TagStatus,
  ) {
    return this.tagService.findAll(status);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  /** Admin fetches one tag by id. Auth: tag:read. */
  @Permissions('tag:read')
  @Query(() => Tag, { name: 'tag' })
  findOne(@Args('id', { type: () => ID }) id: string) {
    return this.tagService.findOne(id);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  /** Creates a tag; names are globally unique (case-insensitive). Auth: tag:create. */
  @Permissions('tag:create')
  @Mutation(() => Tag)
  createTag(@Args('createTagInput') input: CreateTagInput) {
    return this.tagService.create(input);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  /** Edits a tag; re-checks name uniqueness on rename. Auth: tag:update. */
  @Permissions('tag:update')
  @Mutation(() => Tag)
  updateTag(@Args('updateTagInput') input: UpdateTagInput) {
    return this.tagService.update(input);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  /** Toggles a tag's status and/or featured flag. Auth: tag:update + tag:feature. */
  @Permissions('tag:update', 'tag:feature')
  @Mutation(() => Tag)
  setTagStatus(@Args('setTagStatusInput') input: SetTagStatusInput) {
    return this.tagService.setStatus(input);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  /** Soft-deletes a tag. Auth: tag:delete. */
  @Permissions('tag:delete')
  @Mutation(() => Tag)
  removeTag(@Args('id', { type: () => ID }) id: string) {
    return this.tagService.remove(id);
  }
}
