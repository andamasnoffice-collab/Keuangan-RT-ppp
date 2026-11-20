# Keuangan RT — Perum Puri Papahan

## Aplikasi dan akses
- Hosting web: GitHub Pages.
- Database: Firebase Realtime Database, project `keuangan-rt-ppp`, region `asia-southeast1`.
- SDK Firebase Web: 10.12.5.
- Pengunjung tanpa login hanya dapat membuka Dashboard publik dan Daftar Tunggakan.
- Pengguna yang berhasil login dapat mengelola data. Tidak ada pembagian role di aplikasi.
- Pembuatan akun dilakukan oleh pemilik proyek melalui Firebase Authentication; tidak ada CRUD pengguna di aplikasi.

## Data privat dan tampilan publik
- Data rumah, warga, pembayaran individual, deposit, meter, audit, dan transaksi rinci berada di node privat.
- Pengunjung hanya membaca `/public_views`.
- `/public_views` adalah proyeksi publik terbatas yang memuat ringkasan saldo kategori, total tunggakan per rumah dengan label blok, dan rincian pemasukan/pengeluaran per bulan yang telah disaring.
- Jangan menaruh nama kepala keluarga, nomor telepon, anggota keluarga, nomor rekening, atau rincian pembayaran individual di `/public_views`.
- Setiap perubahan keuangan penting mencoba memperbarui snapshot publik secara otomatis. Jika pembaruan gagal, transaksi utama tetap dilaporkan tersimpan dan kegagalan sinkronisasi dicatat di console; pengurus dapat menjalankan pembaruan manual dari Dashboard.

## Alur keuangan
1. Rumah dan tarif disimpan di Firebase.
2. Tagihan bulanan dibuat satu kali per periode melalui `billing_runs/{YYYY-MM}`.
3. Kas RT dan Sampah dibayar penuh per bulan dan checklist pembayaran berjalan berurutan. Air dapat dibayar sebagian; deposit Air digunakan hanya untuk tagihan Air.
4. Pembayaran mencatat tagihan, ledger tunggakan, pembayaran bulanan, transaksi, saldo kategori, audit, dan ringkasan bulanan.
5. Pengeluaran mengurangi saldo kategori yang dipilih dan masuk ke transaksi serta ringkasan bulanan.
6. Deposit warga dipisahkan dari saldo operasional. Penggunaan deposit untuk tagihan kategori yang sama dicatat pada ledger deposit.
7. Laporan tahunan merupakan snapshot; buat ulang setelah ada koreksi transaksi pada tahun terkait.

## Node Firebase utama
- Privat: `households`, `bills`, `arrearsLedger`, `arrearsSummary`, `fixed_advance_payments`, `paymentsByMonth`, `expensesByMonth`, `transactionsByMonth`, `deposits`, `deposit_ledger`, `water_readings`, `category_balances`, `financeSummaryByMonth`, `annual_summaries`, `billing_runs`, `water_import_runs`, `settings`, `audit_logs`, `whatsapp_notifications`.
- Publik: `public_views`.
- Aturan akses tetap tertutup pada root; node privat memerlukan autentikasi; hanya `public_views` yang dapat dibaca publik.

## Batasan yang masih perlu pengujian
- Integrasi Firebase langsung dan simulasi alur dari tagihan sampai laporan perlu diuji pada proyek uji sebelum dipakai untuk uang sungguhan.
- Aplikasi web mencatat transaksi langsung ke RTDB dari browser. Tidak ada Cloud Functions yang digunakan aplikasi saat ini.
- Ringkasan bulanan dan proyeksi publik adalah data turunan dari transaksi sumber; jika ada transaksi lama yang dikoreksi manual, jalankan rekonsiliasi/rebuild sebelum mengandalkan laporan.
- Jangan deploy file Rules atau Functions dari branch audit ini sebelum pemeriksaan dan persetujuan terpisah.

## Tarif
Menu Pengaturan menyimpan tarif Kas RT, administrasi Air, tarif pemakaian per m³, dan iuran Sampah di `settings/billingRates`. Perubahan tarif berlaku untuk pembentukan tagihan berikutnya; tagihan yang sudah dibuat mempertahankan nilai nominal yang tersimpan pada tagihan tersebut.


### Pembayaran di muka Kas RT dan Sampah

Pembayaran Kas RT dan Sampah dapat dialokasikan ke bulan mendatang tanpa menunggu tagihan bulanan dibuat. Catatan disimpan per rumah/periode/kategori pada `fixed_advance_payments`, dengan nominal dan tarif dikunci pada tanggal pembayaran. Saat `createMonthlyBills` dijalankan untuk periode tersebut, tagihan dibuat menggunakan tarif yang terkunci dan langsung berstatus lunas; pendapatan tidak dicatat ulang karena sudah masuk pada bulan transaksi pembayaran. Pembayaran tetap penuh dan berurutan. Air tidak memakai mekanisme ini.
