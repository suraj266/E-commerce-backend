import { Injectable } from '@nestjs/common';
import { CreateSellerInput } from './dto/create-seller.input';
import { UpdateSellerInput } from './dto/update-seller.input';

@Injectable()
export class SellerService {
  create(createSellerInput: CreateSellerInput) {
    return 'This action adds a new seller';
  }

  findAll() {
    return `This action returns all seller`;
  }

  findOne(id: number) {
    return `This action returns a #${id} seller`;
  }

  update(id: number, updateSellerInput: UpdateSellerInput) {
    return `This action updates a #${id} seller`;
  }

  remove(id: number) {
    return `This action removes a #${id} seller`;
  }
}
