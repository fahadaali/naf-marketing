import type { Env, User } from './types';
import { newId, nowIso } from './util';

const SESSION_COOKIE = 'naf_session';
const SESSION_DAYS = 14;

export function getSessionToken(req: Request): string | null {
  const cookie = req.headers.get('cookie') || '';
  const match = cookie.match(new RegExp(`(?:^|; )${SESSION_COOKIE}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export function sessionCookie(token: string): string {
  const maxAge = SESSION_DAYS * 24 * 60 * 60;
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

export async function createSession(env: Env, userId: string): Promise<string> {
  const token = newId('sess');
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  await env.DB.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(token, userId, expires)
    .run();
  return token;
}

export async function destroySession(env: Env, token: string): Promise<void> {
  await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(token).run();
}

export async function getUserFromRequest(env: Env, req: Request): Promise<User | null> {
  const token = getSessionToken(req);
  if (!token) return null;
  const row = await env.DB.prepare(
    `SELECT u.id, u.name, u.email, u.role_name, u.is_active, u.created_at, s.expires_at
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id = ?`,
  )
    .bind(token)
    .first<User & { expires_at: string }>();

  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await destroySession(env, token);
    return null;
  }
  if (!row.is_active) return null;
  const { expires_at, ...user } = row;
  return user as User;
}

// عدد المستخدمين — لدعم التهيئة الأولى (bootstrap لأول مدير عام)
export async function userCount(env: Env): Promise<number> {
  const row = await env.DB.prepare('SELECT COUNT(*) AS c FROM users').first<{ c: number }>();
  return row?.c ?? 0;
}

export { nowIso };
