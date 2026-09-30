import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../../../.env') });
dotenv.config({ path: path.resolve(here, '../../.env') });

export const LOCAL_DATABASE_URL = 'postgres://postgres:postgres@localhost:5432/qtech_data_management';

export const env = {
  port: Number(process.env.PORT || 4000),
  databaseUrl: process.env.DATABASE_URL || LOCAL_DATABASE_URL,
  jwtSecret: process.env.JWT_SECRET || (process.env.NODE_ENV === 'production' ? '' : 'local-dev-qtech-secret-16'),
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  timezone: process.env.APP_TIMEZONE || 'Asia/Kolkata',
  nodeEnv: process.env.NODE_ENV || 'development',
  adminEmail: (process.env.ADMIN_EMAIL || '').trim().toLowerCase(),
  adminPassword: process.env.ADMIN_PASSWORD || '',
  adminName: process.env.ADMIN_NAME || 'Administrator',
  cookieSecure: process.env.COOKIE_SECURE === 'true'
    ? true
    : process.env.COOKIE_SECURE === 'false'
      ? false
      : process.env.NODE_ENV === 'production',
};

export function assertRuntimeConfig(): void {
  const missing: string[] = [];
  if (!env.databaseUrl) missing.push('DATABASE_URL');
  if (!env.jwtSecret || env.jwtSecret.length < 16) missing.push('JWT_SECRET');
  if (missing.length) {
    throw new Error(`Missing required environment: ${missing.join(', ')}`);
  }
}
