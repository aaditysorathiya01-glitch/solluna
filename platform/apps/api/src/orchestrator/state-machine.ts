import type { TaskStatus } from '@prisma/client';

/**
 * Staff-driven transitions. System-only states:
 *  NEW (waiting on dependencies), AWAITING_CLIENT_APPROVAL (set/cleared by approvals), PLAN_VERIFICATION.
 */
export const STAFF_TRANSITIONS: Partial<Record<TaskStatus, TaskStatus[]>> = {
  QUEUED: ['IN_PROGRESS', 'AWAITING_INFORMATION', 'BLOCKED', 'CANCELLED'],
  IN_PROGRESS: ['AWAITING_INFORMATION', 'UNDER_MARKETPLACE_REVIEW', 'BLOCKED', 'COMPLETED', 'PARTIALLY_COMPLETED', 'CANCELLED'],
  AWAITING_INFORMATION: ['IN_PROGRESS', 'CANCELLED'],
  UNDER_MARKETPLACE_REVIEW: ['IN_PROGRESS', 'COMPLETED', 'PARTIALLY_COMPLETED', 'BLOCKED'],
  BLOCKED: ['QUEUED', 'CANCELLED'],
};

export const TERMINAL: TaskStatus[] = ['COMPLETED', 'PARTIALLY_COMPLETED', 'CANCELLED'];
export const isTerminal = (s: TaskStatus) => TERMINAL.includes(s);
