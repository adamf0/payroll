-- MariaDB / MySQL Schema for Fermi Payroll & Attendance System

CREATE DATABASE IF NOT EXISTS fermi_payroll CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE fermi_payroll;

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(191) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  name VARCHAR(191) NOT NULL,
  role ENUM('admin', 'karyawan') NOT NULL DEFAULT 'karyawan',
  employee_id INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS employees (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nik VARCHAR(64) NOT NULL UNIQUE,
  name VARCHAR(191) NOT NULL,
  phone VARCHAR(64) NOT NULL,
  join_date DATE NOT NULL,
  scheme ENUM('per_jam', 'harian', 'mingguan', 'bulanan') NOT NULL DEFAULT 'bulanan',
  base_rate DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
  payday_rule VARCHAR(32) NOT NULL DEFAULT '25', -- e.g. '25', '1', '10', 'jumat'
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS attendance (
  id INT AUTO_INCREMENT PRIMARY KEY,
  employee_id INT NOT NULL,
  date DATE NOT NULL,
  check_in TIME NOT NULL,
  check_out TIME NULL,
  duration_minutes INT NOT NULL DEFAULT 0,
  status ENUM('hadir', 'terlambat', 'lembur') NOT NULL DEFAULT 'hadir',
  qr_token VARCHAR(64) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_emp_date (employee_id, date)
);

CREATE TABLE IF NOT EXISTS payroll_settlements (
  id INT AUTO_INCREMENT PRIMARY KEY,
  employee_id INT NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  scheme VARCHAR(32) NOT NULL,
  total_units DECIMAL(10, 2) NOT NULL, -- total hours, days, or fixed 1
  rate DECIMAL(15, 2) NOT NULL,
  amount_paid DECIMAL(15, 2) NOT NULL,
  settled_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  notes TEXT NULL
);
