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
    { module: "product", action: "create", description: "Admin creates a Product under any store" },
    { module: "product", action: "read", description: "Read product" },
    { module: "product", action: "update", description: "Update product" },
    { module: "product", action: "delete", description: "Delete product" },
    // Seller Management
    { module: "seller", action: "create", description: "Admin creates a Seller (with User) on behalf of someone" },
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
    { module: "store", action: "create", description: "Admin creates a Store under any seller" },
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
    // Page (CMS) Management
    { module: "page", action: "read", description: "Read CMS pages" },
    { module: "page", action: "create", description: "Create CMS page" },
    { module: "page", action: "update", description: "Update CMS page (incl. publish)" },
    { module: "page", action: "delete", description: "Delete CMS page" },
    // Menu (CMS) Management
    { module: "menu", action: "read", description: "Read navigation menus" },
    { module: "menu", action: "create", description: "Create navigation menu" },
    { module: "menu", action: "update", description: "Update navigation menu (incl. items tree)" },
    { module: "menu", action: "delete", description: "Delete navigation menu" },
    // Slider (CMS) Management
    { module: "slider", action: "read", description: "Read sliders + slide items" },
    { module: "slider", action: "create", description: "Create sliders" },
    { module: "slider", action: "update", description: "Update sliders + slide items (incl. reorder)" },
    { module: "slider", action: "delete", description: "Delete sliders" },
    // Newsletter (CMS) Management
    { module: "newsletter", action: "read", description: "Read newsletter subscribers list" },
    { module: "newsletter", action: "update", description: "Update newsletter subscriber (e.g. mark unsubscribed)" },
    // Customer Management
    { module: "customer", action: "read", description: "Read customers list and detail" },
    { module: "customer", action: "update", description: "Update customer profile / status / preferences" },
    { module: "customer", action: "delete", description: "Soft-delete or restore a customer" },
    // Payment Gateway Management
    { module: "payment", action: "read", description: "Read payment gateway configs and transactions" },
    { module: "payment", action: "create", description: "Create payment gateway config" },
    { module: "payment", action: "update", description: "Update payment gateway config / toggle / set default" },
    // Site Settings Management
    { module: "setting", action: "read", description: "Read site settings" },
    { module: "setting", action: "update", description: "Update site settings" },
    // Email Settings & Templates
    { module: "email", action: "read", description: "Read email settings + templates + log" },
    { module: "email", action: "update", description: "Update email settings, edit templates, send test email" },
    // Coupons
    { module: "coupon", action: "read", description: "Read coupons" },
    { module: "coupon", action: "create", description: "Create coupon" },
    { module: "coupon", action: "update", description: "Update coupon" },
    { module: "coupon", action: "delete", description: "Soft-delete coupon" },
    // Reviews
    { module: "review", action: "read", description: "Read all reviews including pending/hidden (admin moderation)" },
    { module: "review", action: "moderate", description: "Approve or reject pending reviews" },
    // Admin Dashboard
    { module: "dashboard", action: "read", description: "Read admin dashboard metrics (revenue, orders, users, sellers, recent orders)" },
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

    // Customer role — assigned automatically on /auth/customer/register.
    // No platform permissions; customer-facing endpoints (cart, wishlist,
    // orders) are gated by JwtAuthGuard + ownership checks against the
    // user's Customer.id. See CUSTOMER_SEPARATION_PLAYBOOK.md.
    await prisma.role.upsert({
        where: { name: "customer" },
        update: {},
        create: {
            name: "customer",
            description: "Storefront shopper — owns cart, wishlist, addresses, orders.",
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