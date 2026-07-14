import { mockDeep, DeepMockProxy, mockReset } from 'jest-mock-extended';
import { PrismaService } from '@/prisma/prisma.service';

/**
 * Shared deep mock of PrismaService for unit tests.
 *
 * The auto-generated scaffold specs instantiated services with no dependencies,
 * so Nest's DI could not resolve them and 12 suites were red. Provide this mock
 * via `{ provide: PrismaService, useValue: prismaMock }` in Test.createTestingModule.
 */
export type PrismaMock = DeepMockProxy<PrismaService>;

export const createPrismaMock = (): PrismaMock => mockDeep<PrismaService>();

export const resetPrismaMock = (mock: PrismaMock): void => {
  mockReset(mock);
};
