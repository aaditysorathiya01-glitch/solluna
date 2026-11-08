import { ConflictException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import type { AuthUser } from '../auth/auth.types';

/**
 * Runs the manager-agent eval set (apps/api/evals) on the server with the server's own ANTHROPIC_API_KEY, so the key
 * never leaves the environment. Started from Admin → Manager cost; runs as a background child process, never inside
 * the HTTP request. One run at a time; a full run costs a few US cents on Claude Haiku 5.5.
 */
const RUNNER = join(__dirname, '..', '..', '..', '..', '..', 'evals', 'run-manager-evals.mjs'); // apps/api/dist/apps/api/src/chat → apps/api/evals

@Injectable()
export class AgentEvalsService {
  private readonly log = new Logger('AgentEvals');
  constructor(private readonly db: PrismaService, private readonly audit: AuditService) {}

  async start(user: AuthUser) {
    if (!process.env.ANTHROPIC_API_KEY) throw new ServiceUnavailableException('Add ANTHROPIC_API_KEY on the server first.');
    const running = await this.db.evalRun.findFirst({ where: { status: 'RUNNING', createdAt: { gte: new Date(Date.now() - 20 * 60_000) } } });
    if (running) throw new ConflictException('A quality check is already running.');
    const run = await this.db.evalRun.create({ data: { startedById: user.id } });
    await this.audit.log({ actor: user, action: 'agent.evals_started', entity: 'EvalRun', entityId: run.id });
    execFile(process.execPath, [RUNNER], { env: process.env, timeout: 15 * 60_000, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      this.finish(run.id, stdout, err ? `${err.message}\n${stderr}`.slice(0, 2000) : null).catch((e) => this.log.error(e));
    });
    return run;
  }

  private async finish(id: string, stdout: string, error: string | null) {
    const file = /Report: (.+\.json)/.exec(stdout)?.[1];
    if (!file) { await this.db.evalRun.update({ where: { id }, data: { status: 'FAILED', error: error ?? 'No report produced', finishedAt: new Date() } }); return; }
    const report = JSON.parse(await readFile(file, 'utf8'));
    await this.db.evalRun.update({ where: { id }, data: {
      status: 'DONE', model: report.model, score: report.score, passed: report.passed, total: report.total,
      costMicroUsd: Math.round((report.costUsd ?? 0) * 1e6), report: report as Prisma.InputJsonValue, finishedAt: new Date(),
    } });
  }

  list() {
    return this.db.evalRun.findMany({ orderBy: { createdAt: 'desc' }, take: 10, select: { id: true, status: true, model: true, score: true, passed: true, total: true, costMicroUsd: true, error: true, createdAt: true, finishedAt: true } });
  }

  async get(id: string) {
    const r = await this.db.evalRun.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('Run not found');
    return r;
  }
}
