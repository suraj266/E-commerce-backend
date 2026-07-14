import { Test, TestingModule } from '@nestjs/testing';
import { mockDeep } from 'jest-mock-extended';
import { CategoryResolver } from './category.resolver';

describe('CategoryResolver', () => {
  let resolver: CategoryResolver;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CategoryResolver],
    })
      .useMocker(() => mockDeep())
      .compile();

    resolver = module.get<CategoryResolver>(CategoryResolver);
  });

  it('should be defined', () => {
    expect(resolver).toBeDefined();
  });
});
