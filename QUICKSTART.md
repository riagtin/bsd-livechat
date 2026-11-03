# ⚡ Panduan Cepat 15 Menit Menjalankan BSD LiveChat (Self-Hosted)

Panduan ini memandu Anda menjalankan **BSD LiveChat Gateway** secara mandiri (*self-hosted*) menggunakan Docker Compose dalam waktu kurang dari 15 menit.

---

## 📋 1. Prasyarat Sistem
* **Docker & Docker Compose** terpasang di komputer/server Anda.
* **Akun Meta Developer** ([developers.facebook.com](https://developers.facebook.com)).
* Nomor telepon WhatsApp untuk tim Customer Support (CS).

---

## ⚙️ 2. Setup Meta WhatsApp Cloud API

1. Buka **[Meta for Developers](https://developers.facebook.com)** $\to$ **My Apps** $\to$ **Create App**.
2. Pilih jenis App: **Business**, beri nama App Anda (misal: *Toko Support*).
3. Pada halaman dashboard App, tambahkan produk **WhatsApp**.
4. Catat informasi berikut dari menu **WhatsApp** $\to$ **API Setup**:
   * **Phone Number ID** (contoh: `105829374628192`)
   * **WhatsApp Business Account ID (WABA ID)**
   * **Temporary Access Token** (untuk produksi, buat *System User* permanen di Business Manager).
5. Ambil **App Secret** dari menu **App Settings** $\to$ **Basic**.

### Pendaftaran Utility Template (`livechat_ticket_alert`)
Buka **WhatsApp Manager** $\to$ **Account Tools** $\to$ **Message Templates**, lalu buat template baru:
* **Category:** `UTILITY`
* **Name:** `livechat_ticket_alert`
* **Language:** `Indonesian (id)`
* **Body Text:**
  ```text
  [Support Alert]
  Pesan baru dari sesi #{{1}} di {{2}} (Sumber: {{3}}) pada {{4}}.
  Pesan pengunjung: "{{5}}"
  Balas pesan ini untuk merespons pengunjung.
  ```
* Tunggu persetujuan otomatis dari Meta (biasanya dalam 1–5 menit).

---

## 🚀 3. Menjalankan Server dengan Docker Compose

### Langkah A: Clone Repositori
```bash
git clone https://github.com/riagtin/bsd-livechat.git
cd bsd-livechat
```

> **Tips Cepat:** Anda juga dapat mengunduh image container resmi dari GitHub Packages:
> ```bash
> docker pull ghcr.io/riagtin/livechat-gateway:latest
> ```
> Konfigurasi `docker-compose.selfhost.yml` telah tersetting otomatis menggunakan image `ghcr.io/riagtin/livechat-gateway:latest`.

### Langkah B: Buat File `.env`
Salin template konfigurasi:
```bash
cp apps/gateway/.env.example .env
```

Buka dan sesuaikan nilai `.env`:
```env
PORT=3100
BUSINESS_NAME=Toko Saya Support
ALLOWED_DOMAINS=*

# Kredensial Meta
META_PHONE_NUMBER_ID=105829374628192
META_ACCESS_TOKEN=EAAG...
META_APP_SECRET=your_app_secret
META_VERIFY_TOKEN=bsd_rahasia_token_123
CS_WHATSAPP_PHONE=6281234567890

# Token Administrasi & Sesi
ADMIN_API_TOKEN=admin_secret_token_anda_32char
SESSION_SIGNING_SECRET=session_signing_secret_32char

# Database
DB_DRIVER=postgres
POSTGRES_USER=livechat
POSTGRES_PASSWORD=password_db_rahasia
POSTGRES_DB=livechat_db
```

### Langkah C: Jalankan Docker Compose
```bash
docker compose -f docker-compose.selfhost.yml up -d
```

Periksa apakah server berjalan normal:
```bash
curl http://localhost:3100/
# Respon: {"service":"BSD LiveChat Gateway","version":"2.0.0","license":"AGPL-3.0-only",...}
```

---

## 🔗 4. Konfigurasi Webhook Meta

1. Pastikan server Anda memiliki domain publik / HTTPS (misal via Cloudflare Tunnel atau domain VPS).
2. Di **Meta Developer Portal** $\to$ **WhatsApp** $\to$ **Configuration**:
   * **Callback URL:** `https://domain-anda.com/api/v1/webhook/meta`
   * **Verify Token:** Masukkan token yang sama dengan `META_VERIFY_TOKEN` di file `.env`.
3. Klik **Verify and Save**.
4. Di bagian **Webhook fields**, klik **Manage** lalu centang:
   * `messages`
   * `message_template_status_update`

---

## 🌐 5. Pasang Widget di Website

### Opsi A: Tag `<script>` CDN Langsung (HTML, WordPress, PHP, Laravel)
Letakkan baris berikut sebelum tag penutup `</body>`:
```html
<script 
  src="https://domain-anda.com/widget.js" 
  data-gateway-url="https://domain-anda.com" 
  data-business-name="Toko Saya Support"
  data-theme="dark" 
  defer>
</script>
```

### Opsi B: Komponen React / Next.js
Instal loader React:
```bash
npm install @bintangstudio/livechat-react
```

Gunakan di komponen halaman:
```tsx
import { BsdChatWidget } from '@bintangstudio/livechat-react';

export default function App() {
  return (
    <div>
      <BsdChatWidget 
        gatewayUrl="https://domain-anda.com"
        businessName="Toko Saya Support"
        theme="dark"
      />
    </div>
  );
}
```

---

## 💬 6. Uji Coba Chat Pertama
1. Buka website Anda, klik ikon chat melayang di pojok kanan bawah.
2. Ketik pesan pengujian: *"Halo, apakah produk ini ready?"*.
3. Dalam 2,5 detik, pesan akan masuk ke WhatsApp nomor CS Anda dengan format:
   ```text
   *Toko Saya Support - #A7F9BC*
   Halo, apakah produk ini ready?
   ```
4. Buka WhatsApp di ponsel CS, lakukan **Swipe / Quote Reply** pada pesan tersebut lalu balas:
   *"Halo, produk ini ready kak!"*.
5. Balasan seketika muncul di widget website pengunjung secara real-time!

Selamat! BSD LiveChat Anda telah aktif dan beroperasi mandiri.
