-- AlterTable
ALTER TABLE "CatalogMapping" ADD COLUMN     "note" TEXT,
ADD COLUMN     "sellerSku" TEXT,
ADD COLUMN     "serviceRequestId" TEXT;

-- AlterTable
ALTER TABLE "InventoryRecord" ADD COLUMN     "acknowledgedAt" TIMESTAMP(3),
ADD COLUMN     "avgDailySales" DECIMAL(10,2),
ADD COLUMN     "dataAsOf" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "inboundUnits" INTEGER,
ADD COLUMN     "recordedById" TEXT,
ADD COLUMN     "sku" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "snapshotId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "LabelJob" ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "dispatchBy" TIMESTAMP(3),
ADD COLUMN     "downloadedAt" TIMESTAMP(3),
ADD COLUMN     "labelDocumentId" TEXT,
ADD COLUMN     "note" TEXT,
ADD COLUMN     "noteCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "noteTemplateId" TEXT;

-- AlterTable
ALTER TABLE "ListingRequest" ADD COLUMN     "catalogId" TEXT,
ADD COLUMN     "history" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "serviceRequestId" TEXT;

-- AlterTable
ALTER TABLE "MarketplaceAccount" ADD COLUMN     "contactEmail" TEXT,
ADD COLUMN     "hasAccount" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "verifiedById" TEXT,
ADD COLUMN     "verifiedNote" TEXT;

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "onboardedAt" TIMESTAMP(3),
ADD COLUMN     "suspendedReason" TEXT;

-- AlterTable
ALTER TABLE "SupportTicket" ADD COLUMN     "firstResponseAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ThankYouTemplate" ADD COLUMN     "approvedById" TEXT,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "name" TEXT NOT NULL DEFAULT 'Thank you note',
ADD COLUMN     "revisionNote" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'DRAFT',
ADD COLUMN     "supportContact" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "lastLoginAt" TIMESTAMP(3),
ADD COLUMN     "passwordChangedAt" TIMESTAMP(3),
ADD COLUMN     "twoFactorEnabledAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "TicketComment" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "authorId" TEXT,
    "authorType" TEXT NOT NULL,
    "authorName" TEXT NOT NULL DEFAULT '',
    "body" TEXT NOT NULL,
    "internal" BOOLEAN NOT NULL DEFAULT false,
    "statusFrom" "TicketStatus",
    "statusTo" "TicketStatus",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactInquiry" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "business" TEXT,
    "topic" TEXT NOT NULL DEFAULT 'GENERAL',
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "handledById" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactInquiry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TicketComment_ticketId_createdAt_idx" ON "TicketComment"("ticketId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AuthToken_tokenHash_key" ON "AuthToken"("tokenHash");

-- CreateIndex
CREATE INDEX "AuthToken_userId_purpose_idx" ON "AuthToken"("userId", "purpose");

-- CreateIndex
CREATE INDEX "ContactInquiry_status_createdAt_idx" ON "ContactInquiry"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ThankYouTemplate_organizationId_status_idx" ON "ThankYouTemplate"("organizationId", "status");

-- AddForeignKey
ALTER TABLE "TicketComment" ADD CONSTRAINT "TicketComment_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

