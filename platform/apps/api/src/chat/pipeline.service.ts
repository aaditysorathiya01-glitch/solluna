import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomInt } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { decrypt, encrypt } from '../common/crypto';
import { DispatcherService } from '../connectors/dispatcher.service';
import type { AuthUser } from '../auth/auth.types';
import { normalise, PIPELINES, stepsOf, validate, type Marketplace, type PipeStep } from './pipelines';

const OTP_TTL_MIN = Number(process.env.PIPELINE_OTP_TTL_MIN ?? 10);
const PASSWORD_CAPTURE = /\b(?:password|passwd|pwd)\b\s*(?:is|:|=|hai|h)?\s*(\S{6,64})/i;
const OTP_CAPTURE = /(?<![\d])(\d{4,8})(?![\d])/;

type Run = { id: string; organizationId: string; pipeline: string; branch: string; stepIndex: number; data: Prisma.JsonValue; secrets: Prisma.JsonValue; status: string; createdAt: Date };
const branchFor = (pipeline: string, mp: Marketplace, hasAccount: boolean | null) => (pipeline === 'BRAND_APPROVAL' ? `${mp}_BRAND` : pipeline === 'CATALOG_MAPPING' ? `${mp}_MAPPING` : `${mp}_${hasAccount ? 'HAS_ACCOUNT' : 'NEW'}`);
const mpOf = (branch: string) => branch.split('_')[0] as Marketplace;
/** {{date-180}} → the date 180 days ago (Amazon invoice rule), e.g. 13-May-2026. */
const withDates = (t: string) => t.replace(/\{\{date-(\d+)\}\}/g, (_, d) => new Date(Date.now() - Number(d) * 86_400_000).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }).replace(/ /g, '-'));

/**
 * Runs the manager's pipelines (pipelines.ts). Secrets (passwords, bank account numbers) are AES-GCM encrypted and
 * never returned to the model; OTPs are kept encrypted for OTP_TTL_MIN minutes and deleted when the team reads them.
 * The owner allowed OTPs and a temporary password ONLY for new seller-account registration (CLAUDE.md rule 6).
 */
@Injectable()
export class PipelineService {
  constructor(private readonly db: PrismaService, private readonly audit: AuditService, private readonly dispatch: DispatcherService) {}

  active(orgId: string) {
    return this.db.pipelineRun.findMany({ where: { organizationId: orgId, status: 'ACTIVE' }, orderBy: { createdAt: 'asc' } });
  }
  private step(run: Run): PipeStep | undefined { return stepsOf(run.pipeline, run.branch)[run.stepIndex]; }
  private async runFor(orgId: string, pipeline: string, marketplace: string) {
    const run = await this.db.pipelineRun.findFirst({ where: { organizationId: orgId, pipeline, status: 'ACTIVE', branch: { startsWith: `${marketplace}_` } } });
    if (!run) throw new BadRequestException(`No active ${pipeline} pipeline for ${marketplace}. Call start_pipeline first.`);
    return run;
  }

