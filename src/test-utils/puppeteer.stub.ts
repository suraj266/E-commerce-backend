/**
 * Jest stub for `puppeteer`.
 *
 * The real `puppeteer` package ships an ESM entry (`export * from
 * 'puppeteer-core'`) that ts-jest's CommonJS transform cannot parse, so any test
 * that TRANSITIVELY imports it (e.g. returns.service.spec → courier.service →
 * seller-order.service → invoice.service `import * as puppeteer`) fails to load.
 * No unit test actually renders a PDF, so we map `puppeteer` to this stub via
 * jest.moduleNameMapper. `launch` throws if a test ever really invokes it —
 * which would be a signal to mock the PDF path explicitly instead.
 */

export const launch = async (): Promise<never> => {
  throw new Error('puppeteer is stubbed in the jest environment');
};

export default { launch };
