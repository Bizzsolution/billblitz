// AtithiBook SaaS — Secure Scan Function
// No external npm dependencies — safe for drag-and-drop Netlify deploys.
// License validated against TWO sources (either one passing = allowed):
//   1. Firestore /admin/licenses (live — updates instantly when admin panel
//      generates/revokes a key, via plain REST fetch, no SDK needed)
//   2. VALID_LICENSES env var (fallback if Firestore is unreachable)

const FIREBASE_PROJECT_ID = "atithibook-saas";

// ── PER-LICENSE RATE LIMITING (in-memory, no external deps) ──
const rateMap = new Map();
function checkScanRateLimit(license) {
  const now = Date.now();
  const entry = rateMap.get(license) || { count: 0, windowStart: now };
  if (now - entry.windowStart > 60000) { entry.count = 0; entry.windowStart = now; }
  if (entry.count >= 20) return false;
  entry.count++;
  rateMap.set(license, entry);
  if (rateMap.size > 5000) rateMap.clear();
  return true;
}

// ── Parse a Firestore REST "mapValue" license entry into plain JS ──
function parseLicenseEntry(mapValue) {
  const f = mapValue?.fields || {};
  return {
    key: (f.key?.stringValue || "").toUpperCase(),
    active: f.active?.booleanValue !== false, // default true if missing
    plan: f.plan?.stringValue || "",
    expiry: f.expiry?.stringValue || f.expiry?.nullValue !== undefined ? (f.expiry?.stringValue || null) : null,
    features: (f.features?.arrayValue?.values || []).map(x => x.stringValue).filter(Boolean)
  };
}

