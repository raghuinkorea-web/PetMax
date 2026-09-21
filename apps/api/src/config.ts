const required = (key: string): string => {
  const v = process.env[key];
  if (!v) throw new Error(`Missing required environment variable: ${key}`);
  return v;
};
const num = (key: string, fallback: number): number => {
  const v = process.env[key];
  const n = v === undefined ? NaN : Number(v);
  return Number.isFinite(n) ? n : fallback;
};

export const config = {
  env: process.env.NODE_ENV ?? 'development',
  isProd: process.env.NODE_ENV === 'production',
  port: num('API_PORT', 4000),
  publicUrl: process.env.API_PUBLIC_URL ?? 'http://localhost:4000',
  databaseUrl: required('DATABASE_URL'),
  jwt: {
    accessSecret: required('JWT_ACCESS_SECRET'),
    refreshSecret: required('JWT_REFRESH_SECRET'),
    accessTtlMin: num('ACCESS_TOKEN_TTL_MIN', 30),
    refreshTtlDays: num('REFRESH_TOKEN_TTL_DAYS', 30),
  },
  storage: {
    driver: process.env.STORAGE_DRIVER ?? 'local',
    localPath: process.env.STORAGE_LOCAL_PATH ?? './storage',
    maxUploadBytes: num('MAX_UPLOAD_MB', 10) * 1024 * 1024,
    allowedMime: (process.env.ALLOWED_UPLOAD_MIME ??
      'image/jpeg,image/png,image/webp,application/pdf').split(',').map((s) => s.trim()),
  },
  corsOrigins: (process.env.CORS_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  rateLimit: {
    windowMs: num('RATE_LIMIT_WINDOW_MIN', 15) * 60_000,
    max: num('RATE_LIMIT_MAX', 600),
    loginMax: num('LOGIN_RATE_LIMIT_MAX', 10),
  },
  bcryptRounds: num('BCRYPT_ROUNDS', 12),
} as const;
