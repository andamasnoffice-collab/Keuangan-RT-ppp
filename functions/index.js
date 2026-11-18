/*
 * Backend transaksi keuangan.
 * Implementasi callable transaction harus diselesaikan dan diuji sebelum produksi.
 * Jangan membuka write RTDB dari browser untuk pembayaran/deposit.
 */
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getDatabase } = require("firebase-admin/database");
initializeApp();

exports.recordPayment = onCall({ region: "asia-southeast1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Login pengurus diperlukan.");
  const db = getDatabase();
  const uid = request.auth.uid;
  const profileSnap = await db.ref(`users/${uid}`).get();
  const profile = profileSnap.val();
  if (!profile || profile.status !== "active" || !["pak_rt","admin","bendahara"].includes(profile.role)) {
    throw new HttpsError("permission-denied", "Tidak memiliki hak mencatat pembayaran.");
  }
  const { householdId, allocations, receivedAmount, paymentMethod, idempotencyKey } = request.data || {};
  if (!householdId || !allocations || !Number.isSafeInteger(receivedAmount) || receivedAmount <= 0 || !idempotencyKey) {
    throw new HttpsError("invalid-argument", "Data pembayaran tidak lengkap atau tidak valid.");
  }
  const allowed = ["kas","sampah","air"];
  for (const [category, amount] of Object.entries(allocations)) {
    if (!allowed.includes(category) || !Number.isSafeInteger(amount) || amount < 0) {
      throw new HttpsError("invalid-argument", "Alokasi kategori tidak valid.");
    }
  }
  // TODO production implementation:
  // 1) transaction/idempotency lock per household + period
  // 2) validate outstanding bill and same-category deposit
  // 3) allocate received amount deterministically
  // 4) write payment, bill balances, deposit ledger, transaction and audit atomically
  // 5) update category balance projections from canonical ledger
  // The function deliberately rejects until all invariants are implemented and tested.
  throw new HttpsError("failed-precondition", "Backend pembayaran belum diaktifkan. Tidak ada transaksi yang disimpan.");
});
