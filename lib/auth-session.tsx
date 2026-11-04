import { createContext, useContext, useEffect, useMemo, useState, type PropsWithChildren } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { db, ensureFirebaseConfigured, firebaseAuth } from "@/lib/firebase";
import { subscribeUserProfile } from "@/lib/profiles";
import type { ProfileRecord } from "@/lib/roles";

export type UserProfile = ProfileRecord & { email?: string; negocioId?: string };

type AuthSession = {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
};

const AuthSessionContext = createContext<AuthSession>({ user: null, profile: null, loading: true });

export function AuthSessionProvider({ children }: PropsWithChildren) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

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
      stopAuth = onAuthStateChanged(firebaseAuth, (nextUser) => {
        stopProfile?.();
        stopProfile = undefined;
        setUser(nextUser);
        setProfile(null);
        if (!nextUser) {
          setLoading(false);
          return;
        }
        setLoading(true);
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

  const value = useMemo(() => ({ user, profile, loading }), [user, profile, loading]);
  return <AuthSessionContext.Provider value={value}>{children}</AuthSessionContext.Provider>;
}

export function useAuthSession() {
  return useContext(AuthSessionContext);
}
