/**
 * Convert an INR amount to Indian-system words ("one lakh twenty thousand
 * five hundred and forty-three rupees and fifty paise only").
 *
 * Indian numbering uses lakh (1e5) and crore (1e7) instead of million /
 * billion. Common on tax invoices for legal precision.
 */

const ONES = [
  '',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
];

const TENS = [
  '',
  '',
  'twenty',
  'thirty',
  'forty',
  'fifty',
  'sixty',
  'seventy',
  'eighty',
  'ninety',
];

function twoDigits(n: number): string {
  if (n < 20) return ONES[n];
  const t = Math.floor(n / 10);
  const o = n % 10;
  return o === 0 ? TENS[t] : `${TENS[t]}-${ONES[o]}`;
}

function threeDigits(n: number): string {
  if (n === 0) return '';
  if (n < 100) return twoDigits(n);
  const h = Math.floor(n / 100);
  const rest = n % 100;
  return rest === 0
    ? `${ONES[h]} hundred`
    : `${ONES[h]} hundred ${twoDigits(rest)}`;
}

/**
 * Whole rupees → Indian-system words. Caps at 99.99 crore for sanity;
 * orders above that bracket can be handled if Phase 5 unlocks B2B.
 */
function rupeesInWords(rupees: number): string {
  if (rupees === 0) return 'zero';
  if (rupees < 0) return `minus ${rupeesInWords(-rupees)}`;

  const crore = Math.floor(rupees / 10000000);
  const lakh = Math.floor((rupees % 10000000) / 100000);
  const thousand = Math.floor((rupees % 100000) / 1000);
  const rest = rupees % 1000;

  const parts: string[] = [];
  if (crore > 0) parts.push(`${threeDigits(crore)} crore`);
  if (lakh > 0) parts.push(`${threeDigits(lakh)} lakh`);
  if (thousand > 0) parts.push(`${threeDigits(thousand)} thousand`);
  if (rest > 0) parts.push(threeDigits(rest));

  return parts.join(' ').trim();
}

/**
 * Format an INR amount as a full legal sentence. Includes a paise tail when
 * the fractional part is non-zero (rounded to 2 dp), and is capitalised at
 * the start so it can drop into the invoice without a wrapper.
 *
 * Examples:
 *   2049         → "Rupees two thousand forty-nine only"
 *   2049.50      → "Rupees two thousand forty-nine and fifty paise only"
 *   1499500      → "Rupees fourteen lakh ninety-nine thousand five hundred only"
 */
export function numberToIndianWords(amount: number): string {
  if (!Number.isFinite(amount)) return '';
  const rounded = Math.round(amount * 100) / 100;
  const rupees = Math.floor(rounded);
  const paise = Math.round((rounded - rupees) * 100);

  const rupeesPart = capitalise(rupeesInWords(rupees));
  if (paise === 0) {
    return `Rupees ${rupeesPart} only`;
  }
  const paisePart = twoDigits(paise);
  return `Rupees ${rupeesPart} and ${paisePart} paise only`;
}

function capitalise(s: string): string {
  return s.length > 0 ? s[0].toUpperCase() + s.slice(1) : s;
}
