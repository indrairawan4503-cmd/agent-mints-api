// Agent Mints API — free-mint list for Binance Agent IDs (BSC, chain 56).
// Free endpoints: GET / , GET /mints , GET /mints/open , GET /mints/:slug , GET /openapi.json
// Paid endpoint (x402 v2, $0.01 USDC on Base): GET /live/:slug — live on-chain check.
// Payment retry header is PAYMENT-SIGNATURE (v2); X-PAYMENT is still accepted
// for older v1 clients. extra.name must be "USD Coin": that is the canonical
// EIP-712 domain name USDC was deployed with on Base, and vAPI rejects "USDC".
// Payout wallet: Raden's vAPI main wallet 0x77d9525EB3A6c2CA804098f2E1535daC8B3DA5E6
// Run: node server.mjs   (PORT env, default 3000). No dependencies, Node 18+.
import http from "node:http";
import { MINTS } from "./mints.mjs";

const PORT = Number(process.env.PORT || 3000);
const PAY_TO = "0x77d9525EB3A6c2CA804098f2E1535daC8B3DA5E6";
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const PRICE_ATOMIC = "10000"; // $0.01 USDC (6 decimals)
const FACILITATOR = "https://x402.org/facilitator";
const BSC_RPC = "https://bsc-dataseed.binance.org/";

const JIN_CLAIMFREE_INPUT =
  "0x5e607d02000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000076465616c6f766100000000000000000000000000000000000000000000000000";

function send(res, code, obj, extraHeaders = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { "content-type": "application/json", ...extraHeaders });
  res.end(body);
}

function resourceUrl(req, path) {
  const host = req.headers["x-forwarded-host"] || req.headers.host || "agent-mints-api.vercel.app";
  const proto = req.headers["x-forwarded-proto"] || "https";
  return `${proto}://${host}${path}`;
}

function paymentRequirements(resource) {
  // v2 accepts entry. amount is the v2 field; maxAmountRequired is also
  // included because vAPI's conformance check looks for it, with the same
  // value. resource is included both here and at the top level of the
  // PaymentRequired payload, as vAPI requires it in the accepts entry.
  return {
    scheme: "exact",
    network: "eip155:8453",
    amount: PRICE_ATOMIC,
    maxAmountRequired: PRICE_ATOMIC,
    asset: USDC_BASE,
    payTo: PAY_TO,
    maxTimeoutSeconds: 60,
    resource: { url: resource, description: "Live on-chain check for one mint ($0.01 USDC on Base)" },
    extra: { name: "USD Coin", version: "2" },
  };
}

function paymentRequired(req, res, path) {
  const resource = resourceUrl(req, path);
  const accepts = [paymentRequirements(resource)];
  const payload = {
    x402Version: 2,
    error: "PAYMENT-SIGNATURE header is required",
    resource: { url: resource, description: "Live on-chain check for one mint ($0.01 USDC on Base)", mimeType: "application/json" },
    accepts,
  };
  send(
    res,
    402,
    payload,
    {
      "PAYMENT-REQUIRED": Buffer.from(JSON.stringify(payload)).toString("base64"),
    }
  );
}

async function verifyAndSettle(paymentB64, resource) {
  let payment;
  try {
    payment = JSON.parse(Buffer.from(paymentB64, "base64").toString("utf8"));
  } catch {
    return { ok: false, reason: "bad payment header" };
  }
  // v2 facilitator shape. The client sends its chosen accepts entry as
  // payment.accepted when present; fall back to our own requirements.
  const requirements = payment.accepted || paymentRequirements(resource);
  const body = { x402Version: 2, paymentPayload: payment, paymentRequirements: requirements };
  const v = await fetch(`${FACILITATOR}/verify`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) => r.json());
  if (!v.isValid) return { ok: false, reason: v.invalidReason || "payment invalid" };
  const s = await fetch(`${FACILITATOR}/settle`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) => r.json());
  if (!s.success) return { ok: false, reason: s.errorReason || "settle failed" };
  return { ok: true, txHash: s.transaction || s.txHash, network: s.network, payer: s.payer };
}

