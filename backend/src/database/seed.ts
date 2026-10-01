import { compare, hash } from 'bcryptjs';
import { dataSource } from './data-source';
import { User } from '../users/user.entity';
import { UserRole } from '../users/user-role.enum';

function requiredPassword(key: string): string {
  const value = process.env[key];
  if (!value || value.length < 12) {
    throw new Error(`${key} must have at least 12 characters`);
  }
  return value;
}

async function main(): Promise<void> {
  const accounts = [
    {
      role: UserRole.MANAGER,
      email: (process.env.DEMO_MANAGER_EMAIL ?? 'manager.demo@example.local').trim().toLowerCase(),
      password: requiredPassword('DEMO_MANAGER_PASSWORD'),
    },
    {
      role: UserRole.TECHNICIAN,
      email: (process.env.DEMO_TECHNICIAN_EMAIL ?? 'technician.demo@example.local').trim().toLowerCase(),
      password: requiredPassword('DEMO_TECHNICIAN_PASSWORD'),
    },
  ];

  if (accounts[0].email === accounts[1].email) {
    throw new Error('Demo account emails must be different');
  }

  await dataSource.initialize();
  try {
    const users = dataSource.getRepository(User);
    for (const account of accounts) {
      const existing = await users
        .createQueryBuilder('user')
        .addSelect('user.passwordHash')
        .where('user.email = :email', { email: account.email })
        .getOne();
      if (existing) {
        if (
          existing.role !== account.role ||
          !existing.isActive ||
          !(await compare(account.password, existing.passwordHash))
        ) {
          await users.update(existing.id, {
            role: account.role,
            isActive: true,
            passwordHash: await hash(account.password, 12),
          });
          console.log(`${account.role}: updated`);
        } else {
          console.log(`${account.role}: unchanged`);
        }
        continue;
      }
      await users.insert({
        email: account.email,
        passwordHash: await hash(account.password, 12),
        role: account.role,
        isActive: true,
      });
      console.log(`${account.role}: created`);
    }
  } finally {
    await dataSource.destroy();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Seed failed');
  process.exitCode = 1;
});
