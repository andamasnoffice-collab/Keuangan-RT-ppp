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
export async function applyMonthlySummaryDelta(period, entryId, delta) {
  if(!validPeriod(period)) throw new Error("Periode ringkasan tidak valid.");
  const summaryRef=root(`financeSummaryByMonth/${period}`);
  const result=await runTransaction(summaryRef,current=>{
    const s=current||{income:0,expenses:0,byCategory:{},incomeItems:{},expenseItems:{},applied:{}};
    s.applied=s.applied||{};
    if(s.applied[entryId]) return s;
    const amount=Math.max(0,Number(delta.amount)||0);
    const category=["kas","air","sampah"].includes(delta.category)?delta.category:"lainnya";
    s.byCategory=s.byCategory||{};
    s.byCategory[category]=s.byCategory[category]||{income:0,expenses:0};
    if(delta.type==="income"){
      s.income=(Number(s.income)||0)+amount;
      s.byCategory[category].income+=amount;
      s.incomeItems=s.incomeItems||{};
      s.incomeItems[entryId]={date:delta.date||null,category,amount,description:String(delta.description||"Pemasukan").slice(0,120)};
    }else if(delta.type==="expense"){
      s.expenses=(Number(s.expenses)||0)+amount;
      s.byCategory[category].expenses+=amount;
      s.expenseItems=s.expenseItems||{};
      s.expenseItems[entryId]={date:delta.date||null,category,amount,description:String(delta.description||"Pengeluaran").slice(0,120)};
    }
    s.applied[entryId]=true;
    s.updatedAt=Date.now();
    return s;
  },{applyLocally:false});
  if(!result.committed) throw new Error("Ringkasan bulanan tidak berhasil diperbarui.");
  return result.snapshot.val();
}
export async function applyArrearsDelta(householdId, entryId, delta) {
  const summaryRef=root(`arrearsSummary/${householdId}`);
  const result=await runTransaction(summaryRef,current=>{
    const s=current||{kas:0,air:0,sampah:0,total:0,applied:{}};
    s.applied=s.applied||{};
    if(s.applied[entryId]) return s;
    for(const cat of ["kas","air","sampah"]) s[cat]=Math.max(0,(Number(s[cat])||0)+(Number(delta[cat])||0));
    s.total=s.kas+s.air+s.sampah;
    s.applied[entryId]=true;
    s.updatedAt=Date.now();
    return s;
  },{applyLocally:false});
  if(!result.committed) throw new Error("Ringkasan tunggakan tidak berhasil diperbarui.");
  return result.snapshot.val();
}
export async function getHouseholds() {
  return await read("households") || {};
}
export async function getMonthBills(monthKey) {
  return await read(`bills/${monthKey}`) || {};
}
export async function getPayments(period=null) {
  return period ? await read(`paymentsByMonth/${period}`) || {} : await read("paymentsByMonth") || {};
}
export async function getExpenses(period=null) {
  return period ? await read(`expensesByMonth/${period}`) || {} : await read("expensesByMonth") || {};
}
export async function getMonthTransactions(period) {
  if(!validPeriod(period)) throw new Error("Periode transaksi tidak valid.");
  return await read(`transactionsByMonth/${period}`) || {};
}
export async function migrateMonthlyIndexes(recordedBy) {
  if(!db) throw new Error("Firebase belum dikonfigurasi.");
  const lock=root("settings/monthlyIndexMigration");
  const claim=await runTransaction(lock,current=>{
    if(current?.status==="completed") return;
    if(current?.status==="processing" && Date.now()-Number(current.startedAt||Date.now())<10*60*1000) return;
    return {status:"processing",startedAt:Date.now(),recordedBy:recordedBy||null};
  },{applyLocally:false});
  if(!claim.committed) throw new Error("Migrasi indeks sudah selesai atau sedang dijalankan. Tidak perlu klik lagi.");
  try{
    const [transactions,expenses,payments]=await Promise.all([
      read("transactions"),read("expenses"),read("payments")
    ]);
    const updates={};
    const periodOf=row=>{
      const raw=row?.date||row?.createdAt||row?.timestamp;
      if(typeof raw==="number") return new Date(raw).toISOString().slice(0,7);
      const s=String(raw||"");
      if(/^\d{4}-\d{2}/.test(s)) return s.slice(0,7);
      const n=Number(s);
      return Number.isFinite(n)&&n>0?new Date(n).toISOString().slice(0,7):"";
    };
    const add=(base,rows)=>{
      for(const [id,row] of Object.entries(rows||{})){
        const period=periodOf(row);
        if(!validPeriod(period)) continue;
        updates[`${base}/${period}/${id}`]=row;
      }
    };
    add("transactionsByMonth",transactions);
    add("expensesByMonth",expenses);
    add("paymentsByMonth",payments);
    const entries=Object.entries(updates);
    for(let i=0;i<entries.length;i+=400){
      const batch=Object.fromEntries(entries.slice(i,i+400));
      await update(ref(db),batch);
      await set(lock,{status:"processing",startedAt:claim.snapshot.val()?.startedAt||Date.now(),processed:Math.min(i+400,entries.length),total:entries.length,recordedBy:recordedBy||null});
    }
    const result={status:"completed",completedAt:Date.now(),recordedBy:recordedBy||null,counts:{transactions:Object.keys(transactions||{}).length,expenses:Object.keys(expenses||{}).length,payments:Object.keys(payments||{}).length},indexedPaths:entries.length};
    await set(lock,result);
    return result;
  }catch(error){
    await set(lock,{status:"failed",failedAt:Date.now(),recordedBy:recordedBy||null,error:String(error.message||error)});
    throw error;
  }
}

