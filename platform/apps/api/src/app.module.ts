import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { config } from './common/config';
import { PrismaService } from './common/prisma.service';
import { AuditService } from './common/audit.service';
import { AuthGuard } from './auth/auth.guard';
import { AuthService } from './auth/auth.service';
import { AdminUsersController, AuthController } from './auth/auth.controller';
import { RazorpayClient } from './billing/razorpay.client';
import { BillingService } from './billing/billing.service';
import { BillingController } from './billing/billing.controller';
import { SkillsService } from './features/skills.service';
import { EntitlementsService } from './features/entitlements.service';
import { FeaturesController } from './features/features.controller';
import { DispatcherService } from './connectors/dispatcher.service';
import { NotificationsController } from './connectors/notifications.controller';
import { OrchestratorService } from './orchestrator/orchestrator.service';
import { ApprovalsController, OpsController, RequestsController } from './orchestrator/orchestrator.controller';
import { HealthController } from './health.controller';
import { AccessService } from './common/access.service';
import { StorageService } from './documents/storage.service';
import { DocumentsService } from './documents/documents.service';
import { DocumentsController } from './documents/documents.controller';
import { ChatService } from './chat/chat.service';
import { AdminClientsController, ChatController, OpsChatController } from './chat/chat.controller';

@Module({
  imports: [
    JwtModule.register({ global: true, secret: config.jwtSecret, signOptions: { expiresIn: config.jwtTtl as never } }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: Number(process.env.RATE_LIMIT_PER_MIN ?? 120) }]),
  ],
  controllers: [HealthController, AuthController, AdminUsersController, BillingController, FeaturesController, NotificationsController, RequestsController, ApprovalsController, OpsController, DocumentsController, ChatController, OpsChatController, AdminClientsController],
  providers: [
    PrismaService, AuditService, AuthService, RazorpayClient, BillingService, SkillsService, EntitlementsService, DispatcherService, OrchestratorService, AccessService, StorageService, DocumentsService, ChatService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}
