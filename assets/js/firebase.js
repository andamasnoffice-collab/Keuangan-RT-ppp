import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";

/*
 * Isi konfigurasi dari Firebase Console > Project settings > Your apps.
 * Jangan memasukkan service account/private key ke file HTML.
 */
export const firebaseConfig = {
  apiKey: "AIzaSyA2b5b4bFrRJvQGxLvvZJ3xOy2QXtydWck",
  authDomain: "keuangan-rt-ppp.firebaseapp.com",
  databaseURL: "https://keuangan-rt-ppp-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "keuangan-rt-ppp",
  storageBucket: "keuangan-rt-ppp.firebasestorage.app",
  messagingSenderId: "54221199892",
  appId: "1:54221199892:web:cc5b4496bc6df0dd246501"
};

export const firebaseConfigured = !Object.values(firebaseConfig).some(v => String(v).startsWith("ISI_"));
export let app = null, auth = null, db = null;
if (firebaseConfigured) {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getDatabase(app);
}
