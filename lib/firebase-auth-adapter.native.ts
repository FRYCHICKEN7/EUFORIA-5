import { initializeAuth, getAuth, type Auth, type Persistence } from "firebase/auth";
import type { FirebaseApp } from "firebase/app";
import AsyncStorage from "@react-native-async-storage/async-storage";

type ReactNativeAuthExports = {
  getReactNativePersistence: (storage: typeof AsyncStorage) => Persistence;
};

export function createFirebaseAuth(app: FirebaseApp): Auth {
  try {
    const { getReactNativePersistence } = require("@firebase/auth") as ReactNativeAuthExports;
    return initializeAuth(app, {
      persistence: getReactNativePersistence(AsyncStorage),
    });
  } catch (error) {
    // HMR puede inicializar Auth antes que este módulo; reutiliza la instancia.
    if ((error as { code?: string }).code === "auth/already-initialized") {
      return getAuth(app);
    }
    throw error;
  }
}
