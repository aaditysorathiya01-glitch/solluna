import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { config } from './common/config';
import { PrismaService } from './common/prisma.service';
import { AuditService } from './common/audit.service';
import { AuthGuard } from './auth/auth.guard';
import { AuthService } from './auth/auth.service';
import { AccountController, AdminUsersController, AuthController } from './auth/auth.controller';
import { TicketsService } from './support/tickets.service';
import { OpsTicketsController, TicketsController } from './support/tickets.controller';
import { CatalogService } from './catalog/catalog.service';
import { CatalogController, OpsCatalogController } from './catalog/catalog.controller';
import { FulfilmentService } from './fulfilment/fulfilment.service';
import { FulfilmentController, OpsFulfilmentController } from './fulfilment/fulfilment.controller';
import { AdminService } from './admin/admin.service';
import { AdminController, AdminPaymentsController, PublicController } from './admin/admin.controller';
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
import { ReportsService } from './reports/reports.service';
import { ReportCycleService } from './reports/report-cycle.service';
import { PlImportService } from './reports/pl-import.service';
import { SpApiService } from './connectors/spapi.service';
import { MarketplaceApiService } from './connectors/marketplace-api.service';
import { ManagerAgentService } from './chat/manager-agent.service';
import { AgentEvalsService } from './chat/agent-evals.service';
import { PipelineService } from './chat/pipeline.service';
import { ClientReportsController, OpsDocumentsCaController, OpsReportsController } from './reports/reports.controller';
import { AdminClientsController, ChatController, OpsChatController } from './chat/chat.controller';
import { LabelCropsController } from './labels/label-crops.controller';
import { CatalogFormsController } from './catalog-forms/catalog-forms.controller';
import { CatalogFormsService } from './catalog-forms/catalog-forms.service';
import { ProductLookupService } from './catalog-forms/product-lookup.service';
import { LabelCropsService } from './labels/label-crops.service';

@Module({
  imports: [
    JwtModule.register({ global: true, secret: config.jwtSecret, signOptions: { expiresIn: config.jwtTtl as never } }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: Number(process.env.RATE_LIMIT_PER_MIN ?? 120) }]),
  ],
  controllers: [HealthController, AuthController, AccountController, AdminUsersController, PublicController, AdminController, AdminPaymentsController, TicketsController, OpsTicketsController, CatalogController, OpsCatalogController, FulfilmentController, OpsFulfilmentController, BillingController, FeaturesController, NotificationsController, RequestsController, ApprovalsController, OpsController, DocumentsController, ChatController, OpsChatController, AdminClientsController, ClientReportsController, OpsReportsController, OpsDocumentsCaController, LabelCropsController, CatalogFormsController],
  providers: [
    PrismaService, AuditService, AuthService, RazorpayClient, BillingService, SkillsService, EntitlementsService, DispatcherService, OrchestratorService, AccessService, StorageService, DocumentsService, ChatService, ManagerAgentService, AgentEvalsService, PipelineService, ReportsService, ReportCycleService, PlImportService, SpApiService, MarketplaceApiService, TicketsService, CatalogService, FulfilmentService, AdminService, LabelCropsService, CatalogFormsService, ProductLookupService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}
