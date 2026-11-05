-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "lastMessageAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "fileName" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "messageId" TEXT,
ADD COLUMN     "sha256" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "title" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "visibility" TEXT NOT NULL DEFAULT 'CLIENT',
ALTER COLUMN "scanStatus" SET DEFAULT 'NOT_SCANNED';

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "senderType" "UserType" NOT NULL DEFAULT 'CUSTOMER';

-- CreateTable
CREATE TABLE "FileBlob" (
    "id" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FileBlob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Document_messageId_idx" ON "Document"("messageId");

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

