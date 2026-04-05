# E-commerce Database Strategy: Full TigerData Translation (Pragmatic CQRS) 🚀

Aap bilkul sahi keh rahe hain. Ek enterprise level e-commerce platform mein sirf 4-5 tables nahi hoti. Usme Shipping, Gateways, Returns, Reviews, Flash Sales, Inventory movements aur Audit logs jaise 70+ tables hote hain.

Aapke provide kiye gaye **TigerData** ke teeno chunks ko maine CQRS Hybrid Model mein convert karke yahan ek **Ultimate Prisma Schema** tyar kiya hai. Yeh 70+ tables ko cover karta hai bina "Soft-Link" logic ko tode!

---

## 🔒 1. CORE USERS, RBAC & SECURITY
Yahan security, session aur API keys track hongi.

```prisma
model User {
  id                String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  email             String    @unique
  phone             String?   @unique
  passwordHash      String
  firstName         String?
  lastName          String?
  avatarUrl         String?
  dateOfBirth       DateTime? @db.Date
  gender            String?
  status            String    @default("active")
  metadata          Json      @default("{}")
  createdAt         DateTime  @default(now()) @db.Timestamptz
  updatedAt         DateTime  @default(now()) @updatedAt @db.Timestamptz

  addresses         UserAddress[]
  userRoles         UserRole[]
  apiKeys           ApiKey[]
  sessions          Session[]
}

model UserAddress {
  id              String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  userId          String    @db.Uuid
  type            String    // 'billing', 'shipping', 'both'
  label           String?
  firstName       String
  lastName        String
  phone           String?
  addressLine1    String
  addressLine2    String?
  city            String
  state           String
  postalCode      String
  countryCode     String
  isDefault       Boolean   @default(false)
  
  user            User      @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model Role {
  id              String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  name            String    @unique
  slug            String    @unique
  isSystemRole    Boolean   @default(false)
  level           Int
  
  permissions     RolePermission[]
  userRoles       UserRole[]
}

model Permission {
  id              String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  name            String    @unique
  slug            String    @unique
  resource        String
  action          String
  roles           RolePermission[]
}

model RolePermission {
  roleId          String    @db.Uuid
  permissionId    String    @db.Uuid
  role            Role      @relation(fields: [roleId], references: [id])
  permission      Permission @relation(fields: [permissionId], references: [id])
  @@id([roleId, permissionId])
}

model UserRole {
  id              String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  userId          String    @db.Uuid
  roleId          String    @db.Uuid
  contextType     String?
  contextId       String?   @db.Uuid 
  user            User      @relation(fields: [userId], references: [id])
  role            Role      @relation(fields: [roleId], references: [id])
}

model ApiKey {
  id              String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  userId          String    @db.Uuid
  name            String
  keyHash         String    @unique
  keyPrefix       String
  permissions     Json      @default("[]")
  user            User      @relation(fields: [userId], references: [id])
}

model Session {
  id              String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  userId          String    @db.Uuid
  tokenHash       String    @unique
  ipAddress       String?   @db.Inet
  userAgent       String?
  expiresAt       DateTime  @db.Timestamptz
  user            User      @relation(fields: [userId], references: [id])
}
```

---

## 🏪 2. SELLERS, STORES & CONFIGURATION

```prisma
model Seller {
  id                  String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  userId              String    @unique @db.Uuid
  businessName        String
  taxId               String?
  verificationStatus  String    @default("pending")
  commissionRate      Decimal   @default(0.00) @db.Decimal(5,2)
  
  stores              Store[]
  payoutAccounts      SellerPayoutAccount[]
}

model Store {
  id                String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  sellerId          String    @db.Uuid
  name              String
  slug              String    @unique
  customDomain      String?   @unique
  currencyCode      String    @default("USD")
  themeConfig       Json      @default("{}")
  status            String    @default("active")
  
  seller            Seller    @relation(fields: [sellerId], references: [id])
  settings          StoreSetting[]
}

model SellerPayoutAccount {
  id                String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  sellerId          String    @db.Uuid
  accountType       String    // bank, upi
  accountHolderName String
  accountNumber     String?   // Encrypted
  ifscCode          String?
  upiId             String?
  isPrimary         Boolean   @default(false)
  seller            Seller    @relation(fields: [sellerId], references: [id])
}

model PlatformSetting {
  id          String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  key         String   @unique
  value       String?
  type        String   // string, json
}

model StoreSetting {
  id          String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  storeId     String   @db.Uuid
  key         String
  value       String?
  store       Store    @relation(fields: [storeId], references: [id])
  @@unique([storeId, key])
}
```

