// lib/firebase.ts
import { initializeApp, getApps, getApp } from "firebase/app";
import {
  getAuth,
  OAuthProvider,
  connectAuthEmulator,
} from "firebase/auth";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";
import { getStorage, connectStorageEmulator } from "firebase/storage";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
};

function createFirebaseApp() {
  if (!getApps().length) {
    return initializeApp(firebaseConfig);
  }
  return getApp();
}

export const firebaseApp = createFirebaseApp();
export const auth = getAuth(firebaseApp);
export const firestore = getFirestore(firebaseApp);
export const storage = getStorage(firebaseApp);

const useFirebaseEmulators =
  process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === "true";

const emulatorHost =
  process.env.NEXT_PUBLIC_FIREBASE_EMULATOR_HOST ?? "127.0.0.1";

const firestoreEmulatorPort =
  Number(process.env.NEXT_PUBLIC_FIRESTORE_EMULATOR_PORT) || 8080;
const authEmulatorPort =
  Number(process.env.NEXT_PUBLIC_AUTH_EMULATOR_PORT) || 9099;
const storageEmulatorPort =
  Number(process.env.NEXT_PUBLIC_STORAGE_EMULATOR_PORT) || 9199;

let emulatorsConnected = false;

function connectFirebaseEmulators(): void {
  if (
    !useFirebaseEmulators ||
    typeof window === "undefined" ||
    emulatorsConnected
  ) {
    return;
  }
  emulatorsConnected = true;

  connectFirestoreEmulator(
    firestore,
    emulatorHost,
    firestoreEmulatorPort
  );
  connectAuthEmulator(
    auth,
    `http://${emulatorHost}:${authEmulatorPort}`,
    { disableWarnings: true }
  );
  connectStorageEmulator(storage, emulatorHost, storageEmulatorPort);
}

connectFirebaseEmulators();

export const microsoftProvider = new OAuthProvider("microsoft.com");