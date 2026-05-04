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
    // Category Management
    { module: "category", action: "create", description: "Create category" },
    { module: "category", action: "read", description: "Read category" },
    { module: "category", action: "update", description: "Update category" },
    { module: "category", action: "delete", description: "Delete category" },
    // Product Management
    { module: "product", action: "create", description: "Create product" },
    { module: "product", action: "read", description: "Read product" },
    { module: "product", action: "update", description: "Update product" },
    { module: "product", action: "delete", description: "Delete product" },
    // Seller Management
    { module: "seller", action: "create", description: "Create seller" },
    { module: "seller", action: "read", description: "Read seller" },
    { module: "seller", action: "update", description: "Update seller" },
    { module: "seller", action: "delete", description: "Delete seller" },
    { module: "seller", action: "verify", description: "Verify or reject a seller" },
    // Payout Account Management
    { module: "payout", action: "create", description: "Create payout account" },
    { module: "payout", action: "read", description: "Read payout account" },
    { module: "payout", action: "update", description: "Update payout account" },
    { module: "payout", action: "delete", description: "Delete payout account" },
    // Store Management
    { module: "store", action: "read", description: "Read any store (admin)" },
    { module: "store", action: "update", description: "Update or override any store (admin)" },
    { module: "store", action: "delete", description: "Delete any store (admin)" },
    // Warehouse Management
    { module: "warehouse", action: "read", description: "Read any warehouse (admin)" },
    { module: "warehouse", action: "update", description: "Update any warehouse (admin)" },
    // Brand Management
    { module: "brand", action: "create", description: "Create brand" },
    { module: "brand", action: "read", description: "Read brand" },
    { module: "brand", action: "update", description: "Update brand" },
    { module: "brand", action: "delete", description: "Delete brand" },
    { module: "brand", action: "feature", description: "Feature or unfeature a brand" },
    // Tag Management
    { module: "tag", action: "create", description: "Create tag" },
    { module: "tag", action: "read", description: "Read tag" },
    { module: "tag", action: "update", description: "Update tag" },
    { module: "tag", action: "delete", description: "Delete tag" },
    { module: "tag", action: "feature", description: "Feature or unfeature a tag" },
    // Attribute Management (covers both attribute itself + its values)
    { module: "attribute", action: "create", description: "Create attribute or value" },
    { module: "attribute", action: "read", description: "Read attribute" },
    { module: "attribute", action: "update", description: "Update attribute or value" },
    { module: "attribute", action: "delete", description: "Delete attribute or value" },
    // Admin Panel Theme / Appearance
    { module: "theme", action: "update", description: "Update or reset the admin panel theme" },
    // Inventory Management (admin-side audit / cross-store reads)
    { module: "inventory", action: "read", description: "Read inventory across stores (admin)" },
    { module: "inventory", action: "adjust", description: "Adjust inventory across stores (admin)" },
    // Tax Management
    { module: "tax", action: "read", description: "Read tax catalog" },
    { module: "tax", action: "create", description: "Create tax" },
    { module: "tax", action: "update", description: "Update tax" },
    { module: "tax", action: "delete", description: "Delete tax" },
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

    // Seller role — assigned automatically on /auth/seller/register.
    // No platform permissions; seller endpoints are gated by JwtAuthGuard +
    // service-level ownership checks (seller.userId === currentUser.userId).
    await prisma.role.upsert({
        where: { name: "seller" },
        update: {},
        create: {
            name: "seller",
            description: "Marketplace seller — self-managed profile, products, orders, payouts.",
            isDefault: false
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
            status: "active",
            emailVerifiedAt: new Date(),  // admin pre-verified
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