const validPeriod = value => /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
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
    for(const [id,row] of Object.entries(updates).filter(([path])=>path.startsWith(`bills/${period}/`))){
      const total=Number(row.kas?.remaining||0)+Number(row.air?.remaining||0)+Number(row.sampah?.remaining||0);
      await applyArrearsDelta(id,`bill-${period}`,{kas:Number(row.kas?.remaining)||0,air:Number(row.air?.remaining)||0,sampah:Number(row.sampah?.remaining)||0});
    }
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
  await applyArrearsDelta(householdId,`water-${period}`,{air:usageAmount});
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
  const period=String(date || new Date().toISOString().slice(0,10)).slice(0,7);
  if(!validPeriod(period)) throw new Error("Tanggal pengeluaran tidak valid.");
  const expenseRef = push(root(`expensesByMonth/${period}`));
  const txRef = push(root(`transactionsByMonth/${period}`));
  const balSnap = await get(root(`category_balances/${category}`));
  const balance = balSnap.exists() ? balSnap.val() : {};
  const currentBalance = Number(balance.balance) || 0;
  if (currentBalance < value) throw new Error("Saldo kategori tidak mencukupi. Periksa saldo awal atau pemasukan terlebih dahulu.");
  const timestamp = Date.now();
  const record = {id:expenseRef.key, category, amount:value, date:date || new Date().toISOString().slice(0,10), description:String(description).trim(), proof:String(proof).trim(), recordedBy:recordedBy || null, createdAt:timestamp};
  const updates = {};
  updates[`expensesByMonth/${period}/${expenseRef.key}`] = record;
  updates[`transactionsByMonth/${period}/${txRef.key}`] = {...record, id:txRef.key, type:"expense", referenceId:expenseRef.key};
  updates[`category_balances/${category}`] = {...balance, balance:currentBalance-value, expense:(Number(balance.expense)||0)+value, updatedAt:timestamp};
  const logRef = push(root("audit_logs"));
  updates[`audit_logs/${logRef.key}`] = {type:"expense_created", expenseId:expenseRef.key, transactionId:txRef.key, category, amount:value, recordedBy:recordedBy||null, createdAt:timestamp};
  await update(ref(db), updates);
  await applyMonthlySummaryDelta(period,expenseRef.key,{type:"expense",category,amount:value,date:record.date,description:record.description});
  return record;
}


/**
 * Publishes a deliberately limited public projection.
 * Never includes resident names, phone numbers, family members, or payment details.
 * Public pages read only /public_views; private source nodes remain auth-only.
 */
export async function publishPublicSnapshot(currentPeriod, households, balances, financeSummaryByMonth, arrearsSummary) {
  if (!db) throw new Error("Firebase belum dikonfigurasi.");
  const allOutstanding={};
  let totalOutstanding=0;
  for(const [id,value] of Object.entries(arrearsSummary||{})){
    const total=Math.max(0,Number(value?.total)||0);
    if(!total) continue;
    const house=households?.[id]||{};
    allOutstanding[id]={label:String(house.block||"Rumah terdaftar").slice(0,60),kas:Math.max(0,Number(value.kas)||0),air:Math.max(0,Number(value.air)||0),sampah:Math.max(0,Number(value.sampah)||0),total};
    totalOutstanding+=total;
  }
  const categoryTotals={};
  for(const category of ["kas","sampah","air"]){
    const b=balances?.[category]||{};
    categoryTotals[category]={balance:Number(b.balance)||0,income:Number(b.income)||0,expense:Number(b.expense)||0};
  }
  const safePublicDescription=value=>String(value||"Transaksi").replace(/[\\w.+-]+@[\\w.-]+\\.[A-Za-z]{2,}/g,"[data pribadi]").replace(/(?:\\+?62|0)\\d[\\d\\s-]{7,}/g,"[nomor disamarkan]").slice(0,120);
  const financeByMonth={};
  for(const [period,summary] of Object.entries(financeSummaryByMonth||{})){
    const incomeItems=Object.values(summary?.incomeItems||{}).map(x=>({...x,description:safePublicDescription(x.description||"Pemasukan")}));
    const expenseItems=Object.values(summary?.expenseItems||{}).map(x=>({...x,description:safePublicDescription(x.description||"Pengeluaran")}));
    financeByMonth[period]={
      income:incomeItems,
      expenses:expenseItems,
      totals:{income:Number(summary?.income)||0,expenses:Number(summary?.expenses)||0}
    };
  }
  const payload={
    dashboard:{period:currentPeriod,householdCount:Object.keys(households||{}).length,outstandingHouseholds:Object.keys(allOutstanding).length,totalOutstanding,categories:categoryTotals,updatedAt:Date.now()},
    allOutstanding,
    financeByMonth,
    updatedAt:Date.now()
  };
  await set(root("public_views"),payload);
  return payload;
}

export async function getPublicDashboard() {
  return await read("public_views/dashboard") || null;
}

export async function getPublicBills() {
  return await read("public_views/allOutstanding") || {};
}
