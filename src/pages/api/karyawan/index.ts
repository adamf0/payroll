import type { APIRoute } from 'astro';
import { getCurrentUser } from '../../../lib/auth';
import { queryAll, queryOne, execute } from '../../../lib/db';
import { recordAuditLog } from '../../../lib/audit';
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
      position,
      phone,
      join_date,
      scheme,
      base_rate,
      payday_rule,
      bank_name,
      bank_account_number,
      bank_account_holder,
      fixed_allowance,
      is_active,
    } = data;

    if (!nik || !name || !scheme) {
      return new Response(JSON.stringify({ error: 'Mohon lengkapi field wajib (NIK, Nama, Sistem Gaji)' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const cleanBaseRate = typeof base_rate === 'string' ? Number(base_rate.replace(/\D/g, '')) || 0 : Number(base_rate) || 0;
    const cleanAllowance = typeof fixed_allowance === 'string' ? Number(fixed_allowance.replace(/\D/g, '')) || 0 : Number(fixed_allowance) || 0;

    if (id) {
      // UPDATE
      const oldEmp = await queryOne<Employee>('SELECT * FROM employees WHERE id = ?', [id]);
      if (!oldEmp) {
        return new Response(JSON.stringify({ error: 'Data karyawan tidak ditemukan' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      await execute(
        `UPDATE employees SET 
          nik = ?, name = ?, position = ?, phone = ?,
          join_date = ?, scheme = ?, base_rate = ?,
          payday_rule = ?, bank_name = ?, bank_account_number = ?,
          bank_account_holder = ?, fixed_allowance = ?, is_active = ?
         WHERE id = ?`,
        [
          nik, name, position || null, phone || '',
          join_date, scheme, cleanBaseRate,
          payday_rule || '25', bank_name || null, bank_account_number || null,
          bank_account_holder || null, cleanAllowance,
          is_active !== undefined ? Number(is_active) : 1,
          id
        ]
      );

      // Keep user table name in sync
      await execute('UPDATE users SET name = ? WHERE employee_id = ?', [name, id]);

      await recordAuditLog({
        module: 'karyawan',
        action: 'update',
        record_id: Number(id),
        record_title: `${name} (${nik})`,
        user_id: user.id,
        user_name: user.name,
        old_values: oldEmp,
        new_values: {
          id: Number(id),
          nik,
          name,
          position: position || null,
          phone: phone || '',
          join_date,
          scheme,
          base_rate: cleanBaseRate,
          payday_rule: payday_rule || '25',
          bank_name: bank_name || null,
          bank_account_number: bank_account_number || null,
          bank_account_holder: bank_account_holder || null,
          fixed_allowance: cleanAllowance,
          is_active: is_active !== undefined ? Number(is_active) : 1,
        },
        notes: `Pembaruan data karyawan ${name}`,
      });

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

      const joinDateFinal = join_date || new Date().toISOString().split('T')[0];
      const res = await execute(
        `INSERT INTO employees (nik, name, position, phone, join_date, scheme, base_rate, payday_rule, bank_name, bank_account_number, bank_account_holder, fixed_allowance, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          nik, name, position || null, phone || '',
          joinDateFinal,
          scheme, cleanBaseRate, payday_rule || '25',
          bank_name || null, bank_account_number || null, bank_account_holder || null,
          cleanAllowance, 1
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

      await recordAuditLog({
        module: 'karyawan',
        action: 'create',
        record_id: empId,
        record_title: `${name} (${nik})`,
        user_id: user.id,
        user_name: user.name,
        old_values: null,
        new_values: {
          id: empId,
          nik,
          name,
          position: position || null,
          phone: phone || '',
          join_date: joinDateFinal,
          scheme,
          base_rate: cleanBaseRate,
          payday_rule: payday_rule || '25',
          bank_name: bank_name || null,
          bank_account_number: bank_account_number || null,
          bank_account_holder: bank_account_holder || null,
          fixed_allowance: cleanAllowance,
          is_active: 1,
        },
        notes: `Penambahan karyawan baru ${name}`,
      });

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
    const emp = await queryOne<Employee>('SELECT * FROM employees WHERE id = ?', [id]);
    if (!emp) {
      return new Response(JSON.stringify({ error: 'Karyawan tidak ditemukan' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (action === 'deactivate') {
      await execute('UPDATE employees SET is_active = 0 WHERE id = ?', [id]);
      await recordAuditLog({
        module: 'karyawan',
        action: 'deactivate',
        record_id: Number(id),
        record_title: `${emp.name} (${emp.nik})`,
        user_id: user.id,
        user_name: user.name,
        old_values: { is_active: emp.is_active },
        new_values: { is_active: 0 },
        notes: `Status karyawan ${emp.name} dinonaktifkan`,
      });
      return new Response(JSON.stringify({ success: true, message: 'Karyawan berhasil dinonaktifkan' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (action === 'activate') {
      await execute('UPDATE employees SET is_active = 1 WHERE id = ?', [id]);
      await recordAuditLog({
        module: 'karyawan',
        action: 'activate',
        record_id: Number(id),
        record_title: `${emp.name} (${emp.nik})`,
        user_id: user.id,
        user_name: user.name,
        old_values: { is_active: emp.is_active },
        new_values: { is_active: 1 },
        notes: `Status karyawan ${emp.name} diaktifkan kembali`,
      });
      return new Response(JSON.stringify({ success: true, message: 'Karyawan berhasil diaktifkan kembali' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Default: permanent delete
    await execute('DELETE FROM users WHERE employee_id = ?', [id]);
    await execute('DELETE FROM attendance WHERE employee_id = ?', [id]);
    await execute('DELETE FROM payroll_settlements WHERE employee_id = ?', [id]);
    await execute('DELETE FROM employees WHERE id = ?', [id]);

    await recordAuditLog({
      module: 'karyawan',
      action: 'delete',
      record_id: Number(id),
      record_title: `${emp.name} (${emp.nik})`,
      user_id: user.id,
      user_name: user.name,
      old_values: emp,
      new_values: null,
      notes: `Hapus permanen seluruh data karyawan ${emp.name} (${emp.nik})`,
    });

    return new Response(JSON.stringify({ success: true, message: `Data karyawan ${emp.name} berhasil dihapus permanen` }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || 'Gagal memproses aksi karyawan' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
