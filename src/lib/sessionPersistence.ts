const PERSISTED_LOGIN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export async function establishPersistedIdentity<T>(
  enableLocalPersistence: () => Promise<void>,
  interactiveSignIn: () => Promise<T>,
): Promise<T> {
  await enableLocalPersistence();
  return interactiveSignIn();
}

export function shouldRestorePersistedSession(lastSignInTime: string | undefined, now = new Date()): boolean {
  if (!lastSignInTime) return false;
  const lastSignInAt = Date.parse(lastSignInTime);
  return Number.isFinite(lastSignInAt) && now.getTime() - lastSignInAt < PERSISTED_LOGIN_TTL_MS;
}

export async function restorePersistedSession(
  user: { getIdToken(forceRefresh?: boolean): Promise<string> },
  createServerSession: (idToken: string) => Promise<boolean>,
): Promise<boolean> {
  const idToken = await user.getIdToken();
  return createServerSession(idToken);
}

export async function signOutPersistedSession(
  clearFirebaseIdentity: () => Promise<void>,
  clearServerSession: () => Promise<void>,
): Promise<void> {
  try {
    await clearFirebaseIdentity();
  } finally {
    await clearServerSession();
  }
}
