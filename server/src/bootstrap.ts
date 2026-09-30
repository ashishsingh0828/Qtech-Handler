import bcrypt from 'bcryptjs';
import { prisma } from './lib/prisma.ts';
import { env } from './config/env.ts';

export async function bootstrapAdmin(): Promise<void> {
  const count = await prisma.user.count();
  if (count > 0) return;
  if (!env.adminEmail || env.adminPassword.length < 8) return;
  const passwordHash = await bcrypt.hash(env.adminPassword, 12);
  await prisma.user.create({
    data: {
      email: env.adminEmail,
      name: env.adminName,
      passwordHash,
      role: 'ADMIN',
      isActive: true,
    },
  });
}
