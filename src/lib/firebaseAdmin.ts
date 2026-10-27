import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

function app() {
  return getApps()[0] ?? initializeApp({ credential: applicationDefault() });
}

export function adminAuth() {
  return getAuth(app());
}
