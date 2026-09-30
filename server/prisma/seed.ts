import { prisma } from '../src/lib/prisma.ts';
import { ensureSchema } from '../src/lib/ensureSchema.ts';
import { bootstrapPresetUsers } from '../src/bootstrap.ts';

await ensureSchema();
await bootstrapPresetUsers();
await prisma.$disconnect();
