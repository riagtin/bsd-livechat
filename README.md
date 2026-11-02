# 💬 BSD LiveChat Gateway (Official Meta WhatsApp Cloud API Bridge)

> **"Digital Innovation Without Limits."**  
> Resmi dikembangkan oleh  **Bintang Studio**

**BSD LiveChat** adalah ekosistem Live Chat mandiri (*standalone & reusable*) yang menghubungkan langsung:
* **Pengunjung Website / Aplikasi** $\longleftrightarrow$ **WhatsApp Ponsel Tim CS / Owner**.
* **Pengunjung:** Mengobrol langsung dari widget mengambang di website tanpa perlu menginstal atau membuka aplikasi WhatsApp.
* **Tim CS / Owner:** Menerima pesan dan membalas obrolan langsung dari aplikasi WhatsApp di ponsel mereka melalui integrasi **Meta WhatsApp Cloud API Resmi v22.0**.

---

## 🌟 Fitur Unggulan

1. **Zero Barrier to Chat:** Pengunjung dapat langsung bertanya tanpa dipaksa scan QR code WhatsApp Web atau membuka aplikasi WhatsApp di ponsel.
2. **Pencegahan Kebocoran Data (*Anti-Data-Breach Quote Resolution*):** Balasan CS dari WhatsApp dipetakan secara presisi ke sesi pengunjung menggunakan *Quote Reply* (`context.id`) atau prefix tag `#SESSION_ID`. Jika CS membalas tanpa quote saat ada $\ge 2$ pengunjung aktif, sistem menolak meneruskan dan otomatis mengirim peringatan ke WhatsApp CS.
3. **Auto-Wakeup Jendela Layanan 24 Jam Meta:** Jika jendela 24 jam ke nomor CS tertutup (Error 131047), Gateway otomatis mengirimkan Utility Template resmi (`bsd_livechat_alert`) yang disanitasi (tanpa newline, maks 300 karakter). Begitu CS membalas, jendela 24 jam teks bebas terbuka kembali secara gratis.
4. **Centang Biru Real-Time (`agent_read`):** Ketika CS membuka pesan di WhatsApp ponsel, status centang dua biru (✓✓) otomatis muncul di gelembung pesan pengunjung di layar website.
5. **Debouncing & Batching (2.5 Detik):** Pesan beruntun dari pengunjung digabungkan menjadi 1 bubble rapi ke WhatsApp CS sehingga ponsel CS tidak bergetar berlebihan dan lebih mudah di-quote.
6. **Keep-Alive Heartbeat (25 Detik):** Mencegah koneksi SSE ditutup oleh Cloudflare atau NGINX proxy saat obrolan sedang senggang.
7. **Isolasi Tampilan Shadow DOM:** Widget dibungkus 100% di dalam Shadow DOM sehingga tampilan Tailwind CSS v4 tidak akan pernah merusak atau terpengaruh oleh CSS website tuan rumah (WordPress, Next.js, Bootstrap, dll).

---

## 📁 Struktur Monorepo

```text
C:\BSD\livechat/
├── apps/
│   ├── gateway/         # [SERVER BRIDGE] Fastify + SSE + Meta Cloud API v22.0 (AGPL-3.0)
│   ├── console/         # [CONSOLE] Merchant Dashboard Next.js 16 (Proprietary Cloud)
│   └── demo/            # [SHOWCASE] Halaman uji coba live chat lokal
│
└── packages/
    ├── sdk/             # [TYPES & CRYPTO] Shared types & HMAC verification (MPL-2.0)
    ├── react/           # [REACT COMPONENT] Thin loader React / Next.js (MPL-2.0)
    └── widget/          # [EMBEDDABLE UI] Shadow DOM Widget (AGPL-3.0 + §7b)
```

---

## 🐳 Quickstart Standalone via Docker Compose (Community Self-Host)

Bagi pengembang yang ingin menjalankan gateway secara instan tanpa mengompilasi kode sumber:

```bash
# 1. Unduh docker-compose.selfhost.yml
# 2. Siapkan file .env berisi kredensial Meta
# 3. Jalankan server kontainer:
docker compose -f docker-compose.selfhost.yml up -d
```

