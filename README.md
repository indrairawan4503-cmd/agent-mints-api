# Agent Mints API

API daftar free mint buat Binance Agent ID di BNB Chain (chain 56).
Dibikin 2026-11-05 buat didaftarin ke vAPI Call.

## Isi API

- `GET /mints` — semua mint yang dilacak (10 proyek)
- `GET /mints/open` — yang lagi buka / searching (5 saat ini)
- `GET /mints/:slug` — detail satu proyek (kontrak, fungsi gratis, harga, status, terakhir dicek)
- `GET /live/:slug` — **berbayar $0.01 USDC di Base (x402)** — cek live on-chain.
  Tanpa bayar jawab 402. Bayar pakai header `PAYMENT-SIGNATURE` (x402 v2, EIP-3009 USDC; `X-PAYMENT` masih diterima buat klien v1).
  Buat JIN, cek live-nya beneran manggil `eth_call` claimFree ke BSC.
  Buat proyek lain, sementara balik ke status terakhir + catatan.
- `GET /openapi.json` — dokumen OpenAPI buat vAPI

Payout wallet: `0x77d9525EB3A6c2CA804098f2E1535daC8B3DA5E6` (dompet vAPI main Raden).
Harga cek live: $0.01 USDC per panggilan. vAPI fee 0%, bayaran langsung ke dompet itu.

## Jalanin lokal

```
node server.mjs   # PORT default 3000
curl localhost:3000/mints/open
curl localhost:3000/mints/jin-agent
curl -i localhost:3000/live/jin-agent   # 402 Payment Required
```

Nggak ada dependency, Node 18+.

## Yang masih kurang sebelum bisa didaftar ke vAPI

1. **Hosting publik HTTPS** — API ini baru jalan di VM ini (localhost).
   Perlu di-deploy ke host publik (VPS / Railway / Render / Cloudflare Workers, dll)
   dengan URL HTTPS, baru bisa dimasukin ke wizard "Add your API" di
   api.vapinetwork.ai/call/my-apis/new atau `vapi publish <url>`.
2. Ganti `servers[0].url` di openapi.json ke URL publik itu.
3. Cek live per-kontrak buat proyek selain JIN (saat ini cuma JIN yang live probe).
4. Status di `mints.mjs` harus di-update berkala — tiap proyek dicatet
   `lastChecked`-nya, jangan diklaim live kalau udah lama nggak dicek.
