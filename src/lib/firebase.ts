import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getAI, GoogleAIBackend, type AI } from 'firebase/ai';
import { initializeAppCheck, ReCaptchaV3Provider, type AppCheck } from 'firebase/app-check';
import { getAuth, type Auth } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey &&
    firebaseConfig.projectId &&
    firebaseConfig.appId &&
    !String(firebaseConfig.apiKey).startsWith('your_'),
);

let app: FirebaseApp | null = null;
let appCheck: AppCheck | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;
let ai: AI | null = null;

if (isFirebaseConfigured) {
  app = initializeApp(firebaseConfig);

  if (typeof self !== 'undefined') {
    // Enable App Check debug token mode before initialization so chrome-extension:// works without a live reCAPTCHA site key.
    (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN?: string | boolean }).FIREBASE_APPCHECK_DEBUG_TOKEN =
      import.meta.env.VITE_APPCHECK_DEBUG_TOKEN || true;

    appCheck = initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider('dummy-site-key-for-debug'),
      isTokenAutoRefreshEnabled: true,
    });
  }

  auth = getAuth(app);
  db = getFirestore(app);
  ai = getAI(app, { backend: new GoogleAIBackend() });
}

export { app, appCheck, auth, db, ai };
