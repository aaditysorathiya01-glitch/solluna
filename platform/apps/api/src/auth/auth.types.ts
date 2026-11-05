import type { StaffRole, UserType } from '@prisma/client';

export interface AuthUser {
  id: string;
  type: UserType;
  staffRole: StaffRole | null;
  organizationId: string | null;
  email: string;
  name: string;
}