---

## 📦 3. CATALOG & VARIANTS (WRITE MODEL)
Yahan seller entries karega. Tags aur categories Many-to-Many se judengi.

```prisma
model Category {
  id            String     @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  parentId      String?    @db.Uuid
  name          String
  slug          String     @unique
  parent        Category?  @relation("CatHierarchy", fields: [parentId], references: [id])
  children      Category[] @relation("CatHierarchy")
}

model Tag {
  id            String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  name          String    @unique
  slug          String    @unique
}

model Product {
  id                String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  storeId           String    @db.Uuid
  productType       String    // simple, variable
  name              String
  slug              String
  status            String    @default("draft")
  basePrice         Decimal   @db.Decimal(10,2) // Use for simple products
  
  variants          ProductVariant[]
  images            ProductImage[]
  readDocument      ProductReadDocument? 
}

model ProductVariant {
  id              String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  productId       String    @db.Uuid
  sku             String    @unique
  price           Decimal   @db.Decimal(10,2)
  weight          Decimal?  @db.Decimal(10,2)
  status          String    @default("active")
  
  product         Product   @relation(fields: [productId], references: [id])
}

model ProductImage {
  id              String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  productId       String    @db.Uuid
  imageUrl        String
  isPrimary       Boolean   @default(false)
  product         Product   @relation(fields: [productId], references: [id])
}

model FlashSale {
  id            String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  storeId       String    @db.Uuid
  name          String
  discountValue Decimal   @db.Decimal(10,2)
  startsAt      DateTime  @db.Timestamptz
  endsAt        DateTime  @db.Timestamptz
}
```

---

## ⚡ 4. NO-SQL CATALOG PROJECTION (READ MODEL)
Is table me Postgres GIN Search hit hoga. All Product Details denormalized.

```prisma
model ProductReadDocument {
  id          String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  productId   String   @unique @db.Uuid
  slug        String   @unique
  isPublished Boolean  @default(false)
  document    Json     // Flattened: {price, tags[], variants[], attributes{}, rating}
  
  product     Product  @relation(fields: [productId], references: [id])
}
```

---

## 🏭 5. INVENTORY WAREHOUSING (STRICT)

```prisma
model Warehouse {
  id            String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  storeId       String    @db.Uuid
  name          String
  code          String
  countryCode   String
}

model Inventory {
  id                String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  variantId         String    @db.Uuid // Strict link to variant
  warehouseId       String    @db.Uuid
  qtyAvailable      Int       @default(0)
  qtyReserved       Int       @default(0) // Locked during checkout
  
  @@unique([variantId, warehouseId])
}

model InventoryMovement {
  id              String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  inventoryId     String    @db.Uuid
  movementType    String    // sale, restock, damage
  qtyChange       Int
  createdAt       DateTime  @default(now()) @db.Timestamptz // Ideal for TimescaleDB
}
```

---

## 🛒 6. DECOUPLED ORDERS & CHECKOUT (SOFT LINKS)

```prisma
model Order {
  id                String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  orderNumber       String    @unique
  customerId        String    @db.Uuid
  status            String    @default("pending")
  totalAmount       Decimal   @db.Decimal(10,2)
  shippingSnapshot  Json      // Immutable address
  createdAt         DateTime  @default(now()) @db.Timestamptz

  items             OrderItem[]
  sellerOrders      SellerOrder[]
}

model SellerOrder {
  id                String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  orderId           String    @db.Uuid
  sellerId          String    // SOFT LINK
  storeId           String    // SOFT LINK
  payoutAmount      Decimal   @db.Decimal(10,2) 
  commissionAmount  Decimal   @db.Decimal(10,2)
  status            String    @default("pending")
  
  order             Order     @relation(fields: [orderId], references: [id])
}

model OrderItem {
  id              String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  orderId         String    @db.Uuid
  productId       String    // SOFT LINK
  variantId       String?   // SOFT LINK
  productSnapshot Json      // Exact copy of specs at checkout
  unitPrice       Decimal   @db.Decimal(10,2)
  quantity        Int
  
  order           Order     @relation(fields: [orderId], references: [id])
}

model OrderStatusHistory {
  id              String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  orderId         String    @db.Uuid
  statusFrom      String?
  statusTo        String
  notes           String?
  createdAt       DateTime  @default(now()) @db.Timestamptz // Timescale Hypertable
}
```

