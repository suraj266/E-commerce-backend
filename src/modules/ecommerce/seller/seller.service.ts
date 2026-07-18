import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import {
  BusinessType,
  Prisma,
  Seller,
  SellerStatus,
} from '@prisma/client';
import { hash } from 'argon2';
import { config } from '@/common/config/config';
import { EmailService } from '@/modules/admin/email/email.service';
import {
  findStateByCode,
  stateCodeFromGstin,
} from '@/common/constants/gst-states';
import {
  SellerListItem,
  SellerListStatus,
} from './entities/seller-list-item.entity';
import { PrismaService } from '@/prisma/prisma.service';
import { CreateSellerInput } from './dto/create-seller.input';
import { UpdateSellerInput } from './dto/update-seller.input';
import { AdminCreateSellerInput } from './dto/admin-create-seller.input';
import {
  SellerVerificationSection,
  SetSellerStatusInput,
  VerifySellerSectionInput,
} from './dto/verify-seller.input';
import { CreatePayoutAccountInput } from './dto/create-payout-account.input';
import { UpdatePayoutAccountInput } from './dto/update-payout-account.input';

const ENTITY_BUSINESS_TYPES: BusinessType[] = [
  BusinessType.PARTNERSHIP,
  BusinessType.LLP,
  BusinessType.PRIVATE_LIMITED,
  BusinessType.PUBLIC_LIMITED,
];

