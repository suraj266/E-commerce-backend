import { Resolver, Query, Mutation, Args, ID, Int } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@/modules/identity/auth/jwt-auth.guard';
import { PermissionsGuard } from '@/common/guards/permissions.guard';
import { Permissions } from '@/common/decorators/permissions.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import type { CurrentUserPayload } from '@/common/decorators/current-user.decorator';
import { InventoryService } from './inventory.service';
import { Inventory } from './entities/inventory.entity';
import { InventoryMovement } from './entities/inventory-movement.entity';
import { AdjustInventoryInput } from './dto/adjust-inventory.input';
import { SetReorderPointInput } from './dto/set-reorder-point.input';

@Resolver(() => Inventory)
export class InventoryResolver {
  constructor(private readonly inventoryService: InventoryService) {}

  // ---------------------------------------------------------------------------
  // Self (seller-managed)
  // ---------------------------------------------------------------------------

  @UseGuards(JwtAuthGuard)
  @Query(() => [Inventory], { name: 'myInventory' })
  myInventory(
    @CurrentUser() user: CurrentUserPayload,
    @Args('storeId', { type: () => ID, nullable: true }) storeId?: string,
    @Args('warehouseId', { type: () => ID, nullable: true })
    warehouseId?: string,
    @Args('productId', { type: () => ID, nullable: true }) productId?: string,
    @Args('lowStockOnly', { type: () => Boolean, nullable: true })
    lowStockOnly?: boolean,
    @Args('search', { type: () => String, nullable: true }) search?: string,
  ) {
    return this.inventoryService.myInventory(user.userId, {
      storeId,
      warehouseId,
      productId,
      lowStockOnly: lowStockOnly ?? false,
      search,
    });
  }

  @UseGuards(JwtAuthGuard)
  @Query(() => Inventory, { name: 'myInventoryByVariant', nullable: true })
  myInventoryByVariant(
    @CurrentUser() user: CurrentUserPayload,
    @Args('variantId', { type: () => ID }) variantId: string,
    @Args('warehouseId', { type: () => ID, nullable: true })
    warehouseId?: string,
  ) {
    return this.inventoryService.myInventoryByVariant(
      user.userId,
      variantId,
      warehouseId,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Query(() => [InventoryMovement], { name: 'myInventoryMovements' })
  myInventoryMovements(
    @CurrentUser() user: CurrentUserPayload,
    @Args('variantId', { type: () => ID, nullable: true }) variantId?: string,
    @Args('warehouseId', { type: () => ID, nullable: true })
    warehouseId?: string,
    @Args('limit', { type: () => Int, nullable: true }) limit?: number,
  ) {
    return this.inventoryService.myInventoryMovements(user.userId, {
      variantId,
      warehouseId,
      limit: limit ?? undefined,
    });
  }

  @UseGuards(JwtAuthGuard)
  @Mutation(() => Inventory)
  adjustMyInventory(
    @CurrentUser() user: CurrentUserPayload,
    @Args('adjustInventoryInput') input: AdjustInventoryInput,
  ) {
    return this.inventoryService.adjustInventory(user.userId, input);
  }

  @UseGuards(JwtAuthGuard)
  @Mutation(() => Inventory)
  setMyReorderPoint(
    @CurrentUser() user: CurrentUserPayload,
    @Args('setReorderPointInput') input: SetReorderPointInput,
  ) {
    return this.inventoryService.setReorderPoint(user.userId, input);
  }

  // ---------------------------------------------------------------------------
  // Admin (cross-store, permission-gated)
  // ---------------------------------------------------------------------------

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('inventory:read')
  @Query(() => [Inventory], { name: 'adminInventoryByProduct' })
  adminInventoryByProduct(
    @Args('productId', { type: () => ID }) productId: string,
  ) {
    return this.inventoryService.adminInventoryByProduct(productId);
  }
}
