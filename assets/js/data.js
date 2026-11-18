import { ref, get, onValue, push, set, update, query, orderByChild, equalTo } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";
import { db } from "./firebase.js";

const root = (path) => ref(db, path);
export async function read(path) {
  if (!db) throw new Error("Firebase belum dikonfigurasi.");
  const snap = await get(root(path));
  return snap.exists() ? snap.val() : null;
}
export function watch(path, callback, onError=console.error) {
  if (!db) return () => {};
  return onValue(root(path), s => callback(s.exists()?s.val():null), onError);
}
export async function createRecord(path, data) {
  if (!db) throw new Error("Firebase belum dikonfigurasi.");
  const r = push(root(path));
  await set(r, {...data, id:r.key, createdAt:Date.now()});
  return r.key;
}
export async function saveHousehold(data) {
  if (!db) throw new Error("Firebase belum dikonfigurasi.");
  const id = data.id || push(root("households")).key;
  await set(root(`households/${id}`), {...data, id, updatedAt:Date.now()});
  return id;
}
export async function getHouseholds() {
  return await read("households") || {};
}
export async function getMonthBills(monthKey) {
  return await read(`bills/${monthKey}`) || {};
}
export async function getPayments() {
  return await read("payments") || {};
}
export async function getExpenses() {
  return await read("expenses") || {};
}

export async function getBillingSettings() {
  return await read("settings/billingRates") || { kasMonthly: 0, waterAdmin: 0, waterPerM3: 0, sampahMonthly: 0, updatedAt: null };
}
export async function saveBillingSettings(values) {
  if (!db) throw new Error("Firebase belum dikonfigurasi.");
  const clean = {
    kasMonthly: Math.max(0, Number(values.kasMonthly) || 0),
    waterAdmin: Math.max(0, Number(values.waterAdmin) || 0),
    waterPerM3: Math.max(0, Number(values.waterPerM3) || 0),
    sampahMonthly: Math.max(0, Number(values.sampahMonthly) || 0),
    updatedAt: Date.now()
  };
  await set(root("settings/billingRates"), clean);
  return clean;
}


/**
 * Publishes a deliberately limited public projection.
 * Never includes resident names, phone numbers, family members, or payment details.
 * Public pages read only /public_views; private source nodes remain auth-only.
 */
export async function publishPublicSnapshot(currentPeriod, households, balances, billsByPeriod, transactions = {}, expenses = {}) {
  if (!db) throw new Error("Firebase belum dikonfigurasi.");
  const publicBillsByPeriod = {};
  const allOutstandingByHousehold = {};
  let totalOutstanding = 0;

  for (const [period, householdsInPeriod] of Object.entries(billsByPeriod || {})) {
    const periodRows = {};
    for (const [householdId, bill] of Object.entries(householdsInPeriod || {})) {
      const house = households?.[householdId] || {};
      const row = {
        label: String(house.block || "Rumah terdaftar").slice(0, 60),
        kas: Math.max(0, Number(bill?.kas?.remaining) || 0),
        sampah: Math.max(0, Number(bill?.sampah?.remaining) || 0),
        air: Math.max(0, Number(bill?.air?.remaining) || 0)
      };
      row.total = row.kas + row.sampah + row.air;
      if (row.total > 0) {
        periodRows[householdId] = row;
        if (!allOutstandingByHousehold[householdId]) {
          allOutstandingByHousehold[householdId] = {label: row.label, kas:0, sampah:0, air:0, total:0, periodCount:0};
        }
        for (const cat of ["kas","sampah","air"]) allOutstandingByHousehold[householdId][cat] += row[cat];
        allOutstandingByHousehold[householdId].total += row.total;
        allOutstandingByHousehold[householdId].periodCount += 1;
        totalOutstanding += row.total;
      }
    }
    publicBillsByPeriod[period] = periodRows;
  }

  const categoryTotals = {};
  for (const category of ["kas", "sampah", "air"]) {
    const b = balances?.[category] || {};
    categoryTotals[category] = {
      balance: Number(b.balance) || 0,
      income: Number(b.income) || 0,
      expense: Number(b.expense) || 0
    };
  }

  const financeByMonth = {};
  const monthOf = value => {
    if (typeof value === "number") return new Date(value).toISOString().slice(0, 7);
    const s = String(value || "");
    if (/^\d{4}-\d{2}/.test(s)) return s.slice(0, 7);
    const n = Number(s);
    return Number.isFinite(n) && n > 0 ? new Date(n).toISOString().slice(0, 7) : "";
  };
  const safeDescription = value => String(value || "Transaksi").replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[data pribadi]").replace(/(?:\+?62|0)\d[\d\s-]{7,}/g, "[nomor disamarkan]").slice(0, 120);

  const ensureMonth = month => {
    if (!month) return null;
    if (!financeByMonth[month]) financeByMonth[month] = { income: [], expenses: [], totals: { income: 0, expenses: 0 } };
    return financeByMonth[month];
  };

  for (const [id, tx] of Object.entries(transactions || {})) {
    const type = String(tx?.type || tx?.direction || tx?.kind || "").toLowerCase();
    if (!/(income|pemasukan|payment|pembayaran|setoran)/.test(type) || /(expense|pengeluaran)/.test(type)) continue;
    const month = monthOf(tx.date || tx.createdAt || tx.timestamp);
    const bucket = ensureMonth(month);
    if (!bucket) continue;
    const amount = Math.max(0, Number(tx.amount) || 0);
    if (!amount) continue;
    const category = ["kas", "sampah", "air"].includes(tx.category) ? tx.category : "lainnya";
    bucket.income.push({ date: tx.date || tx.createdAt || tx.timestamp || null, category, amount, description: safeDescription(tx.publicDescription || tx.description || "Pemasukan") });
    bucket.totals.income += amount;
  }

  for (const [id, expense] of Object.entries(expenses || {})) {
    const month = monthOf(expense?.date || expense?.createdAt || expense?.timestamp);
    const bucket = ensureMonth(month);
    if (!bucket) continue;
    const amount = Math.max(0, Number(expense.amount) || 0);
    if (!amount) continue;
    const category = ["kas", "sampah", "air"].includes(expense.category) ? expense.category : "lainnya";
    bucket.expenses.push({ date: expense.date || expense.createdAt || expense.timestamp || null, category, amount, description: safeDescription(expense.publicDescription || expense.description || "Pengeluaran") });
    bucket.totals.expenses += amount;
  }

  for (const month of Object.values(financeByMonth)) {
    month.income.sort((a,b) => Number(b.date || 0) - Number(a.date || 0));
    month.expenses.sort((a,b) => Number(b.date || 0) - Number(a.date || 0));
  }

  const payload = {
    dashboard: {
      period: currentPeriod,
      householdCount: Object.keys(households || {}).length,
      outstandingHouseholds: Object.values(allOutstandingByHousehold).filter(x => x.total > 0).length,
      totalOutstanding,
      categories: categoryTotals,
      updatedAt: Date.now()
    },
    billsByPeriod: publicBillsByPeriod,
    allOutstanding: allOutstandingByHousehold,
    financeByMonth,
    updatedAt: Date.now()
  };
  await set(root("public_views"), payload);
  return payload;
}

export async function getPublicDashboard() {
  return await read("public_views/dashboard") || null;
}

export async function getPublicBills() {
  return await read("public_views/allOutstanding") || {};
}
