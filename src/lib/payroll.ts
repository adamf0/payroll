import type { Employee, RealtimePayrollItem } from './types';
import { queryAll, queryOne } from './db';

/**
 * Format IDR currency
 */
export function formatRupiah(amount: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(amount);
}

/**
 * Format date string (YYYY-MM-DD or Date) to Indonesian format with day name:
 * e.g. "Jumat, 14 Februari 2025"
 */
export function formatIndonesianDate(dateInput: string | Date | null | undefined, withDayName = true): string {
  if (!dateInput) return '-';
  let d: Date;
  if (typeof dateInput === 'string' && /^\d{4}-\d{2}-\d{2}/.test(dateInput)) {
    const [y, m, day] = dateInput.substring(0, 10).split('-').map(Number);
    d = new Date(y, m - 1, day);
  } else {
    d = new Date(dateInput);
  }

  if (isNaN(d.getTime())) return String(dateInput);

  const options: Intl.DateTimeFormatOptions = {
    weekday: withDayName ? 'long' : undefined,
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  };

  return d.toLocaleDateString('id-ID', options);
}

/**
 * Calculate the next payday date and remaining days based on employee's payday rule.
 * Rules:
 * - Number string: '25' -> 25th day of the current or next month
 * - 'jumat' -> Next coming Friday
 * - 'senin' -> Next coming Monday
 */
export function calculateNextPayday(paydayRule: string, refDate = new Date(), scheme?: string): { nextDateStr: string; daysRemaining: number; isDue: boolean; label?: string } {
  // Gaji per jam dan harian: hari itu juga bisa bayar gaji (kapan saja / harian)
  if (scheme === 'per_jam' || scheme === 'harian') {
    return {
      nextDateStr: 'Hari Ini',
      daysRemaining: 0,
      isDue: true,
      label: 'Hari Itu Juga (Harian)',
    };
  }

  const now = new Date(refDate);
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth(); // 0-indexed
  const currentDay = now.getDate();

  const rule = (paydayRule || '25').trim().toLowerCase();

  let targetDate: Date;

  if (rule === 'jumat' || rule === 'friday') {
    // Target next Friday (day 5)
    targetDate = new Date(now);
    const dayOfWeek = now.getDay();
    let diff = (5 - dayOfWeek + 7) % 7;
    if (diff === 0 && now.getHours() >= 17) {
      diff = 7; // after 5pm on Friday, next payday is next Friday
    }
    targetDate.setDate(now.getDate() + diff);
  } else if (rule === 'senin' || rule === 'monday') {
    targetDate = new Date(now);
    const dayOfWeek = now.getDay();
    let diff = (1 - dayOfWeek + 7) % 7;
    if (diff === 0 && now.getHours() >= 17) {
      diff = 7;
    }
    targetDate.setDate(now.getDate() + diff);
  } else {
    // Numeric day of month (e.g. 25, 1, 10, 28)
    const dayNum = parseInt(rule, 10) || 25;
    if (currentDay <= dayNum) {
      // Still in current month
      targetDate = new Date(currentYear, currentMonth, dayNum);
    } else {
      // Moves to next month
      targetDate = new Date(currentYear, currentMonth + 1, dayNum);
    }
  }

  // Calculate day difference normalized to midnight
  const targetStart = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate());
  const nowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffTime = targetStart.getTime() - nowStart.getTime();
  const daysRemaining = Math.round(diffTime / (1000 * 60 * 60 * 24));
  const isDue = daysRemaining <= 0;

  const y = targetDate.getFullYear();
  const m = String(targetDate.getMonth() + 1).padStart(2, '0');
  const d = String(targetDate.getDate()).padStart(2, '0');

  return {
    nextDateStr: `${y}-${m}-${d}`,
    daysRemaining,
    isDue,
  };
}

/**
 * Helper to get Monday and Saturday for a date string YYYY-MM-DD
 */
