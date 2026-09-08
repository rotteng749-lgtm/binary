# 🦊 Kitsune Panel — Key Management Panel for Vercel

Multi-role key system (Owner → Admin → Reseller) + client auth API. Zero npm dependencies — deploys to Vercel as-is.

```
Owner      full control: all keys, all accounts, games, credits, expiry, devices, activity
  └ Admin  creates/manages resellers (expiry, credits, game permissions)
      └ Reseller  generates keys (random / custom) for permitted games, edits own keys
```

## Fitur

| Fitur | Keterangan |
|---|---|
| Login Protected | Session token (Bearer), kadaluarsa 7 hari, semua endpoint panel terproteksi |
| One Devices Login | Akun panel terikat 1 device — device kedua ditolak sampai di-reset |
| One Device Access | Key client terikat 1 device (HWID) — reset per key |
| Bulk Keys Generate | Random massal (max 100/req) + prefix custom |
| Custom Keys Generate | Tempel daftar key sendiri (satu per baris) |
| Keys Edit | Edit note, duration, game, ban/activate, extend, hapus |
| **Bulk Keys Actions** | Ban/activate/extend/reset device/hapus ratusan key sekaligus (checkbox + bulk bar) |
| **Keys Pagination + CSV Export** | Tabel key di-paging 25/halaman, export CSV sesuai filter aktif |
| Reseller Management | Admin buat reseller + expiry, edit credits/expiry/games/password |
| **Owner Quick Top-up** | Tambah/kurangi credits reseller langsung dari dashboard |
| Game List Permission | Reseller hanya bisa generate untuk game yang diizinkan |
| Server Access Control | Owner enable/disable game — game disabled ditolak di client auth |
| Credits Control | 1 credit = 1 key. Owner unlimited |
| Expired Control | Key: aktif saat login pertama. Akun: block login saat kadaluarsa |
| Reset Devices | Reset device akun panel & device key terpisah |
| Activity Log | Semua aksi tercatat + IP, di-scope per role |
| **PBKDF2 Passwords** | Password di-hash PBKDF2-SHA512 + salt per-password (hash lama otomatis di-upgrade saat login) |
| **Brute-force Guard** | Panel login: 10 percobaan/5 menit per username → 429. Client auth: 30/ment per key |
| **Self-service Password** | Semua role bisa ganti password sendiri (button "Change password" di sidebar) |

## Kredensial awal (seed)

| Akun | Password | Role |
|---|---|---|
| `owner` | `owner123` | owner |
| `reseller` | `reseller123` | reseller (10 credits, semua game) |

> **Ganti password owner segera** setelah deploy (Accounts → Edit).

## Deploy ke Vercel

```bash
cd vercel-nextpanel
npx vercel          # preview
npx vercel --prod   # production
```

### Run lokal di terminal (tanpa Vercel, tanpa npm install)

```bash
node server.js            # → http://localhost:3000
PORT=8080 node server.js  # custom port
# atau: npm start
```

Server lokal memakai handler yang sama persis dengan versi Vercel — panel di `http://localhost:3000/`, client API di `http://localhost:3000/api/auth`. Data in-memory (hilang saat server di-stop) kecuali set env Upstash.

Tidak ada environment variable wajib. Panel terbuka di `/`, client API di `/api/auth` (alias `/auth`).

**Arsitektur**: semua endpoint berjalan di **satu** serverless function (`api/[[...path]].js`) yang me-routing ke `handlers/`. Ini penting — kalau tiap endpoint jadi function terpisah, tiap function punya memori sendiri dan session/state terpecah (gejala: 401 random di `/api/panel/me`).

Env variables opsional:

```
PANEL_SECRET = <string acak>   # kunci signing token login (disarankan diisi)
```

## Client Auth API (untuk client game)

Format response sama dengan panel-panel lama (`{"status":"success","message":...}`), jadi tinggal patch URL client ke `/api/auth`.

```bash
# health check
curl https://YOUR_DOMAIN/api/auth

# login key
curl -X POST https://YOUR_DOMAIN/api/auth \
  -H "Content-Type: application/json" \
  -d '{"key":"DRIP-MLBB-ABCD1234","device":"HWID123","game":"mlbb"}'
```