  /** Starts (or returns) a pipeline for one marketplace; known facts are filled in, not asked again. */
  async start(orgId: string, pipeline: string, marketplace: Marketplace, hasAccount: boolean | null) {
    const branch = branchFor(pipeline, marketplace, hasAccount);
    if (!stepsOf(pipeline, branch).length) throw new BadRequestException(`The ${pipeline} pipeline for ${marketplace} is not set up yet. Escalate to the team.`);
    const existing = await this.db.pipelineRun.findFirst({ where: { organizationId: orgId, pipeline, branch: { startsWith: `${marketplace}_` }, status: 'ACTIVE' } });
    if (existing) {
      if (existing.branch === branch) return existing;
      await this.db.pipelineRun.update({ where: { id: existing.id }, data: { status: 'CANCELLED', secrets: Prisma.DbNull } });
    }
    const org = await this.db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { legalName: true, brandName: true, gstin: true, address: true, pincode: true, contactPhone: true } });
    const prefill: Record<string, string> = {};
    for (const s of stepsOf(pipeline, branch)) for (const f of s.fields) {
      const src = f.prefill?.replace('org.', '') as keyof typeof org | undefined;
      // Prefilled values are normalised and checked like client answers; a value that fails is simply asked again.
      if (src && org[src] && !validate(f, String(org[src]))) prefill[f.key] = normalise(f, String(org[src]));
    }
    const run = await this.db.pipelineRun.create({ data: { organizationId: orgId, pipeline, branch, data: prefill } });
    await this.audit.log({ action: 'pipeline.start', entity: 'PipelineRun', entityId: run.id, organizationId: orgId, after: { branch } });
    return run;
  }

  /** Saves one field of the CURRENT step only (the manager cannot fill other steps). */
  async save(orgId: string, pipeline: string, marketplace: string, field: string, value: string) {
    let run = await this.runFor(orgId, pipeline, marketplace);
    const step = this.step(run);
    const f = step?.fields.find((x) => x.key === field);
    if (!step || !f) throw new BadRequestException(`"${field}" is not part of the current step (${step?.title ?? 'none'}). Stay on the current step.`);
    if (step.by === 'team') throw new BadRequestException('This step is done by the SOLLUNA team; you cannot fill it.');
    if (f.kind === 'otp') throw new BadRequestException('OTPs are captured automatically from the client message; do not save them.');
    if (f.kind === 'form') {
      const forms = await this.db.catalogForm.count({ where: { organizationId: orgId, marketplace: mpOf(run.branch), kind: 'MAPPING', createdAt: { gte: run.createdAt } } });
      if (!forms) throw new BadRequestException(f.hint ?? 'No form submitted yet.');
      value = 'yes';
      await this.db.pipelineRun.update({ where: { id: run.id }, data: { data: { ...(run.data as object), forms_count: String(forms) } } });
      run = (await this.db.pipelineRun.findUniqueOrThrow({ where: { id: run.id } }));
    }
    if (f.kind === 'document') {
      const docs = await this.db.document.count({ where: { organizationId: orgId, deletedAt: null, createdAt: { gte: run.createdAt } } });
      if (docs < (f.minDocs ?? 1)) throw new BadRequestException(f.hint ?? 'Ask the client to upload the document here in chat first.');
      value = 'yes';
    }
    const err = validate(f, value);
    if (err) throw new BadRequestException(err);
    if (f.kind === 'secret') return this.saveSecret(run, f.key, normalise(f, value));
    await this.db.pipelineRun.update({ where: { id: run.id }, data: { data: { ...(run.data as object), [f.key]: normalise(f, value) } } });
    return `Saved ${f.label}.`;
  }

  private async saveSecret(run: Run, key: string, value: string) {
    await this.db.pipelineRun.update({ where: { id: run.id }, data: { secrets: { ...((run.secrets as object) ?? {}), [key]: encrypt(value) }, data: { ...(run.data as object), [key]: '(saved, encrypted)' } } });
    await this.audit.log({ action: 'pipeline.secret_saved', entity: 'PipelineRun', entityId: run.id, organizationId: run.organizationId, after: { field: key } });
    return `Saved ${key} securely (hidden).`;
  }

  async generatePassword(orgId: string, marketplace: string) {
    const run = await this.runFor(orgId, 'SELLER_ACCOUNT_REGISTRATION', marketplace);
    if (!this.step(run)?.fields.some((f) => f.generate === 'password')) throw new BadRequestException('A temporary password is only created on the sign-up step.');
    const pick = (s: string) => s[randomInt(s.length)];
    const sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnpqrstuvwxyz', '23456789', '@#$%&*'];
    const chars = [...sets.map(pick), ...Array.from({ length: 10 }, () => pick(sets.join('')))].sort(() => randomInt(3) - 1).join('');
    await this.saveSecret(run, 'password', chars);
    return 'Temporary password created and stored securely (hidden). The client will change it once SOLLUNA has admin access.';
  }

  /** Client step done → next step. Team steps notify the team and wait for them. Finished → secrets deleted. */
  async next(orgId: string, pipeline: string, marketplace: string) {
    const run = await this.runFor(orgId, pipeline, marketplace);
    const step = this.step(run);
    if (!step) throw new BadRequestException('Pipeline already finished.');
    if (step.by === 'team') throw new BadRequestException('This step is done by the SOLLUNA team. Wait for them; tell the client you will update them.');
    const data = run.data as Record<string, string>;
    const missing = step.fields.filter((f) => f.required && !data[f.key]).map((f) => f.label);
    if (missing.length) throw new BadRequestException(`Still needed for this step: ${missing.join(', ')}.`);
    return this.advanceRun(run, null);
  }

  private async advanceRun(run: Run, actor: AuthUser | null) {
    const steps = stepsOf(run.pipeline, run.branch);
    const nextIndex = run.stepIndex + 1;
    if (nextIndex >= steps.length) {
      await this.db.$transaction([
        this.db.pipelineRun.update({ where: { id: run.id }, data: { stepIndex: nextIndex, status: 'DONE', secrets: Prisma.DbNull } }),
        this.db.pipelineOtp.deleteMany({ where: { runId: run.id } }),
      ]);
      await this.audit.log({ actor, action: 'pipeline.done', entity: 'PipelineRun', entityId: run.id, organizationId: run.organizationId, after: { branch: run.branch, secretsDeleted: true } });
      return 'Pipeline complete. Temporary password and OTPs deleted.';
    }
    await this.db.pipelineRun.update({ where: { id: run.id }, data: { stepIndex: nextIndex } });
    const step = steps[nextIndex];
    await this.audit.log({ actor, action: 'pipeline.step', entity: 'PipelineRun', entityId: run.id, organizationId: run.organizationId, after: { step: step.key } });
    if (step.by === 'team') {
      await this.dispatch.notifyStaff({ roles: ['OPERATIONS_MANAGER'], organizationId: run.organizationId, type: 'pipeline.team_step', title: `${PIPELINES[run.pipeline].title}: ${step.title}`, body: `${mpOf(run.branch)} — open the client's chat → Pipelines to do this step.` });
    }
    return `Next step: ${step.title} (${step.by === 'team' ? 'done by the SOLLUNA team' : 'with the client'}).`;
  }

  /**
   * Runs on every client message before the model sees it: during a step that expects an OTP or a password, the code is
   * stored encrypted for the team (the model only ever sees "[hidden by SOLLUNA]").
   */
  async capture(orgId: string, text: string): Promise<('otp' | 'password')[]> {
    const got: ('otp' | 'password')[] = [];
    for (const run of await this.active(orgId)) {
      const step = this.step(run);
      if (!step) continue;
      if (step.fields.some((f) => f.kind === 'otp')) {
        const m = OTP_CAPTURE.exec(text);
        if (m) {
          await this.db.pipelineOtp.create({ data: { runId: run.id, organizationId: orgId, cipher: encrypt(m[1]), expiresAt: new Date(Date.now() + OTP_TTL_MIN * 60_000) } });
          await this.dispatch.notifyStaff({ roles: ['OPERATIONS_MANAGER'], organizationId: orgId, type: 'pipeline.otp', title: `OTP received (${mpOf(run.branch)})`, body: `Valid for ${OTP_TTL_MIN} minutes — open the client's chat → Pipelines → Show OTP. It is deleted once shown.` });
          got.push('otp');
        }
      }
      const pw = PASSWORD_CAPTURE.exec(text);
      if (pw && step.fields.some((f) => f.key === 'password')) { await this.saveSecret(run, 'password', pw[1]); got.push('password'); }
    }
    return got;
  }

  /** Text block for the manager's context: only the current step of each active pipeline. */
  async contextFor(orgId: string) {
    const runs = await this.active(orgId);
    return runs.map((run) => {
      const steps = stepsOf(run.pipeline, run.branch);
      const step = steps[run.stepIndex];
      if (!step) return '';
      const data = run.data as Record<string, string>;
      const fields = step.fields.filter((f) => f.kind !== 'otp').map((f) => `${f.key} (${f.label})${data[f.key] ? ` = ${f.kind === 'secret' ? 'saved, hidden' : data[f.key]}` : f.required ? ' = MISSING' : ' = optional'}`);
      return [
        `Active pipeline: ${PIPELINES[run.pipeline].title} — ${mpOf(run.branch)}${run.pipeline === 'SELLER_ACCOUNT_REGISTRATION' ? ` (${run.branch.endsWith('NEW') ? 'new account' : 'existing account'})` : ''}`,
        `Current step ${run.stepIndex + 1}/${steps.length}: ${step.title} [${step.by === 'team' ? 'SOLLUNA team is doing this' : 'with the client'}]`,
        `Step instructions: ${withDates(step.instructions)}`,
        fields.length ? `Step fields: ${fields.join('; ')}` : '',
        step.by === 'client' ? 'When every required field is saved, call pipeline_next.' : '',
      ].filter(Boolean).join('\n');
    }).filter(Boolean).join('\n\n');
  }

  // ───────── Team (ops panel) ─────────

  async list(orgId: string) {
    const runs = await this.db.pipelineRun.findMany({ where: { organizationId: orgId }, orderBy: { createdAt: 'desc' }, take: 10 });
    // Mapping runs: the forms the client submitted since the run started (what the team maps).
    const forms = await this.db.catalogForm.findMany({ where: { organizationId: orgId, kind: 'MAPPING' }, orderBy: { createdAt: 'desc' }, take: 50, select: { marketplace: true, title: true, data: true, createdAt: true } });
    const otps = await this.db.pipelineOtp.groupBy({ by: ['runId'], where: { organizationId: orgId, expiresAt: { gt: new Date() } }, _count: { _all: true } });
    return runs.map((r) => {
      const steps = stepsOf(r.pipeline, r.branch);
      const st = steps[r.stepIndex];
      return { id: r.id, pipeline: r.pipeline, title: PIPELINES[r.pipeline]?.title ?? r.pipeline, branch: r.branch, status: r.status,
        step: st ? { index: r.stepIndex, total: steps.length, title: st.title, by: st.by, fields: st.by === 'team' ? st.fields.filter((f) => f.kind === 'text').map((f) => ({ key: f.key, label: f.label, required: Boolean(f.required), hint: f.hint ?? null })) : [] } : null,
        forms: r.pipeline === 'CATALOG_MAPPING' ? forms.filter((f) => f.marketplace === mpOf(r.branch) && f.createdAt >= r.createdAt).map((f) => ({ title: f.title, ref: (f.data as Record<string, string>).productRef ?? (f.data as Record<string, string>).productLink, sku: (f.data as Record<string, string>).sellerSku })) : [],
        data: r.data, secretFields: Object.keys((r.secrets as object) ?? {}), otpWaiting: otps.find((o) => o.runId === r.id)?._count._all ?? 0, createdAt: r.createdAt };
    });
  }

  private async teamRun(orgId: string, runId: string) {
    const run = await this.db.pipelineRun.findFirst({ where: { id: runId, organizationId: orgId } });
    if (!run) throw new NotFoundException('Pipeline not found');
    return run;
  }

  /** Team marks its step done. Access verification needs the marketplace account to be CONNECTED (evidence-based). */
  async teamAdvance(user: AuthUser, orgId: string, runId: string, input: unknown = {}) {
    let run = await this.teamRun(orgId, runId);
    const step = this.step(run);
    if (run.status !== 'ACTIVE' || !step) throw new BadRequestException('Pipeline is not active');
    if (step.by !== 'team') throw new BadRequestException('This step is with the client.');
    // The team's own fields for this step (e.g. Flipkart request ID, decision).
    const given = ((input as { fields?: Record<string, unknown> })?.fields ?? {}) as Record<string, unknown>;
    const data = { ...(run.data as Record<string, string>) };
    for (const f of step.fields.filter((x) => x.kind === 'text')) {
      const v = given[f.key] === undefined || given[f.key] === null ? '' : String(given[f.key]).trim();
      if (v) { const err = validate(f, v); if (err) throw new BadRequestException(err); data[f.key] = normalise(f, v); }
      if (f.required && !data[f.key]) throw new BadRequestException(`${f.label} is required`);
    }
    run = await this.db.pipelineRun.update({ where: { id: run.id }, data: { data } });
    if (step.key === 'verify_access') {
      const acct = await this.db.marketplaceAccount.findUnique({ where: { organizationId_marketplace: { organizationId: orgId, marketplace: mpOf(run.branch) } } });
      if (acct?.status !== 'CONNECTED') throw new BadRequestException('Mark the marketplace account Connected (with evidence) first, then finish this step.');
    }
    return { result: await this.advanceRun(run, user) };
  }

  /** One-time OTP read for the team member filling the page; the OTP is deleted as soon as it is shown. */
  async takeOtp(user: AuthUser, orgId: string, runId: string) {
    await this.teamRun(orgId, runId);
    const row = await this.db.pipelineOtp.findFirst({ where: { runId, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' } });
    await this.db.pipelineOtp.deleteMany({ where: { runId } });
    if (!row) throw new NotFoundException('No valid OTP — ask the client to send the new one.');
    await this.audit.log({ actor: user, action: 'pipeline.otp_read', entity: 'PipelineRun', entityId: runId, organizationId: orgId });
    return { otp: decrypt(row.cipher), receivedAt: row.createdAt };
  }

  async reveal(user: AuthUser, orgId: string, runId: string, field: string) {
    if (user.type !== 'STAFF' || !['SUPER_ADMIN', 'OPERATIONS_MANAGER'].includes(user.staffRole ?? '')) throw new ForbiddenException('Only operations managers can view stored secrets');
    const run = await this.teamRun(orgId, runId);
    const blob = ((run.secrets as Record<string, string>) ?? {})[field];
    if (!blob) throw new NotFoundException('Nothing stored for this field');
    await this.audit.log({ actor: user, action: 'pipeline.secret_viewed', entity: 'PipelineRun', entityId: runId, organizationId: orgId, after: { field } });
    return { field, value: decrypt(blob) };
  }

  /** Deletes OTPs past their time (also done on read). */
  sweep() { return this.db.pipelineOtp.deleteMany({ where: { expiresAt: { lte: new Date() } } }); }
}
