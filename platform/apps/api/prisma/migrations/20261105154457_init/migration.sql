-- CreateEnum
CREATE TYPE "UserType" AS ENUM ('CUSTOMER', 'STAFF');

-- CreateEnum
CREATE TYPE "StaffRole" AS ENUM ('SUPER_ADMIN', 'OPERATIONS_MANAGER', 'LISTING_EXECUTIVE', 'ADS_MANAGER', 'SUPPORT_EXECUTIVE', 'ACCOUNTS_EXECUTIVE');

-- CreateEnum
CREATE TYPE "Marketplace" AS ENUM ('AMAZON', 'FLIPKART');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('PENDING_PAYMENT', 'ACTIVE', 'GRACE_PERIOD', 'PAST_DUE', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('INITIATED', 'VERIFIED', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "ListingStatus" AS ENUM ('RESEARCH_NOT_STARTED', 'EXISTING_ID_CHECK', 'EXISTING_ID_FOUND', 'NEW_CATALOG_CANDIDATE', 'ELIGIBILITY_CHECK', 'BRAND_APPROVAL_REQUIRED', 'APPROVAL_REQUIRED', 'DOCUMENTS_PENDING', 'CONTENT_IN_PROGRESS', 'CONTENT_REVIEW', 'CLIENT_APPROVAL_PENDING', 'APPROVED_FOR_SUBMISSION', 'SUBMITTED', 'PROCESSING', 'PROCESSING_ERROR', 'CATALOG_ID_CREATED', 'LISTING_INCOMPLETE', 'SUPPRESSED', 'ACTIVE', 'INACTIVE', 'REJECTED', 'BLOCKED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MappingStatus" AS ENUM ('NOT_ASSESSED', 'EXACT_VERIFIED', 'HIGH_CONFIDENCE', 'REVIEW_REQUIRED', 'NO_MATCH_FOUND', 'CONFLICT', 'NOT_ELIGIBLE_OR_BLOCKED');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('NEW', 'ASSIGNED', 'IN_PROGRESS', 'WAITING_FOR_CLIENT', 'WAITING_FOR_MARKETPLACE', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "TicketCategory" AS ENUM ('ACCOUNT_REGISTRATION', 'BRAND_APPROVAL', 'CATALOG_MAPPING', 'NEW_LISTING', 'ADS', 'PROMOTIONS', 'INVENTORY', 'SHIPPING_LABELS', 'PAYMENTS_SETTLEMENTS', 'ACCOUNT_HEALTH');

-- CreateEnum
CREATE TYPE "LabelJobStatus" AS ENUM ('QUEUED', 'PROCESSING', 'READY', 'DELIVERED', 'FAILED');

-- CreateEnum
CREATE TYPE "FigureConfidence" AS ENUM ('VERIFIED', 'ESTIMATED', 'UNAVAILABLE');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('NEW', 'AWAITING_INFORMATION', 'AWAITING_CLIENT_APPROVAL', 'PLAN_VERIFICATION', 'QUEUED', 'IN_PROGRESS', 'BLOCKED', 'UNDER_MARKETPLACE_REVIEW', 'COMPLETED', 'PARTIALLY_COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('P1', 'P2', 'P3', 'P4');

-- CreateEnum
CREATE TYPE "PromotionStatus" AS ENUM ('OPPORTUNITY_IDENTIFIED', 'ELIGIBILITY_CHECK', 'ECONOMICS_PENDING', 'PROPOSAL_PREPARED', 'CLIENT_APPROVAL_REQUIRED', 'CLIENT_APPROVED', 'SUBMITTED', 'MARKETPLACE_UNDER_REVIEW', 'APPROVED', 'SCHEDULED', 'ACTIVE', 'REJECTED', 'OPT_OUT_REQUESTED', 'OPT_OUT_PENDING', 'OPTED_OUT', 'EXPIRED', 'RECONCILIATION_REQUIRED', 'CLOSED');

-- CreateEnum
CREATE TYPE "StockSeverity" AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'WATCH', 'HEALTHY');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('REQUESTED', 'APPROVED', 'DECLINED', 'EXPIRED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "type" "UserType" NOT NULL,
    "staffRole" "StaffRole",
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT,
    "emailVerified" TIMESTAMP(3),
    "phoneVerified" TIMESTAMP(3),
    "twoFactorSecret" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "organizationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "brandName" TEXT,
    "gstin" TEXT,
    "pan" TEXT,
    "category" TEXT,
    "contactEmail" TEXT NOT NULL,
    "contactPhone" TEXT NOT NULL,
    "address" TEXT,
    "isSuspended" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "pricePaise" INTEGER NOT NULL,
    "interval" TEXT NOT NULL DEFAULT 'monthly',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanFeature" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "featureKey" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "limitValue" INTEGER,
    "meta" JSONB,

    CONSTRAINT "PlanFeature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "razorpaySubId" TEXT,
    "currentPeriodStart" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "graceUntil" TIMESTAMP(3),
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageCounter" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "featureKey" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "used" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "UsageCounter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "subscriptionId" TEXT,
    "amountPaise" INTEGER NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'INITIATED',
    "razorpayOrderId" TEXT,
    "razorpayPaymentId" TEXT,
    "failureReason" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "paymentId" TEXT,
    "number" TEXT NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "gstPaise" INTEGER NOT NULL,
    "fileKey" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketplaceAccount" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "marketplace" "Marketplace" NOT NULL,
    "sellerId" TEXT,
    "storeName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "lastSyncAt" TIMESTAMP(3),
    "lastError" TEXT,

    CONSTRAINT "MarketplaceAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketplaceCredential" (
    "id" TEXT NOT NULL,
    "marketplaceAccountId" TEXT NOT NULL,
    "encryptedRefreshToken" TEXT NOT NULL,
    "encryptedAccessToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "keyVersion" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketplaceCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brand" TEXT,
    "category" TEXT,
    "sku" TEXT,
    "hsn" TEXT,
    "gstRate" DECIMAL(5,2),
    "mrpPaise" INTEGER,
    "sellingPaise" INTEGER,
    "costPaise" INTEGER,
    "specs" JSONB,
    "variations" JSONB,
    "asin" TEXT,
    "fsn" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ListingRequest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "marketplace" "Marketplace" NOT NULL,
    "status" "ListingStatus" NOT NULL DEFAULT 'RESEARCH_NOT_STARTED',
    "countsTowardQuota" BOOLEAN NOT NULL DEFAULT false,
    "assigneeId" TEXT,
    "payload" JSONB NOT NULL,
    "imageKeys" TEXT[],
    "rejectionNote" TEXT,
    "liveUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ListingRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogMapping" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "marketplace" "Marketplace" NOT NULL,
    "identifier" TEXT NOT NULL,
    "productInfo" JSONB,
    "status" "MappingStatus" NOT NULL DEFAULT 'NOT_ASSESSED',
    "candidateId" TEXT,
    "result" JSONB,
    "assigneeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdCampaign" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "marketplace" "Marketplace" NOT NULL,
    "externalId" TEXT,
    "name" TEXT NOT NULL,
    "dailyBudgetPaise" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "metrics" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdChangeLog" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "previousValue" TEXT,
    "newValue" TEXT,
    "actorId" TEXT,
    "actorType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdChangeLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromotionRequest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "marketplace" "Marketplace" NOT NULL,
    "type" TEXT NOT NULL,
    "details" JSONB NOT NULL,
    "status" "PromotionStatus" NOT NULL DEFAULT 'OPPORTUNITY_IDENTIFIED',
    "approvalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromotionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryRecord" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "marketplace" "Marketplace" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "daysOfCover" DECIMAL(8,2),
    "severity" "StockSeverity",
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabelJob" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "batchDate" TIMESTAMP(3) NOT NULL,
    "marketplace" "Marketplace" NOT NULL,
    "status" "LabelJobStatus" NOT NULL DEFAULT 'QUEUED',
    "orderCount" INTEGER NOT NULL DEFAULT 0,
    "skippedOrders" JSONB,
    "labelFileKey" TEXT,
    "noteFileKey" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "LabelJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ThankYouTemplate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "logoKey" TEXT,
    "brandName" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "colors" JSONB NOT NULL,
    "qrUrl" TEXT,
    "widthMm" INTEGER NOT NULL DEFAULT 100,
    "heightMm" INTEGER NOT NULL DEFAULT 150,
    "approvedAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ThankYouTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "periodMonth" TIMESTAMP(3) NOT NULL,
    "marketplace" "Marketplace",
    "grossSalesPaise" INTEGER,
    "returnsPaise" INTEGER,
    "netSalesPaise" INTEGER,
    "feesPaise" INTEGER,
    "adSpendPaise" INTEGER,
    "cogsPaise" INTEGER,
    "otherExpensesPaise" INTEGER,
    "netProfitPaise" INTEGER,
    "profitConfidence" "FigureConfidence" NOT NULL DEFAULT 'UNAVAILABLE',
    "breakdown" JSONB,
    "pdfKey" TEXT,
    "xlsxKey" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaDocument" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "periodMonth" TIMESTAMP(3) NOT NULL,
    "title" TEXT NOT NULL,
    "fileKey" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "fileKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "scanStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "attachmentKeys" TEXT[],
    "isInternalNote" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportTicket" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "category" "TicketCategory" NOT NULL,
    "marketplace" "Marketplace",
    "subject" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "TicketStatus" NOT NULL DEFAULT 'NEW',
    "priority" "Priority" NOT NULL DEFAULT 'P3',
    "assigneeId" TEXT,
    "createdById" TEXT NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceRequest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "featureKey" TEXT NOT NULL,
    "workflow" TEXT NOT NULL,
    "marketplace" "Marketplace",
    "title" TEXT NOT NULL,
    "details" JSONB NOT NULL,
    "status" "TaskStatus" NOT NULL DEFAULT 'NEW',
    "entitlement" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "requestId" TEXT,
    "stepKey" TEXT,
    "approvalAction" TEXT,
    "title" TEXT NOT NULL,
    "featureKey" TEXT NOT NULL,
    "skill" TEXT NOT NULL,
    "marketplace" "Marketplace",
    "priority" "Priority" NOT NULL DEFAULT 'P3',
    "status" "TaskStatus" NOT NULL DEFAULT 'NEW',
    "entitlement" TEXT NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "requiredInputs" JSONB,
    "dependsOnIds" TEXT[],
    "refId" TEXT,
    "assigneeId" TEXT,
    "dueAt" TIMESTAMP(3),
    "evidence" JSONB,
    "blocker" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Approval" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "taskId" TEXT,
    "actionType" TEXT NOT NULL,
    "parameters" JSONB NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'REQUESTED',
    "requestedById" TEXT NOT NULL,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Approval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketplaceRegistration" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "marketplace" "Marketplace" NOT NULL,
    "registrationStatus" TEXT NOT NULL DEFAULT 'not_started',
    "verificationStatus" TEXT NOT NULL DEFAULT 'not_started',
    "accountStatus" TEXT NOT NULL DEFAULT 'unknown',
    "launchStatus" TEXT NOT NULL DEFAULT 'not_assessed',
    "consentStatus" TEXT NOT NULL DEFAULT 'pending',
    "locations" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketplaceRegistration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrandApproval" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "marketplace" "Marketplace" NOT NULL,
    "brand" TEXT NOT NULL,
    "approvalType" TEXT NOT NULL,
    "clientRelationship" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'intake',
    "evidence" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrandApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManagerAssignment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "managerId" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT true,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "ManagerAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "userId" TEXT,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'IN_APP',
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "actorType" TEXT NOT NULL,
    "organizationId" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

-- CreateIndex
CREATE INDEX "User_organizationId_idx" ON "User"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Plan_code_key" ON "Plan"("code");

-- CreateIndex
CREATE UNIQUE INDEX "PlanFeature_planId_featureKey_key" ON "PlanFeature"("planId", "featureKey");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_razorpaySubId_key" ON "Subscription"("razorpaySubId");

-- CreateIndex
CREATE INDEX "Subscription_organizationId_status_idx" ON "Subscription"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "UsageCounter_organizationId_featureKey_periodStart_key" ON "UsageCounter"("organizationId", "featureKey", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_razorpayOrderId_key" ON "Payment"("razorpayOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_razorpayPaymentId_key" ON "Payment"("razorpayPaymentId");

-- CreateIndex
CREATE INDEX "Payment_organizationId_idx" ON "Payment"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_number_key" ON "Invoice"("number");

-- CreateIndex
CREATE INDEX "Invoice_organizationId_idx" ON "Invoice"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "MarketplaceAccount_organizationId_marketplace_key" ON "MarketplaceAccount"("organizationId", "marketplace");

-- CreateIndex
CREATE UNIQUE INDEX "MarketplaceCredential_marketplaceAccountId_key" ON "MarketplaceCredential"("marketplaceAccountId");

-- CreateIndex
CREATE INDEX "Product_organizationId_idx" ON "Product"("organizationId");

-- CreateIndex
CREATE INDEX "ListingRequest_organizationId_marketplace_status_idx" ON "ListingRequest"("organizationId", "marketplace", "status");

-- CreateIndex
CREATE INDEX "CatalogMapping_organizationId_status_idx" ON "CatalogMapping"("organizationId", "status");

-- CreateIndex
CREATE INDEX "AdCampaign_organizationId_idx" ON "AdCampaign"("organizationId");

-- CreateIndex
CREATE INDEX "PromotionRequest_organizationId_idx" ON "PromotionRequest"("organizationId");

-- CreateIndex
CREATE INDEX "InventoryRecord_organizationId_productId_idx" ON "InventoryRecord"("organizationId", "productId");

-- CreateIndex
CREATE INDEX "LabelJob_organizationId_batchDate_idx" ON "LabelJob"("organizationId", "batchDate");

-- CreateIndex
CREATE UNIQUE INDEX "Report_organizationId_periodMonth_marketplace_key" ON "Report"("organizationId", "periodMonth", "marketplace");

-- CreateIndex
CREATE INDEX "CaDocument_organizationId_periodMonth_idx" ON "CaDocument"("organizationId", "periodMonth");

-- CreateIndex
CREATE INDEX "Document_organizationId_kind_idx" ON "Document"("organizationId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_organizationId_key" ON "Conversation"("organizationId");

-- CreateIndex
CREATE INDEX "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "SupportTicket_organizationId_status_idx" ON "SupportTicket"("organizationId", "status");

-- CreateIndex
CREATE INDEX "SupportTicket_assigneeId_status_idx" ON "SupportTicket"("assigneeId", "status");

-- CreateIndex
CREATE INDEX "ServiceRequest_organizationId_status_idx" ON "ServiceRequest"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Task_organizationId_status_idx" ON "Task"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Task_assigneeId_status_idx" ON "Task"("assigneeId", "status");

-- CreateIndex
CREATE INDEX "Approval_organizationId_status_idx" ON "Approval"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MarketplaceRegistration_organizationId_marketplace_key" ON "MarketplaceRegistration"("organizationId", "marketplace");

-- CreateIndex
CREATE INDEX "BrandApproval_organizationId_idx" ON "BrandApproval"("organizationId");

-- CreateIndex
CREATE INDEX "ManagerAssignment_managerId_idx" ON "ManagerAssignment"("managerId");

-- CreateIndex
CREATE INDEX "ManagerAssignment_organizationId_idx" ON "ManagerAssignment"("organizationId");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE INDEX "AuditLog_organizationId_createdAt_idx" ON "AuditLog"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanFeature" ADD CONSTRAINT "PlanFeature_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageCounter" ADD CONSTRAINT "UsageCounter_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketplaceAccount" ADD CONSTRAINT "MarketplaceAccount_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketplaceCredential" ADD CONSTRAINT "MarketplaceCredential_marketplaceAccountId_fkey" FOREIGN KEY ("marketplaceAccountId") REFERENCES "MarketplaceAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingRequest" ADD CONSTRAINT "ListingRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingRequest" ADD CONSTRAINT "ListingRequest_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogMapping" ADD CONSTRAINT "CatalogMapping_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdCampaign" ADD CONSTRAINT "AdCampaign_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdChangeLog" ADD CONSTRAINT "AdChangeLog_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "AdCampaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionRequest" ADD CONSTRAINT "PromotionRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryRecord" ADD CONSTRAINT "InventoryRecord_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryRecord" ADD CONSTRAINT "InventoryRecord_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabelJob" ADD CONSTRAINT "LabelJob_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ThankYouTemplate" ADD CONSTRAINT "ThankYouTemplate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaDocument" ADD CONSTRAINT "CaDocument_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceRequest" ADD CONSTRAINT "ServiceRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ServiceRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagerAssignment" ADD CONSTRAINT "ManagerAssignment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagerAssignment" ADD CONSTRAINT "ManagerAssignment_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
