import { Resolver, Query, Mutation, Args, Int } from '@nestjs/graphql';
import { SellerService } from './seller.service';
import { Seller } from './entities/seller.entity';
import { CreateSellerInput } from './dto/create-seller.input';
import { UpdateSellerInput } from './dto/update-seller.input';

@Resolver(() => Seller)
export class SellerResolver {
  constructor(private readonly sellerService: SellerService) {}

  @Mutation(() => Seller)
  createSeller(@Args('createSellerInput') createSellerInput: CreateSellerInput) {
    return this.sellerService.create(createSellerInput);
  }

  @Query(() => [Seller], { name: 'seller' })
  findAll() {
    return this.sellerService.findAll();
  }

  @Query(() => Seller, { name: 'seller' })
  findOne(@Args('id', { type: () => Int }) id: number) {
    return this.sellerService.findOne(id);
  }

  @Mutation(() => Seller)
  updateSeller(@Args('updateSellerInput') updateSellerInput: UpdateSellerInput) {
    return this.sellerService.update(updateSellerInput.id, updateSellerInput);
  }

  @Mutation(() => Seller)
  removeSeller(@Args('id', { type: () => Int }) id: number) {
    return this.sellerService.remove(id);
  }
}
