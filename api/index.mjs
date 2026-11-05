// Vercel serverless entry for Agent Mints API.
// Same routing as server.mjs (which exports handleRequest): / , /health,
// /mints, /mints/open, /mints/:slug, /live/:slug (x402 $0.01 USDC on Base),
// /openapi.json. Uses plain Node res.writeHead/res.end, no Express helpers.
import { handleRequest } from "../server.mjs";

export default function handler(req, res) {
  return handleRequest(req, res);
}
