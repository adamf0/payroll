import mysql from 'mysql2/promise';

let mysqlPool: mysql.Pool | null = null;
let sqliteDb: any = null;
let isUsingMariaDb = true;

// MariaDB / MySQL configuration (Default to local MariaDB)
const DB_HOST = process.env.DB_HOST || '127.0.0.1';
const DB_PORT = Number(process.env.DB_PORT || 3306);
const DB_USER = process.env.DB_USER || 'root';
const DB_PASSWORD = process.env.DB_PASSWORD || '';
const DB_NAME = process.env.DB_NAME || 'fermi_payroll';

/**
 * Initialize database connection and schemas
 */
export async function getDb() {
  if (mysqlPool) {
    return { isMariaDb: true };
  }

  try {
    // 1. Ensure database exists
    const adminConn = await mysql.createConnection({
      host: DB_HOST,
      port: DB_PORT,
      user: DB_USER,
      password: DB_PASSWORD,
    });
    await adminConn.query(`CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`);
    await adminConn.end();

    // 2. Create connection pool to the database
    mysqlPool = mysql.createPool({
      host: DB_HOST,
      port: DB_PORT,
      user: DB_USER,
      password: DB_PASSWORD,
      database: DB_NAME,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      dateStrings: true, // Preserve YYYY-MM-DD date strings without UTC shifting
    });

    const conn = await mysqlPool.getConnection();
    conn.release();
    isUsingMariaDb = true;
    console.log(`[DB] Connected to MariaDB at ${DB_HOST}:${DB_PORT}/${DB_NAME}`);

    await initMariaDbSchema();
    await seedMariaDbData();

    return { isMariaDb: true };
  } catch (err: any) {
    console.warn(`[DB] MariaDB connection failed (${err.message}). Falling back to local embedded SQLite.`);
    return initSqliteFallback();
  }
}

async function initMariaDbSchema() {
  if (!mysqlPool) return;

  const queries = [
    `CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(64) NULL UNIQUE,
      email VARCHAR(191) NOT NULL UNIQUE,
      password VARCHAR(255) NOT NULL,
      name VARCHAR(191) NOT NULL,
      role VARCHAR(32) NOT NULL DEFAULT 'karyawan',
      employee_id INT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS employees (
      id INT AUTO_INCREMENT PRIMARY KEY,
      nik VARCHAR(64) NOT NULL UNIQUE,
      name VARCHAR(191) NOT NULL,
      phone VARCHAR(64) NOT NULL,
      join_date DATE NOT NULL,
      scheme VARCHAR(32) NOT NULL DEFAULT 'bulanan',
      base_rate DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
      payday_rule VARCHAR(32) NOT NULL DEFAULT '25',
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS attendance (
      id INT AUTO_INCREMENT PRIMARY KEY,
      employee_id INT NOT NULL,
      date DATE NOT NULL,
      check_in TIME NOT NULL,
      check_out TIME NULL,
      duration_minutes INT NOT NULL DEFAULT 0,
      status VARCHAR(32) NOT NULL DEFAULT 'hadir',
      qr_token VARCHAR(64) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_emp_date (employee_id, date)
    )`,
    `CREATE TABLE IF NOT EXISTS payroll_settlements (
      id INT AUTO_INCREMENT PRIMARY KEY,
      employee_id INT NOT NULL,
      period_start DATE NOT NULL,
      period_end DATE NOT NULL,
      scheme VARCHAR(32) NOT NULL,
      total_units DECIMAL(10, 2) NOT NULL,
      rate DECIMAL(15, 2) NOT NULL,
      amount_paid DECIMAL(15, 2) NOT NULL,
      settled_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      notes TEXT NULL
    )`
  ];

  for (const q of queries) {
    await mysqlPool.query(q);
  }

  try {
    await mysqlPool.query("ALTER TABLE users ADD COLUMN username VARCHAR(64) NULL UNIQUE AFTER id;");
  } catch (err) {
    // Column already exists
  }

  try {
    await mysqlPool.query("ALTER TABLE employees DROP COLUMN email;");
  } catch (err) {
    // Column already dropped or does not exist
  }
}

