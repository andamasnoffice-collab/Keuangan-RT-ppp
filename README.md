# Keuangan RT — Starter V1.6

## Model akses
- Pengunjung tanpa login hanya dapat melihat dua tab: Dashboard publik dan Daftar Tunggakan/Tagihan Bulanan.
- Pengunjung tidak dapat mengubah, menambah, menghapus, membayar, atau mengelola data.
- Tombol Login ada di pojok kanan atas.
- Semua akun Firebase Authentication yang berhasil login memiliki hak pengelolaan yang sama.
- Tidak ada role dan tidak perlu node `/users/{uid}`.
- Akun dibuat oleh pemilik proyek melalui Firebase Console → Authentication → Users → Add user.

## Privasi tampilan publik
- Data pribadi rumah/warga tetap berada di node privat.
- Halaman publik hanya membaca `/public_views`.
- `/public_views` adalah salinan terbatas: ringkasan dashboard, saldo Kas/Air/Sampah, daftar tunggakan per rumah per periode, serta rincian pemasukan dan pengeluaran per bulan. Rincian arus kas tidak boleh memuat nama warga, nomor HP, nomor rekening, atau identitas pribadi.
- Nama kepala keluarga, nomor telepon, anggota keluarga, data pembayaran individual, deposit, audit, dan transaksi rinci tidak disalin ke tampilan publik.
- Semua informasi di `/public_views` dapat dilihat siapa saja di internet. Jangan memasukkan informasi pribadi ke node ini.

## Memperbarui data publik
Setelah login, buka Dashboard dan klik **Perbarui dashboard & daftar tagihan publik**. Tombol ini membuat snapshot saldo, rincian transaksi pemasukan/pengeluaran per bulan, ringkasan dashboard, dan data tagihan per bulan; daftar publik menampilkan periode yang dipilih, sedangkan ringkasan dashboard tetap mengakumulasi seluruh tunggakan. Pengunjung hanya melihat snapshot terakhir yang dipublikasikan.
Jika ada perubahan pembayaran/tagihan, pengurus perlu memperbarui snapshot lagi. Sinkronisasi otomatis akan ditambahkan setelah seluruh alur transaksi stabil.

## Firebase
Project: `keuangan-rt-ppp`
Realtime Database: `https://keuangan-rt-ppp-default-rtdb.asia-southeast1.firebasedatabase.app`
Region: `asia-southeast1`
SDK Web: Firebase 10.12.5
Target hosting: GitHub Pages
Target paket: Spark

## Security Rules
- Root database tertutup.
- Private nodes hanya dapat dibaca/ditulis oleh akun yang login.
- Hanya `/public_views` yang dapat dibaca publik.
- Hanya akun login yang dapat menulis `/public_views`.
- Semua akun login memiliki hak sama terhadap node privat.

**Peringatan:** semua akun login dapat mengubah data keuangan. Rules ini mengatur batas akses, bukan validasi bisnis. Transaksi pembayaran, saldo, dan deposit tetap harus diselesaikan serta diuji sebelum digunakan untuk uang sungguhan.

## Belum selesai
- Pembayaran dan deposit belum tersimpan secara produksi.
- Tagihan otomatis kas/sampah belum selesai.
- Meteran dan perhitungan air belum selesai.
- Pengeluaran dan laporan lintas tahun belum selesai.
- Pengujian integrasi Firebase langsung belum dilakukan.
- Belum dideploy ke GitHub Pages.


## Pengaturan tarif bulanan
Menu Pengaturan menyediakan kolom yang dapat diubah kapan saja: Kas RT per rumah per bulan, administrasi air per rumah per bulan, tarif pemakaian air per m³, dan iuran sampah per rumah per bulan. Nilai disimpan di Firebase Realtime Database pada `settings/billingRates`, sehingga perubahan tidak memerlukan perubahan kode atau pemasangan ulang aplikasi. Tarif tersimpan untuk pembentukan tagihan berikutnya; tagihan lama harus mempertahankan nominal saat tagihan tersebut dibuat.
