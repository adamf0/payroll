import type { APIRoute } from 'astro';
import { clearSessionCookie } from '../../../lib/auth';

export const ALL: APIRoute = async ({ cookies, redirect }) => {
  clearSessionCookie(cookies);
  return redirect('/login');
};
