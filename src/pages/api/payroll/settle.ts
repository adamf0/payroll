import type { APIRoute } from 'astro';
import { getCurrentUser } from '../../../lib/auth';
import { execute, queryAll } from '../../../lib/db';
import { getJakartaTodayStr } from '../../../lib/payroll';

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
    const todayYmd = getJakartaTodayStr();
    const currentYearMonth = todayYmd.substring(0, 7);

    // Helper for applying cashbon repayments
    async function applyCashbonRepayment(empId: number, settlementId: number, deductionAmount: number) {
      if (deductionAmount <= 0) return;

      const activeCashbons = await queryAll<{
        id: number;
        amount_approved: number;
        total_repaid: number;
      }>(
        `SELECT c.id, c.amount_approved, COALESCE(SUM(r.amount), 0) AS total_repaid
         FROM cashbon_requests c
         LEFT JOIN cashbon_repayments r ON c.id = r.cashbon_id
         WHERE c.employee_id = ? AND c.status IN ('approved', 'partial') AND c.disbursed_at IS NOT NULL
         GROUP BY c.id, c.amount_approved
         HAVING total_repaid < c.amount_approved
         ORDER BY c.created_at ASC`,
        [empId]
      );

      let remainingToDeduct = deductionAmount;
      for (const cb of activeCashbons) {
        if (remainingToDeduct <= 0) break;
        const cbBalance = Number(cb.amount_approved) - Number(cb.total_repaid);
        const deductNow = Math.min(remainingToDeduct, cbBalance);

        if (deductNow > 0) {
          await execute(
            `INSERT INTO cashbon_repayments (cashbon_id, settlement_id, amount, notes)
             VALUES (?, ?, ?, ?)`,
            [cb.id, settlementId, deductNow, `Potongan otomatis gaji via slip #${settlementId}`]
          );

          if (Number(cb.total_repaid) + deductNow >= Number(cb.amount_approved)) {
            await execute(`UPDATE cashbon_requests SET status = 'settled' WHERE id = ?`, [cb.id]);
          }
          remainingToDeduct -= deductNow;
        }
      }
    }

    // Support batch settlements
    if (Array.isArray(data.items) && data.items.length > 0) {
      let settledCount = 0;
      let totalAmount = 0;

      for (const item of data.items) {
        const empId = Number(item.employee_id);
        const amount = Number(item.amount_paid);
        if (!empId || amount < 0) continue;

        const pStart = item.period_start || `${currentYearMonth}-01`;
        const pEnd = item.period_end || todayYmd;
        const scheme = item.scheme || 'bulanan';
        const units = Number(item.total_units) || 1;
        const rate = Number(item.rate) || amount;
        const allowance = Number(item.allowance) || 0;
        const overtime = Number(item.overtime_pay) || 0;
        const bonus = Number(item.bonus) || 0;
        const cashbon = Number(item.cashbon_deduction) || 0;
        const notes = item.notes || `Pembayaran gaji batch (${pStart} s/d ${pEnd})`;

        const res = await execute(
          `INSERT INTO payroll_settlements (employee_id, period_start, period_end, scheme, total_units, rate, amount_paid, allowance, overtime_pay, bonus, cashbon_deduction, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [empId, pStart, pEnd, scheme, units, rate, amount, allowance, overtime, bonus, cashbon, notes]
        );

        if (res.insertId && cashbon > 0) {
          await applyCashbonRepayment(empId, res.insertId, cashbon);
        }

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

    const { employee_id, scheme, total_units, rate, amount_paid, notes, allowance, overtime_pay, bonus, cashbon_deduction } = data;

    if (!employee_id || amount_paid === undefined || amount_paid === null) {
      return new Response(JSON.stringify({ error: 'Data pembayaran tidak lengkap' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const periodStart = data.period_start || `${currentYearMonth}-01`;
    const periodEnd = data.period_end || todayYmd;
    const allw = Number(allowance) || 0;
    const ovt = Number(overtime_pay) || 0;
    const bns = Number(bonus) || 0;
    const cbDed = Number(cashbon_deduction) || 0;

    const res = await execute(
      `INSERT INTO payroll_settlements (employee_id, period_start, period_end, scheme, total_units, rate, amount_paid, allowance, overtime_pay, bonus, cashbon_deduction, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        employee_id,
        periodStart,
        periodEnd,
        scheme || 'bulanan',
        Number(total_units) || 1,
        Number(rate) || Number(amount_paid),
        Number(amount_paid),
        allw,
        ovt,
        bns,
        cbDed,
        notes || 'Pembayaran realtime via admin portal'
      ]
    );

    if (res.insertId && cbDed > 0) {
      await applyCashbonRepayment(Number(employee_id), res.insertId, cbDed);
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Pembayaran payroll berhasil dibukukan dan slip tersimpan',
        settlement_id: res.insertId,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || 'Gagal memproses pembayaran' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
