const test = require('node:test');
const assert = require('node:assert/strict');
const { Reflector } = require('@nestjs/core');
const { RolesGuard } = require('../dist/auth/roles.guard.js');
const { ROLES_KEY } = require('../dist/auth/roles.decorator.js');
const { UserRole } = require('../dist/users/user-role.enum.js');

function context(role, requiredRoles) {
  const handler = () => undefined;
  if (requiredRoles) Reflect.defineMetadata(ROLES_KEY, requiredRoles, handler);
  return {
    getHandler: () => handler,
    getClass: () => class TestController {},
    switchToHttp: () => ({ getRequest: () => ({ user: role ? { role } : undefined }) }),
  };
}

test('RolesGuard permits the required role', () => {
  const guard = new RolesGuard(new Reflector());
  assert.equal(guard.canActivate(context(UserRole.MANAGER, [UserRole.MANAGER])), true);
});

test('RolesGuard denies a different role and missing user', () => {
  const guard = new RolesGuard(new Reflector());
  assert.equal(guard.canActivate(context(UserRole.TECHNICIAN, [UserRole.MANAGER])), false);
  assert.equal(guard.canActivate(context(undefined, [UserRole.MANAGER])), false);
});

test('RolesGuard permits routes without a role requirement', () => {
  const guard = new RolesGuard(new Reflector());
  assert.equal(guard.canActivate(context(UserRole.TECHNICIAN)), true);
});
