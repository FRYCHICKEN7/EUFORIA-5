import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { AppState } from "react-native";
import { db, ensureFirebaseConfigured, firebaseAuth } from "@/lib/firebase";
import { subscribeUserProfile } from "@/lib/profiles";
import type { ProfileRecord } from "@/lib/roles";
import { authenticateBiometricFor, isBiometricEnrolledFor } from "@/lib/biometrics";

export type UserProfile = ProfileRecord & { email?: string; negocioId?: string };

type AuthSession = {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  isBiometricLocked: boolean;
  unlockSession: () => void;
  unlockWithBiometrics: () => Promise<boolean>;
};

const AuthSessionContext = createContext<AuthSession>({ user: null, profile: null, loading: true, isBiometricLocked: false, unlockSession: () => undefined, unlockWithBiometrics: async () => false });

export function AuthSessionProvider({ children }: PropsWithChildren) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [isBiometricLocked, setBiometricLocked] = useState(false);
  const firstAuthState = useRef(true);
  const currentUser = useRef<User | null>(null);

  useEffect(() => { currentUser.current = user; }, [user]);

  useEffect(() => {
    let previous = AppState.currentState;
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (previous === "active" && nextState !== "active") {
        const uid = currentUser.current?.uid;
        if (uid) void isBiometricEnrolledFor(uid).then((enrolled) => { if (enrolled) setBiometricLocked(true); });
      }
      previous = nextState;
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    let cancelled = false;
    let stopAuth: (() => void) | undefined;
    let stopProfile: (() => void) | undefined;

    void ensureFirebaseConfigured().then((configured) => {
      if (cancelled) return;
      if (!configured || !firebaseAuth || !db) {
        setLoading(false);
        return;
      }
      stopAuth = onAuthStateChanged(firebaseAuth, async (nextUser) => {
        const isInitialAuthState = firstAuthState.current;
        firstAuthState.current = false;
        currentUser.current = nextUser;
        stopProfile?.();
        stopProfile = undefined;
        setUser(nextUser);
        setProfile(null);
        if (!nextUser) {
          setBiometricLocked(false);
          setLoading(false);
          return;
        }
        setLoading(true);
        if (isInitialAuthState) {
          setBiometricLocked(await isBiometricEnrolledFor(nextUser.uid));
          if (cancelled) return;
        } else {
          setBiometricLocked(false);
        }
        stopProfile = subscribeUserProfile(nextUser.uid, (nextProfile) => {
          setProfile(nextProfile as UserProfile | null);
          setLoading(false);
        }, (error) => {
          console.warn("No se pudo leer una de las fuentes de perfil autenticado.", (error as Error & { code?: string }).code);
        });
      });
    });

    return () => {
      cancelled = true;
      stopProfile?.();
      stopAuth?.();
    };
  }, []);

  const unlockSession = useCallback(() => setBiometricLocked(false), []);
  const unlockWithBiometrics = useCallback(async () => {
    if (!user?.uid || !(await authenticateBiometricFor(user.uid))) return false;
    setBiometricLocked(false);
    return true;
  }, [user?.uid]);
  const value = useMemo(() => ({ user, profile, loading, isBiometricLocked, unlockSession, unlockWithBiometrics }), [user, profile, loading, isBiometricLocked, unlockSession, unlockWithBiometrics]);
  return <AuthSessionContext.Provider value={value}>{children}</AuthSessionContext.Provider>;
}

export function useAuthSession() {
  return useContext(AuthSessionContext);
}
