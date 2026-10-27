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
    const now = new Date();
    const todayYmd = now.toISOString().split('T')[0];

    // Support batch settlements
    if (Array.isArray(data.items) && data.items.length > 0) {
      let settledCount = 0;
      let totalAmount = 0;

      for (const item of data.items) {
        const empId = Number(item.employee_id);
        const amount = Number(item.amount_paid);
        if (!empId || amount <= 0) continue;

        const pStart = item.period_start || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
        const pEnd = item.period_end || todayYmd;
        const scheme = item.scheme || 'bulanan';
        const units = Number(item.total_units) || 1;
        const rate = Number(item.rate) || amount;
        const notes = item.notes || `Pembayaran gaji batch (${pStart} s/d ${pEnd})`;

        await execute(
          `INSERT INTO payroll_settlements (employee_id, period_start, period_end, scheme, total_units, rate, amount_paid, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [empId, pStart, pEnd, scheme, units, rate, amount, notes]
        );

        settledCount++;
        totalAmount += amount;
      }

      return new Response(
        JSON.stringify({
          success: true,
          message: `${settledCount} tagihan gaji berhasil dibayarkan!`,
          settled_count: settledCount,
          total_amount: totalAmount,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const { employee_id, scheme, total_units, rate, amount_paid, notes } = data;

    if (!employee_id || !amount_paid) {
      return new Response(JSON.stringify({ error: 'Data pembayaran tidak lengkap' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const periodStart = data.period_start || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const periodEnd = data.period_end || todayYmd;

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
