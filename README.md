# Fermi Payroll & Presensi Realtime

Sistem presensi terverifikasi dengan QR Code dinamis anti-curang dan mesin kalkulasi payroll real-time berbasis Astro dan MariaDB.

---

## Fitur Utama

1. **Layar Utama & Kiosk QR Dinamis (Anti-Curang)**:
   - QR Code berubah otomatis setiap 1 jam dan unik setiap hari menggunakan HMAC token.
   - Mencegah titip absen dan penyebaran screenshot QR lawas.
   - Dilengkapi widget hitung mundur live rotasi QR dan simulator presensi langsung.

2. **Skema Penggajian Fleksibel**:
   - **Per Jam (Hourly)**: Akumulasi jam kerja aktual × tarif per jam.
   - **Harian (Daily)**: Hari kehadiran aktual × tarif harian.
   - **Mingguan (Weekly)**: Hak upah per minggu dengan siklus pembayaran mingguan (misal tiap hari Jumat).
   - **Bulanan (Monthly)**: Gaji pokok bulanan yang disinkronkan dengan rekap absensi.

3. **Staggered Payday Dates (Tanggal Gajian Kustom)**:
   - Setiap karyawan dapat memiliki tanggal gajian berbeda (misal: tgl 1, 10, 25, 28, atau hari Jumat).
   - Sistem mendeteksi otomatis hitung mundur sisa hari menuju gajian dan memberikan penanda "Siap Dicairkan".

4. **Hak Akses 2 Level (RBAC)**:
   - **Admin**:
     - Executive KPI Dashboard.
     - CRUD Karyawan (data pribadi, tanggal kerja, skema gaji, tanggal gajian).
     - Monitoring Presensi Realtime (log masuk, pulang, durasi, status tepat/terlambat).
     - Payroll Realtime Ledger dengan tombol aksi pelunasan gaji dan audit trail.
   - **Karyawan**:
     - Dashboard personal (jam kerja bulan berjalan, sisa hari menuju gajian).
     - Presensi mandiri (input token QR live & riwayat absensi).
     - Payroll & Slip Gaji digital (rincian komponen & cetak slip resmi).

5. **Dukungan Basis Data Ganda (Dual-Mode DB)**:
   - **MariaDB / MySQL**: Konfigurasi via variabel lingkungan (`DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`). Skema lengkap tersedia di `schema.sql`.
   - **Embedded SQLite Fallback**: Langsung aktif otomatis di lokal jika MariaDB belum terhubung, sehingga aplikasi dapat dijalankan instan tanpa dependensi server DB eksternal.

---

## Akun Pengujian Cepat

| Role | Email | Password | Keterangan |
|------|-------|----------|------------|
| **Admin** | `admin@fermi.io` | `admin123` | Akses penuh manajemen HR & Payroll |
| **Karyawan (Per Jam)** | `budi@fermi.io` | `karyawan123` | Budi Santoso (Rp 45.000/jam, Payday Tgl 25) |
| **Karyawan (Bulanan)** | `siti@fermi.io` | `karyawan123` | Siti Rahmawati (Rp 8.500.000/bln, Payday Tgl 1) |
| **Karyawan (Harian)** | `agus@fermi.io` | `karyawan123` | Agus Setiawan (Rp 185.000/hari, Payday Tgl 10) |
| **Karyawan (Mingguan)** | `dewi@fermi.io` | `karyawan123` | Dewi Lestari (Rp 1.500.000/mgg, Payday Jumat) |

---

## Menjalankan Aplikasi

### 1. Mode Development
```bash
npm run dev
```
Buka browser di `http://localhost:4321`.

### 2. Menjalankan Test Suite
```bash
npm test
```

### 3. Build & Production Start
```bash
npm run build
npm start
```
