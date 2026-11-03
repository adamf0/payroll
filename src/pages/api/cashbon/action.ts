import type { APIRoute } from 'astro';
import { getCurrentUser } from '../../../lib/auth';
import { queryOne, execute } from '../../../lib/db';
import { recordAuditLog } from '../../../lib/audit';
import type { CashbonRequest } from '../../../lib/types';

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
    const { id, action, amount_approved, admin_notes } = data;

    if (!id || !action) {
      return new Response(JSON.stringify({ error: 'ID pengajuan dan aksi diperlukan' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const cashbon = await queryOne<CashbonRequest>('SELECT * FROM cashbon_requests WHERE id = ?', [id]);
    if (!cashbon) {
      return new Response(JSON.stringify({ error: 'Data cashbon tidak ditemukan' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const emp = await queryOne<{ name: string; nik: string }>('SELECT name, nik FROM employees WHERE id = ?', [cashbon.employee_id]);
    const empTitle = emp ? `${emp.name} (${emp.nik})` : 'Karyawan';

    if (action === 'approve') {
      const finalNotes = admin_notes || 'Disetujui penuh oleh Admin';
      await execute(
        `UPDATE cashbon_requests SET 
          status = 'approved',
          amount_approved = amount_requested,
          approved_by = ?,
          admin_notes = ?
         WHERE id = ?`,
        [user.id, finalNotes, id]
      );

      await recordAuditLog({
        module: 'cashbon',
        action: 'approve',
        record_id: Number(id),
        record_title: `Cashbon #${id} - ${empTitle} (Rp ${Number(cashbon.amount_requested).toLocaleString('id-ID')})`,
        user_id: user.id,
        user_name: user.name,
        old_values: {
          status: cashbon.status,
          amount_approved: Number(cashbon.amount_approved),
          admin_notes: cashbon.admin_notes,
        },
        new_values: {
          status: 'approved',
          amount_approved: Number(cashbon.amount_requested),
          admin_notes: finalNotes,
        },
        notes: `Persetujuan penuh pengajuan cashbon Rp ${Number(cashbon.amount_requested).toLocaleString('id-ID')}`,
      });

      return new Response(JSON.stringify({ success: true, message: 'Cashbon disetujui penuh' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (action === 'partial') {
      const approved = Number(amount_approved);
      if (!approved || approved <= 0) {
        return new Response(JSON.stringify({ error: 'Nominal yang disetujui harus lebih besar dari 0' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const finalNotes = admin_notes || 'Disetujui sebagian oleh Admin';
      await execute(
        `UPDATE cashbon_requests SET 
          status = 'partial',
          amount_approved = ?,
          approved_by = ?,
          admin_notes = ?
         WHERE id = ?`,
        [approved, user.id, finalNotes, id]
      );

      await recordAuditLog({
        module: 'cashbon',
        action: 'partial_approve',
        record_id: Number(id),
        record_title: `Cashbon #${id} - ${empTitle} (Rp ${approved.toLocaleString('id-ID')})`,
        user_id: user.id,
        user_name: user.name,
        old_values: {
          status: cashbon.status,
          amount_approved: Number(cashbon.amount_approved),
          admin_notes: cashbon.admin_notes,
        },
        new_values: {
          status: 'partial',
          amount_approved: approved,
          admin_notes: finalNotes,
        },
        notes: `Persetujuan sebagian cashbon menjadi Rp ${approved.toLocaleString('id-ID')}`,
      });

      return new Response(JSON.stringify({ success: true, message: `Cashbon disetujui sebagian sebesar Rp ${approved.toLocaleString('id-ID')}` }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (action === 'reject') {
      const finalNotes = admin_notes || 'Pengajuan tidak disetujui';
      await execute(
        `UPDATE cashbon_requests SET 
          status = 'rejected',
          amount_approved = 0,
          approved_by = ?,
          admin_notes = ?
         WHERE id = ?`,
        [user.id, finalNotes, id]
      );

      await recordAuditLog({
        module: 'cashbon',
        action: 'reject',
        record_id: Number(id),
        record_title: `Cashbon #${id} - ${empTitle}`,
        user_id: user.id,
        user_name: user.name,
        old_values: {
          status: cashbon.status,
          amount_approved: Number(cashbon.amount_approved),
          admin_notes: cashbon.admin_notes,
        },
        new_values: {
          status: 'rejected',
          amount_approved: 0,
          admin_notes: finalNotes,
        },
        notes: `Penolakan cashbon: ${finalNotes}`,
      });

      return new Response(JSON.stringify({ success: true, message: 'Pengajuan cashbon ditolak' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (action === 'disburse') {
      if (cashbon.status === 'rejected' || cashbon.status === 'pending') {
        return new Response(JSON.stringify({ error: 'Cashbon harus disetujui terlebih dahulu sebelum dicairkan' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const updatedNotes = `${cashbon.admin_notes || ''} [Dana dicairkan]`.trim();
      await execute(
        `UPDATE cashbon_requests SET 
          disbursed_at = NOW(),
          admin_notes = ?
         WHERE id = ?`,
        [updatedNotes, id]
      );

      await recordAuditLog({
        module: 'cashbon',
        action: 'disburse',
        record_id: Number(id),
        record_title: `Cashbon #${id} - ${empTitle} (Rp ${Number(cashbon.amount_approved).toLocaleString('id-ID')})`,
        user_id: user.id,
        user_name: user.name,
        old_values: {
          disbursed_at: cashbon.disbursed_at,
          admin_notes: cashbon.admin_notes,
        },
        new_values: {
          disbursed_at: 'NOW()',
          admin_notes: updatedNotes,
        },
        notes: `Pencairan dana cashbon sebesar Rp ${Number(cashbon.amount_approved).toLocaleString('id-ID')}`,
      });

      return new Response(JSON.stringify({ success: true, message: 'Status cashbon berhasil ditandai telah dicairkan' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Aksi tidak dikenal' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || 'Gagal memproses aksi cashbon' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
