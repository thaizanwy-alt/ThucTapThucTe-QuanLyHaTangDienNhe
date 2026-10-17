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
const { withDisposableHttpDb } = require('./disposable-http-db.cjs');

test('Nest starts with real DB and Task/User routes enforce HTTP authentication and roles', async () => {
  await withDisposableHttpDb('taskshttp', async () => {
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
    const { randomBytes } = require('node:crypto');
    const manager = await users.save(users.create({ email: 'manager@tasks-http.invalid', role: UserRole.MANAGER, isActive: true, passwordHash: randomBytes(32).toString('hex') }));
    const technician = await users.save(users.create({ email: 'technician@tasks-http.invalid', role: UserRole.TECHNICIAN, isActive: true, passwordHash: randomBytes(32).toString('hex') }));
    const jwt = app.get(JwtService);
    const bearer = async (user) => ({ Authorization: `Bearer ${await jwt.signAsync({ sub: user.id, authVersion: user.authVersion })}` });

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
});
