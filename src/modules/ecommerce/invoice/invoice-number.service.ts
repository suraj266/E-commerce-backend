import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';

/**
 * Per-seller invoice number allocator (CGST Rule 46(b)).
 *
 * Numbers are issued from a counter keyed by `(sellerId, fiscalYear)`. The
 * counter row is upserted with an atomic increment so two concurrent calls
 * cannot produce the same number, even under heavy parallelism — see
 * `invoice-number.service.spec.ts` for the 100-parallel test.
 *
 * Format: `INV/FY{YY}-{YY}/{SELLER-CODE}/{6-digit-seq}`
 *   - FY is the Indian financial year (April 1 → March 31)
 *   - SELLER-CODE is the first 4 hex chars of the seller's UUID, uppercased
 *   - seq starts at 1 and resets per (seller, fiscalYear) tuple
 *
 * Example: `INV/FY26-27/A1B2/000123`
 */
@Injectable()
export class InvoiceNumberService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Allocate the next invoice number for `sellerId` on the given date.
   *
   * Returns the assembled invoice number plus the date the caller should
   * persist as `invoiceDate` — usually `new Date()` but parameterised so
   * tests can pin time without monkey-patching globals.
   */
  async allocate(
    sellerId: string,
    on: Date = new Date(),
  ): Promise<{ invoiceNumber: string; invoiceDate: Date }> {
    const fiscalYear = getFiscalYear(on);
    const sellerCode = sellerCodeFrom(sellerId);

    // Atomic allocation: upsert + increment in a single transaction so two
    // concurrent calls never see the same `nextSeq`. We compute the
    // allocated number from the post-increment value:
    //
    //   - create branch: row inserted with nextSeq=2 → we used 1
    //   - update branch: row.nextSeq was incremented → we used (nextSeq - 1)
    //
    // Both branches return `nextSeq - 1` so the caller doesn't need to
    // know which path executed.
    const seq = await this.prisma.$transaction(async (tx) => {
      const row = await tx.invoiceSequence.upsert({
        where: {
          sellerId_fiscalYear: { sellerId, fiscalYear },
        },
        update: { nextSeq: { increment: 1 } },
        create: { sellerId, fiscalYear, nextSeq: 2 },
      });
      return row.nextSeq - 1;
    });

    return {
      invoiceNumber: `INV/${fiscalYear}/${sellerCode}/${String(seq).padStart(6, '0')}`,
      invoiceDate: on,
    };
  }
}

/**
 * Format an Indian fiscal year label for a given date.
 *
 *   2026-03-31 → "FY25-26"   (still in FY25-26, ends Mar 31)
 *   2026-04-01 → "FY26-27"   (rolls over Apr 1)
 *   2027-01-15 → "FY26-27"
 */
export function getFiscalYear(date: Date): string {
  const y = date.getFullYear();
  const m = date.getMonth(); // 0 = January
  const startYear = m < 3 ? y - 1 : y;
  const endYear = startYear + 1;
  return `FY${String(startYear).slice(-2)}-${String(endYear).slice(-2)}`;
}

/**
 * Derive the on-invoice seller code from a UUID.
 *
 * Takes the first 4 hex characters (16^4 = 65,536 distinct prefixes — small
 * collision risk acceptable as a *display* shortener since the global key
 * is the full sellerId, not the prefix). Uppercased + dashes stripped so
 * the printed code is compact and unambiguous.
 */
export function sellerCodeFrom(sellerId: string): string {
  return sellerId.replace(/-/g, '').slice(0, 4).toUpperCase();
}
