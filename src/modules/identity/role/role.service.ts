import { Injectable } from '@nestjs/common';
import { CreateRoleInput } from './dto/create-role.input';
import { UpdateRoleInput } from './dto/update-role.input';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class RoleService {
  constructor(private readonly prisma: PrismaService) { }
  create(createRoleInput: CreateRoleInput) {
    return this.prisma.role.create({ data: createRoleInput })
  }

  findAll() {
    return this.prisma.role.findMany();
  }

  findOne(id: string) {
    return this.prisma.role.findUnique({ where: { id } });
  }

  update(id: string, updateRoleInput: UpdateRoleInput) {
    return this.prisma.role.update({ where: { id }, data: updateRoleInput });
  }

  remove(id: string) {
    return this.prisma.role.delete({ where: { id } });
  }
}
