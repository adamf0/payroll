import assert from 'node:assert/strict';
import { generateHourlyToken, validateAttendanceToken, getSecondsRemainingInHour } from '../src/lib/qr.ts';
import { calculateNextPayday, formatIndonesianDate, computeAllRealtimePayroll } from '../src/lib/payroll.ts';
import { queryAll, queryOne } from '../src/lib/db.ts';

console.log('🧪 Starting Fermi Payroll & Presensi System Test Suite...');

async function runTests() {
  // Test 1: Dynamic QR Code Token & Anti-Cheat Validation
  console.log('\n[1/4] Testing Dynamic Hourly QR Token Engine...');
  const { token, expiresAt } = generateHourlyToken(0);
  assert.ok(token.startsWith('FERMI-'), 'Token format must start with FERMI-');
  assert.ok(expiresAt instanceof Date, 'ExpiresAt must be a valid Date object');
  
  // Valid token check
  const isValid = validateAttendanceToken(token);
  assert.equal(isValid, true, 'Current hour token must be valid');

  // Tampered token check
  const isTampered = validateAttendanceToken(token + 'INVALID');
  assert.equal(isTampered, false, 'Tampered token must be rejected');

  // Completely fake token
  const isFake = validateAttendanceToken('FERMI-20200101-12-000000');
  assert.equal(isFake, false, 'Expired/fake token must be rejected');

  const secsLeft = getSecondsRemainingInHour();
  assert.ok(secsLeft >= 0 && secsLeft <= 3600, 'Seconds remaining in hour must be between 0 and 3600');
  console.log('  ✓ QR token generation, countdown, and anti-tamper validation passed.');

  // Test 2: Staggered Payday Calculation Logic
  console.log('\n[2/4] Testing Staggered Payday Calculation...');
  // Reference date: 2026-10-15 (Thursday)
  const refDate = new Date('2026-10-15T10:00:00');
  
  // Employee with payday on the 25th
  const payday25 = calculateNextPayday('25', refDate);
  assert.equal(payday25.nextDateStr, '2026-10-25', 'Next payday on 25th of current month');
  assert.equal(payday25.daysRemaining, 10, '10 days remaining until 25th');
  assert.equal(payday25.isDue, false, 'Not due yet on 15th');

  // Employee with payday on the 10th (already passed for current month -> moves to next month)
  const payday10 = calculateNextPayday('10', refDate);
  assert.equal(payday10.nextDateStr, '2026-11-10', 'Past payday moves to 10th of next month');
  assert.ok(payday10.daysRemaining > 0, 'Days remaining should be positive for next month');

  // Employee with weekly payday on Friday ('jumat')
  const paydayFriday = calculateNextPayday('jumat', refDate);
  // From Thursday Oct 15, next Friday is Oct 16
  assert.equal(paydayFriday.nextDateStr, '2026-10-16', 'Next Friday from Thursday is tomorrow');
  // Format check: Day name, date, month, year
  const formattedJoinDate = formatIndonesianDate('2025-02-14');
  assert.equal(formattedJoinDate, 'Jumat, 14 Februari 2025', 'Must format to "Jumat, 14 Februari 2025"');

  const formattedPayday = formatIndonesianDate('2026-10-27');
  assert.equal(formattedPayday, 'Selasa, 27 Oktober 2026', 'Must format to "Selasa, 27 Oktober 2026"');

  console.log('  ✓ Staggered payday calculations and Indonesian date formatting (Nama Hari, Tgl Bulan Tahun) passed.');

  // Test 3: Database & Seed Data Verification
  console.log('\n[3/4] Testing Database Layer and Schema Integrity...');
  const users = await queryAll('SELECT id, username, email, password, role FROM users');
  assert.equal(users.length, 13, 'Must have exactly 13 accounts (1 admin + 12 employees)');
  
  const admin = users.find((u) => u.role === 'admin');
  assert.ok(admin, 'Admin account must exist');
  assert.equal(admin.username, 'admin', 'Admin username must be "admin"');
  assert.equal(admin.password, '123', 'Admin password must be "123"');

  const employees = await queryAll('SELECT id, nik, name, scheme, base_rate, payday_rule, join_date FROM employees');
  assert.equal(employees.length, 12, 'Must have exactly 12 seeded employees');

  // Verify all 12 employees have password '123'
  for (const emp of employees) {
    const empUser = users.find((u) => u.employee_id === emp.id || u.id === emp.id + 1);
    assert.ok(empUser, `Account for employee ${emp.name} must exist`);
    assert.equal(empUser.password, '123', `Employee ${emp.name} password must be "123"`);
  }

  // Verify all 12 join dates are unique
  const joinDates = new Set(employees.map((e) => e.join_date));
  assert.equal(joinDates.size, 12, 'All 12 employees must have different join dates');

  // Verify each scheme has exactly 3 employees
  const perJam = employees.filter((e) => e.scheme === 'per_jam');
  const harian = employees.filter((e) => e.scheme === 'harian');
  const mingguan = employees.filter((e) => e.scheme === 'mingguan');
  const bulanan = employees.filter((e) => e.scheme === 'bulanan');
  assert.equal(perJam.length, 3, 'Must have 3 per_jam employees');
  assert.equal(harian.length, 3, 'Must have 3 harian employees');
  assert.equal(mingguan.length, 3, 'Must have 3 mingguan employees');
  assert.equal(bulanan.length, 3, 'Must have 3 bulanan employees');

  // Verify rates: per jam = 5rb, per hari = 45rb, minggu = 300rb, bulan = 1.5jt
  for (const emp of perJam) {
    assert.equal(Number(emp.base_rate), 5000, `Per jam rate for ${emp.name} must be 5000 (5rb)`);
  }
  for (const emp of harian) {
    assert.equal(Number(emp.base_rate), 45000, `Harian rate for ${emp.name} must be 45000 (45rb)`);
  }
  for (const emp of mingguan) {
    assert.equal(Number(emp.base_rate), 300000, `Mingguan rate for ${emp.name} must be 300000 (300rb)`);
  }
  for (const emp of bulanan) {
    assert.equal(Number(emp.base_rate), 1500000, `Bulanan rate for ${emp.name} must be 1500000 (1.5jt)`);
  }

  console.log(`  ✓ Database seeded successfully with 1 admin and 12 employees across all 4 compensation schemes.`);

  // Test 4: Attendance & Historical Payroll Settlements Integrity
  console.log('\n[4/4] Testing Attendance and Historical Payroll Settlements...');
  const attendanceCount = (await queryOne('SELECT COUNT(*) as count FROM attendance'))?.count || 0;
  assert.ok(attendanceCount > 500, 'Must have recorded comprehensive September & October attendance records');
  console.log(`  ✓ Attendance engine holds ${attendanceCount} verified scan records.`);

  // Verify Karyawan 2 in each scheme (id: 2, 5, 8, 11) has 1x late and 1x absent in September
  for (const empId of [2, 5, 8, 11]) {
    const lates = await queryAll('SELECT id FROM attendance WHERE employee_id = ? AND date LIKE "2026-09-%" AND status = "terlambat"', [empId]);
    assert.equal(lates.length, 1, `Employee ${empId} must have exactly 1 late attendance in September`);
    const absentDate = await queryOne('SELECT id FROM attendance WHERE employee_id = ? AND date = "2026-09-22"', [empId]);
    assert.equal(absentDate, null, `Employee ${empId} must be absent on 2026-09-22 in September`);
  }

  // Verify settlements: Karyawan 1 & 2 have settlements, Karyawan 3 (id: 3, 6, 9, 12) have NO settlements (belum dibayarkan)
  const settlements = await queryAll('SELECT id, employee_id, scheme, total_units, amount_paid FROM payroll_settlements');
  assert.ok(settlements.length >= 10, 'Must have seeded historical settlements for paid employees');
  
  for (const unpaidId of [3, 6, 9, 12]) {
    const count = settlements.filter((s) => s.employee_id === unpaidId).length;
    assert.equal(count, 0, `Employee ${unpaidId} (case 3) must NOT have settlements (belum terbayarkan)`);
  }
  for (const paidId of [1, 2, 4, 5, 7, 8, 10, 11]) {
    const count = settlements.filter((s) => s.employee_id === paidId).length;
    assert.ok(count > 0, `Employee ${paidId} (case 1 & 2) must have settlements (sudah dibayarkan)`);
  }
  console.log(`  ✓ Historical payroll settlements verified with ${settlements.length} slips across all 4 compensation schemes.`);

  // Test Realtime Payroll Calculation across all schemes
  const payrollItems = await computeAllRealtimePayroll();
  assert.ok(payrollItems.length >= 12, 'Must calculate realtime payroll with separate daily rows for hourly/daily employees');
  const hourlyItem = payrollItems.find((p) => p.employee.scheme === 'per_jam');
  assert.ok(hourlyItem, 'Hourly employee item must exist');
  assert.equal(hourlyItem.next_payday, 'Hari Ini', 'Hourly employee payday must be "Hari Ini"');
  assert.equal(hourlyItem.is_due, true, 'Hourly employee must be payable today');

  // Verify hourly and daily are NOT single accumulated rows
  const jamaludinRows = payrollItems.filter((p) => p.employee.name.includes('Jamaludin'));
  assert.ok(jamaludinRows.length >= 2, 'Jamaludin (per_jam) must have multiple daily records, not 1 accumulated row');

  const hadiRows = payrollItems.filter((p) => p.employee.name.includes('Hadi Supriyanto'));
  assert.ok(hadiRows.length >= 10, 'Hadi (harian) must have multiple daily records, not 1 accumulated row');

  // Verify mingguan has / 6 and bulanan has / 26
  const mingguanItem = payrollItems.find((p) => p.employee.scheme === 'mingguan');
  assert.ok(mingguanItem.attendance_label.includes('/ 6'), 'Mingguan attendance must show X / 6 Hari Kerja');

  const bulananItem = payrollItems.find((p) => p.employee.scheme === 'bulanan');
  assert.ok(bulananItem.attendance_label.includes('/ 26'), 'Bulanan attendance must show X / 26 Hari Kerja');
  console.log(`  ✓ Realtime payroll calculations verified with ${payrollItems.length} unbilled items across all 4 compensation schemes (hourly/daily individual rows, weekly / 6, monthly / 26).`);

  console.log('\n🎉 ALL FERMI PAYROLL & PRESENSI TESTS PASSED SUCCESSFULLY!\n');
}

runTests().catch((err) => {
  console.error('\n❌ Test execution failed:', err);
  process.exit(1);
});
