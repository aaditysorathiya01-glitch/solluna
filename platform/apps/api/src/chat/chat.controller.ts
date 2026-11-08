import { Body, Controller, Get, HttpCode, MessageEvent, Param, Patch, Post, Query, Sse } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { filter, from, interval, map, merge, Observable, switchMap } from 'rxjs';
import { CurrentUser, CustomerOnly, StaffOnly } from '../auth/decorators';
import type { AuthUser } from '../auth/auth.types';
import { AccessService } from '../common/access.service';
import { ChatService, type ChatEvent } from './chat.service';
import { ManagerAgentService } from './manager-agent.service';
import { AgentEvalsService } from './agent-evals.service';
import { PipelineService } from './pipeline.service';

const HEARTBEAT_MS = 25_000;
const heartbeat = () => interval(HEARTBEAT_MS).pipe(map((): MessageEvent => ({ type: 'ping', data: {} })));

/** Client side of Manager Chat Support. */
@Controller('chat')
@CustomerOnly()
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Get() history(@CurrentUser() u: AuthUser, @Query('q') q?: string, @Query('before') before?: string) { return this.chat.history(u, u.organizationId!, { q, before }); }
  @Post('messages') send(@CurrentUser() u: AuthUser, @Body() body: unknown) { return this.chat.send(u, u.organizationId!, body); }
  @Post('read') @HttpCode(200) read(@CurrentUser() u: AuthUser) { return this.chat.markRead(u, u.organizationId!); }

  /** Server-Sent Events: the client's own conversation, internal notes excluded at the source. */
  @Sse('stream') @SkipThrottle()
  stream(@CurrentUser() u: AuthUser): Observable<MessageEvent> {
    const own = this.chat.events.pipe(
      filter((e: ChatEvent) => e.organizationId === u.organizationId && !(e.type === 'message' && e.internal)),
      map((e): MessageEvent => ({ type: e.type, data: e })),
    );
    return merge(own, heartbeat());
  }
}

/** Staff side: inbox, replies, internal notes, routing chat requests to the orchestrator. */
@Controller('ops/chats')
@StaffOnly()
export class OpsChatController {
  constructor(private readonly chat: ChatService, private readonly access: AccessService, private readonly agent: ManagerAgentService, private readonly pipelines: PipelineService) {}

  /** Manager pipelines for this client (seller-account registration / admin access) and the team's actions on them. */
  @Get(':orgId/pipelines') async pipelineList(@CurrentUser() u: AuthUser, @Param('orgId') orgId: string) { await this.access.assertOrg(u, orgId); return this.pipelines.list(orgId); }
  @Post(':orgId/pipelines/:runId/advance') @HttpCode(200) async pipelineAdvance(@CurrentUser() u: AuthUser, @Param('orgId') orgId: string, @Param('runId') runId: string) { await this.access.assertOrg(u, orgId); return this.pipelines.teamAdvance(u, orgId, runId); }
  @Post(':orgId/pipelines/:runId/otp') @HttpCode(200) async pipelineOtp(@CurrentUser() u: AuthUser, @Param('orgId') orgId: string, @Param('runId') runId: string) { await this.access.assertOrg(u, orgId); return this.pipelines.takeOtp(u, orgId, runId); }
  @Post(':orgId/pipelines/:runId/secrets/:field') @HttpCode(200) async pipelineSecret(@CurrentUser() u: AuthUser, @Param('orgId') orgId: string, @Param('runId') runId: string, @Param('field') field: string) { await this.access.assertOrg(u, orgId); return this.pipelines.reveal(u, orgId, runId, field); }

  @Get() inbox(@CurrentUser() u: AuthUser) { return this.chat.inbox(u); }

  @Sse('stream') @SkipThrottle()
  stream(@CurrentUser() u: AuthUser): Observable<MessageEvent> {
    // Access is evaluated per event so new assignments take effect without reconnecting.
    const events = this.chat.events.pipe(
      switchMap((e: ChatEvent) => from(this.access.canAccessOrg(u, e.organizationId).then((ok) => (ok ? e : null)))),
      filter((e): e is ChatEvent => e !== null),
      map((e): MessageEvent => ({ type: e.type, data: e })),
    );
    return merge(events, heartbeat());
  }

  @Get(':orgId') history(@CurrentUser() u: AuthUser, @Param('orgId') orgId: string, @Query('q') q?: string, @Query('before') before?: string) { return this.chat.history(u, orgId, { q, before }); }
  @Post(':orgId/messages') send(@CurrentUser() u: AuthUser, @Param('orgId') orgId: string, @Body() body: unknown) { return this.chat.send(u, orgId, body); }
  @Post(':orgId/read') @HttpCode(200) read(@CurrentUser() u: AuthUser, @Param('orgId') orgId: string) { return this.chat.markRead(u, orgId); }
  @Post(':orgId/requests') createRequest(@CurrentUser() u: AuthUser, @Param('orgId') orgId: string, @Body() body: unknown) { return this.chat.createRequest(u, orgId, body); }

  /** Manager agent for this client: on/off (team takes over) and what it has saved. */
  @Get(':orgId/agent') async agentState(@CurrentUser() u: AuthUser, @Param('orgId') orgId: string) {
    await this.access.assertOrg(u, orgId);
    const conv = await this.chat.conversationState(orgId);
    return { enabled: this.agent.enabled, paused: conv.agentPaused, memory: await this.agent.memory(orgId) };
  }
  @Patch(':orgId/agent') async agentPause(@CurrentUser() u: AuthUser, @Param('orgId') orgId: string, @Body() b: { paused?: boolean }) {
    await this.access.assertOrg(u, orgId);
    return this.agent.setPaused(orgId, b?.paused === true);
  }
}

@Controller('admin')
@StaffOnly('SUPER_ADMIN', 'OPERATIONS_MANAGER')
export class AdminClientsController {
  constructor(private readonly chat: ChatService, private readonly agent: ManagerAgentService, private readonly evals: AgentEvalsService) {}

  /** Manager quality check (eval set) on the server's own API key. Super admin only. */
  @Post('agent-evals') @StaffOnly('SUPER_ADMIN') startEvals(@CurrentUser() u: AuthUser) { return this.evals.start(u); }
  @Get('agent-evals') listEvals() { return this.evals.list(); }
  @Get('agent-evals/:id') getEval(@Param('id') id: string) { return this.evals.get(id); }

  /** Manager-agent spend per client for a month (estimate from tokens). */
  @Get('agent-usage') agentUsage(@Query('month') month?: string) { return this.agent.usage(month); }

  @Get('clients') clients() { return this.chat.clients(); }
  @Get('staff') staff() { return this.chat.staff(); }
  @Post('clients/:orgId/managers') assign(@CurrentUser() u: AuthUser, @Param('orgId') orgId: string, @Body() body: unknown) { return this.chat.assignManager(u, orgId, body); }
}
