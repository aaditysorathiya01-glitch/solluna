-- DropForeignKey
ALTER TABLE "CaDocument" DROP CONSTRAINT "CaDocument_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "Report" DROP CONSTRAINT "Report_organizationId_fkey";

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "caStatus" TEXT,
ADD COLUMN     "periodMonth" TIMESTAMP(3);

-- DropTable
DROP TABLE "CaDocument";

-- DropTable
DROP TABLE "Report";

-- CreateTable
CREATE TABLE "MarketplaceMonth" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "periodMonth" TIMESTAMP(3) NOT NULL,
    "marketplace" "Marketplace" NOT NULL,
    "salesBasis" TEXT NOT NULL DEFAULT 'SHIPPED',
    "grossSalesPaise" INTEGER,
    "discountsPaise" INTEGER,
    "returnsRefundsPaise" INTEGER,
    "reimbursementsPaise" INTEGER,
    "orders" INTEGER,
    "unitsSold" INTEGER,
    "unitsReturned" INTEGER,
    "cancelledOrders" INTEGER,
    "sessions" INTEGER,
    "commissionPaise" INTEGER,
    "fixedFeesPaise" INTEGER,
    "fulfilmentPaise" INTEGER,
    "shippingPaise" INTEGER,
    "storagePaise" INTEGER,
    "otherFeesPaise" INTEGER,
    "adSpendPaise" INTEGER,
    "adSalesPaise" INTEGER,
    "impressions" INTEGER,
    "clicks" INTEGER,
    "adSpendInFees" BOOLEAN NOT NULL DEFAULT false,
    "settlementPaise" INTEGER,
    "bankCreditPaise" INTEGER,
    "reservesPaise" INTEGER,
    "sourceNote" TEXT,
    "enteredById" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketplaceMonth_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SkuMonthLine" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "periodMonth" TIMESTAMP(3) NOT NULL,
    "marketplace" "Marketplace" NOT NULL,
    "sku" TEXT NOT NULL,
    "units" INTEGER NOT NULL,
    "netSalesPaise" INTEGER NOT NULL,
    "feesPaise" INTEGER,
    "adSpendPaise" INTEGER,

    CONSTRAINT "SkuMonthLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductCost" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "costPaise" INTEGER NOT NULL,
    "includesGst" BOOLEAN NOT NULL DEFAULT false,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "clientConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "enteredById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductCost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperatingExpense" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "periodMonth" TIMESTAMP(3) NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "documentId" TEXT,
    "enteredById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OperatingExpense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportMonth" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "periodMonth" TIMESTAMP(3) NOT NULL,
    "expensesConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "confirmedById" TEXT,
    "confirmedAt" TIMESTAMP(3),

    CONSTRAINT "ReportMonth_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonthlyReport" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "periodMonth" TIMESTAMP(3) NOT NULL,
    "kind" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "confidence" "FigureConfidence" NOT NULL,
    "data" JSONB NOT NULL,
    "generatedById" TEXT NOT NULL,
    "publishedById" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MonthlyReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MarketplaceMonth_organizationId_periodMonth_marketplace_key" ON "MarketplaceMonth"("organizationId", "periodMonth", "marketplace");

-- CreateIndex
CREATE UNIQUE INDEX "SkuMonthLine_organizationId_periodMonth_marketplace_sku_key" ON "SkuMonthLine"("organizationId", "periodMonth", "marketplace", "sku");

-- CreateIndex
CREATE INDEX "ProductCost_organizationId_sku_effectiveFrom_idx" ON "ProductCost"("organizationId", "sku", "effectiveFrom");

-- CreateIndex
CREATE INDEX "OperatingExpense_organizationId_periodMonth_idx" ON "OperatingExpense"("organizationId", "periodMonth");

-- CreateIndex
CREATE UNIQUE INDEX "ReportMonth_organizationId_periodMonth_key" ON "ReportMonth"("organizationId", "periodMonth");

-- CreateIndex
CREATE INDEX "MonthlyReport_organizationId_status_idx" ON "MonthlyReport"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MonthlyReport_organizationId_periodMonth_kind_version_key" ON "MonthlyReport"("organizationId", "periodMonth", "kind", "version");

-- AddForeignKey
ALTER TABLE "MarketplaceMonth" ADD CONSTRAINT "MarketplaceMonth_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkuMonthLine" ADD CONSTRAINT "SkuMonthLine_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCost" ADD CONSTRAINT "ProductCost_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperatingExpense" ADD CONSTRAINT "OperatingExpense_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportMonth" ADD CONSTRAINT "ReportMonth_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonthlyReport" ADD CONSTRAINT "MonthlyReport_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

