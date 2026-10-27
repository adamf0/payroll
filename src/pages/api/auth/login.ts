import type { APIRoute } from 'astro';
import { queryOne } from '../../../lib/db';
import { setSessionCookie } from '../../../lib/auth';
import type { User } from '../../../lib/types';

export const POST: APIRoute = async ({ request, cookies }) => {
  try {
    const data = await request.json();
    const { email, password } = data;

    if (!email || !password) {
      return new Response(JSON.stringify({ error: 'Email dan password wajib diisi' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const user = await queryOne<User & { password?: string }>(
      `SELECT id, username, email, password, name, role, employee_id 
       FROM users 
       WHERE LOWER(email) = LOWER(?) OR LOWER(COALESCE(username, '')) = LOWER(?)`,
      [email.trim(), email.trim()]
    );

    if (!user || user.password !== password) {
      return new Response(JSON.stringify({ error: 'Email/Username atau kata sandi salah' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const sessionUser: User = {
      id: user.id,
      username: user.username,
      email: user.email,
      name: user.name,
      role: user.role,
      employee_id: user.employee_id,
    };

    setSessionCookie(cookies, sessionUser);

    const redirectUrl = user.role === 'admin' ? '/admin' : '/karyawan/dashboard';

    return new Response(JSON.stringify({ success: true, user: sessionUser, redirectUrl }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || 'Terjadi kesalahan sistem' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
