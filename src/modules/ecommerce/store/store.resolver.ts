import { Resolver, Query, Mutation, Args, ID, ResolveField, Parent } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { StoreStatus } from '@prisma/client';
import { StoreService } from './store.service';
import { Store } from './entities/store.entity';
import { Warehouse } from './entities/warehouse.entity';
import { ShippingConfig } from './entities/shipping-config.entity';
import { CreateStoreInput } from './dto/create-store.input';
import { UpdateStoreInput } from './dto/update-store.input';
import { SetStoreStatusInput } from './dto/set-store-status.input';
import { AdminCreateStoreInput } from './dto/admin-create-store.input';
import { CreateWarehouseInput } from './dto/create-warehouse.input';
import { UpdateWarehouseInput } from './dto/update-warehouse.input';
import { UpdateStoreShippingInput } from './dto/update-store-shipping.input';
import { parseShippingConfig } from '../shipping/shipping-rate';
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

  /** The caller's own stores. Auth: logged-in seller. */
  @UseGuards(JwtAuthGuard)
  @Query(() => [Store], { name: 'myStores' })
  myStores(@CurrentUser() user: CurrentUserPayload) {
    return this.storeService.myStores(user.userId);
  }

  /** One of the caller's own stores by id (ownership-checked). Auth: logged-in seller. */
  @UseGuards(JwtAuthGuard)
  @Query(() => Store, { name: 'myStore', nullable: true })
  myStore(
    @CurrentUser() user: CurrentUserPayload,
    @Args('id', { type: () => ID }) id: string,
  ) {
    return this.storeService.myStore(user.userId, id);
  }

  /** Create a store (seller must be VERIFIED); also seeds a default warehouse. Auth: logged-in seller. */
  @UseGuards(JwtAuthGuard)
  @Mutation(() => Store)
  createMyStore(
    @CurrentUser() user: CurrentUserPayload,
    @Args('createStoreInput') input: CreateStoreInput,
  ) {
    return this.storeService.createMyStore(user.userId, input);
  }

  /** Update the caller's own store (slug uniqueness + currency-lock-after-products enforced). Auth: logged-in seller. */
  @UseGuards(JwtAuthGuard)
  @Mutation(() => Store)
  updateMyStore(
    @CurrentUser() user: CurrentUserPayload,
    @Args('updateStoreInput') input: UpdateStoreInput,
  ) {
    return this.storeService.updateMyStore(user.userId, input);
  }

  /** Update the store's shipping config (flat/per-kg rates, COD, excluded pincodes), merged over existing. Auth: logged-in seller. */
  @UseGuards(JwtAuthGuard)
  @Mutation(() => Store)
  updateMyStoreShipping(
    @CurrentUser() user: CurrentUserPayload,
    @Args('input') input: UpdateStoreShippingInput,
  ) {
    return this.storeService.updateMyStoreShipping(user.userId, input);
  }

  /** Submit a DRAFT store (needs an active warehouse); MVP skips review and goes straight to ACTIVE. Auth: logged-in seller. */
  @UseGuards(JwtAuthGuard)
  @Mutation(() => Store)
  submitMyStoreForReview(
    @CurrentUser() user: CurrentUserPayload,
    @Args('id', { type: () => ID }) id: string,
  ) {
    return this.storeService.submitMyStoreForReview(user.userId, id);
  }

  /** Soft-delete the caller's own store (blocked if it still has products). Auth: logged-in seller. */
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

  /** List all stores, optionally filtered by status. Auth: store:read permission. */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('store:read')
  @Query(() => [Store], { name: 'stores' })
  findAll(
    @Args('status', { type: () => StoreStatus, nullable: true })
    status?: StoreStatus,
  ) {
    return this.storeService.findAll(status);
  }

  /** One store by id. Auth: store:read permission. */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('store:read')
  @Query(() => Store, { name: 'store' })
  findOne(@Args('id', { type: () => ID }) id: string) {
    return this.storeService.findOne(id);
  }

  /** Admin creates a store under any VERIFIED seller, ACTIVE immediately (+ default warehouse). Auth: store:create permission. */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('store:create')
  @Mutation(() => Store)
  adminCreateStore(@Args('input') input: AdminCreateStoreInput) {
    return this.storeService.adminCreate(input);
  }

  /** Admin updates any store, bypassing the ownership check (same business rules). Auth: store:update permission. */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('store:update')
  @Mutation(() => Store)
  adminUpdateStore(@Args('input') input: UpdateStoreInput) {
    return this.storeService.adminUpdate(input);
  }

  /** Set a store's status, recording the action + reason in metadata. Auth: store:update permission. */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('store:update')
  @Mutation(() => Store)
  setStoreStatus(@Args('setStoreStatusInput') input: SetStoreStatusInput) {
    return this.storeService.setStatus(input);
  }

  /** Admin soft-deletes any store. Auth: store:delete permission. */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('store:delete')
  @Mutation(() => Store)
  adminRemoveStore(@Args('id', { type: () => ID }) id: string) {
    return this.storeService.adminRemove(id);
  }

  // ---------------------------------------------------------------------------
  // Public
  // ---------------------------------------------------------------------------

  /** Public storefront lookup by slug (ACTIVE stores only). Public. */
  @Query(() => Store, { name: 'publicStore' })
  publicStore(@Args('slug', { type: () => String }) slug: string) {
    return this.storeService.findPublic(slug);
  }

  // ---------------------------------------------------------------------------
  // Warehouse mutations (seller-managed)
  // ---------------------------------------------------------------------------

  /** Add a warehouse to the caller's own store (first/`isDefault` becomes the default). Auth: logged-in seller. */
  @UseGuards(JwtAuthGuard)
  @Mutation(() => Warehouse)
  createMyWarehouse(
    @CurrentUser() user: CurrentUserPayload,
    @Args('createWarehouseInput') input: CreateWarehouseInput,
  ) {
    return this.storeService.addMyWarehouse(user.userId, input);
  }

  /** Update a warehouse on the caller's own store (setting default demotes the others). Auth: logged-in seller. */
  @UseGuards(JwtAuthGuard)
  @Mutation(() => Warehouse)
  updateMyWarehouse(
    @CurrentUser() user: CurrentUserPayload,
    @Args('updateWarehouseInput') input: UpdateWarehouseInput,
  ) {
    return this.storeService.updateMyWarehouse(user.userId, input);
  }

  /** Soft-delete a warehouse on the caller's own store (blocked if it holds inventory). Auth: logged-in seller. */
  @UseGuards(JwtAuthGuard)
  @Mutation(() => Warehouse)
  removeMyWarehouse(
    @CurrentUser() user: CurrentUserPayload,
    @Args('id', { type: () => ID }) id: string,
  ) {
    return this.storeService.removeMyWarehouse(user.userId, id);
  }

  /** List warehouses for one of the caller's own stores (default first). Auth: logged-in seller. */
  @UseGuards(JwtAuthGuard)
  @Query(() => [Warehouse], { name: 'myWarehouses' })
  myWarehouses(
    @CurrentUser() user: CurrentUserPayload,
    @Args('storeId', { type: () => ID }) storeId: string,
  ) {
    return this.storeService.myWarehouses(user.userId, storeId);
  }

  // ---------------------------------------------------------------------------
  // Computed fields
  // ---------------------------------------------------------------------------

  /** Surfaces the raw `shippingConfig` Json as a typed, safe-defaulted object. */
  @ResolveField(() => ShippingConfig, { name: 'shippingConfig' })
  resolveShippingConfig(@Parent() store: { shippingConfig?: unknown }): ShippingConfig {
    const c = parseShippingConfig(store.shippingConfig);
    return {
      freeAbove: c.freeAbove ?? null,
      flatRate: c.flatRate,
      perKgRate: c.perKgRate ?? null,
      codEnabled: c.codEnabled ?? false,
      codLimit: c.codLimit ?? null,
      processingDays: c.processingDays ?? null,
      excludedPincodes: c.excludedPincodes ?? [],
    };
  }
}
