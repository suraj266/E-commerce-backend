import { ObjectType, Field, ID, Float, Int, registerEnumType } from '@nestjs/graphql';
import {
  PaymentGateway,
  PaymentTransactionStatus,
  ProcessingFeeType,
  GatewayPaymentType,
  PaymentMethod,
} from '@prisma/client';

registerEnumType(PaymentGateway, { name: 'PaymentGateway' });
registerEnumType(PaymentTransactionStatus, { name: 'PaymentTransactionStatus' });
registerEnumType(ProcessingFeeType, { name: 'ProcessingFeeType' });
registerEnumType(GatewayPaymentType, { name: 'GatewayPaymentType' });

// ---------------------------------------------------------------------------
// PaymentGatewayConfig — admin-facing shape
// NOTE: The `credentials` field is NEVER exposed in GraphQL. Admin sees
//       masked hints only (e.g. "rzp_test_***"). Decrypted credentials
//       exist only server-side, never cross the GraphQL boundary.
// ---------------------------------------------------------------------------

@ObjectType()
export class PaymentGatewayConfigEntity {
  @Field(() => ID)
  id: string;

  @Field(() => PaymentGateway)
  gateway: PaymentGateway;

  @Field(() => String)
  displayName: string;

  @Field(() => String, { nullable: true })
  description?: string | null;

  @Field(() => String, { nullable: true })
  logoUrl?: string | null;

  @Field(() => Boolean)
  isEnabled: boolean;

  @Field(() => Boolean)
  isDefault: boolean;

  @Field(() => Int)
  displayOrder: number;

  @Field(() => [String])
  supportedMethods: string[];

  @Field(() => Boolean)
  sandboxMode: boolean;

  @Field(() => Float)
  processingFee: number;

  @Field(() => ProcessingFeeType)
  processingFeeType: ProcessingFeeType;

  @Field(() => GatewayPaymentType)
  paymentType: GatewayPaymentType;

  @Field(() => String, { nullable: true })
  instructions?: string | null;

  @Field(() => String, { nullable: true })
  webhookUrl?: string | null;

  /**
   * Masked credential hints — never contains secrets.
   * JSON string: { keyId: "rzp_test_***", keySecret: "••••••" }
   */
  @Field(() => String, { nullable: true })
  credentialHints?: string | null;

  /** Whether credentials have been configured (non-empty). */
  @Field(() => Boolean)
  hasCredentials: boolean;

  @Field(() => Date)
  createdAt: Date;

  @Field(() => Date)
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// Payment — per-order transaction record
// ---------------------------------------------------------------------------

@ObjectType()
export class PaymentEntity {
  @Field(() => ID)
  id: string;

  @Field(() => ID)
  orderId: string;

  @Field(() => PaymentGateway)
  gateway: PaymentGateway;

  @Field(() => PaymentMethod)
  method: PaymentMethod;

  @Field(() => Float)
  amount: number;

  @Field(() => Float)
  processingFee: number;

  @Field(() => String)
  currency: string;

  @Field(() => PaymentTransactionStatus)
  status: PaymentTransactionStatus;

  @Field(() => String, { nullable: true })
  gatewayOrderId?: string | null;

  @Field(() => String, { nullable: true })
  gatewayPaymentId?: string | null;

  @Field(() => Date, { nullable: true })
  expiresAt?: Date | null;

  @Field(() => Date, { nullable: true })
  capturedAt?: Date | null;

  @Field(() => Date, { nullable: true })
  failedAt?: Date | null;

  @Field(() => Date)
  createdAt: Date;

  @Field(() => Date)
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// CheckoutResult — returned to frontend after initiateCheckout
// ---------------------------------------------------------------------------

@ObjectType()
export class CheckoutResult {
  @Field(() => ID)
  orderId: string;

  @Field(() => String)
  orderNumber: string;

  @Field(() => PaymentGateway)
  gateway: PaymentGateway;

  /**
   * Gateway-specific payload for the frontend SDK.
   * JSON string. For COD: null. For Razorpay: { razorpayOrderId, ... }
   */
  @Field(() => String, { nullable: true })
  gatewayPayload?: string | null;

  /** Whether the order requires online payment (false for COD). */
  @Field(() => Boolean)
  requiresPayment: boolean;
}

// ---------------------------------------------------------------------------
// Paginated Payment list (for admin transactions page)
// ---------------------------------------------------------------------------

@ObjectType()
export class PaginatedPayments {
  @Field(() => [PaymentEntity])
  items: PaymentEntity[];

  @Field(() => Int)
  totalCount: number;

  @Field(() => Int)
  totalPages: number;

  @Field(() => Int)
  currentPage: number;

  @Field(() => Int)
  pageSize: number;
}
