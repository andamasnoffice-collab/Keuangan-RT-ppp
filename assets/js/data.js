import { ref, get, onValue, push, set, update, runTransaction } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";
import { db } from "./firebase.js";

const root = (path) => ref(db, path);
export async function assertDatabaseOnline() {
  if (!db) throw new Error("Firebase belum dikonfigurasi.");
  // Do not call get() on the reserved .info/connected path. Read requests
  // below use Firebase get() directly; writes require server acknowledgement.
  return true;
}
export async function writeAndVerify(updates, verifyPaths=[]) {
  await assertDatabaseOnline();
  await update(ref(db), updates); // resolves only after Firebase acknowledges the write
  for (const path of verifyPaths) {
    const snap = await get(root(path));
    if (!snap.exists()) throw new Error("Server belum mengonfirmasi data tersimpan pada " + path + ". Periksa database sebelum mengulangi transaksi.");
  }
  return true;
}

export async function read(path) {
  if (!db) throw new Error("Firebase belum dikonfigurasi.");
  const snap = await get(root(path));
  return snap.exists() ? snap.val() : null;
}
export function watch(path, callback, onError=console.error) {
  if (!db) return () => {};
  let cancelled=false, starting=false, stopConnection=null, stopValue=null;
  const start=async()=>{
    if(cancelled||starting||stopValue) return;
    starting=true;
    try {
      await assertDatabaseOnline();
      const initial=await get(root(path));
      if(cancelled) return;
      callback(initial.exists()?initial.val():null);
      stopValue=onValue(root(path), snap=>{
        if(!cancelled) callback(snap.exists()?snap.val():null);
      },onError);
    } catch(error) {
      if(!cancelled) onError(error);
    } finally {
      starting=false;
    }
  };
  stopConnection=onValue(root(".info/connected"),snap=>{
    if(snap.val()===true) start();
  },onError);
  return ()=>{
    cancelled=true;
    if(stopConnection) stopConnection();
    if(stopValue) stopValue();
  };
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
export async function setHouseholdArrearPeriod(householdId, period, category, amount) {
  if(!validPeriod(period)||!["kas","air","sampah"].includes(category)) throw new Error("Periode atau kategori tunggakan tidak valid.");
  const value=Math.max(0,Number(amount)||0);
  const ledgerRef=root(`arrearsLedger/${householdId}`);
  const result=await runTransaction(ledgerRef,current=>{
    const ledger=current||{};
    ledger[period]=ledger[period]||{};
    ledger[period][category]=value;
    ledger[period].updatedAt=Date.now();
    return ledger;
  },{applyLocally:false});
  if(!result.committed) throw new Error("Gagal memperbarui rincian tunggakan.");
  const ledger=result.snapshot.val()||{};
  const totals={kas:0,air:0,sampah:0,total:0,periodCount:0};
  for(const [month,row] of Object.entries(ledger)){
    if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) continue;
    let hasDue=false;
    for(const cat of ["kas","air","sampah"]){const n=Math.max(0,Number(row?.[cat])||0);totals[cat]+=n;if(n>0)hasDue=true;}
    if(hasDue)totals.periodCount++;
  }
  totals.total=totals.kas+totals.air+totals.sampah;
  totals.updatedAt=Date.now();
  await set(root(`arrearsSummary/${householdId}`),totals);
  return totals;
}
export async function getHouseholdArrearLedger(householdId) {
  return await read(`arrearsLedger/${householdId}`) || {};
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
const validPeriod = value => /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
const currentPeriodKey = () => { const now=new Date(); return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`; };
async function applyDepositToWaterBill(period,householdId,recordedBy){
  const [bill,deposit,balance]=await Promise.all([
    read(`bills/${period}/${householdId}/air`),
    read(`deposits/${householdId}/air`),
    read("category_balances/air")
  ]);
  if(!bill)return 0;
  const due=Math.max(0,Number(bill.amount??bill.totalAmount??bill.remaining)||0);
  const paid=Math.max(0,Number(bill.paidAmount)||0);
  const available=Math.max(0,Number(deposit)||0);
  const use=Math.min(available,Math.max(0,due-paid));
  if(use<=0)return 0;
  const now=Date.now(),depositAfter=available-use,remaining=Math.max(0,due-paid-use);
  const paymentRef=push(root(`paymentsByMonth/${period}`));
  const txRef=push(root(`transactionsByMonth/${period}`));
  const ledgerRef=push(root("deposit_ledger"));
  const updates={
    [`deposits/${householdId}/air`]:depositAfter,
    [`bills/${period}/${householdId}/air/paidAmount`]:paid+use,
    [`bills/${period}/${householdId}/air/remaining`]:remaining,
    [`bills/${period}/${householdId}/air/depositAppliedAmount`]:Number(bill.depositAppliedAmount||0)+use,
    [`bills/${period}/${householdId}/air/status`]:remaining===0?"paid":"partial",
    [`arrearsLedger/${householdId}/${period}/air`]:remaining,
    [`deposit_ledger/${ledgerRef.key}`]:{householdId,category:"air",amount:-use,before:available,after:depositAfter,type:"deposit_auto_applied",date:period+"-01",period,paymentId:paymentRef.key,createdAt:now,recordedBy:recordedBy||null},
    [`paymentsByMonth/${period}/${paymentRef.key}`]:{id:paymentRef.key,type:"automatic_deposit_application",householdId,period,date:period+"-01",items:[{cat:"air",cash:0,depositUsed:use,applied:use,surplus:0,remaining}],cashReceived:0,depositUsed:use,appliedToBills:use,surplusDeposit:0,method:"deposit_auto",note:"Pelunasan otomatis dari deposit air",recordedBy:recordedBy||null,createdAt:now},
    [`transactionsByMonth/${period}/${txRef.key}`]:{id:txRef.key,type:"payment",category:"air",amount:use,householdId,referenceId:paymentRef.key,date:period+"-01",description:"Pelunasan otomatis dari deposit air",recordedBy:recordedBy||null,createdAt:now},
    "category_balances/air":{...(balance||{}),balance:(Number(balance?.balance)||0)+use,income:(Number(balance?.income)||0)+use,updatedAt:now}
  };
  await writeAndVerify(updates,[`paymentsByMonth/${period}/${paymentRef.key}`,`bills/${period}/${householdId}/air`,`deposits/${householdId}/air`,`category_balances/air`]);
  await applyMonthlySummaryDelta(period,txRef.key,{type:"income",category:"air",amount:use,date:period+"-01",description:"Pelunasan otomatis dari deposit air"});
  await setHouseholdArrearPeriod(householdId,period,"air",remaining);
  return use;
}

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
  let primaryCommitted=false;
  try {
    const [homes,settings,existing,deposits,balances]=await Promise.all([
      getHouseholds(),getBillingSettings(),getMonthBills(period),read("deposits"),read("category_balances")
    ]);
    const active=Object.entries(homes).filter(([,h])=>h && h.status!=="empty" && h.status!=="inactive");
    if(!active.length) throw new Error("Tidak ada rumah aktif/kontrak yang dapat dibuatkan tagihan.");
    if(Object.keys(existing).length) throw new Error("Data tagihan periode ini sudah ada. Proses dihentikan agar tidak menimpa tagihan.");
    const updates={},depositSummary={kas:0,air:0,sampah:0},paymentItems={};
    const now=Date.now();
    for(const [id,h] of active){
      const raw={kas:Number(settings.kasMonthly)||0,sampah:Number(settings.sampahMonthly)||0,air:Number(settings.waterAdmin)||0};
      const row={
        kas:{amount:raw.kas,paidAmount:0,remaining:raw.kas,status:raw.kas>0?"unpaid":"paid",createdAt:now},
        sampah:{amount:raw.sampah,paidAmount:0,remaining:raw.sampah,status:raw.sampah>0?"unpaid":"paid",createdAt:now},
        air:{amount:raw.air,adminAmount:raw.air,usage:0,usageAmount:0,previousMeter:Number(h.currentWaterMeter??h.initialWaterMeter)||0,currentMeter:Number(h.currentWaterMeter??h.initialWaterMeter)||0,paidAmount:0,remaining:raw.air,status:raw.air>0?"unpaid":"paid",createdAt:now}
      };
      const applied={};
      for(const cat of ["air"]){
        const available=Math.max(0,Number(deposits?.[id]?.[cat])||0);
        const used=Math.min(available,raw[cat]);
        if(used>0){
          applied[cat]=used;depositSummary[cat]+=used;
          row[cat].paidAmount=used;row[cat].remaining=raw[cat]-used;row[cat].depositAppliedAmount=used;
          row[cat].status=row[cat].remaining===0?"paid":"partial";
          updates[`deposits/${id}/${cat}`]=available-used;
          const ledgerRef=push(root("deposit_ledger"));
          updates[`deposit_ledger/${ledgerRef.key}`]={householdId:id,category:cat,amount:-used,before:available,after:available-used,type:"deposit_auto_applied",date:period+"-01",period,createdAt:now,recordedBy:recordedBy||null};
        }
      }
      updates[`bills/${period}/${id}`]=row;
      updates[`arrearsLedger/${id}/${period}`]={kas:row.kas.remaining,sampah:row.sampah.remaining,air:row.air.remaining,updatedAt:now};
      if(Object.keys(applied).length){
        const paymentRef=push(root(`paymentsByMonth/${period}`));
        const items=Object.entries(applied).map(([cat,amount])=>({cat,cash:0,depositUsed:amount,applied:amount,surplus:0,remaining:row[cat].remaining}));
        updates[`paymentsByMonth/${period}/${paymentRef.key}`]={id:paymentRef.key,type:"automatic_deposit_application",householdId:id,householdLabel:h.block||"",period,date:period+"-01",items,cashReceived:0,depositUsed:Object.values(applied).reduce((a,b)=>a+b,0),appliedToBills:Object.values(applied).reduce((a,b)=>a+b,0),surplusDeposit:0,method:"deposit_auto",note:"Pemotongan deposit otomatis saat tagihan dibuat",recordedBy:recordedBy||null,createdAt:now};
      }
    }
    for(const cat of ["air"]){
      if(depositSummary[cat]>0){
        const balance=balances?.[cat]||{};
        updates[`category_balances/${cat}`]={...balance,balance:(Number(balance.balance)||0)+depositSummary[cat],income:(Number(balance.income)||0)+depositSummary[cat],updatedAt:now};
      }
    }
    updates[`billing_runs/${period}/status`]="completed";
    updates[`billing_runs/${period}/completedAt`]=now;
    updates[`billing_runs/${period}/householdCount`]=active.length;
    updates[`billing_runs/${period}/rates`]={kasMonthly:Number(settings.kasMonthly)||0,sampahMonthly:Number(settings.sampahMonthly)||0,waterAdmin:Number(settings.waterAdmin)||0,waterPerM3:Number(settings.waterPerM3)||0};
    updates[`billing_runs/${period}/recordedBy`]=recordedBy||null;
    const verifyPaths=[`billing_runs/${period}/status`,`bills/${period}`];
    for(const [id] of active) verifyPaths.push(`arrearsLedger/${id}/${period}`);
    for(const cat of ["air"]) if(depositSummary[cat]>0) verifyPaths.push(`category_balances/${cat}`);
    if(Object.keys(updates).some(path=>path.startsWith("deposits/"))) verifyPaths.push("deposits");
    if(Object.keys(updates).some(path=>path.startsWith("deposit_ledger/"))) verifyPaths.push("deposit_ledger");
    if(Object.keys(updates).some(path=>path.startsWith(`paymentsByMonth/${period}/`))) verifyPaths.push(`paymentsByMonth/${period}`);
    await writeAndVerify(updates,verifyPaths);
    primaryCommitted=true;
    for(const [id,row] of active.map(([id])=>[id,updates[`bills/${period}/${id}`]])){
      await setHouseholdArrearPeriod(id,period,"kas",row.kas.remaining);
      await setHouseholdArrearPeriod(id,period,"air",row.air.remaining);
      await setHouseholdArrearPeriod(id,period,"sampah",row.sampah.remaining);
    }
    for(const cat of ["air"]){
      if(depositSummary[cat]>0){
        const txRef=push(root(`transactionsByMonth/${period}`));
        const summaryId=txRef.key;
        await set(txRef,{id:summaryId,type:"payment",category:cat,amount:depositSummary[cat],date:period+"-01",description:"Pelunasan otomatis menggunakan deposit warga",recordedBy:recordedBy||null,createdAt:now});
        await applyMonthlySummaryDelta(period,summaryId,{type:"income",category:cat,amount:depositSummary[cat],date:period+"-01",description:"Pelunasan otomatis menggunakan deposit warga"});
      }
    }
    await refreshPublicSnapshotSafely();
    return {period,householdCount:active.length};
  } catch(error) {
    await set(lockRef,{status:primaryCommitted?"needs_reconciliation":"failed",failedAt:Date.now(),recordedBy:recordedBy||null,error:String(error.message||error)});
    throw error;
  }
}

export async function importWaterStatement({period,rows,recordedBy}) {
  if(!db) throw new Error("Firebase belum dikonfigurasi.");
  if(!validPeriod(period)) throw new Error("Periode impor tidak valid.");
  if(!Array.isArray(rows)||!rows.length) throw new Error("Tidak ada baris data untuk diimpor.");
  const lockRef=root(`water_import_runs/${period}`);
  const claim=await runTransaction(lockRef,current=>{
    if(current && current.status!=="failed") return;
    return {status:"processing",startedAt:Date.now(),recordedBy:recordedBy||null,rowCount:rows.length};
  },{applyLocally:false});
  if(!claim.committed) throw new Error(claim.snapshot.val()?.status==="completed"?"Data meter periode ini sudah pernah diimpor.":"Impor periode ini sedang diproses atau perlu pemeriksaan.");
  let primaryCommitted=false;
  try{
    const homes=await getHouseholds();
    const norm=s=>String(s||"").toLowerCase().replace(/[^a-z0-9]/g,"");
    const byBlock=new Map(Object.entries(homes).map(([id,h])=>[norm(h.block),{id,...h}]));
    const updates={},now=Date.now(),createdIds=new Set();
    let created=0,matched=0,meters=0,charges=0,needsReview=0;
    const seen=new Set();
    for(const row of rows){
      const block=String(row.block||"").trim();
      if(!block) {needsReview++;continue;}
      const key=norm(block);
      if(seen.has(key)) throw new Error(`Blok duplikat dalam file: ${block}`);
      seen.add(key);
      let house=byBlock.get(key);
      if(!house){
        const id=push(root("households")).key;
        const initial=Number.isFinite(Number(row.previousMeter))?Number(row.previousMeter):0;
        house={id,block,headName:String(row.headName||"Belum dilengkapi").trim()||"Belum dilengkapi",address:"Perlu dilengkapi",phone:"",whatsapp:{primaryNumber:"",enabled:false},initialWaterMeter:initial,currentWaterMeter:initial,status:"active",members:{head:{name:String(row.headName||"Belum dilengkapi"),relation:"kepala_keluarga",status:"active"}},createdAt:now,updatedAt:now,importedFrom:"water_statement"};
        updates[`households/${id}`]=house;byBlock.set(key,house);createdIds.add(id);created++;
      }else matched++;
      const hasMeters=row.previousMeter!==null&&row.previousMeter!==""&&row.currentMeter!==null&&row.currentMeter!=="";
      const previous=hasMeters?Number(row.previousMeter):null;
      const current=hasMeters?Number(row.currentMeter):null;
      if(hasMeters&&(!Number.isFinite(previous)||!Number.isFinite(current)||current<previous)) throw new Error(`Angka meter tidak valid untuk blok ${block}`);
      const usage=hasMeters?Number((current-previous).toFixed(3)):Number(row.usage)||0;
      const amount=row.amount===null||row.amount===""||row.amount===undefined?null:Number(row.amount);
      if(amount!==null&&(!Number.isFinite(amount)||amount<0))throw new Error(`Nominal tagihan tidak valid untuk blok ${block}`);
      if(hasMeters||amount!==null){
        const reading={period,householdId:house.id,previousMeter:previous,currentMeter:current,usage,rate:null,adminAmount:null,usageAmount:null,totalAmount:amount,source:"imported_statement",recordedBy:recordedBy||null,createdAt:now,amountNeedsReview:amount===null};
        updates[`water_readings/${period}/${house.id}`]=reading;meters++;
        if(amount!==null){
          const existingBill=await read(`bills/${period}/${house.id}`);
          if(existingBill?.air)throw new Error(`Tagihan air ${block} periode ${period} sudah ada. Impor dibatalkan agar tidak menimpa pembayaran.`);
          const air={amount,adminAmount:null,usage,previousMeter:previous,currentMeter:current,paidAmount:0,remaining:amount,status:amount>0?"unpaid":"paid",createdAt:now,source:"imported_statement"};
          updates[`bills/${period}/${house.id}/air`]=air;
          updates[`arrearsLedger/${house.id}/${period}/air`]=amount;
          charges++;
        }else needsReview++;
        if(hasMeters){
          const currentLatest=Number(house.currentWaterMeter??house.initialWaterMeter)||0;
          if(!house.currentWaterMeter||currentLatest<=current){
            if(createdIds.has(house.id)){
              // New household is already written at its parent path in this same multipath update.
              house.currentWaterMeter=current;
              house.updatedAt=now;
            }else{
              updates[`households/${house.id}/currentWaterMeter`]=current;
              updates[`households/${house.id}/updatedAt`]=now;
            }
          }
        }
      }else needsReview++;
    }
    updates[`water_import_runs/${period}`]={status:"completed",period,completedAt:now,recordedBy:recordedBy||null,rowCount:rows.length,created,matched,meters,charges,needsReview};
    await writeAndVerify(updates,[`water_import_runs/${period}/status`]);
    primaryCommitted=true;
    for(const row of rows){
      const blockKey=norm(row.block);
      const house=byBlock.get(blockKey);
      if(house&&row.amount!==null&&row.amount!==undefined){await setHouseholdArrearPeriod(house.id,period,"air",Number(row.amount)||0);await applyDepositToWaterBill(period,house.id,recordedBy);}
    }
    await refreshPublicSnapshotSafely();
    return {period,rowCount:rows.length,created,matched,meters,charges,needsReview};
  }catch(error){
    await set(lockRef,{status:primaryCommitted?"needs_reconciliation":"failed",failedAt:Date.now(),recordedBy:recordedBy||null,error:String(error.message||error)});
    if(primaryCommitted)throw new Error("Data impor utama sudah tersimpan, tetapi sinkronisasi lanjutan gagal. Status dikunci untuk pemeriksaan; jangan impor ulang. Detail: "+error.message);
    throw error;
  }
}
export async function editWaterReading({period,householdId,currentMeter,recordedBy}) {
  if(!db) throw new Error("Firebase belum dikonfigurasi.");
  if(!validPeriod(period)) throw new Error("Periode tidak valid.");
  const value=Number(currentMeter);
  if(!Number.isFinite(value)||value<0) throw new Error("Angka meter akhir tidak valid.");
  const [house,settings,bill,existing]=await Promise.all([
    read(`households/${householdId}`),getBillingSettings(),read(`bills/${period}/${householdId}/air`),read(`water_readings/${period}/${householdId}`)
  ]);
  if(!house||!existing) throw new Error("Data rumah atau catatan meter tidak ditemukan.");
  const baseBill=bill||{amount:0,paidAmount:0,remaining:0,status:"unpaid"};
  const previous=Number(existing.previousMeter??house.currentWaterMeter??house.initialWaterMeter)||0;
  if(value<previous) throw new Error(`Meter akhir tidak boleh lebih kecil dari meter awal (${previous}).`);
  const usage=Number((value-previous).toFixed(3));
  const rate=Number(existing.rate??settings.waterPerM3)||0;
  const admin=Number(existing.adminAmount??bill?.adminAmount??settings.waterAdmin)||0;
  const usageAmount=Math.round(usage*rate),total=admin+usageAmount;
  const paid=Number(baseBill.paidAmount)||0,remaining=Math.max(0,total-paid),timestamp=Date.now();
  const reading={...existing,period,householdId,previousMeter:previous,currentMeter:value,usage,rate,adminAmount:admin,usageAmount,totalAmount:total,recordedBy:recordedBy||null,updatedAt:timestamp};
  const updates={};
  updates[`water_readings/${period}/${householdId}`]=reading;
  updates[`households/${householdId}/currentWaterMeter`]=value;
  updates[`bills/${period}/${householdId}/air`]={...baseBill,previousMeter:previous,currentMeter:value,usage,rate,adminAmount:admin,usageAmount,amount:total,remaining,paidAmount:paid,status:remaining===0?"paid":paid>0?"partial":"unpaid",meterRecordedAt:timestamp};
  const logRef=push(root("audit_logs"));
  updates[`audit_logs/${logRef.key}`]={type:"water_meter_corrected",period,householdId,previousMeter:previous,oldCurrentMeter:existing.currentMeter,newCurrentMeter:value,usage,totalAmount:total,recordedBy:recordedBy||null,createdAt:timestamp};
  await writeAndVerify(updates,[`water_readings/${period}/${householdId}`,`bills/${period}/${householdId}/air`,`households/${householdId}/currentWaterMeter`]);
  await setHouseholdArrearPeriod(householdId,period,"air",remaining);
  await applyDepositToWaterBill(period,householdId,recordedBy);
  await refreshPublicSnapshotSafely();
  return reading;
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
  await writeAndVerify(updates,[`water_readings/${period}/${householdId}`,`bills/${period}/${householdId}/air`,`households/${householdId}/currentWaterMeter`]);
  await setHouseholdArrearPeriod(householdId,period,"air",remaining);
  await applyDepositToWaterBill(period,householdId,recordedBy);
  await refreshPublicSnapshotSafely();
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
  await refreshPublicSnapshotSafely();
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
  await writeAndVerify(updates,[`expensesByMonth/${period}/${expenseRef.key}`,`transactionsByMonth/${period}/${txRef.key}`,`category_balances/${category}`]);
  let summarySyncPending=false;
  try{await applyMonthlySummaryDelta(period,expenseRef.key,{type:"expense",category,amount:value,date:record.date,description:record.description});}
  catch(firstError){
    try{await applyMonthlySummaryDelta(period,expenseRef.key,{type:"expense",category,amount:value,date:record.date,description:record.description});}
    catch(secondError){summarySyncPending=true;console.error("Pengeluaran tersimpan tetapi ringkasan bulanan tertunda:",firstError,secondError);}
  }
  await refreshPublicSnapshotSafely();
  return {...record,summarySyncPending};
}


/**
 * Publishes a deliberately limited public projection.
 * Never includes resident names, phone numbers, family members, or payment details.
 * Public pages read only /public_views; private source nodes remain auth-only.
 */
export async function publishPublicSnapshot(currentPeriod, households, balances, financeSummaryByMonth, arrearsSummary, arrearsLedger={}, announcement=null) {
  if (!db) throw new Error("Firebase belum dikonfigurasi.");
  if(announcement===null) announcement=await read("public_views/announcement");
  const allOutstanding={};
  let totalOutstanding=0;
  const householdIds=new Set([...Object.keys(arrearsSummary||{}),...Object.keys(arrearsLedger||{})]);
  for(const id of householdIds){
    const ledger=arrearsLedger?.[id]||{};
    const validPeriods=Object.keys(ledger).filter(p=>validPeriod(p)&&p<=currentPeriod).sort();
    const hasLedger=validPeriods.length>0;
    const value=arrearsSummary?.[id]||{};
    const totals={kas:0,air:0,sampah:0,periodCount:0};
    if(hasLedger){
      for(const period of validPeriods){
        const row=ledger[period]||{};
        let hasDue=false;
        for(const cat of ["kas","air","sampah"]){
          const amount=Math.max(0,Number(row?.[cat])||0);
          totals[cat]+=amount;
          if(amount>0)hasDue=true;
        }
        if(hasDue)totals.periodCount++;
      }
    }else{
      // Compatibility fallback for households that still have summary data but no monthly ledger.
      for(const cat of ["kas","air","sampah"]) totals[cat]=Math.max(0,Number(value?.[cat])||0);
      totals.periodCount=Math.max(0,Number(value?.periodCount)||0);
    }
    const total=totals.kas+totals.air+totals.sampah;
    if(!total)continue;
    const house=households?.[id]||{};
    allOutstanding[id]={label:String(house.block||"Rumah terdaftar").slice(0,60),kas:totals.kas,air:totals.air,sampah:totals.sampah,total,periodCount:totals.periodCount};
    totalOutstanding+=total;
  }
  const categoryTotals={};
  for(const category of ["kas","sampah","air"]){
    const b=balances?.[category]||{};
    categoryTotals[category]={balance:Number(b.balance)||0,income:Number(b.income)||0,expense:Number(b.expense)||0};
  }
  const publicCategoryLabel=category=>({kas:"Kas RT",air:"Air",sampah:"Sampah"})[category]||"Lainnya";
  const financeByMonth={};
  for(const [period,summary] of Object.entries(financeSummaryByMonth||{})){
    const incomeItems=Object.values(summary?.incomeItems||{}).map(x=>({...x,description:"Pemasukan "+publicCategoryLabel(x.category)}));
    const expenseItems=Object.values(summary?.expenseItems||{}).map(x=>({...x,description:"Pengeluaran "+publicCategoryLabel(x.category)}));
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
    ...(announcement?{announcement}:{}),
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

/**
 * Rebuilds the public projection from the authoritative private Firebase nodes.
 * Called after billing, meter, payment, and import operations have completed.
 */
export async function buildAnnualSummary(year, recordedBy=null) {
  const y=Number(year);
  if(!Number.isInteger(y)||y<2000||y>new Date().getFullYear()) throw new Error("Tahun rekap tidak valid.");
  const periods=Array.from({length:12},(_,i)=>`${y}-${String(i+1).padStart(2,"0")}`);
  const [monthly,allMonthly,settings,balances,deposits,arrears]=await Promise.all([
    Promise.all(periods.map(p=>read(`financeSummaryByMonth/${p}`))),
    read("financeSummaryByMonth"),
    getBillingSettings(),
    read("category_balances"),
    read("deposits"),
    read("arrearsSummary")
  ]);
  const categories=["kas","sampah","air"],byCategory={};
  for(const cat of categories){
    const baseOpening=Number(balances?.[cat]?.openingBalance ?? settings?.openingBalances?.[cat])||0;
    const netBeforeYear=Object.entries(allMonthly||{}).filter(([period])=>period<`${y}-01`).reduce((sum,[,row])=>sum+(Number(row?.byCategory?.[cat]?.income)||0)-(Number(row?.byCategory?.[cat]?.expenses)||0),0);
    const opening=baseOpening+netBeforeYear;
    let income=0,expense=0;
    monthly.forEach((row,index)=>{
      const item=row?.byCategory?.[cat]||{};
      const inc=Math.max(0,Number(item.income)||0),out=Math.max(0,Number(item.expenses)||0);
      income+=inc;expense+=out;
     });
    const deposit=Object.values(deposits||{}).reduce((sum,row)=>sum+(Number(row?.[cat])||0),0);
    byCategory[cat]={openingBalance:opening,income,expenses:expense,closingOperatingBalance:opening+income-expense,depositLiability:deposit};
  }
  const arrearsTotals={kas:0,sampah:0,air:0,total:0};
  for(const row of Object.values(arrears||{})) for(const cat of categories) arrearsTotals[cat]+=Math.max(0,Number(row?.[cat])||0);
  arrearsTotals.total=categories.reduce((sum,cat)=>sum+arrearsTotals[cat],0);
  const payload={year:y,periodStart:periods[0],periodEnd:periods[11],byCategory,arrearsAtSnapshot:arrearsTotals,operatingBalanceAtSnapshot:categories.reduce((sum,cat)=>sum+(Number(balances?.[cat]?.balance)||0),0),depositLiabilityAtSnapshot:categories.reduce((sum,cat)=>sum+byCategory[cat].depositLiability,0),generatedAt:Date.now(),generatedBy:recordedBy||null,version:1};
  await writeAndVerify({[`annual_summaries/${y}`]:payload},[`annual_summaries/${y}`]);
  return payload;
}

export async function refreshPublicSnapshot(currentPeriod, householdsOverride=null) {
  if(!validPeriod(currentPeriod)) throw new Error("Periode publik tidak valid.");
  const [homes,balances,financeSummary,arrearsSummary,arrearsLedger]=await Promise.all([
    householdsOverride||getHouseholds(),
    read("category_balances"),
    read("financeSummaryByMonth"),
    read("arrearsSummary"),
    read("arrearsLedger")
  ]);
  return await publishPublicSnapshot(currentPeriod,homes||{},balances||{},financeSummary||{},arrearsSummary||{},arrearsLedger||{});
}

export async function refreshPublicSnapshotSafely() {
  try { await refreshPublicSnapshot(currentPeriodKey()); return true; }
  catch(error) { console.error("Sinkronisasi tampilan publik tertunda:",error); return false; }
}

const MASTER_DATA_NODES=["households","bills","payments","paymentsByMonth","deposits","deposit_ledger","water_readings","expenses","expensesByMonth","transactions","transactionsByMonth","category_balances","whatsapp_notifications","summaries","financeSummaryByMonth","annual_summaries","arrearsLedger","arrearsSummary","billing_runs","water_import_runs","public_views","settings"];
export async function deleteMasterData({mode,period,recordedBy}) {
  if(!db) throw new Error("Firebase belum dikonfigurasi.");
  const stamp=Date.now(),updates={};
  if(mode==="all"){
    for(const node of MASTER_DATA_NODES) updates[node]=null;
    const log=push(root("audit_logs"));
    updates[`audit_logs/${log.key}`]={type:"master_data_deleted_all",recordedBy:recordedBy||null,createdAt:stamp,retainedAuditLog:true};
    await update(ref(db),updates);
    await refreshPublicSnapshotSafely();
    return {mode:"all",deletedNodes:MASTER_DATA_NODES.length};
  }
  if(mode!=="period"||!/^\\d{4}-(0[1-9]|1[0-2])$/.test(String(period||""))) throw new Error("Pilih periode yang valid.");
  const p=period,year=Number(p.slice(0,4));
  for(const node of ["bills","paymentsByMonth","expensesByMonth","transactionsByMonth","water_readings","financeSummaryByMonth","billing_runs","water_import_runs"]) updates[`${node}/${p}`]=null;
  const periodOf=row=>{
    const raw=row?.date||row?.period||row?.createdAt||row?.timestamp;
    if(typeof raw==="number")return new Date(raw).toISOString().slice(0,7);
    const s=String(raw||"");if(/^\\d{4}-\\d{2}/.test(s))return s.slice(0,7);
    const n=Number(s);return Number.isFinite(n)&&n>0?new Date(n).toISOString().slice(0,7):"";
  };
  for(const node of ["payments","expenses","transactions"]){
    const rows=await read(node)||{};
    for(const [id,row] of Object.entries(rows))if(periodOf(row)===p)updates[`${node}/${id}`]=null;
  }

  const ledgers=await read("arrearsLedger")||{};
  for(const [houseId,ledger] of Object.entries(ledgers)){
    if(!ledger?.[p])continue;
    const next={...ledger};delete next[p];
    updates[`arrearsLedger/${houseId}/${p}`]=null;
    const totals={kas:0,air:0,sampah:0,total:0,periodCount:0};
    for(const [month,row] of Object.entries(next)){
      if(!/^\\d{4}-(0[1-9]|1[0-2])$/.test(month))continue;
      let due=false;
      for(const cat of ["kas","air","sampah"]){const n=Math.max(0,Number(row?.[cat])||0);totals[cat]+=n;if(n>0)due=true;}
      if(due)totals.periodCount++;
    }
    totals.total=totals.kas+totals.air+totals.sampah;totals.updatedAt=stamp;
    updates[`arrearsSummary/${houseId}`]=totals;
  }

  // Reverse deposit movements belonging to the deleted month, then keep all other periods intact.
  const [depositLedger,deposits,monthly,balances,settings,annual]=await Promise.all([
    read("deposit_ledger"),read("deposits"),read("financeSummaryByMonth"),
    read("category_balances"),getBillingSettings(),read("annual_summaries")
  ]);
  const removedDeposits={};
  for(const [id,row] of Object.entries(depositLedger||{})){
    if(periodOf(row)!==p)continue;
    updates[`deposit_ledger/${id}`]=null;
    const householdId=row?.householdId,category=row?.category;
    if(!householdId||!["kas","air","sampah"].includes(category))continue;
    const key=`${householdId}/${category}`;
    removedDeposits[key]=(removedDeposits[key]||0)+(Number(row.amount)||0);
  }
  for(const [key,delta] of Object.entries(removedDeposits)){
    const [householdId,category]=key.split("/");
    const current=Number(deposits?.[householdId]?.[category])||0;
    updates[`deposits/${householdId}/${category}`]=Math.max(0,current-delta);
  }

  const remainingMonthly={...(monthly||{})};delete remainingMonthly[p];
  for(const category of ["kas","air","sampah"]){
    const opening=Number(balances?.[category]?.openingBalance??settings?.openingBalances?.[category])||0;
    let income=0,expense=0;
    for(const summary of Object.values(remainingMonthly)){
      income+=Number(summary?.byCategory?.[category]?.income)||0;
      expense+=Number(summary?.byCategory?.[category]?.expenses)||0;
    }
    updates[`category_balances/${category}`]={
      ...(balances?.[category]||{}),openingBalance:opening,balance:opening+income-expense,
      income,expense,updatedAt:stamp
    };
  }

  // Annual reports are snapshots; invalidate this year and later years after a historical change.
  for(const key of Object.keys(annual||{}))if(Number(key)>=year)updates[`annual_summaries/${key}`]=null;

  const log=push(root("audit_logs"));
  updates[`audit_logs/${log.key}`]={type:"master_data_deleted_period",period:p,recordedBy:recordedBy||null,createdAt:stamp};
  await update(ref(db),updates);
  await refreshPublicSnapshotSafely();
  return {mode:"period",period:p,ledgerHouseholds:Object.keys(ledgers).filter(id=>!!ledgers[id]?.[p]).length,depositBalancesAdjusted:Object.keys(removedDeposits).length};
}
