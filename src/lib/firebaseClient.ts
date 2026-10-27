import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";

function app() {
  if (getApps().length) return getApp();
  return initializeApp({
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  });
}

export function clientAuth() {
  return getAuth(app());
}