async function seedMariaDbData() {
  if (!mysqlPool) return;

  const [userRows] = await mysqlPool.query<any[]>('SELECT COUNT(*) as count FROM users');
  const count = userRows[0]?.count || 0;
  const [adminRow] = await mysqlPool.query<any[]>("SELECT password FROM users WHERE role = 'admin' LIMIT 1");
  const adminPass = adminRow[0]?.password;
  const [emp1Row] = await mysqlPool.query<any[]>("SELECT base_rate FROM employees WHERE id = 1 LIMIT 1");
  const emp1Rate = Number(emp1Row[0]?.base_rate || 0);

  // Re-seed if fewer than 13 users, admin password is not '123', or base_rate doesn't match 5000
  if (count < 13 || adminPass !== '123' || emp1Rate !== 5000) {
    console.log('[DB] Seeding complete 12 employees + 1 admin MariaDB dataset with updated wage rates...');

    await mysqlPool.query('SET FOREIGN_KEY_CHECKS = 0');
    await mysqlPool.query('TRUNCATE TABLE attendance');
    await mysqlPool.query('TRUNCATE TABLE payroll_settlements');
    await mysqlPool.query('TRUNCATE TABLE users');
    await mysqlPool.query('TRUNCATE TABLE employees');
    await mysqlPool.query('SET FOREIGN_KEY_CHECKS = 1');

    // 1. Admin Account: user: admin, pass: 123
    await mysqlPool.execute(
      'INSERT INTO users (username, email, password, name, role, employee_id) VALUES (?, ?, ?, ?, ?, ?)',
      ['admin', 'admin@fermi.io', '123', 'Administrator HR', 'admin', null]
    );

    // 2. 12 Employees (3 per scheme)
    // Tarif: per jam 5rb, per hari 45rb, minggu 300rb, bulan 1.5jt.
    // Tanggal masuk berbeda satu sama lain across all 12 employees.
    const employees = [
      // === SKEMA PER JAM (3 Karyawan) - Tarif: Rp 5.000 / jam ===
      // 1. Lengkap bulan kemarin hingga kemarin, sudah dibayarkan
      {
        nik: 'EMP-001',
        name: 'Jamaludin Firdaus',
        username: 'jamal',
        email: 'jamal@fermi.io',
        phone: '081234567001',
        join_date: '2024-02-15',
        scheme: 'per_jam',
        base_rate: 5000,
        payday_rule: '25',
        is_active: 1,
      },
      // 2. Bulan kemarin terlambat 1x dan tidak masuk 1x, bulan ini lengkap, sudah dibayarkan
      {
        nik: 'EMP-002',
        name: 'Joko Prasetyo',
        username: 'joko',
        email: 'joko@fermi.io',
        phone: '081234567002',
        join_date: '2024-06-20',
        scheme: 'per_jam',
        base_rate: 5000,
        payday_rule: '25',
        is_active: 1,
      },
      // 3. Lengkap bulan kemarin, belum terbayarkan
      {
        nik: 'EMP-003',
        name: 'Jihan Safira',
        username: 'jihan',
        email: 'jihan@fermi.io',
        phone: '081234567003',
        join_date: '2025-01-10',
        scheme: 'per_jam',
        base_rate: 5000,
        payday_rule: '25',
        is_active: 1,
      },

      // === SKEMA HARIAN (3 Karyawan) - Tarif: Rp 45.000 / hari ===
      // 4. Lengkap bulan kemarin hingga kemarin, sudah dibayarkan
      {
        nik: 'EMP-004',
        name: 'Hadi Supriyanto',
        username: 'hadi',
        email: 'hadi@fermi.io',
        phone: '081234567004',
        join_date: '2024-04-12',
        scheme: 'harian',
        base_rate: 45000,
        payday_rule: '10',
        is_active: 1,
      },
      // 5. Bulan kemarin terlambat 1x dan tidak masuk 1x, bulan ini lengkap, sudah dibayarkan
      {
        nik: 'EMP-005',
        name: 'Hana Farida',
        username: 'hana',
        email: 'hana@fermi.io',
        phone: '081234567005',
        join_date: '2024-09-25',
        scheme: 'harian',
        base_rate: 45000,
        payday_rule: '10',
        is_active: 1,
      },
      // 6. Lengkap bulan kemarin, belum terbayarkan
      {
        nik: 'EMP-006',
        name: 'Hendra Wibowo',
        username: 'hendra',
        email: 'hendra@fermi.io',
        phone: '081234567006',
        join_date: '2025-02-08',
        scheme: 'harian',
        base_rate: 45000,
        payday_rule: '10',
        is_active: 1,
      },

      // === SKEMA MINGGUAN (3 Karyawan) - Tarif: Rp 300.000 / minggu ===
      // 7. Lengkap bulan kemarin hingga kemarin, sudah dibayarkan
      {
        nik: 'EMP-007',
        name: 'Mira Astuti',
        username: 'mira',
        email: 'mira@fermi.io',
        phone: '081234567007',
        join_date: '2024-03-18',
        scheme: 'mingguan',
        base_rate: 300000,
        payday_rule: 'jumat',
        is_active: 1,
      },
      // 8. Bulan kemarin terlambat 1x dan tidak masuk 1x, bulan ini lengkap, sudah dibayarkan
      {
        nik: 'EMP-008',
        name: 'Maulana Malik',
        username: 'maulana',
        email: 'maulana@fermi.io',
        phone: '081234567008',
        join_date: '2024-08-11',
        scheme: 'mingguan',
        base_rate: 300000,
        payday_rule: 'jumat',
        is_active: 1,
      },
      // 9. Lengkap bulan kemarin, belum terbayarkan
      {
        nik: 'EMP-009',
        name: 'Mega Suryani',
        username: 'mega',
        email: 'mega@fermi.io',
        phone: '081234567009',
        join_date: '2025-03-14',
        scheme: 'mingguan',
        base_rate: 300000,
        payday_rule: 'jumat',
        is_active: 1,
      },

      // === SKEMA BULANAN (3 Karyawan) - Tarif: Rp 1.500.000 / bulan ===
      // 10. Lengkap bulan kemarin hingga kemarin, sudah dibayarkan
      {
        nik: 'EMP-010',
        name: 'Budi Hartono',
        username: 'budi',
        email: 'budi@fermi.io',
        phone: '081234567010',
        join_date: '2023-11-05',
        scheme: 'bulanan',
        base_rate: 1500000,
        payday_rule: '28',
        is_active: 1,
      },
      // 11. Bulan kemarin terlambat 1x dan tidak masuk 1x, bulan ini lengkap, sudah dibayarkan
      {
        nik: 'EMP-011',
        name: 'Bayu Pratama',
        username: 'bayu',
        email: 'bayu@fermi.io',
        phone: '081234567011',
        join_date: '2024-05-19',
        scheme: 'bulanan',
        base_rate: 1500000,
        payday_rule: '28',
        is_active: 1,
      },
      // 12. Lengkap bulan kemarin, belum terbayarkan
      {
        nik: 'EMP-012',
        name: 'Bella Anggraini',
        username: 'bella',
        email: 'bella@fermi.io',
        phone: '081234567012',
        join_date: '2025-04-01',
        scheme: 'bulanan',
        base_rate: 1500000,
        payday_rule: '28',
        is_active: 1,
      },
    ];

    for (const emp of employees) {
      const [res]: any = await mysqlPool.execute(
        `INSERT INTO employees (nik, name, phone, join_date, scheme, base_rate, payday_rule, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [emp.nik, emp.name, emp.phone, emp.join_date, emp.scheme, emp.base_rate, emp.payday_rule, emp.is_active]
      );
      const empId = res.insertId;
      // Akun Karyawan: user: [bebas], pass: 123
      await mysqlPool.execute(
        'INSERT INTO users (username, email, password, name, role, employee_id) VALUES (?, ?, ?, ?, ?, ?)',
        [emp.username, emp.email, '123', emp.name, 'karyawan', empId]
      );
    }

    // 3. Attendance Logs
    // Bulan kemarin (September 2026: 2026-09-01 s/d 2026-09-30)
    // Bulan ini hingga kemarin (Oktober 2026: 2026-10-01 s/d 2026-10-26)
    // Hari ini (2026-10-27)
    const lateAndAbsentEmpIds = [2, 5, 8, 11]; // Karyawan ke-2 di tiap skema

    function getDatesInRange(startDateStr: string, endDateStr: string): string[] {
      const dates: string[] = [];
      const [sy, sm, sd] = startDateStr.split('-').map(Number);
      const [ey, em, ed] = endDateStr.split('-').map(Number);
      const curr = new Date(sy, sm - 1, sd);
      const end = new Date(ey, em - 1, ed);
      while (curr <= end) {
        const y = curr.getFullYear();
        const m = String(curr.getMonth() + 1).padStart(2, '0');
        const day = String(curr.getDate()).padStart(2, '0');
        dates.push(`${y}-${m}-${day}`);
        curr.setDate(curr.getDate() + 1);
      }
      return dates;
    }

    // A. September 2026
    const sepDates = getDatesInRange('2026-09-01', '2026-09-30');
    for (const dateStr of sepDates) {
      const [y, m, day] = dateStr.split('-').map(Number);
      const d = new Date(y, m - 1, day);
      if (d.getDay() === 0) continue; // Skip Sunday

      for (let empId = 1; empId <= 12; empId++) {
        const isLateAbsentProfile = lateAndAbsentEmpIds.includes(empId);

        if (isLateAbsentProfile) {
          // 1x Tidak Masuk pada 22 September 2026
          if (dateStr === '2026-09-22') {
            continue;
          }
          // 1x Terlambat pada 10 September 2026
          if (dateStr === '2026-09-10') {
            await mysqlPool.execute(
              `INSERT INTO attendance (employee_id, date, check_in, check_out, duration_minutes, status, qr_token)
               VALUES (?, ?, ?, ?, ?, ?, ?)`,
              [empId, dateStr, '08:42:00', '16:30:00', 468, 'terlambat', `FERMI-${dateStr.replace(/-/g, '')}-08-SEP`]
            );
            continue;
          }
        }

        // Hari kerja normal lainnya
        await mysqlPool.execute(
          `INSERT INTO attendance (employee_id, date, check_in, check_out, duration_minutes, status, qr_token)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [empId, dateStr, '08:00:00', '16:00:00', 480, 'hadir', `FERMI-${dateStr.replace(/-/g, '')}-08-SEP`]
        );
      }
    }

    // B. Oktober 2026 (1 s/d 26 Okt - hingga kemarin)
    const octDates = getDatesInRange('2026-10-01', '2026-10-26');
    for (const dateStr of octDates) {
      const [y, m, day] = dateStr.split('-').map(Number);
      const d = new Date(y, m - 1, day);
      if (d.getDay() === 0) continue; // Skip Sunday

      for (let empId = 1; empId <= 12; empId++) {
        // Bulan ini lengkap hadir untuk semua karyawan
        await mysqlPool.execute(
          `INSERT INTO attendance (employee_id, date, check_in, check_out, duration_minutes, status, qr_token)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [empId, dateStr, '08:00:00', '16:00:00', 480, 'hadir', `FERMI-${dateStr.replace(/-/g, '')}-08-OCT`]
        );
      }
    }

    // C. Hari ini (2026-10-27) - Presensi pagi
    for (let empId = 1; empId <= 12; empId++) {
      await mysqlPool.execute(
        `INSERT INTO attendance (employee_id, date, check_in, check_out, duration_minutes, status, qr_token)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [empId, '2026-10-27', '08:00:00', '16:00:00', 480, 'hadir', `FERMI-20261027-08-TODAY`]
      );
    }

    // 4. Payroll Settlements
    // Karyawan 1 & 2 di setiap skema sudah dibayarkan (sudah ada slip riwayat pembayaran).
    // Karyawan 3 di setiap skema belum terbayarkan (TIDAK ADA data settlement di database).
    const settlements = [
      // === SKEMA JAM (Karyawan 1 & 2 sudah dibayarkan) - rate: 5.000/jam ===
      // Jamaludin Firdaus (EMP-001) - rate 5.000/jam
      {
        employee_id: 1,
        period_start: '2026-08-26',
        period_end: '2026-09-25',
        scheme: 'per_jam',
        total_units: 208,
        rate: 5000,
        amount_paid: 1040000,
        settled_at: '2026-09-25 17:00:00',
        notes: 'Slip Gaji Jam Kerja Periode September 2026 (208 Jam × Rp 5.000) - Lunas',
      },
      {
        employee_id: 1,
        period_start: '2026-09-26',
        period_end: '2026-10-25',
        scheme: 'per_jam',
        total_units: 176,
        rate: 5000,
        amount_paid: 880000,
        settled_at: '2026-10-25 17:00:00',
        notes: 'Slip Gaji Jam Kerja Periode Oktober 2026 (176 Jam × Rp 5.000) - Lunas',
      },
      // Joko Prasetyo (EMP-002) - rate 5.000/jam (potongan telat & alpa 1x)
      {
        employee_id: 2,
        period_start: '2026-08-26',
        period_end: '2026-09-25',
        scheme: 'per_jam',
        total_units: 190,
        rate: 5000,
        amount_paid: 950000,
        settled_at: '2026-09-25 17:00:00',
        notes: 'Slip Gaji September 2026 (Sudah dibayar 190 jam, potongan 1x alpa & 1x telat)',
      },
      {
        employee_id: 2,
        period_start: '2026-09-26',
        period_end: '2026-10-25',
        scheme: 'per_jam',
        total_units: 176,
        rate: 5000,
        amount_paid: 880000,
        settled_at: '2026-10-25 17:00:00',
        notes: 'Slip Gaji Jam Kerja Periode Oktober 2026 (176 Jam Penuh) - Lunas',
      },

      // === SKEMA HARIAN (Karyawan 4 & 5 sudah dibayarkan) - rate: 45.000/hari ===
      // Hadi Supriyanto (EMP-004) - rate 45.000/hari
      {
        employee_id: 4,
        period_start: '2026-08-11',
        period_end: '2026-09-10',
        scheme: 'harian',
        total_units: 26,
        rate: 45000,
        amount_paid: 1170000,
        settled_at: '2026-09-10 17:00:00',
        notes: 'Slip Gaji Harian Periode 10 September 2026 (26 Hari Hadir × Rp 45.000) - Lunas',
      },
      {
        employee_id: 4,
        period_start: '2026-09-11',
        period_end: '2026-10-10',
        scheme: 'harian',
        total_units: 25,
        rate: 45000,
        amount_paid: 1125000,
        settled_at: '2026-10-10 17:00:00',
        notes: 'Slip Gaji Harian Periode 10 Oktober 2026 (25 Hari Hadir × Rp 45.000) - Lunas',
      },
      // Hana Farida (EMP-005) - rate 45.000/hari
      {
        employee_id: 5,
        period_start: '2026-08-11',
        period_end: '2026-09-10',
        scheme: 'harian',
        total_units: 24,
        rate: 45000,
        amount_paid: 1080000,
        settled_at: '2026-09-10 17:00:00',
        notes: 'Slip Gaji Harian September (Sudah dibayar 24 hari hadir × Rp 45.000, 1 hari absen)',
      },
      {
        employee_id: 5,
        period_start: '2026-09-11',
        period_end: '2026-10-10',
        scheme: 'harian',
        total_units: 25,
        rate: 45000,
        amount_paid: 1125000,
        settled_at: '2026-10-10 17:00:00',
        notes: 'Slip Gaji Harian Periode 10 Oktober 2026 (25 Hari Penuh × Rp 45.000) - Lunas',
      },

      // === SKEMA MINGGUAN (Karyawan 7 & 8 sudah dibayarkan) - rate: 300.000/minggu ===
      // Mira Astuti (EMP-007) - rate 300.000/minggu
      {
        employee_id: 7,
        period_start: '2026-09-01',
        period_end: '2026-09-25',
        scheme: 'mingguan',
        total_units: 4,
        rate: 300000,
        amount_paid: 1200000,
        settled_at: '2026-09-25 17:00:00',
        notes: 'Slip Gaji Mingguan September 2026 (4 Minggu Penuh × Rp 300.000) - Lunas',
      },
      {
        employee_id: 7,
        period_start: '2026-10-01',
        period_end: '2026-10-23',
        scheme: 'mingguan',
        total_units: 3,
        rate: 300000,
        amount_paid: 900000,
        settled_at: '2026-10-23 17:00:00',
        notes: 'Slip Gaji Mingguan Oktober 2026 (3 Minggu × Rp 300.000) - Lunas',
      },
      // Maulana Malik (EMP-008) - rate 300.000/minggu
      {
        employee_id: 8,
        period_start: '2026-09-01',
        period_end: '2026-09-25',
        scheme: 'mingguan',
        total_units: 3.83,
        rate: 300000,
        amount_paid: 1150000,
        settled_at: '2026-09-25 17:00:00',
        notes: 'Slip Gaji Mingguan September (Sudah dibayar 23 hari hadir, potongan 1 hari absen)',
      },
      {
        employee_id: 8,
        period_start: '2026-10-01',
        period_end: '2026-10-23',
        scheme: 'mingguan',
        total_units: 3,
        rate: 300000,
        amount_paid: 900000,
        settled_at: '2026-10-23 17:00:00',
        notes: 'Slip Gaji Mingguan Oktober 2026 (3 Minggu × Rp 300.000) - Lunas',
      },

      // === SKEMA BULANAN (Karyawan 10 & 11 sudah dibayarkan) - rate: 1.500.000/bulan ===
      // Budi Hartono (EMP-010) - rate 1.500.000/bulan
      {
        employee_id: 10,
        period_start: '2026-09-01',
        period_end: '2026-09-30',
        scheme: 'bulanan',
        total_units: 1,
        rate: 1500000,
        amount_paid: 1500000,
        settled_at: '2026-09-28 17:00:00',
        notes: 'Slip Gaji Bulanan September 2026 (Lunas Penuh Rp 1.500.000)',
      },
      // Bayu Pratama (EMP-011) - rate 1.500.000/bulan
      {
        employee_id: 11,
        period_start: '2026-09-01',
        period_end: '2026-09-30',
        scheme: 'bulanan',
        total_units: 1,
        rate: 1500000,
        amount_paid: 1442308,
        settled_at: '2026-09-28 17:00:00',
        notes: 'Slip Gaji Bulanan September 2026 (Sudah dibayar 25/26 hari hadir, potongan 1 hari absen)',
      },
      // Karyawan 3, 6, 9, 12 (Jihan, Hendra, Mega, Bella) TIDAK ADA di settlements (Belum Terbayarkan)
    ];

    for (const s of settlements) {
      await mysqlPool.execute(
        `INSERT INTO payroll_settlements (employee_id, period_start, period_end, scheme, total_units, rate, amount_paid, settled_at, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [s.employee_id, s.period_start, s.period_end, s.scheme, s.total_units, s.rate, s.amount_paid, s.settled_at, s.notes]
      );
    }

    console.log(`[DB] Seeded ${settlements.length} historical settlements into MariaDB with updated wage rates.`);
  }
}

/**
 * Fallback to embedded SQLite only if MariaDB is unavailable
 */
async function initSqliteFallback() {
  const sqliteModule = (process as any).getBuiltinModule
    ? (process as any).getBuiltinModule('node:sqlite')
    : await import('node:sqlite');
  const { DatabaseSync } = sqliteModule;
  sqliteDb = new DatabaseSync(':memory:');
  isUsingMariaDb = false;

  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'karyawan',
      employee_id INTEGER NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS employees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nik TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      join_date TEXT NOT NULL,
      scheme TEXT NOT NULL DEFAULT 'bulanan',
      base_rate REAL NOT NULL DEFAULT 0,
      payday_rule TEXT NOT NULL DEFAULT '25',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS attendance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      check_in TEXT NOT NULL,
      check_out TEXT NULL,
      duration_minutes INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'hadir',
      qr_token TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS payroll_settlements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL,
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      scheme TEXT NOT NULL,
      total_units REAL NOT NULL,
      rate REAL NOT NULL,
      amount_paid REAL NOT NULL,
      settled_at TEXT DEFAULT CURRENT_TIMESTAMP,
      notes TEXT NULL
    );
  `);

  return { isMariaDb: false };
}

/**
 * Universal Query Helpers
 */
export async function queryAll<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  await getDb();
  if (isUsingMariaDb && mysqlPool) {
    const [rows] = await mysqlPool.query(sql, params);
    return rows as T[];
  }
  const stmt = sqliteDb.prepare(sql);
  return stmt.all(...params) as T[];
}

export async function queryOne<T = any>(sql: string, params: any[] = []): Promise<T | null> {
  await getDb();
  if (isUsingMariaDb && mysqlPool) {
    const [rows] = await mysqlPool.query(sql, params);
    const arr = rows as T[];
    return arr.length > 0 ? arr[0] : null;
  }
  const stmt = sqliteDb.prepare(sql);
  const row = stmt.get(...params);
  return (row as T) || null;
}

export async function execute(sql: string, params: any[] = []): Promise<{ insertId?: number; changes: number }> {
  await getDb();
  if (isUsingMariaDb && mysqlPool) {
    const [res] = await mysqlPool.execute(sql, params);
    const result = res as any;
    return { insertId: Number(result.insertId), changes: Number(result.affectedRows) };
  }
  const stmt = sqliteDb.prepare(sql);
  const info = stmt.run(...params);
  return { insertId: Number(info.lastInsertRowid), changes: Number(info.changes) };
}
