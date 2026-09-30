import type { Prisma } from '@prisma/client';
import { publish } from './events.ts';
import { isolate } from './sideEffect.ts';

type Tx = Prisma.TransactionClient;

export async function userIdsByRole(tx: Tx, roles: string[]): Promise<string[]> {
  const users = await tx.user.findMany({
    where: { role: { in: roles }, isActive: true },
    select: { id: true },
  });
  return users.map((user) => user.id);
}

export async function notifyUsers(tx: Tx, input: {
  userIds: string[];
  actorId: string;
  type: string;
  message: string;
  rowId?: string | null;
  datasetId?: string | null;
  priority?: 'NORMAL' | 'HIGH';
}): Promise<void> {
  await isolate(tx, 'notification', async () => {
    const since = new Date(Date.now() - 60_000);
    const unique = [...new Set(input.userIds)].filter((id) => id && id !== input.actorId);
    for (const userId of unique) {
      if (input.rowId) {
        const recent = await tx.notification.findFirst({
          where: {
            userId,
            actorId: input.actorId,
            rowId: input.rowId,
            type: input.type,
            createdAt: { gte: since },
          },
        });
        if (recent) continue;
      }
      await tx.notification.create({
        data: {
          actorId: input.actorId,
          type: input.type,
          message: input.message,
          rowId: input.rowId || null,
          priority: input.priority || 'NORMAL',
          user: { connect: { id: userId } },
          ...(input.datasetId ? { dataset: { connect: { id: input.datasetId } } } : {}),
        },
      });
    }
  });
}

export function emit(type: string, datasetId: string | null, rowId: string | null, actorId: string): void {
  try {
    publish({ type, datasetId, rowId, actorId });
  } catch (error) {
    console.error('sse', error);
  }
}
