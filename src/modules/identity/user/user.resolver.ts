import { Resolver, Query, Mutation, Args, ID, Int } from '@nestjs/graphql';
import { UserService } from './user.service';
import { User, PaginatedUsers } from './entities/user.entity';
import { CreateUserInput } from './dto/create-user.input';
import { UpdateUserInput } from './dto/update-user.input';
import { UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Permissions } from '@/common/decorators/permissions.decorator';
import { PermissionsGuard } from '@/common/guards/permissions.guard';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '@/common/decorators/current-user.decorator';


@Resolver(() => User)
export class UserResolver {
  constructor(private readonly userService: UserService) { }

  /** Creates a platform (staff/admin) user; rejects a duplicate email. Auth: user:create permission. */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('user:create')
  @Mutation(() => User)
  createUser(@Args('createUserInput') createUserInput: CreateUserInput) {
    return this.userService.create(createUserInput);
  }

  /** Lists all users, unpaginated. Auth: user:read permission. */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('user:read')
  @Query(() => [User], { name: 'users' })
  findAll() {
    return this.userService.findAll();
  }

  /** Admin user list with search/status/role filters + pagination. Auth: user:read permission. */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('user:read')
  @Query(() => PaginatedUsers, { name: 'adminUsers' })
  adminUsers(
    @Args('search', { type: () => String, nullable: true }) search?: string,
    @Args('status', { type: () => String, nullable: true }) status?: string,
    @Args('roleId', { type: () => ID, nullable: true }) roleId?: string,
    @Args('page', { type: () => Int, nullable: true }) page?: number,
    @Args('pageSize', { type: () => Int, nullable: true }) pageSize?: number,
  ) {
    return this.userService.adminUsers({
      search,
      status,
      roleId,
      page,
      pageSize,
    });
  }

  /** Fetches one user by id. Auth: user:read permission. */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('user:read')
  @Query(() => User, { name: 'user' })
  findOne(@Args('id', { type: () => ID }) id: string) {
    return this.userService.findOne(id);
  }

  /** Updates a user's fields. Auth: user:update permission. */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('user:update')
  @Mutation(() => User)
  updateUser(@Args('updateUserInput') updateUserInput: UpdateUserInput) {
    return this.userService.update(updateUserInput.id, updateUserInput);
  }

  /** Moderates a user's status (active/suspended/banned); can't self-target and only a superAdmin may
   *  restatus a superAdmin. Auth: user:update permission. */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('user:update')
  @Mutation(() => User, { name: 'setUserStatus' })
  setUserStatus(
    @CurrentUser() actor: CurrentUserPayload,
    @Args('id', { type: () => ID }) id: string,
    @Args('status', { type: () => String }) status: string,
  ) {
    return this.userService.setUserStatus(actor.userId, id, status);
  }

  /** Hard-deletes a user row. Auth: user:delete permission. */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('user:delete')
  @Mutation(() => User)
  removeUser(@Args('id', { type: () => ID }) id: string) {
    return this.userService.remove(id);
  }
}
