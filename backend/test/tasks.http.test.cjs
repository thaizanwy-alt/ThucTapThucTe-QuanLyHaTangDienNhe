const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { ValidationPipe } = require('@nestjs/common');
const { NestFactory } = require('@nestjs/core');
const { JwtService } = require('@nestjs/jwt');
const { DataSource } = require('typeorm');
const { AppModule } = require('../dist/app.module.js');
const { UserRole } = require('../dist/users/user-role.enum.js');
const { User } = require('../dist/users/user.entity.js');

test('Nest starts with real DB and Task/User routes enforce HTTP authentication and roles', async () => {
  const app = await NestFactory.create(AppModule, { logger: ['error'] });
  try {
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    const base = `http://127.0.0.1:${app.getHttpServer().address().port}`;
    const health = await fetch(`${base}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: 'ok', database: 'connected' });
    assert.equal((await fetch(`${base}/users/technicians`)).status, 401);

    const users = app.get(DataSource).getRepository(User);
    const manager = await users.findOneBy({ role: UserRole.MANAGER, isActive: true });
    const technician = await users.findOneBy({ role: UserRole.TECHNICIAN, isActive: true });
    assert.ok(manager && technician, 'local DB needs active demo manager and technician');
    const jwt = app.get(JwtService);
    const bearer = async (user) => ({ Authorization: `Bearer ${await jwt.signAsync({ sub: user.id })}` });

    const managerResponse = await fetch(`${base}/users/technicians`, { headers: await bearer(manager) });
    assert.equal(managerResponse.status, 200);
    const technicianList = await managerResponse.json();
    assert.ok(technicianList.some((entry) => entry.id === technician.id));
    assert.ok(technicianList.every((entry) => Object.keys(entry).sort().join(',') === 'email,id'));
    assert.equal((await fetch(`${base}/users/technicians`, { headers: await bearer(technician) })).status, 403);
    assert.equal((await fetch(`${base}/projects/${randomUUID()}/tasks`, {
      method: 'POST', headers: { ...await bearer(technician), 'Content-Type': 'application/json' }, body: '{}',
    })).status, 403);
    assert.equal((await fetch(`${base}/projects/not-a-uuid/tasks`, { headers: await bearer(manager) })).status, 400);
  } finally {
    await app.close();
  }
});
