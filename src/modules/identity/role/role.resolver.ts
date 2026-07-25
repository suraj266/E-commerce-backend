import { Resolver, Query, Mutation, Args, ID } from '@nestjs/graphql';
import { RoleService } from './role.service';
import { Role } from './entities/role.entity';
import { Permission } from './entities/permission.entity';
import { CreateRoleInput } from './dto/create-role.input';
import { UpdateRoleInput } from './dto/update-role.input';
import { UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '@/common/guards/permissions.guard';
import { Permissions } from '@/common/decorators/permissions.decorator';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '@/common/decorators/current-user.decorator';

@Resolver(() => Role)
export class RoleResolver {
  constructor(private readonly roleService: RoleService) { }

  /** Creates a new role. Auth: role:create permission. */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('role:create')
  @Mutation(() => Role)
  createRole(@Args('createRoleInput') createRoleInput: CreateRoleInput) {
    return this.roleService.create(createRoleInput);
  }

  /** Lists all roles, each hydrated with its granted permission set. Auth: role:read permission. */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('role:read')
  @Query(() => [Role], { name: 'roles' })
  findAll() {
    return this.roleService.findAll();
  }

  /** Fetches one role with its granted permissions. Auth: role:read permission. */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('role:read')
  @Query(() => Role, { name: 'role' })
  findOne(@Args('id', { type: () => ID }) id: string) {
    return this.roleService.findOne(id);
  }

  /** Updates a role's metadata (e.g. name). Auth: role:update permission. */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('role:update')
  @Mutation(() => Role)
  updateRole(@Args('updateRoleInput') updateRoleInput: UpdateRoleInput) {
    return this.roleService.update(updateRoleInput.id, updateRoleInput);
  }

  /** Deletes a role. Auth: role:delete permission. */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('role:delete')
  @Mutation(() => Role)
  removeRole(@Args('id', { type: () => ID }) id: string) {
    return this.roleService.remove(id);
  }

  // ---------------------------------------------------------------------------
  // Permission matrix (P3-06) — read the catalog + grant/revoke on a role.
  // ---------------------------------------------------------------------------

  /**
   * Read-only permission catalog — the matrix columns. Gated by either
   * `permission:read` or `role:read` (PermissionsGuard uses `.some()`), so any
   * role-editor can load the columns they'll toggle.
   */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('permission:read', 'role:read')
  @Query(() => [Permission], { name: 'permissions' })
  findAllPermissions() {
    return this.roleService.findAllPermissions();
  }

  /** Grant one permission to a role. Returns the role with its full new set. */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('permission:update')
  @Mutation(() => Role, { name: 'assignPermission' })
  assignPermission(
    @CurrentUser() user: CurrentUserPayload,
    @Args('roleId', { type: () => ID }) roleId: string,
    @Args('permissionId', { type: () => ID }) permissionId: string,
  ) {
    return this.roleService.assignPermission(roleId, permissionId, user.userId);
  }

  /** Revoke one permission from a role. Returns the role with its remaining set. */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('permission:update')
  @Mutation(() => Role, { name: 'revokePermission' })
  revokePermission(
    @CurrentUser() user: CurrentUserPayload,
    @Args('roleId', { type: () => ID }) roleId: string,
    @Args('permissionId', { type: () => ID }) permissionId: string,
  ) {
    return this.roleService.revokePermission(
      roleId,
      permissionId,
      user.userId,
    );
  }

  /**
   * The current session's own permission slugs — no permission gate (any
   * authenticated user may read their OWN grants). Powers the client-side
   * hidden-nav half of the P3-06 route gate.
   */
  @UseGuards(JwtAuthGuard)
  @Query(() => [String], { name: 'myPermissions' })
  myPermissions(@CurrentUser() user: CurrentUserPayload) {
    return this.roleService.getUserPermissionSlugs(user.userId);
  }
}
