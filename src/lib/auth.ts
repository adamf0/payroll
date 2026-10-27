import type { AstroCookies } from 'astro';
import type { User } from './types';
import { queryOne } from './db';

const COOKIE_NAME = 'fermi_session';

export function setSessionCookie(cookies: AstroCookies, user: User) {
  const payload = Buffer.from(JSON.stringify(user)).toString('base64');
  cookies.set(COOKIE_NAME, payload, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7, // 7 days
  });
}

export function clearSessionCookie(cookies: AstroCookies) {
  cookies.delete(COOKIE_NAME, { path: '/' });
}

export async function getCurrentUser(cookies: AstroCookies): Promise<User | null> {
  const cookie = cookies.get(COOKIE_NAME);
  if (!cookie || !cookie.value) return null;

  try {
    const raw = Buffer.from(cookie.value, 'base64').toString('utf8');
    const parsed = JSON.parse(raw) as User;
    if (!parsed || !parsed.id) return null;

    // Verify user still exists in database
    const user = await queryOne<User>(
      'SELECT id, email, name, role, employee_id FROM users WHERE id = ?',
      [parsed.id]
    );
    return user;
  } catch {
    return null;
  }
}
