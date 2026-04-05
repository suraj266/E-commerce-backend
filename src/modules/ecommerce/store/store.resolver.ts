import { Resolver, Query, Mutation, Args, Int } from '@nestjs/graphql';
import { StoreService } from './store.service';
import { Store } from './entities/store.entity';
import { CreateStoreInput } from './dto/create-store.input';
import { UpdateStoreInput } from './dto/update-store.input';

@Resolver(() => Store)
export class StoreResolver {
  constructor(private readonly storeService: StoreService) {}

  @Mutation(() => Store)
  createStore(@Args('createStoreInput') createStoreInput: CreateStoreInput) {
    return this.storeService.create(createStoreInput);
  }

  @Query(() => [Store], { name: 'store' })
  findAll() {
    return this.storeService.findAll();
  }

  @Query(() => Store, { name: 'store' })
  findOne(@Args('id', { type: () => Int }) id: number) {
    return this.storeService.findOne(id);
  }

  @Mutation(() => Store)
  updateStore(@Args('updateStoreInput') updateStoreInput: UpdateStoreInput) {
    return this.storeService.update(updateStoreInput.id, updateStoreInput);
  }

  @Mutation(() => Store)
  removeStore(@Args('id', { type: () => Int }) id: number) {
    return this.storeService.remove(id);
  }
}
