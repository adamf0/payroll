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
  phone: string;
  join_date: string; // YYYY-MM-DD
  scheme: WageScheme;
  base_rate: number; // rate per hour, per day, per week, or per month in IDR
  payday_rule: string; // e.g. "25" (25th of month), "1", "10", "jumat" (every Friday)
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
  amount_paid: number;
  settled_at: string;
  notes?: string;
}

