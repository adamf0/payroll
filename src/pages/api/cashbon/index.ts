import type { APIRoute } from 'astro';
import { getCurrentUser } from '../../../lib/auth';
import { queryAll, queryOne, execute } from '../../../lib/db';
import type { CashbonRequest } from '../../../lib/types';

export const GET: APIRoute = async ({ request, cookies }) => {
  const user = await getCurrentUser(cookies);
  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const url = new URL(request.url);
  const statusFilter = url.searchParams.get('status');

  let sql = `
    SELECT 
      c.*,
      e.name AS employee_name,
      e.nik AS employee_nik,
      e.position,
      u.name AS approved_by_name,
      COALESCE((SELECT SUM(amount) FROM cashbon_repayments WHERE cashbon_id = c.id), 0) AS total_repaid
    FROM cashbon_requests c
    JOIN employees e ON c.employee_id = e.id
    LEFT JOIN users u ON c.approved_by = u.id
  `;

  const params: any[] = [];
  const conditions: string[] = [];

  if (user.role === 'karyawan') {
    if (!user.employee_id) {
      return new Response(JSON.stringify({ error: 'Akun karyawan belum terhubung' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    conditions.push('c.employee_id = ?');
    params.push(user.employee_id);
  } else if (url.searchParams.get('employee_id')) {
    conditions.push('c.employee_id = ?');
    params.push(Number(url.searchParams.get('employee_id')));
  }

  if (statusFilter && statusFilter !== 'all') {
    conditions.push('c.status = ?');
    params.push(statusFilter);
  }

  if (conditions.length > 0) {
    sql += ' WHERE ' + conditions.join(' AND ');
  }

  sql += ' ORDER BY c.id DESC';

  const rows = await queryAll<any>(sql, params);
  const items: CashbonRequest[] = rows.map((r) => {
    const totalRepaid = Number(r.total_repaid) || 0;
    const approved = Number(r.amount_approved) || 0;
    const remaining = r.disbursed_at ? Math.max(0, approved - totalRepaid) : approved;
    return {
      ...r,
      amount_requested: Number(r.amount_requested) || 0,
      amount_approved: approved,
      total_repaid: totalRepaid,
      remaining_balance: remaining,
    };
  });

  return new Response(JSON.stringify({ success: true, items }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

export const POST: APIRoute = async ({ request, cookies }) => {
  const user = await getCurrentUser(cookies);
  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const data = await request.json();
    const { employee_id, direct_disburse } = data;

    let targetEmpId: number | null = null;
    if (user.role === 'karyawan') {
      targetEmpId = user.employee_id || null;
    } else {
      targetEmpId = Number(employee_id || data.employee_id) || null;
    }

    if (!targetEmpId) {
      return new Response(JSON.stringify({ error: 'Pilih karyawan yang mengajukan cashbon' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const rawAmount = data.amount_requested !== undefined && data.amount_requested !== null && data.amount_requested !== ''
      ? data.amount_requested
      : data.amount;
    const amount = Number(rawAmount);
    if (!amount || isNaN(amount) || amount <= 0) {
      return new Response(JSON.stringify({ error: 'Nominal cashbon harus lebih besar dari 0' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const rawReason = (typeof data.reason === 'string' ? data.reason : '');
    const finalReason = rawReason.trim() || (user.role === 'admin' ? 'Input langsung oleh Admin' : '');
    if (!finalReason) {
      return new Response(JSON.stringify({ error: 'Mohon cantumkan alasan pengajuan cashbon' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // If admin enters direct_disburse (quick input cashbon)
    if (user.role === 'admin' && direct_disburse) {
      const res = await execute(
        `INSERT INTO cashbon_requests 
          (employee_id, amount_requested, amount_approved, reason, status, disbursed_at, admin_notes, approved_by)
         VALUES (?, ?, ?, ?, 'approved', NOW(), 'Input langsung oleh Admin', ?)`,
        [targetEmpId, amount, amount, finalReason, user.id]
      );
      return new Response(
        JSON.stringify({ success: true, message: 'Cashbon berhasil dicatat dan dicairkan', id: res.insertId }),
        { status: 201, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Standard employee request (status = pending)
    const res = await execute(
      `INSERT INTO cashbon_requests 
        (employee_id, amount_requested, amount_approved, reason, status)
       VALUES (?, ?, 0, ?, 'pending')`,
      [targetEmpId, amount, finalReason]
    );

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Pengajuan cashbon berhasil dikirimkan, menunggu persetujuan admin',
        id: res.insertId,
      }),
      { status: 201, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || 'Gagal mengajukan cashbon' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
