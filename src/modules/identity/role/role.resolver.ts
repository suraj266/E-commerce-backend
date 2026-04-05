import { Resolver, Query, Mutation, Args, ID } from '@nestjs/graphql';
import { RoleService } from './role.service';
import { Role } from './entities/role.entity';
import { CreateRoleInput } from './dto/create-role.input';
import { UpdateRoleInput } from './dto/update-role.input';
import { UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '@/common/guards/permissions.guard';
import { Permissions } from '@/common/decorators/permissions.decorator';

@Resolver(() => Role)
export class RoleResolver {
  constructor(private readonly roleService: RoleService) { }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('role:create')
  @Mutation(() => Role)
  createRole(@Args('createRoleInput') createRoleInput: CreateRoleInput) {
    return this.roleService.create(createRoleInput);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('role:read')
  @Query(() => [Role], { name: 'roles' })
  findAll() {
    return this.roleService.findAll();
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('role:read')
  @Query(() => Role, { name: 'role' })
  findOne(@Args('id', { type: () => ID }) id: string) {
    return this.roleService.findOne(id);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('role:update')
  @Mutation(() => Role)
  updateRole(@Args('updateRoleInput') updateRoleInput: UpdateRoleInput) {
    return this.roleService.update(updateRoleInput.id, updateRoleInput);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('role:delete')
  @Mutation(() => Role)
  removeRole(@Args('id', { type: () => ID }) id: string) {
    return this.roleService.remove(id);
  }
}
