# Espresso — Nano-First Hybrid AI Chrome Extension

**Espresso** (`espresso-extension`) is a minimalist Manifest V3 Chrome Side Panel extension built for **Nano-First Hybrid AI** — prioritizing **on-device Gemini Nano 4** (`LanguageModel` Prompt API) for fast, private, offline-capable inference, with seamless **Gemini Cloud** fallback via **Firebase AI Logic** (`gemini-3.5-flash-lite` → `gemini-4-hydrogen`) for oversized documents or devices without Nano 4 enabled.

---

## Key Features

- **Nano-First Hybrid Routing:**
  - **Primary (On-Device Gemini Nano 4):** Auto pre-warms `warmBaseSession` on Side Panel open and clones lightweight sessions per prompt run (`topK: 1`, `temperature: 0.2`) for selections and pages up to `2,000` tokens.
  - **Seamless Cloud Fallback (`firebase/ai`):** Automatically routes long articles/PDFs (`> 2,000` tokens) or browsers without Nano 4 to Gemini Cloud (`gemini-3.5-flash-lite` → `gemini-4-hydrogen`).
  - **Resilient Local Fallback & `Local Only` Mode:** Falls back to sentence-trimmed local Nano 4 (`<= 4,800` chars) if Cloud hits `429` quota or the device is offline, or lock inference 100% locally anytime with **Local Only**.
- **Offline PDF & Webpage Context:**
  - Prioritizes highlighted text (`Selected text`) or extracts clean article text via `@mozilla/readability`.
  - Parses both local (`file:///...pdf`) and direct file-picker PDFs (`Open PDF`) completely offline via `pdfjs-dist`, with guided `Allow access to file URLs` support.
- **Guided 3-Step Chrome Setup:**
  - Automatically checks Chrome's `LanguageModel.availability()` state and guides users through `1. Chrome Flags → 2. Download Model → 3. Ready` without blocking Hybrid Cloud usage.
- **4 Core Prompts + Custom Prompts & Cloud Sync:**
  - Ships with **Quick Summary**, **Key Takeaways**, **Explain Like I'm 5**, and **Code & Docs Breakdown**.
  - Supports custom prompt CRUD, **Pin** quick access, and optional Email/Password sign-in via Firebase Auth & Cloud Firestore.

---

## 1. Chrome Setup (On-Device Gemini Nano 4)

Espresso works out of the box in **Hybrid** mode via Gemini Cloud, and includes a built-in setup guide in the Side Panel to enable **local Gemini Nano 4**:

1. Use **Chrome Desktop v138+**.
2. Open `chrome://flags` and set:
   - `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input` → **Enabled**
   - `chrome://flags/#optimization-guide-on-device-model` → **Enabled BypassPerfRequirement**
3. Relaunch Chrome and click **Download Nano 4** inside Espresso.

---

## 2. Firebase Setup (`.env`)

1. Copy `.env.example` to `.env` and fill in your Firebase Web App credentials.
2. Enable **Firebase AI Logic (Gemini Developer API)** in the Firebase Console.
3. *(Optional, for Prompt Sync)* Enable **Authentication → Email/Password** and **Cloud Firestore** scoped to `users/{uid}`.
4. For `chrome-extension://` App Check testing, register your debug token UUID from DevTools Console (`AppCheck debug token: "<UUID>"`) or set `VITE_APPCHECK_DEBUG_TOKEN` in `.env`.

---

## 3. Build & Load Unpacked in Chrome

```bash
npm install
npm run build
```

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and choose the `dist/` folder.
3. Click the **Espresso** toolbar icon on any webpage or PDF to open the Side Panel.

---

## Scripts

- `npm run dev` — Start Vite dev server
- `npm run typecheck` — TypeScript check (`tsc --noEmit`)
- `npm test` — Run Vitest unit tests
- `npm run build` — Type-check and build production extension into `dist/`
