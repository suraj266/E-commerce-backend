/**
 * CI-only Jest config (P2-07). Extends the base `jest` block from package.json
 * (rootDir / testRegex / transform / moduleNameMapper are inherited unchanged so
 * `pnpm test` and this config discover and compile the exact same specs) and
 * layers on a *money-path coverage gate*.
 *
 * Why a separate file (NOT package.json):
 *   - a `coverageThreshold` in package.json would make every plain `pnpm test`
 *     enforce coverage, which we don't want locally. This gate runs only via
 *     `jest --config jest.config.ci.js` in the backend workflow.
 *
 * Scope of the gate — deliberately narrow:
 *   - `collectCoverageFrom` is restricted to the four money-path source files the
 *     Phase-1/2 unit suites actually exercise (refund + payout + the paise-match
 *     util + the Razorpay gateway). This keeps the gate meaningful: untested
 *     resolvers / cron / webhook controllers in the same folders are NOT counted,
 *     so they can't drag the folder aggregate to ~0 and turn the gate into noise.
 *   - `coverageThreshold` keys are resolved by Jest against process.cwd() (the
 *     backend/ working-directory in CI), so `src/modules/...` is correct here even
 *     though rootDir is `src`.
 *   - the keys are GLOBS (they contain `**`), and Jest applies a glob threshold
 *     to EACH matching file INDEPENDENTLY (not the folder aggregate). So every
 *     money-path file must clear the floor on its own — a stronger ratchet, but it
 *     means the floor is set by the *weakest* file in the group.
 *
 * Threshold values are a RATCHET, not a wall: they sit a few points BELOW the
 * per-file coverage the committed specs currently produce (measured 2026-07, and
 * fully deterministic — these are mocked unit specs, no DB, no flake):
 *   payment/**  worst-file floors → S 34.94 (refund) · B 23.68 (razorpay) ·
 *               F 37.5 (razorpay) · L 36.25 (refund)
 *   payout/**   (single file payout.service) → S 65.31 · B 55.07 · F 62.5 · L 67.44
 * CI is green on day one and only fails if a money-path file's coverage REGRESSES
 * below these floors. Raise them as the refund/payout/gateway suites grow (the
 * uncovered lines are the finalize transaction, restock, webhook, and the
 * gateway verify/refund paths — good next targets).
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const base = require('./package.json').jest;

/** @type {import('jest').Config} */
module.exports = {
  ...base,

  // Only the money-path modules the Phase-1/2 suites cover are measured.
  // Paths are relative to rootDir (`src`).
  collectCoverageFrom: [
    'modules/ecommerce/payment/refund.service.ts',
    'modules/ecommerce/payment/payment-amount.util.ts',
    'modules/ecommerce/payment/gateways/razorpay.gateway.ts',
    'modules/ecommerce/payout/payout.service.ts',
  ],

  coverageReporters: ['text-summary', 'text', 'json-summary'],

  // Keys are resolved against process.cwd() (backend/ in CI), NOT rootDir.
  coverageThreshold: {
    // Low/zero global so unrelated code never blocks CI — the gate is scoped
    // entirely to the money-path globs below.
    global: {
      branches: 0,
      functions: 0,
      lines: 0,
      statements: 0,
    },
    // Buyer-refund rail + paise-match util + Razorpay gateway.
    // Per-file floors (weakest file wins) — see header for measured values.
    'src/modules/ecommerce/payment/**': {
      branches: 20,
      functions: 32,
      lines: 30,
      statements: 30,
    },
    // Seller-payout settlement rail (single file: payout.service.ts).
    'src/modules/ecommerce/payout/**': {
      branches: 50,
      functions: 55,
      lines: 60,
      statements: 60,
    },
  },
};
