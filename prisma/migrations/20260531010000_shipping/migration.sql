-- AlterTable: shipping composite-supply tax breakup (persisted for invoice
-- tie-out) + fulfillment tracking captured when a seller marks SHIPPED.
ALTER TABLE "SellerOrder" ADD COLUMN     "carrier" TEXT,
ADD COLUMN     "dispatchedAt" TIMESTAMP(3),
ADD COLUMN     "expectedDeliveryAt" TIMESTAMP(3),
ADD COLUMN     "shippingCgstAmount" DECIMAL(12,4) NOT NULL DEFAULT 0,
ADD COLUMN     "shippingIgstAmount" DECIMAL(12,4) NOT NULL DEFAULT 0,
ADD COLUMN     "shippingSgstAmount" DECIMAL(12,4) NOT NULL DEFAULT 0,
ADD COLUMN     "shippingTaxableValue" DECIMAL(12,4) NOT NULL DEFAULT 0,
ADD COLUMN     "trackingNumber" TEXT,
ADD COLUMN     "trackingUrl" TEXT;
