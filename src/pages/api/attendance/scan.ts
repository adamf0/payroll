import type { APIRoute } from 'astro';
import { validateAttendanceToken } from '../../../lib/qr';
import { getCurrentUser } from '../../../lib/auth';
import { queryOne, execute } from '../../../lib/db';
import type { Employee, AttendanceRecord } from '../../../lib/types';
import { getJakartaNow } from '../../../lib/payroll';

export const POST: APIRoute = async ({ request, cookies }) => {
  try {
    const data = await request.json();
    const { token, employee_id, identifier } = data;

    if (!token) {
      return new Response(JSON.stringify({ error: 'Token QR diperlukan' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 1. Anti-cheat token validation
    const isValid = validateAttendanceToken(token);
    if (!isValid) {
      return new Response(
        JSON.stringify({
          error: 'QR Code tidak valid atau sudah kedaluwarsa. Silakan scan QR terbaru yang tampil di layar utama.',
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // 2. Resolve employee ID
    let targetEmployeeId: number | null = null;
    const sessionUser = await getCurrentUser(cookies);

    if (sessionUser && sessionUser.employee_id) {
      targetEmployeeId = sessionUser.employee_id;
    } else if (employee_id) {
      targetEmployeeId = Number(employee_id);
    } else if (identifier) {
      // Find employee by NIK
      const emp = await queryOne<Employee>(
        'SELECT id FROM employees WHERE NIK = ?',
        [identifier.trim()]
      );
      if (emp) targetEmployeeId = emp.id;
    }

    if (!targetEmployeeId) {
      return new Response(
        JSON.stringify({
          error: 'Karyawan tidak ditemukan. Masukkan NIK atau login terlebih dahulu.',
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    const employee = await queryOne<Employee>(
      'SELECT id, name, nik, scheme FROM employees WHERE id = ? AND is_active = 1',
      [targetEmployeeId]
    );

    if (!employee) {
      return new Response(JSON.stringify({ error: 'Data karyawan tidak aktif atau tidak terdaftar' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 3. Check today's record with Asia/Jakarta (WIB) timezone
    const { dateStr, timeStr, hour, minute } = getJakartaNow();

    const todayRecord = await queryOne<AttendanceRecord>(
      'SELECT * FROM attendance WHERE employee_id = ? AND date = ?',
      [employee.id, dateStr]
    );

    if (!todayRecord) {
      // CHECK IN
      const isLate = hour > 8 || (hour === 8 && minute > 30);
      const status = isLate ? 'terlambat' : 'hadir';

      await execute(
        `INSERT INTO attendance (employee_id, date, check_in, check_out, duration_minutes, status, qr_token)
         VALUES (?, ?, ?, NULL, 0, ?, ?)`,
        [employee.id, dateStr, timeStr, status, token]
      );

      return new Response(
        JSON.stringify({
          success: true,
          action: 'check_in',
          message: `Presensi Masuk berhasil dicatat untuk ${employee.name} pukul ${timeStr}. Status: ${status === 'hadir' ? 'Tepat Waktu' : 'Terlambat'}.`,
          employee: { id: employee.id, name: employee.name, nik: employee.nik },
          time: timeStr,
          status,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!todayRecord.check_out) {
      // CHECK OUT
      const [inH, inM, inS] = todayRecord.check_in.split(':').map(Number);
      const [nowY, nowM, nowD] = dateStr.split('-').map(Number);
      const checkInDate = new Date(nowY, nowM - 1, nowD, inH, inM, inS || 0);
      const durationMin = Math.max(1, Math.round((Date.now() - checkInDate.getTime()) / (1000 * 60)));
      const durationHours = (durationMin / 60).toFixed(1);

      await execute(
        `UPDATE attendance SET check_out = ?, duration_minutes = ? WHERE id = ?`,
        [timeStr, durationMin, todayRecord.id]
      );

      return new Response(
        JSON.stringify({
          success: true,
          action: 'check_out',
          message: `Presensi Pulang berhasil dicatat untuk ${employee.name} pukul ${timeStr}. Total durasi kerja: ${durationHours} jam.`,
          employee: { id: employee.id, name: employee.name, nik: employee.nik },
          time: timeStr,
          duration_hours: durationHours,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Already checked in and checked out
    return new Response(
      JSON.stringify({
        success: true,
        action: 'already_completed',
        message: `${employee.name} sudah menyelesaikan presensi masuk (${todayRecord.check_in}) dan pulang (${todayRecord.check_out}) untuk hari ini.`,
        employee: { id: employee.id, name: employee.name },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || 'Gagal memproses presensi' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
