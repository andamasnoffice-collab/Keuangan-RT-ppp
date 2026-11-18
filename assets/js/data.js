import { ref, get, onValue, push, set, update, runTransaction, query, orderByChild, equalTo } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";
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


const validPeriod = value => /^\\d{4}-(0[1-9]|1[0-2])$/.test(value);
export async function createMonthlyBills(period, recordedBy) {
  if (!db) throw new Error("Firebase belum dikonfigurasi.");
  if (!validPeriod(period)) throw new Error("Periode tagihan tidak valid.");
  const lockRef=root(`billing_runs/${period}`);
  const claim=await runTransaction(lockRef,current=>{
    if(current && current.status!=="failed") return;
    return {status:"processing",startedAt:Date.now(),recordedBy:recordedBy||null};
  },{applyLocally:false});
  if(!claim.committed) {
    const state=claim.snapshot.val();
    if(state?.status==="completed") throw new Error(`Tagihan periode ${period} sudah pernah dibuat. Tidak dapat dibuat dua kali.`);
    throw new Error("Pembuatan tagihan periode ini sedang diproses atau perlu pemeriksaan pengurus.");
  }
  try {
    const [homes,settings,existing]=await Promise.all([
      getHouseholds(),getBillingSettings(),getMonthBills(period)
    ]);
    const active=Object.entries(homes).filter(([,h])=>h && h.status!=="empty" && h.status!=="inactive");
    if(!active.length) throw new Error("Tidak ada rumah aktif/kontrak yang dapat dibuatkan tagihan.");
    if(Object.keys(existing).length) throw new Error("Data tagihan periode ini sudah ada. Proses dihentikan agar tidak menimpa tagihan.");
    const updates={};
    const now=Date.now();
    for(const [id,h] of active){
      const kas=Number(settings.kasMonthly)||0;
      const sampah=Number(settings.sampahMonthly)||0;
      const admin=Number(settings.waterAdmin)||0;
      const row={
        kas:{amount:kas,paidAmount:0,remaining:kas,status:kas>0?"unpaid":"paid",createdAt:now},
        sampah:{amount:sampah,paidAmount:0,remaining:sampah,status:sampah>0?"unpaid":"paid",createdAt:now},
        air:{amount:admin,adminAmount:admin,usage:0,usageAmount:0,previousMeter:Number(h.currentWaterMeter??h.initialWaterMeter)||0,currentMeter:Number(h.currentWaterMeter??h.initialWaterMeter)||0,paidAmount:0,remaining:admin,status:admin>0?"unpaid":"paid",createdAt:now}
      };
      updates[`bills/${period}/${id}`]=row;
    }
    updates[`billing_runs/${period}/status`]="completed";
    updates[`billing_runs/${period}/completedAt`]=now;
    updates[`billing_runs/${period}/householdCount`]=active.length;
    updates[`billing_runs/${period}/rates`]={kasMonthly:Number(settings.kasMonthly)||0,sampahMonthly:Number(settings.sampahMonthly)||0,waterAdmin:Number(settings.waterAdmin)||0,waterPerM3:Number(settings.waterPerM3)||0};
    updates[`billing_runs/${period}/recordedBy`]=recordedBy||null;
    await update(ref(db),updates);
    return {period,householdCount:active.length};
  } catch(error) {
    await set(lockRef,{status:"failed",failedAt:Date.now(),recordedBy:recordedBy||null,error:String(error.message||error)});
    throw error;
  }
}

export async function saveWaterReading({period,householdId,currentMeter,recordedBy}) {
  if(!db) throw new Error("Firebase belum dikonfigurasi.");
  if(!validPeriod(period)) throw new Error("Periode tidak valid.");
  const value=Number(currentMeter);
  if(!Number.isFinite(value)||value<0) throw new Error("Angka meter akhir tidak valid.");
  const [house,settings,bill,existingReading]=await Promise.all([
    read(`households/${householdId}`),getBillingSettings(),read(`bills/${period}/${householdId}/air`),read(`water_readings/${period}/${householdId}`)
  ]);
  if(!house) throw new Error("Data rumah tidak ditemukan.");
  if(!bill) throw new Error("Tagihan periode ini belum dibuat. Buat tagihan bulan berjalan terlebih dahulu.");
  if(existingReading) throw new Error("Meter air rumah ini sudah dicatat untuk periode tersebut. Koreksi harus dilakukan melalui prosedur koreksi, bukan input ulang.");
  const previous=Number(house.currentWaterMeter??house.initialWaterMeter)||0;
  if(value<previous) throw new Error(`Meter akhir tidak boleh lebih kecil dari meter awal (${previous}).`);
  const usage=Number((value-previous).toFixed(3));
  const rate=Number(settings.waterPerM3)||0;
  const admin=Number(bill.adminAmount??settings.waterAdmin)||0;
  const usageAmount=Math.round(usage*rate);
  const total=admin+usageAmount;
  const paid=Number(bill.paidAmount)||0;
  const remaining=Math.max(0,total-paid);
  const timestamp=Date.now();
  const reading={period,householdId,previousMeter:previous,currentMeter:value,usage,rate,adminAmount:admin,usageAmount,totalAmount:total,recordedBy:recordedBy||null,createdAt:timestamp};
  const updates={};
  updates[`water_readings/${period}/${householdId}`]=reading;
  updates[`households/${householdId}/currentWaterMeter`]=value;
  updates[`bills/${period}/${householdId}/air`]={...bill,previousMeter:previous,currentMeter:value,usage,rate,adminAmount:admin,usageAmount,amount:total,remaining,paidAmount:paid,status:remaining===0?"paid":paid>0?"partial":"unpaid",meterRecordedAt:timestamp};
  const logRef=push(root("audit_logs"));
  updates[`audit_logs/${logRef.key}`]={type:"water_meter_recorded",period,householdId,previousMeter:previous,currentMeter:value,usage,totalAmount:total,recordedBy:recordedBy||null,createdAt:timestamp};
  await update(ref(db),updates);
  return reading;
}

