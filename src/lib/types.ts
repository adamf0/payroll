export type WageScheme = 'per_jam' | 'harian' | 'mingguan' | 'bulanan';
export type UserRole = 'admin' | 'karyawan';

export interface User {
  id: number;
  username?: string;
  email: string;
  name: string;
  role: UserRole;
  employee_id?: number | null;
}

export interface Employee {
  id: number;
  nik: string;
  name: string;
  position?: string | null;
  phone: string;
  join_date: string; // YYYY-MM-DD
  scheme: WageScheme;
  base_rate: number; // rate per hour, per day, per week, or per month in IDR
  payday_rule: string; // e.g. "25" (25th of month), "1", "10", "jumat" (every Friday)
  bank_name?: string | null;
  bank_account_number?: string | null;
  bank_account_holder?: string | null;
  fixed_allowance?: number;
  is_active: number; // 1 or 0
  created_at?: string;
}

export interface AttendanceRecord {
  id: number;
  employee_id: number;
  employee_name?: string;
  date: string; // YYYY-MM-DD
  check_in: string; // HH:mm:ss
  check_out: string | null; // HH:mm:ss
  duration_minutes: number;
  status: 'hadir' | 'terlambat' | 'lembur';
  qr_token: string;
}

export interface RealtimePayrollItem {
  employee: Employee;
  period_label: string;
  next_payday: string;
  days_until_payday: number;
  is_due: boolean;
  total_present_days: number;
  total_hours_worked: number;
  accrued_amount: number;
  currency_formatted: string;
  breakdown: string;
  attendance_label: string;
  attendance_badge?: string;
  attendance_badge_type?: 'success' | 'warning' | 'danger' | 'info';
  has_unpaid_previous?: boolean;
  unpaid_note?: string;
  period_start?: string;
  period_end?: string;
  active_cashbon?: number;
}

export interface PayrollSettlement {
  id: number;
  employee_id: number;
  employee_name?: string;
  employee_nik?: string;
  period_start: string;
  period_end: string;
  scheme: WageScheme;
  total_units: number;
  rate: number;
  allowance?: number;
  overtime_pay?: number;
  bonus?: number;
  cashbon_deduction?: number;
  amount_paid: number;
  settled_at: string;
  notes?: string;
}

export type CashbonStatus = 'pending' | 'approved' | 'partial' | 'rejected' | 'settled';

export interface CashbonRequest {
  id: number;
  employee_id: number;
  employee_name?: string;
  employee_nik?: string;
  position?: string | null;
  amount_requested: number;
  amount_approved: number;
  reason: string;
  status: CashbonStatus;
  disbursed_at?: string | null;
  admin_notes?: string | null;
  approved_by?: number | null;
  approved_by_name?: string | null;
  created_at: string;
  total_repaid?: number;
  remaining_balance?: number;
}

export interface CashbonRepayment {
  id: number;
  cashbon_id: number;
  settlement_id?: number | null;
  amount: number;
  repaid_at: string;
  notes?: string | null;
}

export interface AuditLog {
  id: number;
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
  created_at: string;
}

