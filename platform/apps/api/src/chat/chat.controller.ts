import { Body, Controller, Get, HttpCode, MessageEvent, Param, Post, Query, Sse } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { filter, from, interval, map, merge, Observable, switchMap } from 'rxjs';
import { CurrentUser, CustomerOnly, StaffOnly } from '../auth/decorators';
import type { AuthUser } from '../auth/auth.types';
import { AccessService } from '../common/access.service';
import { ChatService, type ChatEvent } from './chat.service';

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
  constructor(private readonly chat: ChatService, private readonly access: AccessService) {}

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
}

@Controller('admin')
@StaffOnly('SUPER_ADMIN', 'OPERATIONS_MANAGER')
export class AdminClientsController {
  constructor(private readonly chat: ChatService) {}

  @Get('clients') clients() { return this.chat.clients(); }
  @Get('staff') staff() { return this.chat.staff(); }
  @Post('clients/:orgId/managers') assign(@CurrentUser() u: AuthUser, @Param('orgId') orgId: string, @Body() body: unknown) { return this.chat.assignManager(u, orgId, body); }
}
