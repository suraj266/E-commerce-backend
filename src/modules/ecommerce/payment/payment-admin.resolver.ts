/**
 * PaymentAdminResolver — admin-only GraphQL for payment gateway management.
 *
 * Uses the same PermissionsGuard pattern as other admin resolvers
 * (category, brand, etc.). Payment permissions should be seeded in
 * rolePermission.seed.ts when ready.
 */

import { Args, ID, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@/modules/identity/auth/jwt-auth.guard';
import { PermissionsGuard } from '@/common/guards/permissions.guard';
import { Permissions } from '@/common/decorators/permissions.decorator';
import { PaymentConfigService } from './payment-config.service';
import { PaymentService } from './payment.service';
import {
  PaymentGatewayConfigEntity,
  PaginatedPayments,
} from './entities/payment.entity';
import {
  CreateGatewayConfigInput,
  UpdateGatewayConfigInput,
} from './dto/gateway-config.input';
import { PaymentGateway, PaymentTransactionStatus } from '@prisma/client';

@Resolver()
export class PaymentAdminResolver {
  constructor(
    private readonly configService: PaymentConfigService,
    private readonly paymentService: PaymentService,
  ) {}

  // ---------------------------------------------------------------------------
  // Gateway Config CRUD
  // ---------------------------------------------------------------------------

  /** Lists all configured payment gateways (credentials masked). Auth: payment:read permission. */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('payment:read')
  @Query(() => [PaymentGatewayConfigEntity], { name: 'adminPaymentGateways' })
  async listGateways() {
    return this.configService.list();
  }

  /** Fetches one gateway config by id (credentials masked). Auth: payment:read permission. */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('payment:read')
  @Query(() => PaymentGatewayConfigEntity, { name: 'adminPaymentGateway' })
  async getGateway(@Args('id', { type: () => ID }) id: string) {
    return this.configService.getById(id);
  }

  /** Creates a gateway config; encrypts credentials at rest. Auth: payment:create permission. */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('payment:create')
  @Mutation(() => PaymentGatewayConfigEntity, {
    name: 'createPaymentGatewayConfig',
  })
  async createConfig(@Args('input') input: CreateGatewayConfigInput) {
    return this.configService.create(input);
  }

  /** Updates a gateway config; re-encrypts credentials only when new ones are supplied. Auth: payment:update permission. */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('payment:update')
  @Mutation(() => PaymentGatewayConfigEntity, {
    name: 'updatePaymentGatewayConfig',
  })
  async updateConfig(@Args('input') input: UpdateGatewayConfigInput) {
    return this.configService.update(input);
  }

  /** Enables/disables a gateway on the checkout page. Auth: payment:update permission. */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('payment:update')
  @Mutation(() => PaymentGatewayConfigEntity, {
    name: 'togglePaymentGateway',
  })
  async toggleGateway(
    @Args('id', { type: () => ID }) id: string,
    @Args('enabled') enabled: boolean,
  ) {
    return this.configService.toggleEnabled(id, enabled);
  }

  /** Sets one gateway as the checkout default; unsets any prior default. Auth: payment:update permission. */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('payment:update')
  @Mutation(() => PaymentGatewayConfigEntity, {
    name: 'setDefaultPaymentGateway',
  })
  async setDefault(@Args('id', { type: () => ID }) id: string) {
    return this.configService.setDefault(id);
  }

  // ---------------------------------------------------------------------------
  // Transactions (read-only admin view)
  // ---------------------------------------------------------------------------

  /** Paginated read-only view of payment transactions, filterable by gateway/status. Auth: payment:read permission. */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('payment:read')
  @Query(() => PaginatedPayments, { name: 'adminPaymentTransactions' })
  async listTransactions(
    @Args('page', { type: () => Int, defaultValue: 1 }) page: number,
    @Args('pageSize', { type: () => Int, defaultValue: 10 }) pageSize: number,
    @Args('gateway', { type: () => PaymentGateway, nullable: true })
    gateway?: PaymentGateway,
    @Args('status', { type: () => PaymentTransactionStatus, nullable: true })
    status?: PaymentTransactionStatus,
  ) {
    return this.paymentService.listPayments({
      page,
      pageSize,
      gateway,
      status,
    });
  }
}
