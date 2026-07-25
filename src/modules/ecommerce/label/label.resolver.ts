import { Resolver, Query, Mutation, Args, ID } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { LabelService } from './label.service';
import { Label } from './entities/label.entity';
import { CreateLabelInput } from './dto/create-label.input';
import { UpdateLabelInput } from './dto/update-label.input';
import { JwtAuthGuard } from '@/modules/identity/auth/jwt-auth.guard';
import { PermissionsGuard } from '@/common/guards/permissions.guard';
import { Permissions } from '@/common/decorators/permissions.decorator';

@Resolver(() => Label)
export class LabelResolver {
  constructor(private readonly labelService: LabelService) {}

  /**
   * Enabled labels — the seller product form populates its label picker from
   * this (it assigns MANUAL ones; AUTO are shown read-only). Authenticated.
   */
  @UseGuards(JwtAuthGuard)
  @Query(() => [Label], { name: 'labels' })
  labels() {
    return this.labelService.findEnabled();
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  /** Admin list of all labels (MANUAL + AUTO, any state). Auth: label:read. */
  @Permissions('label:read')
  @Query(() => [Label], { name: 'adminLabels' })
  adminLabels() {
    return this.labelService.findAll();
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  /** Admin fetches one label by id. Auth: label:read. */
  @Permissions('label:read')
  @Query(() => Label, { name: 'label' })
  label(@Args('id', { type: () => ID }) id: string) {
    return this.labelService.findOne(id);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  /** Creates a MANUAL or AUTO (rule-based) label; key must be unique. Auth: label:create. */
  @Permissions('label:create')
  @Mutation(() => Label)
  createLabel(@Args('createLabelInput') input: CreateLabelInput) {
    return this.labelService.create(input);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  /** Edits a label; re-validates the rule on type/rule change. Auth: label:update. */
  @Permissions('label:update')
  @Mutation(() => Label)
  updateLabel(@Args('updateLabelInput') input: UpdateLabelInput) {
    return this.labelService.update(input);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  /** Soft-deletes a label; system labels can't be deleted. Auth: label:delete. */
  @Permissions('label:delete')
  @Mutation(() => Label)
  removeLabel(@Args('id', { type: () => ID }) id: string) {
    return this.labelService.remove(id);
  }
}