| Response message | Arti |
|---|---|
| `Device registered` | ✅ device baru terdaftar, key mulai aktif (expiry = duration) |
| `Login successful` | ✅ device sudah terdaftar |
| `Invalid key` | ❌ key tidak ada |
| `Wrong game key` | ❌ key valid tapi game salah |
| `Key banned` | ❌ key dibanned |
| `Key expired on ...` | ❌ key kadaluarsa |
| `Key already used on another device` | ❌ one device access (perlu reset device) |
| `Game is currently disabled` | ❌ owner mematikan game tersebut |

Alias body yang diterima: `key`/`license`, `device`/`hwid`/`uuid`/`android_id`.

## Panel API (semua butuh header `Authorization: Bearer <token>` kecuali login)

| Endpoint | Method | Role | Keterangan |
|---|---|---|---|
| `/api/panel/login` | POST | — | `{username,password,device}` → token |
| `/api/panel/logout` | POST | semua | hancurkan session |
| `/api/panel/me` | GET | semua | akun + games diizinkan |
| `/api/panel/stats` | GET | semua | angka dashboard per-scope |
| `/api/panel/accounts` | GET/POST | owner/admin | list & buat akun |
| `/api/panel/accounts/:username` | PATCH/DELETE | owner/admin | edit (password/credits/expiry/games/status/reset device) & hapus |
| `/api/panel/keys` | GET/POST | semua | list & generate (`mode:random/custom`) |
| `/api/panel/keys/bulk` | POST | sesuai scope | `{action: ban/activate/delete/extend/reset_device, keys:[...], days?}` — max 500 |
| `/api/panel/keys/:key` | PATCH/DELETE | sesuai scope | `action: ban/activate/extend/reset_device/edit` |
| `/api/panel/password` | POST | semua | ganti password sendiri `{current, password}` |
| `/api/panel/games` | GET/POST | GET semua, POST owner | list & tambah game |
| `/api/panel/games/:id` | PATCH/DELETE | owner | enable/disable, rename, hapus |
| `/api/panel/activity` | GET | semua | feed aktivitas per-scope |

Contoh generate:

```bash
# random 10 key, 30 hari
curl -X POST https://YOUR_DOMAIN/api/panel/keys \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"mode":"random","game":"mlbb","count":10,"duration_days":30,"prefix":"DRIP"}'

# custom keys
curl -X POST https://YOUR_DOMAIN/api/panel/keys \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"mode":"custom","game":"mlbb","keys":"VIP-001\nVIP-002","duration_days":7}'
```

## Aturan penting

- **Credits**: generate key memotong 1 credit/key (admin & reseller). Owner bebas. Credit habis → generate ditolak.
- **Scope keys**: owner lihat semua; admin lihat key sendiri + reseller buatannya; reseller hanya key sendiri (berlaku juga untuk bulk actions).
- **Scope accounts**: admin hanya kelola reseller yang dia buat; owner kelola semuanya.
- **Game permission**: reseller `games: ["*"]` = semua game, atau daftar id game tertentu.
- **Delete game** diblok kalau masih ada key di game itu.
- **Password** di-hash PBKDF2-SHA512 (60k iterasi) + salt acak per-password. Hash lama (sha256) tetap valid & otomatis di-upgrade saat login sukses.

## Bulk actions (baru)

```bash
curl -X POST https://YOUR_DOMAIN/api/panel/keys/bulk \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"action":"ban","keys":["DRIP-MLBB-AAA","DRIP-MLBB-BBB"]}'

# extend semua key terpilih +7 hari
curl -X POST https://YOUR_DOMAIN/api/panel/keys/bulk \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"action":"extend","keys":["KEY1","KEY2"],"days":7}'
```

Response: `{"updated":2,"deleted":0,"skipped":[]}` — key milik orang lain / tidak ada masuk `skipped`, bukan error.

## Persistensi (opsional tapi disarankan)

Default-nya data di memori — hilang saat cold start (sama seperti panel-panel sebelumnya). Supaya data akun/key/credits bertahan, set 2 env variables di Vercel (Project → Settings → Environment Variables):

```
UPSTASH_REDIS_REST_URL     = https://xxx.upstash.io
UPSTASH_REDIS_REST_TOKEN   = AX....
```

(Diterima juga `KV_REST_API_URL` / `KV_REST_API_URL_TOKEN`.)

Buatnya: daftar gratis di [upstash.com](https://upstash.com) → buat Redis database (Regional) → copy REST URL + token → set env di Vercel → redeploy. Tidak perlu npm driver — store memakai `fetch` langsung.

## Test lokal

```bash
node test.js   # 75 assertions: role, credits, one-device, expiry, scoping, games, router, bulk, rate-limit, pbkdf2
```
