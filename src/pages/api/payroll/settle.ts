import type { APIRoute } from 'astro';
import { getCurrentUser } from '../../../lib/auth';
import { execute } from '../../../lib/db';

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
    const { employee_id, scheme, total_units, rate, amount_paid, notes } = data;

    if (!employee_id || !amount_paid) {
      return new Response(JSON.stringify({ error: 'Data pembayaran tidak lengkap' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const now = new Date();
    const periodStart = data.period_start || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const periodEnd = data.period_end || now.toISOString().split('T')[0];

    await execute(
      `INSERT INTO payroll_settlements (employee_id, period_start, period_end, scheme, total_units, rate, amount_paid, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        employee_id,
        periodStart,
        periodEnd,
        scheme || 'bulanan',
        Number(total_units) || 1,
        Number(rate) || Number(amount_paid),
        Number(amount_paid),
        notes || 'Pembayaran realtime via admin portal'
      ]
    );

    return new Response(
      JSON.stringify({ success: true, message: 'Pembayaran payroll berhasil dibukukan dan slip tersimpan' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || 'Gagal memproses pembayaran' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
