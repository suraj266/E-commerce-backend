import { Resolver, Query, Mutation, Args, ID, Int } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { SliderStatus } from '@prisma/client';
import { JwtAuthGuard } from '@/modules/identity/auth/jwt-auth.guard';
import { Permissions } from '@/common/decorators/permissions.decorator';
import { PermissionsGuard } from '@/common/guards/permissions.guard';
import { SliderService } from './slider.service';
import { Slider, PaginatedSliders } from './entities/slider.entity';
import { SlideItem } from './entities/slide-item.entity';
import { CreateSliderInput } from './dto/create-slider.input';
import { UpdateSliderInput } from './dto/update-slider.input';
import { SetSliderStatusInput } from './dto/set-slider-status.input';
import { AddSlideItemInput } from './dto/add-slide-item.input';
import { UpdateSlideItemInput } from './dto/update-slide-item.input';
import { ReorderSlideItemsInput } from './dto/reorder-slide-items.input';

@Resolver(() => Slider)
export class SliderResolver {
  constructor(private readonly sliderService: SliderService) {}

  // ---------------------------------------------------------------------------
  // Public — storefront fetches by stable key
  // ---------------------------------------------------------------------------

  /** Public storefront slider by key; only PUBLISHED sliders with enabled items. Public. */
  @Query(() => Slider, { name: 'publicSlider' })
  publicSlider(@Args('key', { type: () => String }) key: string) {
    return this.sliderService.findPublicByKey(key);
  }

  // ---------------------------------------------------------------------------
  // Admin
  // ---------------------------------------------------------------------------

  /** Admin list of all sliders with their items. Auth: slider:read. */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('slider:read')
  @Query(() => [Slider], { name: 'adminSliders' })
  adminSliders() {
    return this.sliderService.findAllAdmin();
  }

  /** Paginated admin slider list (filter by status/search). Auth: slider:read. */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('slider:read')
  @Query(() => PaginatedSliders, { name: 'adminSlidersPaginated' })
  adminSlidersPaginated(
    @Args('status', { type: () => SliderStatus, nullable: true })
    status?: SliderStatus,
    @Args('page', { type: () => Int, nullable: true }) page?: number,
    @Args('pageSize', { type: () => Int, nullable: true }) pageSize?: number,
    @Args('search', { type: () => String, nullable: true }) search?: string,
  ) {
    return this.sliderService.findAllPaginated({
      status,
      page,
      pageSize,
      search,
    });
  }

  /** Admin fetch of one slider by id with its items. Auth: slider:read. */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('slider:read')
  @Query(() => Slider, { name: 'adminSlider' })
  adminSlider(@Args('id', { type: () => ID }) id: string) {
    return this.sliderService.findOneAdmin(id);
  }

  /** Create a slider; auto-generates a unique key from the name when none given. Auth: slider:create. */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('slider:create')
  @Mutation(() => Slider)
  createSlider(@Args('createSliderInput') input: CreateSliderInput) {
    return this.sliderService.create(input);
  }

  /** Update a slider's name/key/config (key uniqueness enforced). Auth: slider:update. */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('slider:update')
  @Mutation(() => Slider)
  updateSlider(@Args('updateSliderInput') input: UpdateSliderInput) {
    return this.sliderService.update(input);
  }

  /** Change a slider's publish status. Auth: slider:update. */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('slider:update')
  @Mutation(() => Slider)
  setSliderStatus(
    @Args('setSliderStatusInput') input: SetSliderStatusInput,
  ) {
    return this.sliderService.setStatus(input);
  }

  /** Soft-delete a slider (archives it). Auth: slider:delete. */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('slider:delete')
  @Mutation(() => Slider)
  removeSlider(@Args('id', { type: () => ID }) id: string) {
    return this.sliderService.remove(id);
  }

  // ---------------------------------------------------------------------------
  // Slide item mutations
  // ---------------------------------------------------------------------------

  /** Add a slide to a slider; appends at the end when no order is given. Auth: slider:update. */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('slider:update')
  @Mutation(() => SlideItem)
  addSlideItem(@Args('addSlideItemInput') input: AddSlideItemInput) {
    return this.sliderService.addItem(input);
  }

  /** Update a single slide's fields. Auth: slider:update. */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('slider:update')
  @Mutation(() => SlideItem)
  updateSlideItem(
    @Args('updateSlideItemInput') input: UpdateSlideItemInput,
  ) {
    return this.sliderService.updateItem(input);
  }

  /** Soft-delete a slide (also disables it). Auth: slider:update. */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('slider:update')
  @Mutation(() => SlideItem)
  removeSlideItem(@Args('id', { type: () => ID }) id: string) {
    return this.sliderService.removeItem(id);
  }

  /** Atomically reorder a slider's slides by id list; all ids must belong to it. Auth: slider:update. */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('slider:update')
  @Mutation(() => Boolean)
  reorderSlideItems(
    @Args('reorderSlideItemsInput') input: ReorderSlideItemsInput,
  ) {
    return this.sliderService.reorderItems(input);
  }
}
