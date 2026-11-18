import { signInWithEmailAndPassword, signOut, onAuthStateChanged, EmailAuthProvider, reauthenticateWithCredential } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { auth, firebaseConfigured } from "./firebase.js";

export function observeSession(callback) {
  if (!firebaseConfigured) {
    callback(null, null);
    return () => {};
  }
  return onAuthStateChanged(auth, user => {
    callback(user || null, user ? { name: user.email || "Pengguna", role: "Akun login" } : null);
  });
}

export async function login(email, password) {
  if (!firebaseConfigured) throw new Error("Konfigurasi Firebase belum diisi.");
  return signInWithEmailAndPassword(auth, email, password);
}

export async function logout() {
  if (auth) await signOut(auth);
}

export async function reauthenticate(password) {
  if(!auth?.currentUser?.email) throw new Error("Sesi login tidak ditemukan. Silakan login ulang.");
  const credential=EmailAuthProvider.credential(auth.currentUser.email,password);
  await reauthenticateWithCredential(auth.currentUser,credential);
  return true;
}
