import { Test, TestingModule } from '@nestjs/testing';
import { mockDeep } from 'jest-mock-extended';
import { ProductResolver } from './product.resolver';

describe('ProductResolver', () => {
  let resolver: ProductResolver;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ProductResolver],
    })
      .useMocker(() => mockDeep())
      .compile();

    resolver = module.get<ProductResolver>(ProductResolver);
  });

  it('should be defined', () => {
    expect(resolver).toBeDefined();
  });
});
