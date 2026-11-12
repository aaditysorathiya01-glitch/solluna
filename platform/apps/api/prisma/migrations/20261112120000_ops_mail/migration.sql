CREATE TABLE "OpsMail" (
    "id" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fromAddr" TEXT NOT NULL,
    "toAddr" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "marketplace" TEXT,
    "bodyCipher" TEXT NOT NULL,
    "otpCipher" TEXT,
    "otpExpiresAt" TIMESTAMP(3),
    CONSTRAINT "OpsMail_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "OpsMail_receivedAt_idx" ON "OpsMail"("receivedAt");
