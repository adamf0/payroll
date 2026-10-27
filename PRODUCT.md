# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Astro (SSR), MariaDB

## Users

- **Admin / HR & Finance**: Mengelola data karyawan, memantau kehadiran real-time, mengonfigurasi skema gaji dan tanggal pembayaran fleksibel, serta mengontrol pencairan payroll.
- **Karyawan**: Mengakses dashboard personal, mengecek hak dan rincian payroll pribadi, serta mencatatkan presensi via scan QR.
- **Office Display / Kiosk**: Layar publik di lokasi kerja yang menampilkan informasi aplikasi dan QR presensi dinamis yang terotasi secara otomatis.

## Product Purpose

Menghadirkan sistem presensi dan payroll terintegrasi yang akurat, anti-curang, dan real-time untuk operasional bisnis dengan jadwal gajian beragam dan skema kompensasi multivariasi (per jam, harian, mingguan, bulanan).

## Positioning

Sistem payroll dan presensi berbasis Astro dan MariaDB yang ringan, instan, interaktif, dan terkontrol ketat. Mengeliminasi titip absen lewat dynamic time-sliced QR rotation dan menyajikan kalkulasi estimasi gaji berjalan secara real-time.

## Operating Context

- Aplikasi web SSR menggunakan Astro yang terhubung langsung ke basis data MariaDB.
- Halaman publik berfungsi ganda: landing page profil produk dan display layar QR absensi dinamis yang berganti tiap jam dan unik setiap hari.
- Autentikasi berbasis peran (Role-Based Access Control) dengan 2 tingkat hak akses: Admin dan Karyawan.

## Capabilities and Constraints

### Presensi & Anti-Fraud
- Halaman utama menampilkan QR code dinamis yang berganti setiap 1 jam dan unik setiap hari menggunakan token berbasis timestamp dan secret key.
- Mencegah kecurangan absensi (titip absen / screenshot QR lama).
- Validasi presensi real-time dengan pencatatan status datang, pulang, dan durasi kerja.

### Skema Payroll Fleksibel
- Mendukung penetapan tanggal gajian yang berbeda antar karyawan (staggered pay dates).
- Multi-skema kompensasi: per jam (hourly), harian (daily), mingguan (weekly), dan bulanan (monthly).
- Kalkulasi payroll berjalan secara real-time berdasarkan akumulasi jam kerja dan presensi aktual.

### Akses & Fitur Role
- **Admin**:
  - CRUD Karyawan: data pribadi, tanggal masuk kerja, tipe skema gaji, tanggal gajian, dan tarif upah.
  - Data Presensi Realtime: log absensi masuk/pulang hari ini beserta status kehadiran.
  - Data Payroll Realtime: kalkulasi upah terakumulasi yang harus dibayarkan, rincian potongan/tambahan, dan riwayat pembayaran.
- **Karyawan**:
  - Dashboard: ringkasan jam kerja bulan/periode berjalan.
  - Payroll: rincian slip dan estimasi upah yang akan diterima.
  - Presensi: antarmuka scan QR dan riwayat absensi mandiri.

### Constraints & Integrity
- Akses data terkontrol ketat: karyawan hanya berhak membaca data payroll dan absensi miliknya sendiri.
- Perhitungan upah harus presisi dan memiliki audit log transaksi di MariaDB.
- Menolak klaim atau data palsu (grounded reality).

## Brand Commitments

Simple, powerful, trustworthy, and controlled. Antarmuka cepat tanpa beban aset berlebih, navigasi to-the-point, interaksi responsif, dan kejelasan status finansial yang transparan.