@Injectable()
export class SellerService {
  private readonly logger = new Logger(SellerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  // ---------------------------------------------------------------------------
  // Self-onboarding
  // ---------------------------------------------------------------------------

  async createSelf(userId: string, input: CreateSellerInput) {
    return this.createSellerRecord(userId, input, { status: SellerStatus.DRAFT });
  }

  /**
   * Owner-agnostic core: writes a Seller row for a given userId. Both
   * `createSelf` (seller-self via JWT) and `adminCreate` (admin) call this.
   *
   * - `opts.status` controls overallStatus (DRAFT for self, VERIFIED for admin).
   * - `opts.markAllVerifiedNow` sets all section verification timestamps to
   *   now() so admin-created sellers skip the verification queue entirely.
   * - `tx` lets the caller wrap this in a wider transaction (used by
   *   adminCreate to create User + Seller atomically).
   */
  private async createSellerRecord(
    userId: string,
    input: CreateSellerInput,
    opts: { status: SellerStatus; markAllVerifiedNow?: boolean },
    tx?: Prisma.TransactionClient,
  ) {
    const client = tx ?? this.prisma;

    const existing = await client.seller.findUnique({ where: { userId } });
    if (existing && !existing.deletedAt) {
      throw new ConflictException('This user already has a seller profile');
    }
    this.assertSignatoryRequired(input);
    this.assertSignatoryPanDistinct(input);

    const verifiedTimestamps = opts.markAllVerifiedNow
      ? {
          panVerifiedAt: new Date(),
          gstinVerifiedAt: input.gstin ? new Date() : null,
          bankVerifiedAt: new Date(),
          documentsVerifiedAt: new Date(),
        }
      : {};

    // Resolve state. Prefer the explicit field; fall back to deriving from
    // GSTIN's first two characters. We always assert agreement when both
    // are present so the persisted code matches the GSTIN-issuing state.
    const { stateCode, stateName } = this.resolveSellerState(input);

    return client.seller.create({
      data: {
        userId,
        legalName: input.legalName,
        displayName: input.displayName,
        businessType: input.businessType,
        dateOfIncorporation: input.dateOfIncorporation,
        registrationNumber: input.registrationNumber,
        panNumber: input.panNumber.toUpperCase(),
        gstin: input.gstin?.toUpperCase(),
        stateCode,
        stateName,
        businessEmail: input.businessEmail.toLowerCase(),
        businessPhone: this.normalizePhone(input.businessPhone),
        supportEmail: input.supportEmail?.toLowerCase(),
        signatoryName: input.signatoryName,
        signatoryPan: input.signatoryPan?.toUpperCase(),
        signatoryDesignation: input.signatoryDesignation,
        commissionRate: input.commissionRate ?? 0,
        overallStatus: opts.status,
        ...verifiedTimestamps,
      },
      include: { payoutAccounts: { where: { deletedAt: null } } },
    });
  }

  /**
   * Pick the canonical GST state for a seller. Three cases:
   *
   *   1. GSTIN present + stateCode present → assert agreement.
   *      Throws BadRequestException if mismatched.
   *   2. GSTIN present, stateCode absent → derive from GSTIN's first 2 chars.
   *   3. GSTIN absent → use whatever stateCode was supplied (may be null).
   *
   * `stateName` is always rehydrated from the GST_STATES catalog so the
   * display string stays canonical even if the client sent something odd.
   */
  private resolveSellerState(
    input: Pick<CreateSellerInput, 'gstin' | 'stateCode' | 'stateName'>,
  ): { stateCode: string | null; stateName: string | null } {
    const fromGstin = stateCodeFromGstin(input.gstin?.toUpperCase());
    const supplied = input.stateCode?.trim() || null;

    let chosenCode: string | null = null;
    if (fromGstin && supplied && fromGstin !== supplied) {
      throw new BadRequestException(
        `stateCode "${supplied}" does not match GSTIN prefix "${fromGstin}"`,
      );
    }
    chosenCode = fromGstin ?? supplied;
    if (!chosenCode) {
      return { stateCode: null, stateName: null };
    }

    const canonical = findStateByCode(chosenCode);
    if (!canonical) {
      throw new BadRequestException(`Unknown GST state code: ${chosenCode}`);
    }
    return { stateCode: canonical.code, stateName: canonical.name };
  }

  /**
   * Admin: create a User (role=seller, pre-verified email) + Seller record
   * atomically. The seller starts VERIFIED so they can immediately receive
   * stores and products without going through the onboarding queue.
   */
  async adminCreate(input: AdminCreateSellerInput) {
    const normalizedEmail = input.userEmail.toLowerCase();
    const normalizedPhone = this.normalizePhone(input.userPhone);

    const sellerRole = await this.prisma.role.findUnique({
      where: { name: 'seller' },
    });
    if (!sellerRole) {
      throw new BadRequestException('Seller role missing. Run prisma seed.');
    }

    const [emailExists, phoneExists] = await Promise.all([
      this.prisma.user.findUnique({ where: { email: normalizedEmail } }),
      this.prisma.user.findUnique({ where: { phone: normalizedPhone } }),
    ]);
    if (emailExists) throw new ConflictException('Email already registered');
    if (phoneExists) throw new ConflictException('Phone already registered');

    const passwordHash = await hash(input.userPassword);

    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          name: input.userName,
          email: normalizedEmail,
          phone: normalizedPhone,
          password: passwordHash,
          roleId: sellerRole.id,
          status: 'active',
          emailVerifiedAt: new Date(),
        },
      });

      return this.createSellerRecord(
        user.id,
        input,
        { status: SellerStatus.VERIFIED, markAllVerifiedNow: true },
        tx,
      );
    });
  }

  /**
   * Partial update. Allowed only when seller is in DRAFT or REJECTED state
   * (so they can fix issues and resubmit). Anything else requires admin override.
   */
  async update(userId: string, input: UpdateSellerInput, isAdmin = false) {
    const seller = await this.findOneOrThrow(input.id);

    if (!isAdmin) {
      if (seller.userId !== userId) {
        throw new ForbiddenException('You can only edit your own seller profile');
      }
      if (
        seller.overallStatus !== SellerStatus.DRAFT &&
        seller.overallStatus !== SellerStatus.REJECTED
      ) {
        throw new ForbiddenException(
          'Edits are only allowed in DRAFT or REJECTED state',
        );
      }
    }

    const { id, stateCode: _sc, stateName: _sn, ...rest } = input;
    const data: Prisma.SellerUpdateInput = {
      ...rest,
      panNumber: rest.panNumber?.toUpperCase(),
      gstin: rest.gstin?.toUpperCase(),
      businessEmail: rest.businessEmail?.toLowerCase(),
      businessPhone: rest.businessPhone
        ? this.normalizePhone(rest.businessPhone)
        : undefined,
      supportEmail: rest.supportEmail?.toLowerCase(),
      signatoryPan: rest.signatoryPan?.toUpperCase(),
      dateOfIncorporation: rest.dateOfIncorporation
        ? new Date(rest.dateOfIncorporation)
        : undefined,
    };

    // Re-resolve state if the caller touched gstin or stateCode. We merge
    // the input with existing seller values so partial updates still pick
    // up the correct state.
    if (input.gstin !== undefined || input.stateCode !== undefined) {
      const merged = {
        gstin: input.gstin ?? seller.gstin ?? undefined,
        stateCode: input.stateCode ?? seller.stateCode ?? undefined,
        stateName: input.stateName ?? seller.stateName ?? undefined,
      };
      const resolved = this.resolveSellerState(merged);
      data.stateCode = resolved.stateCode;
      data.stateName = resolved.stateName;
    }

    // If editing a rejected profile, reset to DRAFT so they can re-submit cleanly
    if (seller.overallStatus === SellerStatus.REJECTED) {
      data.overallStatus = SellerStatus.DRAFT;
      data.rejectionReason = null;
    }

    return this.prisma.seller.update({
      where: { id },
      data,
      include: { payoutAccounts: { where: { deletedAt: null } } },
    });
  }

  /**
   * Seller submits their DRAFT profile for admin review.
   * Backend re-validates required fields, then moves to PENDING.
   */
  async submitForReview(userId: string, sellerId: string) {
    const seller = await this.findOneOrThrow(sellerId);
    if (seller.userId !== userId) {
      throw new ForbiddenException('Not your seller profile');
    }
    if (seller.overallStatus !== SellerStatus.DRAFT) {
      throw new ConflictException(
        `Cannot submit from ${seller.overallStatus} state`,
      );
    }

    const missing: string[] = [];
    if (!seller.legalName) missing.push('legalName');
    if (!seller.displayName) missing.push('displayName');
    if (!seller.panNumber) missing.push('panNumber');
    if (!seller.businessEmail) missing.push('businessEmail');
    if (!seller.businessPhone) missing.push('businessPhone');
    if (
      ENTITY_BUSINESS_TYPES.includes(seller.businessType) &&
      (!seller.signatoryName || !seller.signatoryPan)
    ) {
      missing.push('signatoryName / signatoryPan');
    }
    if (missing.length > 0) {
      throw new BadRequestException(
        `Cannot submit. Missing: ${missing.join(', ')}`,
      );
    }

    const updated = await this.prisma.seller.update({
      where: { id: sellerId },
      data: {
        overallStatus: SellerStatus.PENDING,
        rejectionReason: null,
      },
      include: { payoutAccounts: { where: { deletedAt: null } } },
    });

    // Alert admins that a new application is awaiting review. Fire-and-forget:
    // a mail hiccup must never fail the seller's submit.
    this.notifyAdminNewSeller(updated).catch((err) =>
      this.logger.warn(
        `admin_new_seller email failed: ${(err as Error).message}`,
      ),
    );

    return updated;
  }

  // ---------------------------------------------------------------------------
  // Admin queries
  // ---------------------------------------------------------------------------

  async findAll(status?: SellerStatus) {
    return this.prisma.seller.findMany({
      where: {
        deletedAt: null,
        ...(status ? { overallStatus: status } : {}),
      },
      include: { payoutAccounts: { where: { deletedAt: null } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Returns ALL users in the seller pipeline. A user appears here if EITHER:
   *   - they have role `seller` (registered via /seller/register), OR
   *   - they have a Seller record attached (legacy / admin-created profiles)
   *
   * Each item carries a derived funnel `status` so the admin can see the full
   * pipeline (registered → onboarding → submitted → verified).
   */
  async findSellerUsers(filterStatus?: SellerListStatus): Promise<SellerListItem[]> {
    const sellerRole = await this.prisma.role.findUnique({
      where: { name: 'seller' },
    });

    const users = await this.prisma.user.findMany({
      where: {
        OR: [
          ...(sellerRole ? [{ roleId: sellerRole.id }] : []),
          { Seller: { is: { deletedAt: null } } },
        ],
      },
      include: {
        Seller: {
          where: { deletedAt: null },
          include: { payoutAccounts: { where: { deletedAt: null } } },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const items: SellerListItem[] = users.map((u) => {
      const seller = u.Seller;
      let status: SellerListStatus;
      if (!seller) {
        status = u.emailVerifiedAt
          ? SellerListStatus.REGISTERED
          : SellerListStatus.REGISTERED_UNVERIFIED;
      } else {
        status = SellerListStatus[
          seller.overallStatus as keyof typeof SellerListStatus
        ];
      }
      return {
        userId: u.id,
        name: u.name,
        email: u.email,
        phone: u.phone,
        emailVerifiedAt: u.emailVerifiedAt,
        registeredAt: u.createdAt,
        status,
        seller: seller
          ? {
              ...seller,
              commissionRate: Number(seller.commissionRate),
            }
          : null,
      } as SellerListItem;
    });

    return filterStatus
      ? items.filter((i) => i.status === filterStatus)
      : items;
  }

  async findOne(id: string) {
    return this.findOneOrThrow(id);
  }

  async findByUserId(userId: string) {
    const seller = await this.prisma.seller.findUnique({
      where: { userId },
      include: { payoutAccounts: { where: { deletedAt: null } } },
    });
    if (!seller || seller.deletedAt) return null;
    return seller;
  }

  // ---------------------------------------------------------------------------
  // Admin verification
  // ---------------------------------------------------------------------------

  async verifySection(input: VerifySellerSectionInput) {
    const seller = await this.findOneOrThrow(input.id);

    const sectionFieldMap: Record<SellerVerificationSection, keyof typeof seller> =
      {
        [SellerVerificationSection.PAN]: 'panVerifiedAt',
        [SellerVerificationSection.GSTIN]: 'gstinVerifiedAt',
        [SellerVerificationSection.BANK]: 'bankVerifiedAt',
        [SellerVerificationSection.DOCUMENTS]: 'documentsVerifiedAt',
      };
    const fieldName = sectionFieldMap[input.section];

    const updated = await this.prisma.seller.update({
      where: { id: input.id },
      data: { [fieldName]: input.verified ? new Date() : null },
      include: { payoutAccounts: { where: { deletedAt: null } } },
    });

    // Auto-derive overall status from sections (only if currently in review)
    if (
      seller.overallStatus === SellerStatus.PENDING ||
      seller.overallStatus === SellerStatus.UNDER_REVIEW
    ) {
      const allRequiredVerified =
        updated.panVerifiedAt &&
        updated.bankVerifiedAt &&
        updated.documentsVerifiedAt &&
        // GSTIN is only required if seller declared one
        (seller.gstin ? updated.gstinVerifiedAt : true);

      if (allRequiredVerified) {
        const verified = await this.prisma.seller.update({
          where: { id: input.id },
          data: {
            overallStatus: SellerStatus.VERIFIED,
            rejectionReason: null,
          },
          include: { payoutAccounts: { where: { deletedAt: null } } },
        });

        // We only reach here from PENDING/UNDER_REVIEW, so this is a genuine
        // first-time transition into VERIFIED — safe to notify without resend.
        this.notifySellerKycApproved(verified).catch((err) =>
          this.logger.warn(
            `seller_kyc_approved email failed: ${(err as Error).message}`,
          ),
        );

        return verified;
      }

      // First section verified → move from PENDING to UNDER_REVIEW
      if (
        seller.overallStatus === SellerStatus.PENDING &&
        (updated.panVerifiedAt ||
          updated.gstinVerifiedAt ||
          updated.bankVerifiedAt ||
          updated.documentsVerifiedAt)
      ) {
        return this.prisma.seller.update({
          where: { id: input.id },
          data: { overallStatus: SellerStatus.UNDER_REVIEW },
          include: { payoutAccounts: { where: { deletedAt: null } } },
        });
      }
    }

    return updated;
  }

  async setStatus(input: SetSellerStatusInput) {
    const previous = await this.findOneOrThrow(input.id);
    const updated = await this.prisma.seller.update({
      where: { id: input.id },
      data: {
        overallStatus: input.status,
        rejectionReason:
          input.status === SellerStatus.REJECTED ||
          input.status === SellerStatus.SUSPENDED
            ? input.reason ?? null
            : null,
      },
      include: { payoutAccounts: { where: { deletedAt: null } } },
    });

    // Notify on genuine transitions only — the previous-status guards stop a
    // re-verify / re-reject of an already-VERIFIED/REJECTED seller from
    // re-sending. All sends are fire-and-forget so mail never blocks the admin.
    if (
      input.status === SellerStatus.VERIFIED &&
      previous.overallStatus !== SellerStatus.VERIFIED
    ) {
      this.notifySellerKycApproved(updated).catch((err) =>
        this.logger.warn(
          `seller_kyc_approved email failed: ${(err as Error).message}`,
        ),
      );
    }
    if (
      input.status === SellerStatus.REJECTED &&
      previous.overallStatus !== SellerStatus.REJECTED
    ) {
      this.notifySellerKycRejected(updated, input.reason).catch((err) =>
        this.logger.warn(
          `seller_kyc_rejected email failed: ${(err as Error).message}`,
        ),
      );
    }

    return updated;
  }

  async remove(id: string) {
    await this.findOneOrThrow(id);
    return this.prisma.seller.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  // ---------------------------------------------------------------------------
  // Payout accounts (unchanged from previous iteration)
  // ---------------------------------------------------------------------------

  async addPayoutAccount(userId: string, input: CreatePayoutAccountInput) {
    const seller = await this.findOneOrThrow(input.sellerId);
    if (seller.userId !== userId) {
      throw new ForbiddenException('Not your seller profile');
    }
    if (seller.overallStatus !== SellerStatus.VERIFIED) {
      throw new ForbiddenException(
        'Seller must be verified before adding payout accounts',
      );
    }
    this.assertPayoutDetailsForType(input);

    return this.prisma.$transaction(async (tx) => {
      if (input.isPrimary) {
        await tx.sellerPayoutAccount.updateMany({
          where: { sellerId: input.sellerId, isPrimary: true, deletedAt: null },
          data: { isPrimary: false },
        });
      }
      return tx.sellerPayoutAccount.create({
        data: {
          sellerId: input.sellerId,
          accountType: input.accountType,
          accountHolderName: input.accountHolderName,
          accountNumber: input.accountNumber,
          ifscCode: input.ifscCode,
          bankName: input.bankName,
          upiId: input.upiId,
          walletProvider: input.walletProvider,
          isPrimary: input.isPrimary ?? false,
        },
      });
    });
  }

  async updatePayoutAccount(userId: string, input: UpdatePayoutAccountInput) {
    const account = await this.prisma.sellerPayoutAccount.findUnique({
      where: { id: input.id },
      include: { seller: true },
    });
    if (!account || account.deletedAt) {
      throw new NotFoundException(`Payout account ${input.id} not found`);
    }
    if (account.seller.userId !== userId) {
      throw new ForbiddenException('Not your payout account');
    }

    const { id, ...data } = input;
    return this.prisma.$transaction(async (tx) => {
      if (data.isPrimary) {
        await tx.sellerPayoutAccount.updateMany({
          where: {
            sellerId: account.sellerId,
            isPrimary: true,
            deletedAt: null,
            NOT: { id },
          },
          data: { isPrimary: false },
        });
      }
      return tx.sellerPayoutAccount.update({ where: { id }, data });
    });
  }

  async removePayoutAccount(userId: string, id: string) {
    const account = await this.prisma.sellerPayoutAccount.findUnique({
      where: { id },
      include: { seller: true },
    });
    if (!account || account.deletedAt) {
      throw new NotFoundException(`Payout account ${id} not found`);
    }
    if (account.seller.userId !== userId) {
      throw new ForbiddenException('Not your payout account');
    }
    return this.prisma.sellerPayoutAccount.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async findOneOrThrow(id: string) {
    const seller = await this.prisma.seller.findUnique({
      where: { id },
      include: { payoutAccounts: { where: { deletedAt: null } } },
    });
    if (!seller || seller.deletedAt) {
      throw new NotFoundException(`Seller ${id} not found`);
    }
    return seller;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle email notifiers (soft-fail, fire-and-forget — see call sites)
  //
  // Branding (platform_name / logo) is injected by EmailService from
  // SiteSetting, so we never pass shopName here. The seller's contact email +
  // name come from a scoped User lookup so we don't widen findOneOrThrow's
  // include for every caller.
  // ---------------------------------------------------------------------------

  /** Owner account email + display name for a seller, via a scoped lookup. */
  private async resolveSellerContact(
    userId: string,
  ): Promise<{ email: string | null; name: string | null }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, name: true },
    });
    return { email: user?.email ?? null, name: user?.name ?? null };
  }

  private sellerDisplayName(
    seller: Pick<Seller, 'displayName' | 'legalName'>,
    fallbackName: string | null,
  ): string {
    return (
      fallbackName || seller.displayName || seller.legalName || 'there'
    );
  }

  /** seller_kyc_approved — sent to the seller on a first VERIFIED transition. */
  private async notifySellerKycApproved(
    seller: Pick<Seller, 'userId' | 'displayName' | 'legalName'>,
  ): Promise<void> {
    const { email, name } = await this.resolveSellerContact(seller.userId);
    if (!email) return;
    await this.email.send('seller_kyc_approved', email, {
      sellerName: this.sellerDisplayName(seller, name),
      dashboardLink: `${config.FRONTEND_URL ?? ''}/seller/dashboard`,
    });
  }

  /** seller_kyc_rejected — sent to the seller with the admin's reason. */
  private async notifySellerKycRejected(
    seller: Pick<Seller, 'userId' | 'displayName' | 'legalName'>,
    reason?: string | null,
  ): Promise<void> {
    const { email, name } = await this.resolveSellerContact(seller.userId);
    if (!email) return;
    await this.email.send('seller_kyc_rejected', email, {
      sellerName: this.sellerDisplayName(seller, name),
      rejectionReason: reason?.trim() || 'Please review your submitted details.',
    });
  }

  /**
   * admin_new_seller — alerts every active superAdmin that a DRAFT seller has
   * submitted for review. No-op when no admin email is on file.
   */
  private async notifyAdminNewSeller(
    seller: Pick<
      Seller,
      'userId' | 'displayName' | 'legalName' | 'businessType' | 'businessEmail'
    >,
  ): Promise<void> {
    const admins = await this.prisma.user.findMany({
      where: { role: { name: 'superAdmin' }, status: 'active' },
      select: { email: true },
    });
    if (admins.length === 0) return;

    const { email, name } = await this.resolveSellerContact(seller.userId);
    const ctx = {
      sellerName: this.sellerDisplayName(seller, name),
      sellerEmail: email ?? seller.businessEmail,
      businessType: seller.businessType,
      reviewLink: `${config.FRONTEND_URL ?? ''}/admin/sellers`,
    };
    for (const a of admins) {
      if (!a.email) continue;
      await this.email.send('admin_new_seller', a.email, ctx);
    }
  }

  private assertSignatoryRequired(input: CreateSellerInput) {
    if (
      ENTITY_BUSINESS_TYPES.includes(input.businessType) &&
      (!input.signatoryName || !input.signatoryPan)
    ) {
      throw new BadRequestException(
        'Authorized signatory name and PAN are required for entity business types',
      );
    }
  }

  private assertSignatoryPanDistinct(input: CreateSellerInput) {
    if (
      input.signatoryPan &&
      input.signatoryPan.toUpperCase() === input.panNumber.toUpperCase() &&
      ENTITY_BUSINESS_TYPES.includes(input.businessType)
    ) {
      throw new BadRequestException(
        'Signatory PAN must differ from entity PAN for entity business types',
      );
    }
  }

  private assertPayoutDetailsForType(input: CreatePayoutAccountInput) {
    if (input.accountType === 'bank') {
      if (!input.accountNumber || !input.ifscCode || !input.bankName) {
        throw new BadRequestException(
          'Bank accounts require accountNumber, ifscCode, and bankName',
        );
      }
    }
    if (input.accountType === 'upi' && !input.upiId) {
      throw new BadRequestException('UPI accounts require upiId');
    }
    if (input.accountType === 'wallet' && !input.walletProvider) {
      throw new BadRequestException('Wallet accounts require walletProvider');
    }
  }

  private normalizePhone(phone: string) {
    const trimmed = phone.replace(/\s+/g, '').replace(/^\+91/, '');
    return trimmed;
  }
}
