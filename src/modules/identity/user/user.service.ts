import { Injectable } from '@nestjs/common';
import { CreateUserInput } from './dto/create-user.input';
import { UpdateUserInput } from './dto/update-user.input';
import { PrismaService } from 'src/prisma/prisma.service';
import { User } from '@prisma/client';
import { hash } from 'argon2';

@Injectable()
export class UserService {
  constructor(private readonly prisma: PrismaService) { }

  async create(createUserInput: CreateUserInput): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { email: createUserInput.email } })
    if (user) {
      throw new Error("User already exists")
    }
    const passwordHash = await hash(createUserInput.password)
    return this.prisma.user.create({ data: { ...createUserInput, password: passwordHash } })
  }

  findAll() {
    return this.prisma.user.findMany();
  }

  findOne(id: string) {
    return this.prisma.user.findUnique({ where: { id } });
  }

  update(id: string, updateUserInput: UpdateUserInput) {
    return this.prisma.user.update({ where: { id }, data: updateUserInput });
  }

  remove(id: string) {
    return this.prisma.user.delete({ where: { id } });
  }
}
