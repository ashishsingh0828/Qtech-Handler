import { prisma } from '../src/lib/prisma.ts';
import { ensureSchema } from '../src/lib/ensureSchema.ts';
import { bootstrapAdmin } from '../src/bootstrap.ts';

await ensureSchema();
await bootstrapAdmin();
await prisma.$disconnect();
