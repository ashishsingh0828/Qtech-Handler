import { PRESET_USERS } from '../../shared/presets.ts';
import { prisma } from './lib/prisma.ts';

export async function bootstrapPresetUsers(): Promise<void> {
  for (const preset of PRESET_USERS) {
    await prisma.user.upsert({
      where: { email: preset.email },
      update: { name: preset.name, role: preset.role, isActive: true },
      create: {
        email: preset.email,
        name: preset.name,
        role: preset.role,
        isActive: true,
        passwordHash: '',
      },
    });
  }
  await prisma.$executeRaw`UPDATE users SET is_active = active`;
  console.log(`Preset accounts ready: ${PRESET_USERS.map((preset) => preset.email).join(', ')}`);
}
