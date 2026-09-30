import type { Prisma } from '@prisma/client';

type Tx = Prisma.TransactionClient;

let sequence = 0;

export async function isolate(tx: Tx, label: string, work: () => Promise<void>): Promise<void> {
  const name = `qside_${sequence}`;
  sequence += 1;
  try {
    await tx.$executeRawUnsafe(`SAVEPOINT ${name}`);
    await work();
    await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${name}`);
  } catch (error) {
    console.error(label, error);
    try {
      await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${name}`);
    } catch (rollbackError) {
      console.error(label, rollbackError);
    }
  }
}
