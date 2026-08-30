// AtithiBook Admin API — License Management
// No external npm dependencies — safe for drag-and-drop Netlify deploys.
// SECURITY: No hardcoded fallback password. Fails closed if env var missing.
// Rate-limited (in-memory, best-effort) against brute-force guessing.

const rateMap = new Map(); // ip -> { attempts, lockUntil }
function checkRateLimit(ip) {
  const entry = rateMap.get(ip) || { attempts: 0, lockUntil: 0 };
  if (entry.lockUntil && Date.now() < entry.lockUntil) {
    const mins = Math.ceil((entry.lockUntil - Date.now()) / 60000);
    return { allowed: false, message: `Too many attempts. Locked for ${mins} more minute(s).` };
  }
  return { allowed: true, entry };
}
function recordFailure(ip, entry) {
  entry.attempts = (entry.attempts || 0) + 1;
  if (entry.attempts >= 5) entry.lockUntil = Date.now() + 15 * 60 * 1000;
  rateMap.set(ip, entry);
  if (rateMap.size > 5000) rateMap.clear();
}
function clearAttempts(ip) { rateMap.delete(ip); }

export async function handler(event) {
  const headers = {
    "Access-Control-Allow-Origin": process.env.URL || process.env.DEPLOY_PRIME_URL || "*",
    "Access-Control-Allow-Headers": "Content-Type,x-admin-key",
    "Content-Type": "application/json"
  };
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };

  // ── FAIL CLOSED: if ADMIN_PASSWORD not configured server-side, deny all access ──
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
  if (!ADMIN_PASSWORD) {
    return { statusCode: 503, headers, body: JSON.stringify({ error: "Server not configured. Set ADMIN_PASSWORD env var in Netlify." }) };
  }

  // ── RATE LIMITING — prevent brute-force guessing ──
  const ip = event.headers["x-nf-client-connection-ip"] || event.headers["client-ip"] || "unknown";
  const rl = checkRateLimit(ip);
  if (!rl.allowed) {
    return { statusCode: 429, headers, body: JSON.stringify({ error: rl.message }) };
  }

  // ── AUTH CHECK ──
  const adminKey = event.headers["x-admin-key"] || "";
  if (adminKey !== ADMIN_PASSWORD) {
    recordFailure(ip, rl.entry);
    return { statusCode: 401, headers, body: JSON.stringify({ error: "Unauthorized" }) };
  }
  clearAttempts(ip);

  const licenses = (process.env.VALID_LICENSES || "")
    .split(",").map(k => k.trim().toUpperCase()).filter(Boolean);

  if (event.httpMethod === "GET") {
    return { statusCode: 200, headers, body: JSON.stringify({ licenses, total: licenses.length }) };
  }

  return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
}
