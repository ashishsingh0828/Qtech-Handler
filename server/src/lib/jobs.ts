import cron from 'node-cron';
import { Prisma } from '@prisma/client';
import { prisma } from './prisma.ts';
import { env } from '../config/env.ts';
import { todayInZone, addDays } from '../../../shared/dates.ts';
import { deriveRecord } from '../../../shared/metrics.ts';
import { asCells } from './present.ts';
import { publish } from './events.ts';

async function claim(key: string): Promise<boolean> {
  try {
    await prisma.jobMark.create({ data: { dedupeKey: key } });
    return true;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return false;
    throw error;
  }
}

export async function runDailyJobs(now = new Date()): Promise<void> {
  const today = todayInZone(env.timezone, now);
  const week = addDays(today, 3);
  const managers = await prisma.user.findMany({ where: { role: 'MANAGER', isActive: true }, select: { id: true } });
  const services = await prisma.user.findMany({ where: { role: 'SERVICE', isActive: true }, select: { id: true } });
  const datasets = await prisma.dataset.findMany({ select: { id: true, name: true } });
  for (const dataset of datasets) {
    const rows = await prisma.row.findMany({ where: { datasetId: dataset.id } });
    let overdueValidation = 0;
    for (const row of rows) {
      const derived = deriveRecord(asCells(row.data), today, row.amcStatus);
      const label = row.customerName || row.serialNo || 'Record';
      if (derived.validationOverdue && row.assignedValidatorId) {
        overdueValidation += 1;
        if (await claim(`validation:${row.id}:${today}`)) {
          await prisma.notification.create({
            data: {
              type: 'validation_overdue',
              message: `${label} is overdue for validation.`,
              rowId: row.id,
              priority: 'HIGH',
              user: { connect: { id: row.assignedValidatorId } },
              dataset: { connect: { id: dataset.id } },
            },
          });
        }
      }
      const serviceTargets = row.assignedServiceId ? [row.assignedServiceId] : services.map((user) => user.id);
      if (derived.pmsOverdue || (derived.nextDuePms.date && derived.nextDuePms.date <= week && derived.nextDuePms.date >= today)) {
        if (await claim(`pms:${row.id}:${today}`)) {
          for (const userId of serviceTargets) {
            await prisma.notification.create({
              data: {
                type: 'pms_due',
                message: derived.pmsOverdue ? `${label} has an overdue PMS visit.` : `${label} has a PMS visit within 3 days.`,
                rowId: row.id,
                priority: derived.pmsOverdue ? 'HIGH' : 'NORMAL',
                user: { connect: { id: userId } },
                dataset: { connect: { id: dataset.id } },
              },
            });
          }
        }
      }
      if (derived.followupDue && await claim(`followup:${row.id}:${today}`)) {
        for (const userId of serviceTargets) {
          await prisma.notification.create({
            data: {
              type: 'followup_due',
              message: `${label} has a follow-up due today.`,
              rowId: row.id,
              priority: 'NORMAL',
              user: { connect: { id: userId } },
              dataset: { connect: { id: dataset.id } },
            },
          });
        }
      }
      if (derived.expiringSoon && !derived.warrantyExpired && await claim(`warranty:${row.id}:${today}`)) {
        for (const userId of serviceTargets) {
          await prisma.notification.create({
            data: {
              type: 'warranty_expiring',
              message: `${label} warranty expires within 30 days.`,
              rowId: row.id,
              priority: 'NORMAL',
              user: { connect: { id: userId } },
              dataset: { connect: { id: dataset.id } },
            },
          });
        }
      }
    }
    if (overdueValidation && await claim(`digest:${dataset.id}:${today}`)) {
      for (const manager of managers) {
        await prisma.notification.create({
          data: {
            type: 'validation_digest',
            message: `${dataset.name}: ${overdueValidation} validation${overdueValidation === 1 ? '' : 's'} overdue.`,
            priority: 'HIGH',
            user: { connect: { id: manager.id } },
            dataset: { connect: { id: dataset.id } },
          },
        });
      }
    }
  }
  publish({ type: 'digest', datasetId: null, rowId: null, actorId: 'system' });
}

export function startJobs(): void {
  cron.schedule('0 9 * * *', () => {
    runDailyJobs().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'job failed';
      console.error('Daily job failed', message);
    });
  }, { timezone: env.timezone });
}
