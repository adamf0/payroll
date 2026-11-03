import { execute } from './db';

export interface AuditLogInput {
  module: 'karyawan' | 'cashbon' | 'payroll' | 'presensi';
  action: string;
  record_id?: number | null;
  record_title?: string | null;
  user_id?: number | null;
  user_name: string;
  old_values?: any;
  new_values?: any;
  notes?: string | null;
  ip_address?: string | null;
}

/**
 * Record an audit log entry safely without breaking caller on failure
 */
export async function recordAuditLog(input: AuditLogInput): Promise<boolean> {
  try {
    const oldJson = input.old_values !== undefined && input.old_values !== null
      ? (typeof input.old_values === 'string' ? input.old_values : JSON.stringify(input.old_values))
      : null;
    const newJson = input.new_values !== undefined && input.new_values !== null
      ? (typeof input.new_values === 'string' ? input.new_values : JSON.stringify(input.new_values))
      : null;

    await execute(
      `INSERT INTO audit_logs 
        (module, action, record_id, record_title, user_id, user_name, old_values, new_values, notes, ip_address)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.module,
        input.action,
        input.record_id || null,
        input.record_title || null,
        input.user_id || null,
        input.user_name || 'System',
        oldJson,
        newJson,
        input.notes || null,
        input.ip_address || null,
      ]
    );
    return true;
  } catch (err: any) {
    console.error('[AUDIT_LOG_ERROR]', err?.message || err);
    return false;
  }
}
