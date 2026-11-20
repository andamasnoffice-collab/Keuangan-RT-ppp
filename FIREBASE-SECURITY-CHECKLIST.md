# Firebase Security — Public read-only

- Root `.read` dan `.write` tetap `false`.
- Private nodes hanya `auth != null`.
- `/public_views` dapat dibaca publik dan hanya dapat ditulis oleh pengguna login.
- `/annual_summaries` hanya dapat dibaca dan ditulis oleh pengguna login.
- Jangan menaruh nama warga, nomor telepon, anggota keluarga, data pembayaran personal, deposit, atau audit di `/public_views`.
- Pengunjung hanya boleh melihat Dashboard dan Daftar Tagihan; seluruh operasi edit tetap memerlukan login.
- Setiap akun login memiliki hak pengelolaan sama.

Peringatan: public_views benar-benar publik dan dapat dibaca siapa saja yang mengetahui URL database. Periksa Rules Simulator sebelum deploy.

- `fixed_advance_payments`: hanya pengguna terautentikasi yang dapat membaca/menulis catatan pembayaran di muka Kas RT dan Sampah.

- `opening_migrations` dan `opening_migration_records`: hanya pengguna terautentikasi yang dapat membaca/menulis status dan arsip batch migrasi saldo awal. Root `.read`/`.write` tetap `false`.
