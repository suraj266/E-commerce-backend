import { Test, TestingModule } from '@nestjs/testing';
import { mockDeep } from 'jest-mock-extended';
import { StoreResolver } from './store.resolver';

describe('StoreResolver', () => {
  let resolver: StoreResolver;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [StoreResolver],
    })
      .useMocker(() => mockDeep())
      .compile();

    resolver = module.get<StoreResolver>(StoreResolver);
  });

  it('should be defined', () => {
    expect(resolver).toBeDefined();
  });
});