export function getWeekRange(dStr: string): { monStr: string; satStr: string } {
  const [y, m, d] = dStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const day = date.getDay(); // 0 is Sun, 1 is Mon, 6 is Sat
  const diffToMon = day === 0 ? -6 : 1 - day;
  const mon = new Date(y, m - 1, d + diffToMon);
  const sat = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 5);

  const fmt = (dt: Date) => {
    const yy = dt.getFullYear();
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    const dd = String(dt.getDate()).padStart(2, '0');
    return `${yy}-${mm}-${dd}`;
  };

  return { monStr: fmt(mon), satStr: fmt(sat) };
}

/**
 * Computes real-time accrued payroll for a single employee (personal summary)
 */
export async function computeEmployeeRealtimePayroll(employee: Employee): Promise<RealtimePayrollItem> {
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const currentMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const unbilledRecords = await queryAll<{
    id: number;
    date_str: string;
    check_in_str: string;
    check_out_str: string;
    duration_minutes: number;
    status: string;
  }>(`
    SELECT a.id, 
           DATE_FORMAT(a.date, '%Y-%m-%d') as date_str,
           TIME_FORMAT(a.check_in, '%H:%i') as check_in_str,
           TIME_FORMAT(a.check_out, '%H:%i') as check_out_str,
           a.duration_minutes, a.status
    FROM attendance a
    WHERE a.employee_id = ?
      AND NOT EXISTS (
        SELECT 1 FROM payroll_settlements s
        WHERE s.employee_id = a.employee_id
          AND a.date >= s.period_start
          AND a.date <= s.period_end
      )
    ORDER BY a.date ASC
  `, [employee.id]);

  const periodStart = unbilledRecords[0]?.date_str || `${currentMonthStr}-01`;
  const periodEnd = unbilledRecords[unbilledRecords.length - 1]?.date_str || todayStr;
  const totalPresentDays = unbilledRecords.length;
  const totalMinutes = unbilledRecords.reduce((sum, r) => sum + (r.duration_minutes || 480), 0);
  const totalHoursWorked = parseFloat((totalMinutes / 60).toFixed(1));

  const { nextDateStr, daysRemaining, isDue } = calculateNextPayday(employee.payday_rule, now, employee.scheme);

  let accruedAmount = 0;
  let breakdown = '';
  let attendanceLabel = '';
  let attendanceBadge = '';
  let attendanceBadgeType: 'success' | 'warning' | 'danger' | 'info' = 'info';

  const baseRate = Number(employee.base_rate) || 0;

  switch (employee.scheme) {
    case 'per_jam': {
      accruedAmount = Math.round(totalHoursWorked * baseRate);
      attendanceLabel = `${totalHoursWorked} Jam Kerja`;
      attendanceBadge = 'Bisa Bayar Hari Ini';
      attendanceBadgeType = 'success';
      breakdown = `${totalHoursWorked} jam × ${formatRupiah(baseRate)}/jam (Hari itu juga bisa dibayar)`;
      break;
    }
    case 'harian': {
      accruedAmount = Math.round(totalPresentDays * baseRate);
      attendanceLabel = `${totalPresentDays} Hari Hadir`;
      attendanceBadge = 'Bisa Bayar Hari Ini';
      attendanceBadgeType = 'success';
      breakdown = `${totalPresentDays} hari × ${formatRupiah(baseRate)}/hari (Hari itu juga bisa dibayar)`;
      break;
    }
    case 'mingguan': {
      const workDaysPerWeek = 6;
      const dailyRate = Math.round(baseRate / workDaysPerWeek);
      accruedAmount = Math.round(totalPresentDays * dailyRate);
      attendanceLabel = `${totalPresentDays} Hari Kerja`;
      const isPast = daysRemaining <= 0 && isDue;
      if (!isPast) {
        attendanceBadge = `Sedang Berjalan (${totalPresentDays} Hari Hadir)`;
        attendanceBadgeType = 'info';
        breakdown = `${totalPresentDays} hari hadir berjalan × ${formatRupiah(dailyRate)}/hari (Siklus minggu berjalan)`;
      } else {
        const rem = totalPresentDays % workDaysPerWeek;
        if (rem > 0 && rem < workDaysPerWeek) {
          attendanceBadge = `${workDaysPerWeek - rem} Hari Absen (Gaji Tidak Full)`;
          attendanceBadgeType = 'warning';
          breakdown = `${totalPresentDays} hari hadir × ${formatRupiah(dailyRate)}/hari (Gaji mingguan dibagi 6 hari, tidak full jika absen)`;
        } else {
          attendanceBadge = 'Lengkap (Full)';
          attendanceBadgeType = 'success';
          breakdown = `${totalPresentDays} hari hadir × ${formatRupiah(dailyRate)}/hari (Basis ${formatRupiah(baseRate)}/minggu ÷ 6)`;
        }
      }
      break;
    }
    case 'bulanan': {
      const workDaysInMonth = 26;
      const dailyRate = Math.round(baseRate / workDaysInMonth);
      accruedAmount = totalPresentDays >= workDaysInMonth 
        ? baseRate 
        : Math.round((totalPresentDays / workDaysInMonth) * baseRate);
      attendanceLabel = `${totalPresentDays} / ${workDaysInMonth} Hari Kerja`;
      const isPast = daysRemaining <= 0 && isDue;
      if (!isPast) {
        attendanceBadge = `Sedang Berjalan (${totalPresentDays} Hari Hadir)`;
        attendanceBadgeType = 'info';
        breakdown = `Hadir ${totalPresentDays} hari berjalan (Gaji bulanan ${formatRupiah(baseRate)}/bulan)`;
      } else if (totalPresentDays < workDaysInMonth) {
        attendanceBadge = `${workDaysInMonth - totalPresentDays} Hari Absen (Gaji Tidak Full)`;
        attendanceBadgeType = 'warning';
        breakdown = `Hadir ${totalPresentDays}/${workDaysInMonth} hari kerja (Gaji bulanan dibagi 26 hari: ${formatRupiah(dailyRate)}/hari)`;
      } else {
        attendanceBadge = 'Lengkap (Full)';
        attendanceBadgeType = 'success';
        breakdown = `Hadir ${totalPresentDays}/${workDaysInMonth} hari kerja (Gaji pokok ${formatRupiah(baseRate)}/bulan)`;
      }
      break;
    }
    default:
      accruedAmount = 0;
      breakdown = 'Skema tidak dikenal';
      attendanceLabel = `${totalPresentDays} Hari`;
  }

  return {
    employee,
    period_label: `Periode s/d ${formatIndonesianDate(periodEnd, false)}`,
    next_payday: nextDateStr,
    days_until_payday: daysRemaining,
    is_due: isDue,
    total_present_days: totalPresentDays,
    total_hours_worked: totalHoursWorked,
    accrued_amount: accruedAmount,
    currency_formatted: formatRupiah(accruedAmount),
    breakdown,
    attendance_label: attendanceLabel,
    attendance_badge: attendanceBadge,
    attendance_badge_type: attendanceBadgeType,
    period_start: periodStart,
    period_end: periodEnd,
  };
}

