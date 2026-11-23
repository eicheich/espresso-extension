# Lazy Prompt — Hybrid On-Device & Cloud AI Chrome Extension

**Lazy Prompt** is a minimalist Manifest V3 Chrome Side Panel extension built for the **Devpost #BuildHybridAI 2026** hackathon. It turns your most-used AI prompts into 1-click actions over any webpage or highlighted selection—running privately on-device with **Gemini Nano** via Chrome's built-in Prompt API whenever possible, and seamlessly falling back to **Gemini Cloud** via Firebase AI Logic when needed.

---

## Key Features & Hybrid AI Architecture

- **Chrome Side Panel UX (`~360px–400px`):** Opens directly from the extension toolbar icon (`chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })`) and stays docked beside any webpage.
- **Smart Context Extraction & Live Token Meter:**
  - Automatically prioritizes highlighted text (`window.getSelection()`) and labels it **`Context: Selected Text`**.
  - Falls back to clean article extraction using **`@mozilla/readability`** (with cleaned `document.body.innerText` fallback) labeled **`Context: Full Page`**, stripping navigation, ads, and boilerplate.
  - Displays a live approximate token meter (`~X / 9,216 tokens`) before and during execution so users see at a glance whether the payload fits within Gemini Nano's local window or will trigger Cloud Fallback.
- **Streaming Hybrid Inference (`firebase/ai`):**
  - Uses `generateContentStream` with `InferenceMode.PREFER_ON_DEVICE`, `GoogleAIBackend()`, and a flagship cloud fallback chain (`gemini-4-hydrogen` → `gemini-3.8-flash` → `gemini-3.5-flash-lite`) for resilient real-time Markdown streaming.
  - Respects Chrome's **User Activation Rule**: `model.initializeDeviceModel()` is called *only* inside explicit user click handlers (**Run** or **Warm Up Local AI**), never on page load.
  - Renders a transparent **Inference Source Badge** on every result:
    - `⚡ On-Device (Gemini Nano 4 • Private)` when executed locally (`on_device`)
    - `☁️ Cloud Fallback (Gemini Cloud)` when executed in the cloud (`in_cloud`)
- **Zero-Friction Prompt Library (CRUD) + Optional Cloud Sync:**
  - Ships with 4 starter prompts (*TL;DR Bullet Summary*, *Extract Key Takeaways*, *Explain Like I'm 5*, *Technical Docs Breakdown*) saved in `chrome.storage.local` with no login required.
  - Supports creating, editing, deleting, and reordering prompts, plus optional Email/Password sign-in via Firebase Auth & Cloud Firestore (`users/{uid}/prompts`).

```
[Active Tab Selection / Page Text]
               │
               ▼
    [Live Token Meter (~X / 9,216)]
               │
               ▼  (User clicks "Run" or "Warm Up Local AI")
  model.initializeDeviceModel() + generateContentStream()
        ┌──────┴─────────────────────────┐
        ▼                                ▼
  Local Gemini Nano Ready?         Unavailable or > Window
        │                                │
        ▼                                ▼
⚡ On-Device (Gemini Nano 4)     ☁️ Cloud Fallback (Gemini Cloud)
```

---

## 1. Chrome Prerequisites (On-Device Gemini Nano)

To test local on-device inference (otherwise requests automatically route to Gemini Cloud Fallback):

1. Install **Chrome Desktop v139+** (or Chrome Canary / Dev v139+).
2. Open `chrome://flags` and enable both flags:
   - `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input` → **Enabled**
   - `chrome://flags/#optimization-guide-on-device-model` → **Enabled BypassPerfRequirement**
3. Relaunch Chrome.
4. Click **Warm Up Local AI** (or run any prompt) in the Lazy Prompt Side Panel to trigger Chrome's on-device model download/initialization.

---

## 2. Firebase & Environment Setup (`.env`)

1. Create or select a project in the [Firebase Console](https://console.firebase.google.com/).
2. Enable **Firebase AI Logic** (Gemini Developer API):
   - In the Firebase Console, open **AI Logic** and enable the **Gemini Developer API**, or run `npx firebase-tools@latest init ailogic`.
3. *(Optional, for Cloud Sync)* Enable **Authentication → Email/Password** and create a **Cloud Firestore** database with rules scoped to each user:
   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /users/{uid}/prompts/{promptId} {
         allow read, write: if request.auth != null && request.auth.uid == uid;
       }
     }
   }
   ```
4. Copy `.env.example` to `.env` and fill in your Firebase Web App config:
   ```bash
   cp .env.example .env
   ```

### App Check Debug Token Setup (For Judges & `chrome-extension://` Origin)

Chrome extensions run under the `chrome-extension://` origin, where standard web reCAPTCHA challenges cannot run. Lazy Prompt configures Firebase App Check in **Debug Token Mode** (`(self as any).FIREBASE_APPCHECK_DEBUG_TOKEN = import.meta.env.VITE_APPCHECK_DEBUG_TOKEN || true` before `initializeAppCheck()`).

To authorize your local extension build when App Check enforcement is enabled:
- **Option A — Auto-generated token:**
  1. Leave `VITE_APPCHECK_DEBUG_TOKEN=` blank in `.env`, build, and open the Lazy Prompt Side Panel.
  2. Right-click inside the Side Panel → **Inspect** → open the **Console** tab.
  3. Copy the printed UUID from `AppCheck debug token: "<UUID>"`.
  4. Register that UUID in **Firebase Console → App Check → Apps → (Your Web App) → Manage debug tokens**.
- **Option B — Pre-registered token (CI / Judge testing):**
  1. Generate and save a debug token UUID in **Firebase Console → App Check → Apps → Manage debug tokens**.
  2. Set `VITE_APPCHECK_DEBUG_TOKEN=<your-uuid>` in `.env` before running `npm run build`.

---

## 3. Build & Load Unpacked in Chrome

All scripts and dependencies are bundled locally into `dist/` with zero remotely hosted code.

```bash
npm install
npm run build
```

Then load the extension in Chrome:

1. Navigate to `chrome://extensions`.
2. Toggle **Developer mode** ON (top right).
3. Click **Load unpacked** and select the generated **`dist/`** directory.
4. Pin **Lazy Prompt** to the Chrome toolbar and click its icon on any webpage to open the Side Panel.

---

## Available Scripts

- `npm run dev` — Start Vite dev server
- `npm run typecheck` — Run TypeScript type checking (`tsc --noEmit`)
- `npm test` — Run unit tests with Vitest
- `npm run build` — Type-check and build the production extension bundle into `dist/`
