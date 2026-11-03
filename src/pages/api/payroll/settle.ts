import type { APIRoute } from 'astro';
import { getCurrentUser } from '../../../lib/auth';
import { execute, queryAll, queryOne } from '../../../lib/db';
import { recordAuditLog } from '../../../lib/audit';
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

    // Helper to get active cashbon balance for an employee
    async function getActiveCashbonBalance(empId: number): Promise<number> {
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
      return activeCashbons.reduce((sum, c) => sum + (Number(c.amount_approved) - Number(c.total_repaid)), 0);
    }

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
        if (!empId) continue;

        const pStart = item.period_start || `${currentYearMonth}-01`;
        const pEnd = item.period_end || todayYmd;
        const scheme = item.scheme || 'bulanan';
        const units = Number(item.total_units) || 1;
        const rate = Number(item.rate) || 0;
        const allowance = Number(item.allowance) || 0;
        const overtime = Number(item.overtime_pay) || 0;
        const bonus = Number(item.bonus) || 0;
        const basePay = (rate * units) || Number(item.amount_paid) || 0;
        const totalGross = basePay + allowance + overtime + bonus;

        let cashbon = Number(item.cashbon_deduction) || 0;
        // Auto-deduct active cashbon if not explicitly passed
        if (cashbon <= 0) {
          const activeBalance = await getActiveCashbonBalance(empId);
          if (activeBalance > 0) {
            cashbon = Math.min(totalGross, activeBalance);
          }
        }

        const netAmount = Math.max(0, totalGross - cashbon);
        const notes = item.notes || `Pembayaran gaji batch (${pStart} s/d ${pEnd})`;

        const res = await execute(
          `INSERT INTO payroll_settlements (employee_id, period_start, period_end, scheme, total_units, rate, amount_paid, allowance, overtime_pay, bonus, cashbon_deduction, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [empId, pStart, pEnd, scheme, units, rate, netAmount, allowance, overtime, bonus, cashbon, notes]
        );

        if (res.insertId && cashbon > 0) {
          await applyCashbonRepayment(empId, res.insertId, cashbon);
        }

        const emp = await queryOne<{ name: string; nik: string }>('SELECT name, nik FROM employees WHERE id = ?', [empId]);
        await recordAuditLog({
          module: 'payroll',
          action: 'settle_batch',
          record_id: res.insertId,
          record_title: `Slip #PAY-${res.insertId} - ${emp?.name || 'Karyawan'} (${pStart} s/d ${pEnd})`,
          user_id: user.id,
          user_name: user.name,
          old_values: null,
          new_values: {
            settlement_id: res.insertId,
            employee_id: empId,
            employee_name: emp?.name,
            period_start: pStart,
            period_end: pEnd,
            scheme,
            total_units: units,
            rate,
            amount_paid: netAmount,
            allowance,
            overtime_pay: overtime,
            bonus,
            cashbon_deduction: cashbon,
            notes,
          },
          notes: `Pembayaran gaji batch karyawan ${emp?.name || ''} sebesar Rp ${netAmount.toLocaleString('id-ID')}`,
        });

        settledCount++;
        totalAmount += netAmount;
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
    let cbDed = Number(cashbon_deduction) || 0;
    let netAmount = Number(amount_paid);

    // Auto-deduct active cashbon if not explicitly passed
    if (cbDed <= 0 && data.auto_deduct_cashbon !== false) {
      const activeBalance = await getActiveCashbonBalance(Number(employee_id));
      if (activeBalance > 0) {
        const gross = (Number(rate) * Number(total_units)) || netAmount;
        const totalGross = gross + allw + ovt + bns;
        cbDed = Math.min(totalGross, activeBalance);
        netAmount = Math.max(0, totalGross - cbDed);
      }
    }

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
        netAmount,
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

    const emp = await queryOne<{ name: string; nik: string }>('SELECT name, nik FROM employees WHERE id = ?', [employee_id]);
    await recordAuditLog({
      module: 'payroll',
      action: 'settle',
      record_id: res.insertId,
      record_title: `Slip #PAY-${res.insertId} - ${emp?.name || 'Karyawan'} (${periodStart} s/d ${periodEnd})`,
      user_id: user.id,
      user_name: user.name,
      old_values: null,
      new_values: {
        settlement_id: res.insertId,
        employee_id: Number(employee_id),
        employee_name: emp?.name,
        period_start: periodStart,
        period_end: periodEnd,
        scheme: scheme || 'bulanan',
        total_units: Number(total_units) || 1,
        rate: Number(rate) || Number(amount_paid),
        amount_paid: netAmount,
        allowance: allw,
        overtime_pay: ovt,
        bonus: bns,
        cashbon_deduction: cbDed,
        notes: notes || 'Pembayaran realtime via admin portal',
      },
      notes: `Pembayaran gaji karyawan ${emp?.name || ''} sebesar Rp ${netAmount.toLocaleString('id-ID')}`,
    });

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

  if (!id) {
    return new Response(JSON.stringify({ error: 'ID settlement diperlukan' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const settlement = await queryOne<any>(
      `SELECT s.*, e.name, e.nik 
       FROM payroll_settlements s 
       JOIN employees e ON s.employee_id = e.id 
       WHERE s.id = ?`,
      [id]
    );

    if (!settlement) {
      return new Response(JSON.stringify({ error: 'Data pembayaran tidak ditemukan' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Cek apakah ada cashbon repayments yang terhubung ke settlement ini
    const repayments = await queryAll<{ id: number; cashbon_id: number; amount: number }>(
      'SELECT id, cashbon_id, amount FROM cashbon_repayments WHERE settlement_id = ?',
      [id]
    );

    for (const rep of repayments) {
      // Revert status cashbon kembali ke approved jika sebelumnya settled
      await execute(
        "UPDATE cashbon_requests SET status = 'approved' WHERE id = ? AND status = 'settled'",
        [rep.cashbon_id]
      );
    }

    // Hapus cashbon_repayments
    await execute('DELETE FROM cashbon_repayments WHERE settlement_id = ?', [id]);
    // Hapus settlement
    await execute('DELETE FROM payroll_settlements WHERE id = ?', [id]);

    await recordAuditLog({
      module: 'payroll',
      action: 'void',
      record_id: Number(id),
      record_title: `Slip #PAY-${id} - ${settlement.name} (${settlement.nik})`,
      user_id: user.id,
      user_name: user.name,
      old_values: settlement,
      new_values: null,
      notes: `Pembatalan slip pembayaran gaji #PAY-${id} (${settlement.name}) sebesar Rp ${Number(settlement.amount_paid).toLocaleString('id-ID')}`,
    });

    return new Response(
      JSON.stringify({
        success: true,
        message: `Slip gaji #PAY-${id} (${settlement.name}) berhasil dibatalkan dan potongan cashbon telah dipulihkan`,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || 'Gagal membatalkan slip gaji' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
