/**
 * Customer-facing coupon resolver — `validateCoupon` only.
 *
 * Reads the current customer's cart from the DB and runs it through
 * CouponService.validateAndCompute. The mutation does NOT persist anything;
 * it's a preview the cart UI uses to show the discount line before checkout.
 * The actual redemption row is written inside the placement transaction.
 */

import { ForbiddenException, UseGuards } from '@nestjs/common';
import { Args, Mutation, Resolver } from '@nestjs/graphql';

import { CouponService } from './coupon.service';
import { CouponValidation } from './entities/coupon-validation.entity';
import { ValidateCouponInput } from './dto/validate-coupon.input';

import { PrismaService } from '@/prisma/prisma.service';
import { JwtAuthGuard } from '@/modules/identity/auth/jwt-auth.guard';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '@/common/decorators/current-user.decorator';

@Resolver()
export class CouponCustomerResolver {
  constructor(
    private readonly service: CouponService,
    private readonly prisma: PrismaService,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Mutation(() => CouponValidation)
  async validateCoupon(
    @Args('input') input: ValidateCouponInput,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<CouponValidation> {
    const customer = await this.prisma.customer.findUnique({
      where: { userId: user.userId },
      select: { id: true, deletedAt: true },
    });
    if (!customer || customer.deletedAt) {
      throw new ForbiddenException('Coupons are only available to customers.');
    }

    const cart = await this.prisma.cart.findUnique({
      where: { customerId: customer.id },
      include: {
        items: {
          include: {
            variant: { select: { price: true } },
            product: {
              select: {
                storeId: true,
                isPriceTaxInclusive: true,
                // Needed so the validation can compute the customer-facing
                // tax-inclusive total + GST reduction from the discount.
                tax: { select: { rate: true } },
              },
            },
          },
        },
      },
    });
    if (!cart || cart.items.length === 0) {
      return {
        isValid: false,
        reason: 'Your cart is empty.',
        coupon: null,
        discountAmount: 0,
        subtotal: 0,
        subtotalInclTax: 0,
        discountInclTax: 0,
        customerTotal: 0,
      };
    }

    const cartLines = cart.items.map((it) => ({
      storeId: it.product.storeId,
      lineTotal: Number(it.variant.price) * it.quantity,
      taxRate: it.product.tax?.rate != null ? Number(it.product.tax.rate) : null,
      priceTaxInclusive: it.product.isPriceTaxInclusive !== false,
    }));

    const result = await this.service.validateAndCompute({
      code: input.code,
      customerId: customer.id,
      cartLines,
    });

    if (result.isValid) {
      return {
        isValid: true,
        reason: null,
        coupon: this.serializeCoupon(result.coupon),
        discountAmount: result.discountAmount,
        subtotal: result.subtotal,
        subtotalInclTax: result.subtotalInclTax,
        discountInclTax: result.discountInclTax,
        customerTotal: result.customerTotal,
      };
    }
    return {
      isValid: false,
      reason: result.reason,
      coupon: null,
      discountAmount: 0,
      subtotal: result.subtotal,
      subtotalInclTax: result.subtotalInclTax,
      discountInclTax: 0,
      customerTotal: result.customerTotal,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private serializeCoupon(row: any) {
    return {
      id: row.id,
      storeId: row.storeId,
      code: row.code,
      name: row.name,
      description: row.description,
      discountType: row.discountType,
      discountValue: Number(row.discountValue),
      minimumPurchaseAmount:
        row.minimumPurchaseAmount != null
          ? Number(row.minimumPurchaseAmount)
          : null,
      maximumDiscountAmount:
        row.maximumDiscountAmount != null
          ? Number(row.maximumDiscountAmount)
          : null,
      usageLimit: row.usageLimit,
      usageLimitPerUser: row.usageLimitPerUser,
      validFrom: row.validFrom,
      validUntil: row.validUntil,
      isActive: row.isActive,
      redemptionCount: null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