async function liveCheck(slug) {
  const mint = MINTS.find((m) => m.slug === slug);
  if (!mint) return null;
  if (slug === "jin-agent") {
    // Live eth_call of claimFree("dealova") against the JIN contract.
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

// Exported so Vercel can run the same routing as a serverless function
// (see api/index.js). When run directly with `node server.mjs` it still
// listens as a long-running server, for local use and Render.
export async function handleRequest(req, res) {
  const url = new URL(req.url, "http://localhost");
  const path = url.pathname;
  try {
    if (path === "/" || path === "/health") {
      return send(res, 200, { name: "Agent Mints API", description: "Free-mint list for Binance Agent IDs on BNB Chain. Paid live check: GET /live/:slug ($0.01 USDC on Base).", endpoints: ["GET /mints", "GET /mints/open", "GET /mints/:slug", "GET /live/:slug (x402 paid)", "GET /openapi.json"], mints: MINTS.length, open: MINTS.filter((m) => m.status === "open").length });
    }
    if (path === "/mints") return send(res, 200, { count: MINTS.length, mints: MINTS });
    if (path === "/mints/open") {
      const open = MINTS.filter((m) => m.status === "open" || m.status === "searching");
      return send(res, 200, { count: open.length, mints: open });
    }
    if (path === "/openapi.json") {
      const spec = {
        openapi: "3.1.0",
        info: { title: "Agent Mints API", version: "1.0.0", description: "Free-mint list for Binance Agent IDs on BNB Chain (chain 56). GET /live/:slug is a paid x402 endpoint ($0.01 USDC on Base, payTo 0x77d9525EB3A6c2CA804098f2E1535daC8B3DA5E6).", contact: { email: "indrairawan4503@gmail.com" } },
        servers: [{ url: "https://agent-mints-api.vercel.app" }],
        paths: {
          "/mints": { get: { operationId: "listMints", summary: "List all tracked free mints", responses: { 200: { description: "Mint list" } } } },
          "/mints/open": { get: { operationId: "listOpenMints", summary: "List mints currently open or searching", responses: { 200: { description: "Open mint list" } } } },
          "/mints/{slug}": { get: { operationId: "getMint", summary: "One mint by slug", parameters: [{ name: "slug", in: "path", required: true, schema: { type: "string" } }], responses: { 200: { description: "Mint detail" }, 404: { description: "Unknown slug" } } } },
          "/live/{slug}": {
            "x-payment-info": { price: { mode: "fixed", currency: "USD", amount: "0.010000" }, protocols: [{ x402: {} }] },
            get: { operationId: "liveCheckMint", summary: "Live on-chain check for one mint (paid, x402 v2 $0.01 USDC on Base)", parameters: [{ name: "slug", in: "path", required: true, schema: { type: "string", example: "jin-agent" }, example: "jin-agent" }], "x-payment-info": { price: { mode: "fixed", currency: "USD", amount: "0.010000" }, protocols: [{ x402: {} }] }, responses: { 200: { description: "Live status" }, 402: { description: "Payment Required — x402 v2. Send PAYMENT-SIGNATURE header with a signed EIP-3009 authorization for $0.01 USDC on Base to 0x77d9525EB3A6c2CA804098f2E1535daC8B3DA5E6.", content: { "application/json": { schema: { type: "object", properties: { x402Version: { type: "number", example: 2 }, error: { type: "string" }, resource: { type: "object" }, accepts: { type: "array", items: { type: "object" } } } } } } }, 404: { description: "Unknown slug" } } },
          },
        },
      };
      return send(res, 200, spec);
    }
    const m = path.match(/^\/mints\/([\w-]+)$/);
    if (m) {
      const mint = MINTS.find((x) => x.slug === m[1]);
      if (!mint) return send(res, 404, { error: "unknown slug", slugs: MINTS.map((x) => x.slug) });
      return send(res, 200, mint);
    }
    const l = path.match(/^\/live\/([\w-]+)$/);
    if (l) {
      const slug = l[1];
      if (!MINTS.some((x) => x.slug === slug)) return send(res, 404, { error: "unknown slug", slugs: MINTS.map((x) => x.slug) });
      const payment = req.headers["payment-signature"] || req.headers["x-payment"];
      if (!payment) return paymentRequired(req, res, path);
      const resource = resourceUrl(req, path);
      const settled = await verifyAndSettle(payment, resource);
      if (!settled.ok) return send(res, 402, { error: "payment failed", reason: settled.reason });
      const result = await liveCheck(slug);
      const receipt = { success: true, transaction: settled.txHash, network: settled.network, payer: settled.payer };
      return send(res, 200, { ...result, payment: { txHash: settled.txHash, payer: settled.payer, amount: "$0.01 USDC" } },
        { "PAYMENT-RESPONSE": Buffer.from(JSON.stringify(receipt)).toString("base64") });
    }
    return send(res, 404, { error: "not found", endpoints: ["/mints", "/mints/open", "/mints/:slug", "/live/:slug", "/openapi.json"] });
  } catch (e) {
    return send(res, 500, { error: e.message });
  }
}

if (process.argv[1] && process.argv[1].endsWith("server.mjs")) {
  const server = http.createServer(handleRequest);
  server.listen(PORT, () => console.log(`Agent Mints API on http://localhost:${PORT}`));
}
