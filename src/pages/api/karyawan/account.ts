import type { APIRoute } from 'astro';
import { getCurrentUser } from '../../../lib/auth';
import { queryOne, execute } from '../../../lib/db';
import type { Employee, User } from '../../../lib/types';

export const POST: APIRoute = async ({ request, cookies }) => {
  const admin = await getCurrentUser(cookies);
  if (!admin || admin.role !== 'admin') {
    return new Response(JSON.stringify({ error: 'Akses ditolak: Hanya admin yang dapat mengelola akun' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const data = await request.json();
    const { employee_id, username, email, password } = data;

    if (!employee_id) {
      return new Response(JSON.stringify({ error: 'ID Karyawan wajib diisi' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const cleanUsername = (username || '').trim().toLowerCase();
    const cleanEmail = (email || '').trim().toLowerCase();
    const cleanPassword = (password || '').trim();

    if (!cleanUsername || !cleanEmail) {
      return new Response(JSON.stringify({ error: 'Username dan email wajib diisi' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Pastikan karyawan valid
    const employee = await queryOne<Employee>('SELECT * FROM employees WHERE id = ?', [employee_id]);
    if (!employee) {
      return new Response(JSON.stringify({ error: 'Data karyawan tidak ditemukan' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Cek duplikasi username pada user lain
    const existingUsername = await queryOne<User>(
      'SELECT id FROM users WHERE LOWER(username) = ? AND (employee_id IS NULL OR employee_id != ?)',
      [cleanUsername, employee_id]
    );
    if (existingUsername) {
      return new Response(JSON.stringify({ error: `Username "${cleanUsername}" sudah digunakan oleh akun lain` }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Cek duplikasi email pada user lain
    const existingEmail = await queryOne<User>(
      'SELECT id FROM users WHERE LOWER(email) = ? AND (employee_id IS NULL OR employee_id != ?)',
      [cleanEmail, employee_id]
    );
    if (existingEmail) {
      return new Response(JSON.stringify({ error: `Email "${cleanEmail}" sudah digunakan oleh akun lain` }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Cek apakah akun untuk employee_id ini sudah ada
    const user = await queryOne<User>('SELECT id FROM users WHERE employee_id = ?', [employee_id]);

    if (user) {
      // UPDATE akun yang ada
      if (cleanPassword) {
        await execute(
          'UPDATE users SET username = ?, email = ?, password = ?, name = ? WHERE id = ?',
          [cleanUsername, cleanEmail, cleanPassword, employee.name, user.id]
        );
      } else {
        await execute(
          'UPDATE users SET username = ?, email = ?, name = ? WHERE id = ?',
          [cleanUsername, cleanEmail, employee.name, user.id]
        );
      }

      return new Response(
        JSON.stringify({
          success: true,
          message: `Akun login untuk ${employee.name} (@${cleanUsername}) berhasil diperbarui`,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    } else {
      // CREATE akun baru
      const pwd = cleanPassword || '123';
      await execute(
        'INSERT INTO users (username, email, password, name, role, employee_id) VALUES (?, ?, ?, ?, ?, ?)',
        [cleanUsername, cleanEmail, pwd, employee.name, 'karyawan', employee_id]
      );

      return new Response(
        JSON.stringify({
          success: true,
          message: `Akun login baru untuk ${employee.name} (@${cleanUsername}) berhasil dibuat`,
        }),
        {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || 'Gagal menyimpan akun karyawan' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
