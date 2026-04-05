import { PrismaClient } from "@prisma/client";
import { hash } from "argon2";

const prisma = new PrismaClient();

const permissions = [
    { module: "user", action: "create", description: "Create user" },
    { module: "user", action: "read", description: "Read user" },
    { module: "user", action: "update", description: "Update user" },
    { module: "user", action: "delete", description: "Delete user" },
    { module: "role", action: "create", description: "Create role" },
    { module: "role", action: "read", description: "Read role" },
    { module: "role", action: "update", description: "Update role" },
    { module: "role", action: "delete", description: "Delete role" },
    { module: "permission", action: "create", description: "Create permission" },
    { module: "permission", action: "read", description: "Read permission" },
    { module: "permission", action: "update", description: "Update permission" },
    { module: "permission", action: "delete", description: "Delete permission" },
]

async function main() {
    const role = await prisma.role.upsert({
        where: { name: "superAdmin" },
        update: {},
        create: {
            name: "superAdmin",
            description: "Super Admin role with all permissions",
            isDefault: true
        }
    })

    const passwordHash = await hash("Admin@123");

    await prisma.user.upsert({
        where: { email: "admin@example.com" },
        update: {},
        create: {
            name: "Admin",
            email: "admin@example.com",
            password: passwordHash,
            phone: "9999999999",
            roleId: role.id,
            status: "active"
        }
    })

    for (const perm of permissions) {
        const permission = await prisma.permission.upsert({
            where: { module_action: { module: perm.module, action: perm.action } },
            update: {},
            create: {
                module: perm.module,
                action: perm.action,
                description: perm.description
            }
        })

        await prisma.rolePermission.upsert({
            where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
            update: {},
            create: {
                roleId: role.id,
                permissionId: permission.id,
            }
        })
    }


}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });