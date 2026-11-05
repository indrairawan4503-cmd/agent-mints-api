// Vercel serverless entry for Agent Mints API.
// Same routes as server.mjs: /mints, /mints/open, /mints/:slug, /live/:slug (x402 $0.01 USDC on Base), /openapi.json
import { MINTS } from "../mints.mjs";

const PAY_TO = "0x77d9525EB3A6c2CA804098f2E1535daC8B3DA5E6";
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const PRICE_ATOMIC = "10000";
const FACILITATOR = "https://x402.org/facilitator";
const BSC_RPC = "https://bsc-dataseed.binance.org/";
const JIN_CLAIMFREE_INPUT =
  "0x5e607d02000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000076465616c6f766100000000000000000000000000000000000000000000000000";

function json(res, code, obj, extra = {}) {
  res.status(code).setHeader("content-type", "application/json");
  for (const [k, v] of Object.entries(extra)) res.setHeader(k, v);
  res.end(JSON.stringify(obj));
}

async function liveCheck(slug) {
  const mint = MINTS.find((m) => m.slug === slug);
  if (!mint) return null;
  if (slug === "jin-agent") {
    try {
      const r = await fetch(BSC_RPC, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call",
          params: [{ to: mint.contract, data: JIN_CLAIMFREE_INPUT }, "latest"] }),
      }).then((x) => x.json());
      const reverted = !!r.error;
      return { ...mint, liveStatus: reverted ? "closed" : "open",
        liveCheckedAt: new Date().toISOString(),
        liveNote: reverted ? "claimFree preview reverts on-chain right now." : "claimFree preview succeeds on-chain right now." };
    } catch (e) {
      return { ...mint, liveStatus: "unknown", liveCheckedAt: new Date().toISOString(), liveNote: "BSC RPC error: " + e.message };
    }
  }
  return { ...mint, liveStatus: mint.status, liveCheckedAt: new Date().toISOString(),
    liveNote: "Stored status from last manual check (see lastChecked). Live on-chain probe for this contract is not wired yet." };
}

export default async function handler(req, res) {
  const url = new URL(req.url, "http://localhost");
  const path = url.pathname;
  try {
    if (path === "/" || path === "/health") {
      return json(res, 200, { name: "Agent Mints API", description: "Free-mint list for Binance Agent IDs on BNB Chain. Paid live check: GET /live/:slug ($0.01 USDC on Base).", endpoints: ["GET /mints", "GET /mints/open", "GET /mints/:slug", "GET /live/:slug (x402 paid)", "GET /openapi.json"], mints: MINTS.length, open: MINTS.filter((m) => m.status === "open").length });
    }
    if (path === "/mints") return json(res, 200, { count: MINTS.length, mints: MINTS });
    if (path === "/mints/open") {
      const open = MINTS.filter((m) => m.status === "open" || m.status === "searching");
      return json(res, 200, { count: open.length, mints: open });
    }
    if (path === "/openapi.json") {
      return json(res, 200, {
        openapi: "3.0.3",
        info: { title: "Agent Mints API", version: "1.0.0", description: "Free-mint list for Binance Agent IDs on BNB Chain (chain 56). GET /live/:slug is a paid x402 endpoint ($0.01 USDC on Base, payTo 0x77d9525EB3A6c2CA804098f2E1535daC8B3DA5E6)." },
        servers: [{ url: "https://agent-mints-api.vercel.app" }],
        paths: {
          "/mints": { get: { summary: "List all tracked free mints", responses: { 200: { description: "Mint list" } } } },
          "/mints/open": { get: { summary: "List mints currently open or searching", responses: { 200: { description: "Open mint list" } } },
          "/mints/{slug}": { get: { summary: "One mint by slug", parameters: [{ name: "slug", in: "path", required: true, schema: { type: "string" } }], responses: { 200: { description: "Mint detail" }, 404: { description: "Unknown slug" } } } },
          "/live/{slug}": { get: { summary: "Live on-chain check for one mint (paid, x402 $0.01 USDC on Base)", parameters: [{ name: "slug", in: "path", required: true, schema: { type: "string" } }], responses: { 200: { description: "Live status" }, 402: { description: "Payment Required — x402. Send X-PAYMENT header with a signed EIP-3009 authorization for $0.01 USDC on Base to 0x77d9525EB3A6c2CA804098f2E1535daC8B3DA5E6." }, 404: { description: "Unknown slug" } } } },
        },
      });
    }
    const m = path.match(/^\/mints\/([\w-]+)$/);
    if (m) {
      const mint = MINTS.find((x) => x.slug === m[1]);
      if (!mint) return json(res, 404, { error: "unknown slug", slugs: MINTS.map((x) => x.slug) });
      return json(res, 200, mint);
    }
    const l = path.match(/^\/live\/([\w-]+)$/);
    if (l) {
      const slug = l[1];
      if (!MINTS.some((x) => x.slug === slug)) return json(res, 404, { error: "unknown slug", slugs: MINTS.map((x) => x.slug) });
      const payment = req.headers["x-payment"];
      if (!payment) {
        const accepts = [{ scheme: "exact", network: "eip155:8453", amount: PRICE_ATOMIC, asset: USDC_BASE, payTo: PAY_TO, maxTimeoutSeconds: 60, extra: { name: "USDC", version: "2" } }];
        const payload = { x402Version: 1, error: "Payment Required", accepts };
        return json(res, 402, payload, { "PAYMENT-REQUIRED": Buffer.from(JSON.stringify(payload)).toString("base64") });
      }
      let parsed;
      try { parsed = JSON.parse(Buffer.from(payment, "base64").toString("utf8")); }
      catch { return json(res, 402, { error: "payment failed", reason: "bad X-PAYMENT header" }); }
      const body = { x402Version: 1, paymentPayload: parsed, paymentRequirements: { scheme: "exact", network: "eip155:8453", amount: PRICE_ATOMIC, asset: USDC_BASE, payTo: PAY_TO, maxTimeoutSeconds: 60, extra: { name: "USDC", version: "2" } } };
      const v = await fetch(`${FACILITATOR}/verify`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
      if (!v.isValid) return json(res, 402, { error: "payment failed", reason: v.invalidReason || "payment invalid" });
      const s = await fetch(`${FACILITATOR}/settle`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
      if (!s.success) return json(res, 402, { error: "payment failed", reason: s.errorReason || "settle failed" });
      const result = await liveCheck(slug);
      return json(res, 200, { ...result, payment: { txHash: s.txHash, payer: s.payer, amount: "$0.01 USDC" } });
    }
    return json(res, 404, { error: "not found", endpoints: ["/mints", "/mints/open", "/mints/:slug", "/live/:slug", "/openapi.json"] });
  } catch (e) {
    return json(res, 500, { error: e.message });
  }
}