---

## 🚀 Cara Menggunakan

### Mode 1: Salin 1 Baris Tag Script (HTML / WordPress / PHP / Shopify)

Cukup tambahkan tag berikut sebelum penutup `</body>`:

```html
<script 
  src="https://cdn.bintangstudio.tech/chat/widget.js" 
  data-gateway-url="https://api-chat.bintangstudio.tech" 
  data-business-name="Bintang Studio Support"
  data-theme="dark"
  defer>
</script>
```

### Mode 2: Menggunakan Paket NPM (React / Next.js / Vue)

Instal paket:
```bash
pnpm add @bintangstudio/livechat-widget
# atau: npm install @bintangstudio/livechat-widget
```

Gunakan di komponen:
```tsx
import { BsdChatWidget } from '@bintangstudio/livechat-widget';

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <BsdChatWidget 
        gatewayUrl="https://api-chat.bintangstudio.tech"
        businessName="Bintang Studio Support"
        welcomeMessage="Halo! Ada yang bisa kami bantu seputar produk kami?"
        theme="dark"
      />
    </>
  );
}
```

---

## ⚙️ Menjalankan Server Gateway Sendiri (Self-Hosted)

### 1. Salin File Environment
```bash
cd apps/gateway
cp .env.example .env
```

### 2. Isi Kredensial Meta WhatsApp Cloud API
Edit file `.env`:
```env
PORT=3100
BUSINESS_NAME=Bintang Studio Support
ALLOWED_DOMAINS=http://localhost:3000,https://domainanda.com

# Kredensial Meta Developer Portal (v22.0)
META_PHONE_NUMBER_ID=123456789012345
META_ACCESS_TOKEN=EAAG...
META_APP_SECRET=your_app_secret
META_VERIFY_TOKEN=bsd_livechat_webhook_secret

# Nomor WhatsApp Ponsel CS Tujuan (Format internasional tanpa +)
CS_WHATSAPP_PHONE=6281234567890

# Template Resmi Meta (Utility)
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

## 📝 Format Utility Template Meta (`bsd_livechat_alert`)
Daftarkan template ini di **Meta Business Manager** $\to$ **WhatsApp Manager** $\to$ **Message Templates**:
* **Template Name:** `bsd_livechat_alert`
* **Category:** `UTILITY`
* **Language:** `Indonesian (id)`
* **Body Text:**
  ```text
  [BSD LiveChat Notification]
  Ada pesan baru dari pengunjung website (Sesi: {{1}}).
  Halaman: {{2}}
  Pesan: "{{3}}"

  Balas pesan ini untuk merespons pengunjung secara langsung di website.
  ```

---

## 📄 Lisensi & Tata Kelola Dual-Track

Mulai rilis **`v2.0.0`**, BSD LiveChat menerapkan tata kelola lisensi **Dual-Track**:

* **Server Gateway (`apps/gateway`)**: Dilisensikan di bawah [GNU Affero General Public License v3.0 (AGPL-3.0-only)](LICENSE).
* **Frontend Widget (`packages/widget`)**: Dilisensikan di bawah [AGPL-3.0-only](LICENSE) dengan **Ketentuan Tambahan Pasal 7(b)** (kewajiban mempertahankan atribusi *"Powered by Bintang Studio"* ke `https://bintangstudio.tech`, lihat berkas [NOTICE](NOTICE)).
* **Integrasi SDK (`packages/sdk`) & Loader React (`packages/react`)**: Dilisensikan di bawah [Mozilla Public License 2.0 (MPL-2.0)](LICENSES/MPL-2.0.txt) agar dapat diimpor langsung ke aplikasi web tanpa menulari kode merchant.
* **Kebijakan Merek Dagang**: Nama "Bintang Studio", "BSD LiveChat", dan logo dilindungi hak merek dagang (lihat [TRADEMARKS.md](TRADEMARKS.md)).

*Catatan: Versi historis ≤ 1.x berlisensi MIT dinyatakan deprecated dan tidak lagi dipelihara.*

Hak Cipta &copy; 2026 **PT. BINTANG STUDIO DIGITAL**. Hak cipta dilindungi undang-undang.
