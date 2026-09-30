import bcrypt from 'bcryptjs';
import { PRESET_USERS } from '../../shared/presets.ts';
import { prisma } from './lib/prisma.ts';

export async function bootstrapPresetUsers(): Promise<void> {
  for (const preset of PRESET_USERS) {
    const passwordHash = await bcrypt.hash(preset.password, 12);
    await prisma.user.upsert({
      where: { email: preset.email },
      update: {
        name: preset.name,
        role: preset.role,
        passwordHash,
        isActive: true,
      },
      create: {
        email: preset.email,
        name: preset.name,
        passwordHash,
        role: preset.role,
        isActive: true,
      },
    });
  }
}
