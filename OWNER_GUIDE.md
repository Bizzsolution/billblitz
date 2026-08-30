# 🏨 AtithiBook SaaS — Owner Guide (Dharamveer ke liye)

## Architecture Overview

```
Customer Phone
     │
     ▼
https://atithhi.netlify.app
     │  (enters license key)
     ▼
Netlify Function /api/scan
     │  (license verified, API key hidden)
     ▼
Google Gemini API
     │
     ▼
Aadhaar data back to customer
```

**Customer ko kabhi nahi pata**: API key, server details, kuch bhi.

---

## STEP 1 — Netlify Setup (One Time)

### 1a. Deploy karo
Yeh 4 files/folders drag karo Netlify pe:
```
index.html
manifest.json
netlify.toml
netlify/
  └── functions/
      └── scan.mjs
```

### 1b. Environment Variables set karo
Netlify Dashboard → Site → **Environment Variables** → Add:

| Key | Value |
|---|---|
| `GEMINI_API_KEY` | Apna Google AI Studio key (AIzaSy...) |
| `VALID_LICENSES` | Comma-separated license keys (below) |

Example VALID_LICENSES value:
```
ATITHI-HOTEL001,ATITHI-HOTEL002,ATITHI-HOTEL003
```

### 1c. Redeploy
Environment variables add karne ke baad **Trigger Deploy** karo.

---

## STEP 2 — License Key Generate Karo

Har customer ke liye ek unique key banao. Simple format:

```
ATITHI-[HOTELCODE]
```

Example keys:
```
ATITHI-RAJHOTEL
ATITHI-SHIVAM01
ATITHI-DELUXE22
ATITHI-SUNRISE1
```

**Rules:**
- Sirf capital letters aur numbers
- 8-20 characters after ATITHI-
- Har hotel ko alag key

---

## STEP 3 — Nayi Customer Add Karna

Jab koi hotel subscribe kare:

1. **License key banao**: e.g., `ATITHI-NEWHOTEL`
2. Netlify → **Environment Variables** → `VALID_LICENSES` edit karo
3. Nayi key add karo (comma se separate):
   ```
   ATITHI-HOTEL001,ATITHI-HOTEL002,ATITHI-NEWHOTEL
   ```
4. **Save** → **Trigger Deploy** (1 min lagta hai)
5. Customer ko WhatsApp pe bhejo:
   ```
   AtithiBook Hotel Management
   URL: https://atithhi.netlify.app
   License Key: ATITHI-NEWHOTEL
   Login: admin / admin123
   
   Pehli baar: URL kholo → License key enter karo → Activate
   ```

---

## STEP 4 — Customer ka License Expire Karna

Agar payment nahi aaya:

1. Netlify → **Environment Variables** → `VALID_LICENSES`
2. Us hotel ki key **remove** karo
3. Deploy
4. Customer ke app mein automatically "License expired" aayega

---

## STEP 5 — Pricing Strategy

### Recommended Plans:

| Plan | Price | Features |
|---|---|---|
| **Starter** | ₹499/month | 15 rooms, basic features |
| **Standard** | ₹799/month | 30 rooms, all features |
| **Premium** | ₹1499/month | Unlimited rooms, priority support |

### Per-scan cost (aapka):
- Google Gemini: ~₹0.01/scan (practically free)
- 100 check-ins/day × 30 days = 3000 scans/month = ~₹30

### Profit per customer:
- ₹499 revenue - ₹30 cost = **₹469 profit per hotel/month**
- 10 hotels = ₹4,690/month
- 50 hotels = ₹23,450/month

---

## STEP 6 — Customer Support

Agar customer bolta hai "kaam nahi kar raha":

**Check 1**: License key valid hai?
→ Netlify → VALID_LICENSES mein hai?

**Check 2**: Gemini API quota?
→ aistudio.google.com/apikey → Usage check karo
→ Free tier: 1500 req/day. Zyada chahiye? Paid plan le lo.

**Check 3**: Netlify function errors?
→ Netlify → Functions → Logs dekho

---

## Files Summary

| File | Purpose |
|---|---|
| `index.html` | Customer-facing app |
| `manifest.json` | PWA (installable on phone) |
| `netlify.toml` | Server routing config |
| `netlify/functions/scan.mjs` | Backend — hides API key |

---

## Quick Reference — Adding Customer

```
1. Key banao: ATITHI-XXXXX
2. Netlify env var VALID_LICENSES mein add karo
3. Deploy
4. WhatsApp karo: URL + Key + Login
5. Done ✅
```