export async function getBillingSettings() {
  return await read("settings/billingRates") || { kasMonthly: 0, waterAdmin: 0, waterPerM3: 0, sampahMonthly: 0, updatedAt: null };
}
export async function saveBillingSettings(values) {
  if (!db) throw new Error("Firebase belum dikonfigurasi.");
  const previous = await getBillingSettings();
  const openingBalances = {
    kas: Math.max(0, Number(values.openingKas) || 0),
    air: Math.max(0, Number(values.openingAir) || 0),
    sampah: Math.max(0, Number(values.openingSampah) || 0)
  };
  const clean = {
    kasMonthly: Math.max(0, Number(values.kasMonthly) || 0),
    waterAdmin: Math.max(0, Number(values.waterAdmin) || 0),
    waterPerM3: Math.max(0, Number(values.waterPerM3) || 0),
    sampahMonthly: Math.max(0, Number(values.sampahMonthly) || 0),
    openingBalances,
    updatedAt: Date.now()
  };
  const updates = {"settings/billingRates": clean};
  for (const cat of ["kas","air","sampah"]) {
    const oldOpening = Number(previous.openingBalances?.[cat]) || 0;
    const nextOpening = openingBalances[cat];
    const balanceRef = await get(root(`category_balances/${cat}`));
    const current = balanceRef.exists() ? balanceRef.val() : {};
    const currentBalance = Number(current.balance) || 0;
    updates[`category_balances/${cat}`] = {
      ...current,
      openingBalance: nextOpening,
      balance: currentBalance + (nextOpening - oldOpening),
      updatedAt: Date.now()
    };
  }
  const logRef = push(root("audit_logs"));
  updates[`audit_logs/${logRef.key}`] = {type:"opening_balances_updated", openingBalances, createdAt:Date.now()};
  await update(ref(db), updates);
  return clean;
}

export async function createExpense({category, amount, date, description, proof, recordedBy}) {
  if (!db) throw new Error("Firebase belum dikonfigurasi.");
  if (!["kas","air","sampah"].includes(category)) throw new Error("Pilih sumber dana yang valid.");
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) throw new Error("Nominal pengeluaran harus lebih dari nol.");
  if (!String(description||"").trim()) throw new Error("Keterangan pengeluaran wajib diisi.");
  if (!String(proof||"").trim()) throw new Error("Bukti pengeluaran wajib diisi.");
  const expenseRef = push(root("expenses"));
  const txRef = push(root("transactions"));
  const balSnap = await get(root(`category_balances/${category}`));
  const balance = balSnap.exists() ? balSnap.val() : {};
  const currentBalance = Number(balance.balance) || 0;
  if (currentBalance < value) throw new Error("Saldo kategori tidak mencukupi. Periksa saldo awal atau pemasukan terlebih dahulu.");
  const timestamp = Date.now();
  const record = {id:expenseRef.key, category, amount:value, date:date || new Date().toISOString().slice(0,10), description:String(description).trim(), proof:String(proof).trim(), recordedBy:recordedBy || null, createdAt:timestamp};
  const updates = {};
  updates[`expenses/${expenseRef.key}`] = record;
  updates[`transactions/${txRef.key}`] = {...record, id:txRef.key, type:"expense", referenceId:expenseRef.key};
  updates[`category_balances/${category}`] = {...balance, balance:currentBalance-value, expense:(Number(balance.expense)||0)+value, updatedAt:timestamp};
  const logRef = push(root("audit_logs"));
  updates[`audit_logs/${logRef.key}`] = {type:"expense_created", expenseId:expenseRef.key, transactionId:txRef.key, category, amount:value, recordedBy:recordedBy||null, createdAt:timestamp};
  await update(ref(db), updates);
  return record;
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