// ── Check license against live Firestore admin/licenses doc (no SDK, plain fetch) ──
async function checkFirestoreLicense(licenseUpper) {
  try {
    const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/admin/licenses`;
    const r = await fetch(url);
    if (!r.ok) return { found: false };
    const doc = await r.json();
    const values = doc?.fields?.list?.arrayValue?.values || [];
    for (const v of values) {
      const entry = parseLicenseEntry(v.mapValue);
      if (entry.key === licenseUpper) {
        if (entry.expiry && Date.now() > new Date(entry.expiry + "T23:59:59Z").getTime()) {
          return { found: true, active: false, expired: true, expiry: entry.expiry };
        }
        return { found: true, active: entry.active, features: entry.features };
      }
    }
    return { found: false };
  } catch (e) {
    console.warn("Firestore license check unavailable:", e.message);
    return { found: false, error: true };
  }
}

// ── Check license against static env var (fallback) ──
function checkEnvLicense(licenseUpper) {
  const validEntries = (process.env.VALID_LICENSES || "")
    .split(",")
    .map(e => { const [k, d] = e.trim().split(":"); return { key: k?.toUpperCase(), expiry: d || null }; })
    .filter(e => e.key);
  const entry = validEntries.find(e => e.key === licenseUpper);
  if (!entry) return { found: false };
  if (entry.expiry && Date.now() > new Date(entry.expiry + "T23:59:59Z").getTime()) {
    return { found: true, expired: true };
  }
  return { found: true, active: true };
}

export async function handler(event) {
  const headers = {
    "Access-Control-Allow-Origin": process.env.URL || process.env.DEPLOY_PRIME_URL || "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
    "X-Content-Type-Options": "nosniff"
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };

  try {
    const { image, prompt, license, scanContext } = JSON.parse(event.body || "{}");

    if (!license) return { statusCode: 400, headers, body: JSON.stringify({ error: "License required" }) };
    if (image && image.length > 4 * 1024 * 1024) return { statusCode: 413, headers, body: JSON.stringify({ error: "Image too large (max 4MB)" }) };
    if (prompt && prompt.length > 1000) return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid request" }) };

    // ── LICENSE VALIDATION — Firestore (live) checked first, env var as fallback ──
    const licenseUpper = license.trim().toUpperCase();
    const [fsResult, envResult] = await Promise.all([
      checkFirestoreLicense(licenseUpper),
      Promise.resolve(checkEnvLicense(licenseUpper))
    ]);

    let valid = false;
    let expired = false;

    if (fsResult.found) {
      valid = fsResult.active;
      if (fsResult.expired) expired = true;
    }
    if (!valid && envResult.found) {
      valid = envResult.active && !envResult.expired;
      expired = expired || envResult.expired;
    }

    if (!valid && expired) {
      return { statusCode: 403, headers, body: JSON.stringify({ error: "EXPIRED_LICENSE", message: "License expired. Please renew." }) };
    }
    if (!valid) {
      return { statusCode: 403, headers, body: JSON.stringify({ error: "INVALID_LICENSE", message: "Invalid license key. Contact support." }) };
    }

    // ── FEATURE GATE — server-side enforcement, not just UI hiding.
    // This is the ONE thing in the app that genuinely can't be bypassed via
    // browser console, since the OCR call itself goes through here. Only
    // enforced when Firestore was reachable and returned a definitive
    // features list — if we fell back to the env-var check (Firestore was
    // down), we fail OPEN on the feature check specifically, so a transient
    // outage never blocks a paying customer's family scan.
    if (scanContext === "family" && fsResult.found && Array.isArray(fsResult.features)) {
      if (!fsResult.features.includes("family")) {
        return { statusCode: 403, headers, body: JSON.stringify({ error: "FEATURE_NOT_ENABLED", message: "Family member scanning is not enabled on this plan." }) };
      }
    }

    // ── RATE LIMIT: max 20 scans/min per license ──
    if (!checkScanRateLimit(licenseUpper)) {
      return { statusCode: 429, headers, body: JSON.stringify({ error: "RATE_LIMITED", message: "Too many scans. Wait a moment and try again." }) };
    }

    // License valid — if no image (test call), return OK
    if (!image || !prompt) {
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, licensed: true }) };
    }

    // ── OCR: GROQ PRIMARY ──
    // MODEL NAMES ARE CONFIGURABLE — if a provider deprecates a model, fix it
    // in Netlify dashboard (env var) instead of editing code:
    //   Site settings → Environment variables → GROQ_MODELS
    //   Comma-separated list, tried in order. Example:
    //   "qwen/qwen3.6-27b,llama-3.2-90b-vision-preview"
    let result = null;
    const lastErrors = { groq: null, gemini: null };
    const groqKey = process.env.GROQ_API_KEY;
    const groqModels = (process.env.GROQ_MODELS || "qwen/qwen3.6-27b")
      .split(",").map(m => m.trim()).filter(Boolean);
    if (groqKey) {
      for (const model of groqModels) {
        if (result) break;
        try {
          const gr = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": "Bearer " + groqKey },
            body: JSON.stringify({
              model,
              messages: [{ role: "user", content: [
                { type: "image_url", image_url: { url: "data:image/jpeg;base64," + image } },
                { type: "text", text: prompt }
              ]}],
              max_tokens: 1000, temperature: 0,
              reasoning_effort: "none" // Qwen3.6 defaults to "thinking mode" which
              // burns tokens on visible <think> reasoning before the answer —
              // for a direct extraction task like this we want the fast,
              // direct answer only. Ignored harmlessly by non-Qwen Groq models.
            })
          });
          const gd = await gr.json();
          if (gr.ok && gd.choices?.[0]?.message?.content) {
            result = { _groq: true, _text: gd.choices[0].message.content };
          } else if (gd.error) {
            lastErrors.groq = `[${model}] ` + (gd.error?.message || gd.error?.code || JSON.stringify(gd.error));
            console.warn("Groq API error:", lastErrors.groq);
          }
        } catch (e) { lastErrors.groq = `[${model}] ` + e.message; console.warn("Groq:", e.message); }
      }
    }

    // ── OCR: GEMINI FALLBACK ──
    // Also configurable — Netlify dashboard → GEMINI_MODELS (comma-separated,
    // tried in order). Default list below is current as of Aug 2026.
    // Gemini 2.5-flash is announced to shut down Oct 16, 2026 — update this
    // list before then (check https://ai.google.dev/gemini-api/docs/models).
    if (!result) {
      const gKey = process.env.GEMINI_API_KEY;
      const geminiModels = (process.env.GEMINI_MODELS || "gemini-2.5-flash,gemini-2.0-flash,gemini-flash-latest")
        .split(",").map(m => m.trim()).filter(Boolean);
      if (gKey) {
        for (const model of geminiModels) {
          try {
            const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${gKey}`, {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ contents: [{ parts: [{ inlineData: { mimeType: "image/jpeg", data: image } }, { text: prompt }] }], generationConfig: { temperature: 0, maxOutputTokens: 400 } })
            });
            const d = await r.json();
            if (r.ok && d.candidates) { result = d; break; }
            if (d.error) { lastErrors.gemini = d.error?.message; console.warn("Gemini API error:", d.error?.message); }
          } catch (e) { lastErrors.gemini = e.message; console.warn("Gemini:", e.message); }
        }
      }
    }

    if (!result) return { statusCode: 503, headers, body: JSON.stringify({
      error: "OCR service unavailable. API keys may need updating — contact admin.",
      details: { groq: lastErrors.groq, gemini: lastErrors.gemini }
    }) };
    return { statusCode: 200, headers, body: JSON.stringify(result) };

  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Server error. Try again." }) };
  }
}
