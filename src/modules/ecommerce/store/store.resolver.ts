import { Resolver, Query, Mutation, Args, ID } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { StoreStatus } from '@prisma/client';
import { StoreService } from './store.service';
import { Store } from './entities/store.entity';
import { Warehouse } from './entities/warehouse.entity';
import { CreateStoreInput } from './dto/create-store.input';
import { UpdateStoreInput } from './dto/update-store.input';
import { SetStoreStatusInput } from './dto/set-store-status.input';
import { AdminCreateStoreInput } from './dto/admin-create-store.input';
import { CreateWarehouseInput } from './dto/create-warehouse.input';
import { UpdateWarehouseInput } from './dto/update-warehouse.input';
import { JwtAuthGuard } from '@/modules/identity/auth/jwt-auth.guard';
import { PermissionsGuard } from '@/common/guards/permissions.guard';
import { Permissions } from '@/common/decorators/permissions.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import type { CurrentUserPayload } from '@/common/decorators/current-user.decorator';

@Resolver(() => Store)
export class StoreResolver {
  constructor(private readonly storeService: StoreService) {}

  // ---------------------------------------------------------------------------
  // Self (seller-bound) — store core
  // ---------------------------------------------------------------------------

  @UseGuards(JwtAuthGuard)
  @Query(() => [Store], { name: 'myStores' })
  myStores(@CurrentUser() user: CurrentUserPayload) {
    return this.storeService.myStores(user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Query(() => Store, { name: 'myStore', nullable: true })
  myStore(
    @CurrentUser() user: CurrentUserPayload,
    @Args('id', { type: () => ID }) id: string,
  ) {
    return this.storeService.myStore(user.userId, id);
  }

  @UseGuards(JwtAuthGuard)
  @Mutation(() => Store)
  createMyStore(
    @CurrentUser() user: CurrentUserPayload,
    @Args('createStoreInput') input: CreateStoreInput,
  ) {
    return this.storeService.createMyStore(user.userId, input);
  }

  @UseGuards(JwtAuthGuard)
  @Mutation(() => Store)
  updateMyStore(
    @CurrentUser() user: CurrentUserPayload,
    @Args('updateStoreInput') input: UpdateStoreInput,
  ) {
    return this.storeService.updateMyStore(user.userId, input);
  }

  @UseGuards(JwtAuthGuard)
  @Mutation(() => Store)
  submitMyStoreForReview(
    @CurrentUser() user: CurrentUserPayload,
    @Args('id', { type: () => ID }) id: string,
  ) {
    return this.storeService.submitMyStoreForReview(user.userId, id);
  }

  @UseGuards(JwtAuthGuard)
  @Mutation(() => Store)
  removeMyStore(
    @CurrentUser() user: CurrentUserPayload,
    @Args('id', { type: () => ID }) id: string,
  ) {
    return this.storeService.removeMyStore(user.userId, id);
  }

  // ---------------------------------------------------------------------------
  // Admin
  // ---------------------------------------------------------------------------

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('store:read')
  @Query(() => [Store], { name: 'stores' })
  findAll(
    @Args('status', { type: () => StoreStatus, nullable: true })
    status?: StoreStatus,
  ) {
    return this.storeService.findAll(status);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('store:read')
  @Query(() => Store, { name: 'store' })
  findOne(@Args('id', { type: () => ID }) id: string) {
    return this.storeService.findOne(id);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('store:create')
  @Mutation(() => Store)
  adminCreateStore(@Args('input') input: AdminCreateStoreInput) {
    return this.storeService.adminCreate(input);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('store:update')
  @Mutation(() => Store)
  adminUpdateStore(@Args('input') input: UpdateStoreInput) {
    return this.storeService.adminUpdate(input);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('store:update')
  @Mutation(() => Store)
  setStoreStatus(@Args('setStoreStatusInput') input: SetStoreStatusInput) {
    return this.storeService.setStatus(input);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('store:delete')
  @Mutation(() => Store)
  adminRemoveStore(@Args('id', { type: () => ID }) id: string) {
    return this.storeService.adminRemove(id);
  }

  // ---------------------------------------------------------------------------
  // Public
  // ---------------------------------------------------------------------------

  @Query(() => Store, { name: 'publicStore' })
  publicStore(@Args('slug', { type: () => String }) slug: string) {
    return this.storeService.findPublic(slug);
  }

  // ---------------------------------------------------------------------------
  // Warehouse mutations (seller-managed)
  // ---------------------------------------------------------------------------

  @UseGuards(JwtAuthGuard)
  @Mutation(() => Warehouse)
  createMyWarehouse(
    @CurrentUser() user: CurrentUserPayload,
    @Args('createWarehouseInput') input: CreateWarehouseInput,
  ) {
    return this.storeService.addMyWarehouse(user.userId, input);
  }

  @UseGuards(JwtAuthGuard)
  @Mutation(() => Warehouse)
  updateMyWarehouse(
    @CurrentUser() user: CurrentUserPayload,
    @Args('updateWarehouseInput') input: UpdateWarehouseInput,
  ) {
    return this.storeService.updateMyWarehouse(user.userId, input);
  }

  @UseGuards(JwtAuthGuard)
  @Mutation(() => Warehouse)
  removeMyWarehouse(
    @CurrentUser() user: CurrentUserPayload,
    @Args('id', { type: () => ID }) id: string,
  ) {
    return this.storeService.removeMyWarehouse(user.userId, id);
  }

  @UseGuards(JwtAuthGuard)
  @Query(() => [Warehouse], { name: 'myWarehouses' })
  myWarehouses(
    @CurrentUser() user: CurrentUserPayload,
    @Args('storeId', { type: () => ID }) storeId: string,
  ) {
    return this.storeService.myWarehouses(user.userId, storeId);
  }
}
