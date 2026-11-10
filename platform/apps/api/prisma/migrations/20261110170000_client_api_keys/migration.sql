ALTER TABLE "MarketplaceCredential" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'OAUTH';
ALTER TABLE "MarketplaceCredential" ADD COLUMN "encryptedClientId" TEXT;
ALTER TABLE "MarketplaceCredential" ADD COLUMN "encryptedClientSecret" TEXT;
ALTER TABLE "MarketplaceCredential" ADD COLUMN "lastTestAt" TIMESTAMP(3);
ALTER TABLE "MarketplaceCredential" ADD COLUMN "lastTestOk" BOOLEAN;
ALTER TABLE "MarketplaceCredential" ADD COLUMN "lastTestMessage" TEXT;
