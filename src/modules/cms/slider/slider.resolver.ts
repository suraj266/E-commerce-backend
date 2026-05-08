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

  @Query(() => Slider, { name: 'publicSlider' })
  publicSlider(@Args('key', { type: () => String }) key: string) {
    return this.sliderService.findPublicByKey(key);
  }

  // ---------------------------------------------------------------------------
  // Admin
  // ---------------------------------------------------------------------------

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('slider:read')
  @Query(() => [Slider], { name: 'adminSliders' })
  adminSliders() {
    return this.sliderService.findAllAdmin();
  }

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

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('slider:read')
  @Query(() => Slider, { name: 'adminSlider' })
  adminSlider(@Args('id', { type: () => ID }) id: string) {
    return this.sliderService.findOneAdmin(id);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('slider:create')
  @Mutation(() => Slider)
  createSlider(@Args('createSliderInput') input: CreateSliderInput) {
    return this.sliderService.create(input);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('slider:update')
  @Mutation(() => Slider)
  updateSlider(@Args('updateSliderInput') input: UpdateSliderInput) {
    return this.sliderService.update(input);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('slider:update')
  @Mutation(() => Slider)
  setSliderStatus(
    @Args('setSliderStatusInput') input: SetSliderStatusInput,
  ) {
    return this.sliderService.setStatus(input);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('slider:delete')
  @Mutation(() => Slider)
  removeSlider(@Args('id', { type: () => ID }) id: string) {
    return this.sliderService.remove(id);
  }

  // ---------------------------------------------------------------------------
  // Slide item mutations
  // ---------------------------------------------------------------------------

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('slider:update')
  @Mutation(() => SlideItem)
  addSlideItem(@Args('addSlideItemInput') input: AddSlideItemInput) {
    return this.sliderService.addItem(input);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('slider:update')
  @Mutation(() => SlideItem)
  updateSlideItem(
    @Args('updateSlideItemInput') input: UpdateSlideItemInput,
  ) {
    return this.sliderService.updateItem(input);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('slider:update')
  @Mutation(() => SlideItem)
  removeSlideItem(@Args('id', { type: () => ID }) id: string) {
    return this.sliderService.removeItem(id);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('slider:update')
  @Mutation(() => Boolean)
  reorderSlideItems(
    @Args('reorderSlideItemsInput') input: ReorderSlideItemsInput,
  ) {
    return this.sliderService.reorderItems(input);
  }
}