/**
 * Computes real-time accrued payroll for all active employees.
 * Per Jam & Harian: TIDAK diakumulasi, melainkan menampilkan banyak baris (per tanggal kerja).
 * Mingguan: Diakumulasi per minggu (÷ 6 hari kerja).
 * Bulanan: Diakumulasi per bulan (÷ 26 hari kerja).
 */
export async function computeAllRealtimePayroll(): Promise<RealtimePayrollItem[]> {
  const employees = await queryAll<Employee>(
    `SELECT * FROM employees WHERE is_active = 1 ORDER BY id ASC`
  );
  const empMap = new Map<number, Employee>(employees.map((e) => [e.id, e]));

  const records = await queryAll<{
    id: number;
    employee_id: number;
    date_str: string;
    check_in_str: string;
    check_out_str: string;
    duration_minutes: number;
    status: string;
  }>(`
    SELECT a.id, a.employee_id, 
           DATE_FORMAT(a.date, '%Y-%m-%d') as date_str,
           TIME_FORMAT(a.check_in, '%H:%i') as check_in_str,
           TIME_FORMAT(a.check_out, '%H:%i') as check_out_str,
           a.duration_minutes, a.status
    FROM attendance a
    WHERE NOT EXISTS (
      SELECT 1 FROM payroll_settlements s
      WHERE s.employee_id = a.employee_id
        AND a.date >= s.period_start
        AND a.date <= s.period_end
    )
    ORDER BY a.date DESC, a.employee_id ASC
  `);

  const results: RealtimePayrollItem[] = [];
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  // 1. Per Jam: Setiap tanggal kehadiran menjadi 1 baris tersendiri
  const hourlyRecords = records.filter((r) => empMap.get(r.employee_id)?.scheme === 'per_jam');
  for (const r of hourlyRecords) {
    const emp = empMap.get(r.employee_id)!;
    const baseRate = Number(emp.base_rate) || 0;
    const hours = parseFloat(((r.duration_minutes || 480) / 60).toFixed(1));
    const accrued = Math.round(hours * baseRate);
    const timeStr = r.check_in_str && r.check_out_str ? `${r.check_in_str} - ${r.check_out_str}` : '08:00 - 16:00';

    results.push({
      employee: emp,
      period_label: formatIndonesianDate(r.date_str, true),
      next_payday: 'Hari Ini',
      days_until_payday: 0,
      is_due: true,
      total_present_days: 1,
      total_hours_worked: hours,
      accrued_amount: accrued,
      currency_formatted: formatRupiah(accrued),
      breakdown: `${hours} jam × ${formatRupiah(baseRate)}/jam (Hari itu juga bisa dibayar)`,
      attendance_label: `${hours} Jam Kerja (${timeStr})`,
      attendance_badge: 'Bisa Bayar Hari Ini',
      attendance_badge_type: 'success',
      period_start: r.date_str,
      period_end: r.date_str,
    });
  }

  // 2. Harian: Setiap tanggal kehadiran menjadi 1 baris tersendiri
  const dailyRecords = records.filter((r) => empMap.get(r.employee_id)?.scheme === 'harian');
  for (const r of dailyRecords) {
    const emp = empMap.get(r.employee_id)!;
    const baseRate = Number(emp.base_rate) || 0;
    const accrued = baseRate;
    const timeStr = r.check_in_str && r.check_out_str ? `${r.check_in_str} - ${r.check_out_str}` : '08:00 - 16:00';

    results.push({
      employee: emp,
      period_label: formatIndonesianDate(r.date_str, true),
      next_payday: 'Hari Ini',
      days_until_payday: 0,
      is_due: true,
      total_present_days: 1,
      total_hours_worked: parseFloat(((r.duration_minutes || 480) / 60).toFixed(1)),
      accrued_amount: accrued,
      currency_formatted: formatRupiah(accrued),
      breakdown: `1 hari × ${formatRupiah(baseRate)}/hari (Hari itu juga bisa dibayar)`,
      attendance_label: `1 Hari Hadir (${timeStr})`,
      attendance_badge: 'Bisa Bayar Hari Ini',
      attendance_badge_type: 'success',
      period_start: r.date_str,
      period_end: r.date_str,
    });
  }

  // 3. Mingguan: Dikelompokkan per minggu (Senin - Sabtu, basis 6 hari kerja)
  const weeklyRecords = records.filter((r) => empMap.get(r.employee_id)?.scheme === 'mingguan');
  const weekGroups: Record<string, { emp: Employee; weekStart: string; weekEnd: string; records: typeof records }> = {};

  for (const r of weeklyRecords) {
    const { monStr, satStr } = getWeekRange(r.date_str);
    const key = `${r.employee_id}_${monStr}`;
    if (!weekGroups[key]) {
      weekGroups[key] = {
        emp: empMap.get(r.employee_id)!,
        weekStart: monStr,
        weekEnd: satStr,
        records: [],
      };
    }
    weekGroups[key].records.push(r);
  }

  for (const g of Object.values(weekGroups)) {
    const days = g.records.length;
    const baseRate = Number(g.emp.base_rate) || 0;
    const dailyRate = Math.round(baseRate / 6);
    const accrued = days >= 6 ? baseRate : Math.round(days * dailyRate);
    const isFull = days >= 6;

    // Tentukan hari gajian mingguan: jika 'jumat', ambil hari Jumat (Senin + 4 hari)
    const [wy, wm, wd] = g.weekStart.split('-').map(Number);
    const monDate = new Date(wy, wm - 1, wd);
    const friDate = new Date(monDate.getFullYear(), monDate.getMonth(), monDate.getDate() + 4);
    const friStr = `${friDate.getFullYear()}-${String(friDate.getMonth() + 1).padStart(2, '0')}-${String(friDate.getDate()).padStart(2, '0')}`;
    const paydayDate = g.emp.payday_rule === 'jumat' ? friStr : g.weekEnd;

    // Cek apakah minggu ini sudah lewat di masa lalu
    const isPastWeek = todayStr > g.weekEnd;
    const isTodayPayday = todayStr === paydayDate;
    const isDue = isPastWeek || isTodayPayday;

    let daysUntilPayday = 0;
    if (!isPastWeek) {
      const nowMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const pMidnight = new Date(monDate.getFullYear(), monDate.getMonth(), monDate.getDate() + (g.emp.payday_rule === 'jumat' ? 4 : 5));
      const diffDays = Math.round((pMidnight.getTime() - nowMidnight.getTime()) / (1000 * 60 * 60 * 24));
      daysUntilPayday = Math.max(0, diffDays);
    }

    let badge = '';
    let badgeType: 'success' | 'warning' | 'info' = 'info';
    let breakdown = '';

    if (isPastWeek) {
      if (isFull) {
        badge = 'Lengkap (Full)';
        badgeType = 'success';
      } else {
        badge = `${6 - days} Hari Absen (Gaji Tidak Full)`;
        badgeType = 'warning';
      }
      breakdown = `${days} hari hadir × ${formatRupiah(dailyRate)}/hari (Basis ${formatRupiah(baseRate)}/minggu ÷ 6)`;
    } else {
      if (isTodayPayday) {
        badge = `Hari Ini Gajian (${days} Hari Hadir)`;
        badgeType = 'info';
      } else {
        badge = `Sedang Berjalan (${days} Hari Hadir)`;
        badgeType = 'info';
      }
      breakdown = `${days} hari hadir berjalan × ${formatRupiah(dailyRate)}/hari (Siklus minggu berjalan)`;
    }

    results.push({
      employee: g.emp,
      period_label: `Minggu ${formatIndonesianDate(g.weekStart, false)} s/d ${formatIndonesianDate(g.weekEnd, false)}`,
      next_payday: paydayDate,
      days_until_payday: daysUntilPayday,
      is_due: isDue,
      total_present_days: days,
      total_hours_worked: days * 8,
      accrued_amount: accrued,
      currency_formatted: formatRupiah(accrued),
      breakdown,
      attendance_label: `${days} / 6 Hari Kerja`,
      attendance_badge: badge,
      attendance_badge_type: badgeType,
      period_start: g.weekStart,
      period_end: g.weekEnd,
    });
  }

  // 4. Bulanan: Dikelompokkan per bulan (basis 26 hari kerja)
  const monthlyRecords = records.filter((r) => empMap.get(r.employee_id)?.scheme === 'bulanan');
  const monthGroups: Record<string, { emp: Employee; monthKey: string; records: typeof records }> = {};

  for (const r of monthlyRecords) {
    const monthKey = r.date_str.substring(0, 7);
    const key = `${r.employee_id}_${monthKey}`;
    if (!monthGroups[key]) {
      monthGroups[key] = {
        emp: empMap.get(r.employee_id)!,
        monthKey,
        records: [],
      };
    }
    monthGroups[key].records.push(r);
  }

  for (const g of Object.values(monthGroups)) {
    const days = g.records.length;
    const baseRate = Number(g.emp.base_rate) || 0;
    const dailyRate = Math.round(baseRate / 26);
    const accrued = days >= 26 ? baseRate : Math.round((days / 26) * baseRate);
    const isFull = days >= 26;
    const [yNum, mNum] = g.monthKey.split('-').map(Number);
    const lastDayOfMonth = new Date(yNum, mNum, 0).getDate();
    const pStart = `${g.monthKey}-01`;
    const pEnd = `${g.monthKey}-${String(lastDayOfMonth).padStart(2, '0')}`;
    const mDate = new Date(yNum, mNum - 1, 1);
    const monthName = mDate.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
    const paydayDay = parseInt(g.emp.payday_rule, 10) || 25;
    const paydayStr = `${g.monthKey}-${String(paydayDay).padStart(2, '0')}`;

    const isPastMonth = todayStr > pEnd || todayStr > paydayStr;
    const isTodayPayday = todayStr === paydayStr;
    const isDue = isPastMonth || isTodayPayday;

    let daysUntilPayday = 0;
    if (!isPastMonth) {
      const nowMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const pMidnight = new Date(yNum, mNum - 1, paydayDay);
      const diffDays = Math.round((pMidnight.getTime() - nowMidnight.getTime()) / (1000 * 60 * 60 * 24));
      daysUntilPayday = Math.max(0, diffDays);
    }

    let badge = '';
    let badgeType: 'success' | 'warning' | 'info' = 'info';
    let breakdown = '';

    if (isPastMonth) {
      if (isFull) {
        badge = 'Lengkap (Full)';
        badgeType = 'success';
      } else {
        badge = `${26 - days} Hari Absen (Gaji Tidak Full)`;
        badgeType = 'warning';
      }
      breakdown = `Hadir ${days}/26 hari kerja (Gaji bulanan dibagi 26 hari: ${formatRupiah(dailyRate)}/hari)`;
    } else {
      if (isTodayPayday) {
        badge = `Hari Ini Gajian (${days} Hari Hadir)`;
        badgeType = 'info';
      } else {
        badge = `Sedang Berjalan (${days} Hari Hadir)`;
        badgeType = 'info';
      }
      breakdown = `Hadir ${days} hari berjalan (Gaji bulanan ${formatRupiah(baseRate)}/bulan)`;
    }

    results.push({
      employee: g.emp,
      period_label: `Bulan ${monthName}`,
      next_payday: paydayStr,
      days_until_payday: daysUntilPayday,
      is_due: isDue,
      total_present_days: days,
      total_hours_worked: days * 8,
      accrued_amount: accrued,
      currency_formatted: formatRupiah(accrued),
      breakdown,
      attendance_label: `${days} / 26 Hari Kerja`,
      attendance_badge: badge,
      attendance_badge_type: badgeType,
      period_start: pStart,
      period_end: pEnd,
    });
  }

  // Urutkan data: tanggal terbaru di paling atas
  results.sort((a, b) => {
    const dateA = a.period_end || '';
    const dateB = b.period_end || '';
    if (dateB !== dateA) return dateB.localeCompare(dateA);
    return a.employee.id - b.employee.id;
  });

  return results;
}
