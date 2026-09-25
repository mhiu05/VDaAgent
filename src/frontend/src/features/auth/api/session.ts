import { z } from 'zod';
import { SessionSchema, SetupSchema, type Role } from '@vda/contracts';
import { api, post } from '../../../lib/http/api-client';

export function getSetup() {
  return api('/setup', SetupSchema);
}

export function getSession() {
  return api('/session', SessionSchema);
}

export function loginWithPassword(body: { email: string; password: string }) {
  return api('/auth/login', SessionSchema, post(body));
}

export function loginWithDevelopmentRole(role: Role) {
  return api('/auth/development-role', SessionSchema, post({ role }));
}

export function logout() {
  return api('/auth/logout', z.unknown(), post({}));
}
