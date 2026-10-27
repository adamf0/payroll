import type { APIRoute } from 'astro';
import { getCurrentUser } from '../../../lib/auth';
import { queryAll, queryOne, execute } from '../../../lib/db';
import type { Employee } from '../../../lib/types';

export const GET: APIRoute = async ({ cookies }) => {
  const user = await getCurrentUser(cookies);
  if (!user || user.role !== 'admin') {
    return new Response(JSON.stringify({ error: 'Akses ditolak: Hanya admin' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const employees = await queryAll<Employee>(
    'SELECT * FROM employees ORDER BY id DESC'
  );
  return new Response(JSON.stringify({ success: true, employees }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

export const POST: APIRoute = async ({ request, cookies }) => {
  const user = await getCurrentUser(cookies);
  if (!user || user.role !== 'admin') {
    return new Response(JSON.stringify({ error: 'Akses ditolak: Hanya admin' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const data = await request.json();
    const {
      id,
      nik,
      name,
      phone,
      join_date,
      scheme,
      base_rate,
      payday_rule,
      is_active,
    } = data;

    if (!nik || !name || !scheme) {
      return new Response(JSON.stringify({ error: 'Mohon lengkapi field wajib (NIK, Nama, Sistem Gaji)' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (id) {
      // UPDATE
      await execute(
        `UPDATE employees SET 
          nik = ?, name = ?, phone = ?,
          join_date = ?, scheme = ?, base_rate = ?,
          payday_rule = ?, is_active = ?
         WHERE id = ?`,
        [
          nik, name, phone || '',
          join_date, scheme, Number(base_rate) || 0,
          payday_rule || '25', is_active !== undefined ? Number(is_active) : 1,
          id
        ]
      );

      // Keep user table name in sync
      await execute('UPDATE users SET name = ? WHERE employee_id = ?', [name, id]);

      return new Response(JSON.stringify({ success: true, message: 'Data karyawan berhasil diperbarui' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } else {
      // CREATE
      const existing = await queryOne('SELECT id FROM employees WHERE nik = ?', [nik]);
      if (existing) {
        return new Response(JSON.stringify({ error: 'NIK sudah terdaftar' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const res = await execute(
        `INSERT INTO employees (nik, name, phone, join_date, scheme, base_rate, payday_rule, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          nik, name, phone || '',
          join_date || new Date().toISOString().split('T')[0],
          scheme, Number(base_rate) || 0, payday_rule || '25', 1
        ]
      );

      const empId = res.insertId;
      // Auto-create user login for employee with default password '123'
      const username = nik.toLowerCase().replace(/[^a-z0-9]/g, '');
      const userEmail = `${username}@fermi.io`;
      await execute(
        `INSERT INTO users (username, email, password, name, role, employee_id)
         VALUES (?, ?, '123', ?, 'karyawan', ?)`,
        [username, userEmail, name, empId]
      );

      return new Response(JSON.stringify({ success: true, message: 'Karyawan baru berhasil ditambahkan' }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || 'Gagal menyimpan data karyawan' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

export const DELETE: APIRoute = async ({ request, cookies }) => {
  const user = await getCurrentUser(cookies);
  if (!user || user.role !== 'admin') {
    return new Response(JSON.stringify({ error: 'Akses ditolak: Hanya admin' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  const action = url.searchParams.get('action') || 'delete';

  if (!id) {
    return new Response(JSON.stringify({ error: 'ID karyawan diperlukan' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    if (action === 'deactivate') {
      await execute('UPDATE employees SET is_active = 0 WHERE id = ?', [id]);
      return new Response(JSON.stringify({ success: true, message: 'Karyawan berhasil dinonaktifkan' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (action === 'activate') {
      await execute('UPDATE employees SET is_active = 1 WHERE id = ?', [id]);
      return new Response(JSON.stringify({ success: true, message: 'Karyawan berhasil diaktifkan kembali' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Default: permanent delete
    const emp = await queryOne<Employee>('SELECT name FROM employees WHERE id = ?', [id]);
    if (!emp) {
      return new Response(JSON.stringify({ error: 'Karyawan tidak ditemukan' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    await execute('DELETE FROM users WHERE employee_id = ?', [id]);
    await execute('DELETE FROM attendance WHERE employee_id = ?', [id]);
    await execute('DELETE FROM payroll_settlements WHERE employee_id = ?', [id]);
    await execute('DELETE FROM employees WHERE id = ?', [id]);

    return new Response(JSON.stringify({ success: true, message: `Data karyawan ${emp.name} berhasil dihapus permanen` }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || 'Gagal menghapus karyawan' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
