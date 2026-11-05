// Vercel serverless entrypoint: same routing as server.mjs, no long-running server.
import { handleRequest } from "../server.mjs";

export default function handler(req, res) {
  return handleRequest(req, res);
}