---

## 🎟️ 7. COUPONS & DISCOUNTS

```prisma
model Coupon {
  id              String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  storeId         String?   @db.Uuid // null = platform coupon
  code            String    @unique
  discountType    String    // fixed, percentage
  discountValue   Decimal   @db.Decimal(10,2)
  usageLimit      Int?
}

model CouponUsage {
  id              String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  couponId        String    @db.Uuid
  userId          String    @db.Uuid
  orderId         String    @db.Uuid // Link to order
  discountAmount  Decimal   @db.Decimal(10,2)
}
```

---

## 💳 8. PAYMENTS & SELLER EARNINGS

```prisma
model PaymentIntent {
  id              String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  orderId         String    @db.Uuid
  gatewayId       String    @db.Uuid
  intentId        String    // Stripe/Razorpay PID
  amount          Decimal   @db.Decimal(10,2)
  status          String
}

model Payment {
  id              String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  orderId         String    @db.Uuid
  transactionId   String    @unique
  amount          Decimal   @db.Decimal(10,2)
  status          String
}

model SellerPayout {
  id              String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  sellerId        String    @db.Uuid // Strict or Soft handled in code
  payoutAccountId String    @db.Uuid
  amount          Decimal   @db.Decimal(10,2)
  status          String
}

model SellerEarning {
  id              String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  sellerId        String    @db.Uuid
  periodStart     DateTime  @db.Date
  periodEnd       DateTime  @db.Date
  totalRevenue    Decimal   @db.Decimal(10,2)
  totalCommission Decimal   @db.Decimal(10,2)
}
```

---

## 🚚 9. SHIPPING & LOGISTICS

```prisma
model ShippingProvider {
  id              String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  name            String    @unique // shiprocket, delhivery
  isActive        Boolean   @default(true)
}

model Shipment {
  id              String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  sellerOrderId   String    @db.Uuid
  providerId      String    @db.Uuid
  trackingNumber  String    @unique
  status          String    @default("pending")
  shippingCost    Decimal   @db.Decimal(10,2)
}

model ShipmentTrackingEvent {
  id              String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  shipmentId      String    @db.Uuid
  status          String
  location        String?
  eventTimestamp  DateTime  @db.Timestamptz // Timescale
}
```

---

## ⭐ 10. REVIEWS, WISHLIST & ENGAGEMENT

```prisma
model ProductReview {
  id              String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  productId       String    // SOFT LINK
  userId          String    @db.Uuid
  rating          Int
  reviewText      String?
  isApproved      Boolean   @default(false)
}

model Wishlist {
  id              String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  userId          String    @db.Uuid
  name            String    @default("My Wishlist")
}

model WishlistItem {
  wishlistId      String    @db.Uuid
  productId       String    // SOFT LINK
  variantId       String?   // SOFT LINK
  @@id([wishlistId, productId])
}
```

---

## 🔔 11. NOTIFICATIONS & EMAILS

```prisma
model EmailTemplate {
  id              String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  storeId         String?   @db.Uuid
  templateType    String
  subject         String
  bodyText        String
}

model EmailLog {
  id              String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  recipientEmail  String
  status          String
  error           String?
  sentAt          DateTime  @default(now()) @db.Timestamptz
}

model Notification {
  id              String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  userId          String    @db.Uuid
  type            String
  title           String
  isRead          Boolean   @default(false)
  createdAt       DateTime  @default(now()) @db.Timestamptz
}
```

---

## 🛡️ 12. AUDIT & LOGS (Timescale Ready)

```prisma
model AuditLog {
  id              String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  userId          String?   @db.Uuid
  action          String
  resourceType    String
  resourceId      String?   @db.Uuid
  changes         Json      @default("{}")
  createdAt       DateTime  @default(now()) @db.Timestamptz
}

model SecurityEvent {
  id              String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  userId          String?   @db.Uuid
  eventType       String    // login_failed, password_reset
  ipAddress       String?   @db.Inet
  createdAt       DateTime  @default(now()) @db.Timestamptz
}
```
