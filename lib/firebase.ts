import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { getFirestore, initializeFirestore, persistentLocalCache, type Firestore } from "firebase/firestore";
import { createFirebaseAuth } from "./firebase-auth-adapter";
import type { Auth } from "firebase/auth";

export type FirebasePublicConfig = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  measurementId?: string;
};

export const firebaseConfig: FirebasePublicConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY ?? "",
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN ?? "",
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ?? "",
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET ?? "",
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? "",
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID ?? "",
  measurementId: process.env.EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID ?? "",
};

export let firebaseConfigured = false;
export let firebaseApp: FirebaseApp | null = null;
export let firebaseAuth: Auth | null = null;
export let db: Firestore | null = null;

function isComplete(config: FirebasePublicConfig) {
  return Boolean(config.apiKey && config.authDomain && config.projectId && config.appId);
}

export async function ensureFirebaseConfigured(): Promise<boolean> {
  if (firebaseConfigured && firebaseApp && firebaseAuth && db) return true;
  if (!isComplete(firebaseConfig)) return false;

  try {
    firebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);
    firebaseAuth = createFirebaseAuth(firebaseApp);
    try {
      db = initializeFirestore(firebaseApp, { localCache: persistentLocalCache() });
    } catch {
      db = getFirestore(firebaseApp);
    }
    firebaseConfigured = true;
    return true;
  } catch (error) {
    console.error("Firebase no pudo inicializarse.", error);
    firebaseConfigured = false;
    return false;
  }
}

void ensureFirebaseConfigured();
