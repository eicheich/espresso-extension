import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from 'firebase/auth';
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, writeBatch } from 'firebase/firestore';
import { auth, db } from './firebase';
import { sortPrompts, type PromptItem } from './prompts';

function promptsCollection(uid: string) {
  if (!db) {
    throw new Error('Cloud sync requires Firebase configuration in .env.');
  }
  return collection(db, 'users', uid, 'prompts');
}

function toFirestorePrompt(prompt: PromptItem) {
  return {
    id: prompt.id,
    title: prompt.title,
    instruction: prompt.instruction,
    category: prompt.category ?? '',
    order: prompt.order,
    updatedAt: prompt.updatedAt,
  };
}

export function subscribeToAuth(callback: (user: User | null) => void): () => void {
  if (!auth) return () => {};
  return onAuthStateChanged(auth, callback);
}

export async function signInWithEmail(email: string, password: string): Promise<User> {
  if (!auth) throw new Error('Firebase Auth is not configured.');
  const credential = await signInWithEmailAndPassword(auth, email.trim(), password);
  return credential.user;
}

export async function signUpWithEmail(email: string, password: string): Promise<User> {
  if (!auth) throw new Error('Firebase Auth is not configured.');
  const credential = await createUserWithEmailAndPassword(auth, email.trim(), password);
  return credential.user;
}

export async function signOutUser(): Promise<void> {
  if (!auth) return;
  await signOut(auth);
}

export async function syncPromptsOnSignIn(
  uid: string,
  localPrompts: PromptItem[],
): Promise<PromptItem[]> {
  if (!db) return localPrompts;

  const colRef = promptsCollection(uid);
  const snapshot = await getDocs(colRef);
  const merged = new Map<string, PromptItem>();

  for (const item of localPrompts) {
    merged.set(item.id, item);
  }

  snapshot.forEach((docSnap) => {
    const data = docSnap.data() as Partial<PromptItem>;
    if (!data.title || !data.instruction) return;
    const remote: PromptItem = {
      id: docSnap.id,
      title: data.title,
      instruction: data.instruction,
      category: data.category || undefined,
      order: typeof data.order === 'number' ? data.order : merged.size,
      updatedAt: typeof data.updatedAt === 'number' ? data.updatedAt : Date.now(),
    };
    const existing = merged.get(remote.id);
    if (!existing || remote.updatedAt >= existing.updatedAt) {
      merged.set(remote.id, remote);
    }
  });

  const sorted = sortPrompts([...merged.values()]).map((item, idx) => ({
    ...item,
    order: idx,
  }));

  const batch = writeBatch(db);
  for (const prompt of sorted) {
    batch.set(doc(colRef, prompt.id), toFirestorePrompt(prompt));
  }
  await batch.commit();

  return sorted;
}

export async function upsertCloudPrompt(uid: string, prompt: PromptItem): Promise<void> {
  if (!db) return;
  await setDoc(doc(promptsCollection(uid), prompt.id), toFirestorePrompt(prompt));
}

export async function deleteCloudPrompt(uid: string, promptId: string): Promise<void> {
  if (!db) return;
  await deleteDoc(doc(promptsCollection(uid), promptId));
}

export async function saveAllCloudPrompts(uid: string, prompts: PromptItem[]): Promise<void> {
  if (!db) return;
  const colRef = promptsCollection(uid);
  const batch = writeBatch(db);
  for (const prompt of prompts) {
    batch.set(doc(colRef, prompt.id), toFirestorePrompt(prompt));
  }
  await batch.commit();
}

function userProfileDoc(uid: string) {
  if (!db) {
    throw new Error('Firebase Firestore is not configured.');
  }
  return doc(db, 'users', uid);
}

export async function syncPinnedPromptIdsOnSignIn(
  uid: string,
  localPinnedIds: string[],
): Promise<string[]> {
  if (!db) return localPinnedIds;

  const userRef = userProfileDoc(uid);
  const snap = await getDoc(userRef);
  const rawCloud = snap.exists() ? snap.data()?.pinnedPromptIds : undefined;
  const cloudPinnedIds = Array.isArray(rawCloud)
    ? rawCloud.filter((id): id is string => typeof id === 'string' && id.length > 0)
    : [];

  const merged = Array.from(new Set([...localPinnedIds, ...cloudPinnedIds]));
  const cloudMatchesMerged =
    merged.length === cloudPinnedIds.length && merged.every((id, idx) => id === cloudPinnedIds[idx]);
  if (!cloudMatchesMerged) {
    await setDoc(userRef, { pinnedPromptIds: merged, updatedAt: Date.now() }, { merge: true });
  }
  return merged;
}

export async function saveCloudPinnedPromptIds(uid: string, pinnedIds: string[]): Promise<void> {
  if (!db) return;
  const uniqueIds = Array.from(new Set(pinnedIds.filter((id) => typeof id === 'string' && id.length > 0)));
  await setDoc(userProfileDoc(uid), { pinnedPromptIds: uniqueIds, updatedAt: Date.now() }, { merge: true });
}

export function formatAuthError(error: unknown): string {
  const code = (error as { code?: string })?.code ?? '';
  switch (code) {
    case 'auth/invalid-email':
      return 'Please enter a valid email address.';
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Incorrect email or password.';
    case 'auth/email-already-in-use':
      return 'An account with this email already exists.';
    case 'auth/weak-password':
      return 'Password must be at least 6 characters.';
    case 'auth/network-request-failed':
      return 'Network error. Please check your connection and try again.';
    case 'auth/configuration-not-found':
    case 'auth/operation-not-allowed':
      return 'Email/Password sign-in is not enabled in Firebase Console yet. Enable Authentication → Email/Password for this project.';
    default:
      return error instanceof Error ? error.message : 'Authentication failed. Please try again.';
  }
}
