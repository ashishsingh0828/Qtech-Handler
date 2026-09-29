import dotenv from 'dotenv';

dotenv.config();

export const env = {
  port: Number(process.env.PORT || 4000),
  databaseUrl: process.env.DATABASE_URL || '',
  jwtSecret: process.env.JWT_SECRET || '',
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  timezone: process.env.APP_TIMEZONE || 'Asia/Kolkata',
  nodeEnv: process.env.NODE_ENV || 'development',
  seedDemo: process.env.SEED_DEMO !== 'false',
  cookieSecure: process.env.COOKIE_SECURE === 'true'
    ? true
    : process.env.COOKIE_SECURE === 'false'
      ? false
      : process.env.NODE_ENV === 'production',
};

export function assertRuntimeConfig() {
  const missing = [];
  if (!env.databaseUrl) missing.push('DATABASE_URL');
  if (!env.jwtSecret || env.jwtSecret.length < 16) missing.push('JWT_SECRET');
  if (missing.length) {
    throw new Error(`Missing required environment: ${missing.join(', ')}`);
  }
}
