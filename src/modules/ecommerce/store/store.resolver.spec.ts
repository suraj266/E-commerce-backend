import { Test, TestingModule } from '@nestjs/testing';
import { StoreResolver } from './store.resolver';
import { StoreService } from './store.service';

describe('StoreResolver', () => {
  let resolver: StoreResolver;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [StoreResolver, StoreService],
    }).compile();

    resolver = module.get<StoreResolver>(StoreResolver);
  });

  it('should be defined', () => {
    expect(resolver).toBeDefined();
  });
});
