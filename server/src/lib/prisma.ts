import { PrismaClient } from '@prisma/client';
import { env } from '../config/env.ts';

function databaseUrl(): string {
  const url = env.databaseUrl;
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
      parsed.searchParams.set('sslmode', 'disable');
      return parsed.toString();
    }
  } catch {
    return url;
  }
  return url;
}

export const prisma = new PrismaClient({
  datasources: { db: { url: databaseUrl() } },
});
