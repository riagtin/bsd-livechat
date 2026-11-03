# 💬 BSD LiveChat Gateway (Official Meta WhatsApp Cloud API Bridge)

[![GitHub Release](https://img.shields.io/github/v/release/riagtin/bsd-livechat?color=10B981&label=Release)](https://github.com/riagtin/bsd-livechat/releases)
[![Docker Image](https://img.shields.io/badge/docker-ghcr.io%2Friagtin%2Flivechat--gateway-blue?logo=docker)](https://github.com/riagtin/bsd-livechat/pkgs/container/livechat-gateway)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL_3.0-blue.svg)](LICENSE)

> **"Digital Innovation Without Limits."**  
> Resmi dikembangkan oleh **Bintang Studio** ([bintangstudio.tech](https://bintangstudio.tech))

**BSD LiveChat** adalah jembatan obrolan langsung (live chat) mandiri yang menghubungkan:
* **Pengunjung Website / Aplikasi** $\longleftrightarrow$ **WhatsApp Ponsel Tim CS / Pemilik Usaha**.
* **Pengunjung:** Mengobrol langsung dari widget di website tanpa perlu memasang atau membuka aplikasi WhatsApp.
* **Tim CS / Pemilik Usaha:** Menerima notifikasi dan membalas obrolan langsung dari aplikasi WhatsApp di ponsel mereka melalui integrasi **Meta WhatsApp Cloud API Resmi v22.0**.

---

## 🌟 Fitur Utama

1. **Langsung Mengobrol:** Pengunjung tidak perlu login, tidak perlu scan QR code WhatsApp Web, dan tidak dialihkan keluar dari website.
2. **Pencegahan Salah Kamar Pesan (*Anti-Data-Breach Quote Resolution*):** Balasan CS dari WhatsApp dipetakan secara presisi ke sesi pengunjung menggunakan *Quote Reply* (`context.id`) atau awalan kode `#SESSION_ID`. Jika CS membalas tanpa quote saat ada 2 atau lebih obrolan yang sedang aktif, sistem otomatis menolak pesan tersebut dan mengirim notifikasi peringatan ke WhatsApp CS agar pesan tidak terkirim ke pengunjung yang salah.
3. **Pemulihan Jendela 24 Jam Meta Otomatis:** Jika jendela gratis 24 jam ke WhatsApp CS tertutup (Error 131047), gateway otomatis mengirimkan Utility Template resmi (`bsd_livechat_alert`). Saat CS membalas template tersebut, jendela obrolan gratis langsung aktif kembali.
4. **Indikator Centang Biru Real-Time:** Saat CS membaca pesan di aplikasi WhatsApp ponsel, status centang dua biru otomatis tampil pada balon pesan pengunjung di website.
5. **Penggabungan Pesan Beruntun (Debounce 2.5 Detik):** Pesan yang diketik berulang kali oleh pengunjung digabungkan ke dalam satu balon pesan WhatsApp, sehingga ponsel CS tidak berdering terus-menerus dan mudah dibalas.
6. **Koneksi Stabil (Keep-Alive 25 Detik):** Menjaga jalur Server-Sent Events (SSE) tetap terbuka dan tidak terputus oleh proxy atau reverse proxy saat obrolan sedang senggang.
7. **Isolasi Penuh Shadow DOM:** Tampilan widget dibungkus rapi di dalam Shadow DOM. CSS website utama (WordPress, Next.js, Laravel, HTML statis) tidak akan merusak gaya visual widget.

---

## 📁 Struktur Direktori

```text
.
├── apps/
│   ├── gateway/         # Server backend Fastify + SSE + Meta Cloud API v22.0 (AGPL-3.0)
│   └── demo/            # Halaman web uji coba widget lokal
│
└── packages/
    ├── sdk/             # Tipe data bersama & utilitas verifikasi HMAC (MPL-2.0)
    ├── react/           # Komponen siap pakai untuk React / Next.js (MPL-2.0)
    └── widget/          # Widget antarmuka Shadow DOM (AGPL-3.0 + Ketentuan Tambahan §7b)
```

---

## 🐳 Menjalankan Cepat dengan Docker (Self-Hosted)

Tersedia container image siap pakai di **GitHub Packages (GHCR)**:

```bash
# Tarik image resmi dari GitHub Container Registry:
docker pull ghcr.io/riagtin/livechat-gateway:latest
```

Atau jalankan full stack (Gateway + PostgreSQL) menggunakan Docker Compose:

```bash
# 1. Pastikan file docker-compose.selfhost.yml dan .env sudah siap
# 2. Jalankan container:
docker compose -f docker-compose.selfhost.yml up -d
```

---

## 🚀 Cara Pemasangan Widget

### 1. Tag Script HTML (WordPress, PHP, Laravel, Shopify, Web Statis)

Tempelkan kode ini tepat sebelum penutup tag `</body>`:

```html
<script 
  src="https://chat.example.com/widget.js" 
  data-gateway-url="https://chat.example.com" 
  data-business-name="Bintang Studio Support"
  data-theme="dark"
  defer>
</script>
```

> **Catatan:** Ganti `https://chat.example.com` dengan URL domain gateway Anda sendiri (atau `http://localhost:3100` untuk pengujian lokal).

### 2. Komponen React / Next.js

Pasang paket resmi:
```bash
npm install @bintangstudio/livechat-react
# atau: pnpm add @bintangstudio/livechat-react
```

Gunakan di dalam komponen atau layout aplikasi:
```tsx
import { LiveChatWidget } from '@bintangstudio/livechat-react';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <body>
        {children}
        <LiveChatWidget 
          gatewayUrl="https://chat.example.com"
          businessName="Bintang Studio Support"
          welcomeMessage="Halo! Ada yang bisa kami bantu hari ini?"
          theme="dark"
        />
      </body>
    </html>
  );
}
```

---

## ⚙️ Menjalankan Server Gateway Secara Mandiri

### 1. Siapkan Berkas Konfigurasi
```bash
cd apps/gateway
cp .env.example .env
```

### 2. Atur Variabel Lingkungan (.env)
Sesuaikan nilai kredensial Meta WhatsApp Cloud API Anda:
```env
PORT=3100
BUSINESS_NAME=Bintang Studio Support
ALLOWED_DOMAINS=http://localhost:3000,https://example.com

# Kredensial Meta Developer Portal (v22.0)
META_PHONE_NUMBER_ID=123456789012345
META_ACCESS_TOKEN=EAAG...
META_APP_SECRET=your_app_secret
META_VERIFY_TOKEN=your_custom_webhook_verify_token

# Nomor WhatsApp CS Tujuan (Format internasional tanpa tanda +)
CS_WHATSAPP_PHONE=6281234567890

# Utility Template Meta
META_UTILITY_TEMPLATE_NAME=bsd_livechat_alert
META_TEMPLATE_LANGUAGE=id
```

### 3. Kompilasi & Jalankan
```bash
pnpm install
pnpm build
pnpm --filter bsd-livechat-gateway start
```

---

## 📝 Pendaftaran Template WhatsApp di Meta Manager

Daftarkan template ini melalui **Meta Business Manager** $\to$ **WhatsApp Manager** $\to$ **Message Templates**:
* **Nama Template:** `bsd_livechat_alert`
* **Kategori:** `UTILITY`
* **Bahasa:** `Indonesian (id)`
* **Isi Pesan (Body Text):**
  ```text
  [BSD LiveChat Notification]
  Ada pesan baru dari pengunjung website (Sesi: {{1}}).
  Halaman: {{2}}
  Pesan: "{{3}}"

  Balas pesan ini untuk merespons pengunjung secara langsung di website.
  ```

---

## 📄 Lisensi Proyek

* **Server Gateway (`apps/gateway`)**: Dilisensikan di bawah [GNU Affero General Public License v3.0 (AGPL-3.0-only)](LICENSE).
* **Frontend Widget (`packages/widget`)**: Dilisensikan di bawah [AGPL-3.0-only](LICENSE) dengan **Ketentuan Tambahan Pasal 7(b)** (kewajiban mempertahankan atribusi *"Powered by Bintang Studio"* dengan tautan aktif ke `https://bintangstudio.tech`, lihat berkas [NOTICE](NOTICE)).
* **Integrasi SDK (`packages/sdk`) & Loader React (`packages/react`)**: Dilisensikan di bawah [Mozilla Public License 2.0 (MPL-2.0)](LICENSES/MPL-2.0.txt) agar dapat diimpor langsung ke aplikasi web tanpa mengubah lisensi kode aplikasi Anda.
* **Merek Dagang**: Nama "Bintang Studio", "BSD LiveChat", dan logo dilindungi hak merek dagang (lihat [TRADEMARKS.md](TRADEMARKS.md)).

*Catatan: Versi historis ≤ 1.x berlisensi MIT sudah dinyatakan usang (deprecated) dan tidak lagi dipelihara.*

Hak Cipta &copy; 2026 **Bintang Studio Digital**. Hak cipta dilindungi undang-undang.
