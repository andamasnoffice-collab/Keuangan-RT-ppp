import { db } from "./firebase.js";
import { ref, get, update, runTransaction, push } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";

const $=s=>document.querySelector(s);
const money=n=>"Rp "+new Intl.NumberFormat("id-ID").format(Number(n)||0);
const escapeHtml=v=>String(v??"").replace(/[&<>"\']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","\'":"&#39;"}[ch]));
const validPeriod=v=>/^\d{4}-(0[1-9]|1[0-2])$/.test(v);
const categories=["kas","air","sampah"];
const labels={kas:"Kas RT",air:"Air",sampah:"Sampah"};
const root=path=>ref(db,path);
const read=async path=>{const s=await get(root(path));return s.exists()?s.val():null;};
let parsed=null, households={}, recordedBy=null;

function norm(v){return String(v??"").trim().toLowerCase().replace(/\s+/g," ");}
function parseAmount(v){
  if(v===null||v===undefined||String(v).trim()==="")return 0;
  const n=Number(String(v).replace(/[^0-9,.-]/g,"").replace(/\.(?=\d{3}(?:\D|$))/g,"").replace(",","."));
  if(!Number.isFinite(n)||n<0)throw new Error("Nominal harus angka rupiah nol atau lebih.");
  return Math.round(n);
}
function parseWorkbook(wb){
  const sheet=(name,required)=>{const ws=wb.Sheets[name];if(!ws){if(required)throw new Error('Sheet "'+name+'" tidak ditemukan. Gunakan template migrasi.');return [];}return window.XLSX.utils.sheet_to_json(ws,{defval:"",raw:false});};
  const homes=Object.entries(households).map(([id,h])=>({id,...h}));
  const byBlock=new Map(homes.map(h=>[norm(h.block),h]));
  const arrears=[],deposits=[],cash=[];
  const aRows=sheet("Tunggakan",true);
  for(let i=0;i<aRows.length;i++){
    const r=aRows[i],block=String(r["Blok"]??"").trim(),period=String(r["Periode (YYYY-MM)"]??"").trim(),category=norm(r["Kategori"]),amount=parseAmount(r["Sisa Tunggakan (Rp)"]);
    if(!block&&!period&&!category&&!amount)continue;
    const home=byBlock.get(norm(block));
    if(!home)throw new Error('Tunggakan baris '+(i+2)+': rumah "'+block+'" tidak ditemukan.');
    if(!validPeriod(period))throw new Error('Tunggakan baris '+(i+2)+': periode harus YYYY-MM.');
    if(!categories.includes(category))throw new Error('Tunggakan baris '+(i+2)+': kategori harus kas, air, atau sampah.');
    if(!amount)continue;
    arrears.push({householdId:home.id,block:home.block,period,category,amount});
  }
  const dRows=sheet("Deposit",false),seenDeposit=new Set();
  for(let i=0;i<dRows.length;i++){
    const r=dRows[i],block=String(r["Blok"]??"").trim();
    if(!block)continue;
    const home=byBlock.get(norm(block));
    if(!home)throw new Error('Deposit baris '+(i+2)+': rumah "'+block+'" tidak ditemukan.');
    if(seenDeposit.has(home.id))throw new Error("Deposit rumah "+block+" tercantum lebih dari sekali.");
    seenDeposit.add(home.id);
    const values={};for(const cat of categories)values[cat]=parseAmount(r[labels[cat]+" (Rp)"]);
    if(Object.values(values).some(Boolean))deposits.push({householdId:home.id,block:home.block,values});
  }
  const cRows=sheet("Saldo Kas",false);
  for(let i=0;i<cRows.length;i++){
    const r=cRows[i],category=norm(r["Kategori"]),amount=parseAmount(r["Saldo Awal (Rp)"]);
    if(!category&&!amount)continue;
    if(!categories.includes(category))throw new Error('Saldo Kas baris '+(i+2)+': kategori harus kas, air, atau sampah.');
    if(cash.some(x=>x.category===category))throw new Error("Kategori saldo kas "+category+" tercantum lebih dari sekali.");
    cash.push({category,amount});
  }
  const keys=new Set();
  for(const x of arrears){const k=x.householdId+"|"+x.period+"|"+x.category;if(keys.has(k))throw new Error("Tunggakan ganda: "+x.block+" "+x.period+" "+x.category);keys.add(k);}
  if(!arrears.length&&!deposits.length&&!cash.length)throw new Error("Tidak ada data saldo awal untuk dimigrasikan.");
  return {arrears,deposits,cash,counts:{arrears:arrears.length,deposits:deposits.length,cash:cash.length}};
}

function downloadTemplate(){
  const X=window.XLSX,wb=X.utils.book_new();
  const sheets=[
    ["Tunggakan",[["Blok","Periode (YYYY-MM)","Kategori","Sisa Tunggakan (Rp)"],["A-01","2026-03","kas",30000],["A-01","2026-04","sampah",10000]]],
    ["Deposit",[["Blok","Kas RT (Rp)","Air (Rp)","Sampah (Rp)"],["A-01",0,50000,0]]],
    ["Saldo Kas",[["Kategori","Saldo Awal (Rp)"],["kas",1500000],["air",0],["sampah",0]]],
    ["Panduan",[["PANDUAN MIGRASI PEMBUKUAN MANUAL"],["Tunggakan: satu baris untuk satu rumah, satu bulan, satu kategori. Isi sisa tagihan yang belum dibayar, bukan total tagihan awal."],["Kategori wajib: kas, air, sampah. Periode gunakan YYYY-MM. Baris tanpa tunggakan tidak perlu dimasukkan."],["Deposit: satu baris per rumah. Isi saldo deposit yang masih menjadi hak warga pada tanggal migrasi."],["Saldo Kas: isi saldo operasional nyata per kategori pada tanggal migrasi. Ini saldo pembuka, bukan pemasukan bulan berjalan."],["Jangan masukkan pembayaran yang sudah lunas sebagai tunggakan. Jangan gabungkan deposit warga ke saldo kas operasional."],["Data contoh A-01 hanya contoh; hapus sebelum mengimpor. Blok harus sama persis dengan Master Data Rumah."],["Migrasi tidak mengubah tagihan bulanan atau membuat transaksi pendapatan historis. Catatan sumber buku disimpan pada batch migrasi."]]]
  ];
  for(const [name,rows] of sheets){const ws=X.utils.aoa_to_sheet(rows);X.utils.book_append_sheet(wb,ws,name);}
  X.writeFile(wb,"Template_Migrasi_Pembukuan_Manual_Keuangan_RT.xlsx");
}

async function renderMigration(c){
  const projectId=db?.app?.options?.projectId||"";
  const production=projectId==="keuangan-rt-ppp";
  const marker=await read("opening_migrations/2026-10");
  c.innerHTML=`<section class="panel">
    <div class="section-head" style="margin-top:0"><div><h3>Migrasi pembukuan manual</h3><p class="tiny muted">Saldo pembuka per 31 Oktober 2026 · aplikasi mulai mencatat November 2026</p></div><span class="pill ${marker?.status==="completed"?"success":"warning"}">${marker?.status==="completed"?"Sudah dimigrasikan":"Belum dimigrasikan"}</span></div>
    <div class="muted-note">Gunakan buku manual untuk memindahkan sisa tunggakan per bulan, deposit warga, dan saldo kas operasional. Pembayaran yang sudah lunas tidak dimasukkan sebagai tunggakan.</div>
    <div class="toolbar" style="margin:16px 0"><button class="btn secondary" id="migrationTemplate">↓ Unduh Template Excel</button><label class="btn outline file-button" for="migrationFile">Pilih file Excel</label><input id="migrationFile" type="file" accept=".xlsx,.xls" hidden></div>
    <div id="migrationPreview"><div class="empty">Unduh template, isi berdasarkan buku manual, lalu pilih file untuk melihat pratinjau.</div></div>
    ${production?'<div class="muted-note" style="margin-top:16px"><b>Mode aman: hanya pratinjau.</b> Branch ini masih menunjuk proyek Firebase produksi <code>keuangan-rt-ppp</code>. Tombol penyimpanan dinonaktifkan agar migrasi uji tidak menulis atau mengubah data warga produksi. Setelah proyek Firebase uji dikonfigurasi, proses simpan dapat diuji di sana.</div>':""}
    ${marker?.status==="completed"?'<p class="tiny muted">Batch '+String(marker.batchId||"")+' telah disahkan pada '+new Date(marker.completedAt||0).toLocaleString("id-ID")+'. Migrasi ulang ditolak untuk mencegah duplikasi.</p>':""}
  </section>`;
  $("#migrationTemplate").addEventListener("click",downloadTemplate);
  $("#migrationFile").addEventListener("change",async e=>{
    const file=e.target.files?.[0];parsed=null;const target=$("#migrationPreview");
    if(!file)return;
    target.textContent="Membaca buku…";
    try{
      if(!window.XLSX)await new Promise((resolve,reject)=>{const s=document.createElement("script");s.src="https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";s.onload=resolve;s.onerror=()=>reject(new Error("Pustaka Excel gagal dimuat."));document.head.appendChild(s);});
      const wb=window.XLSX.read(await file.arrayBuffer(),{type:"array"});
      parsed=parseWorkbook(wb);
      const totals={kas:0,air:0,sampah:0};parsed.arrears.forEach(x=>totals[x.category]+=x.amount);
      const depositTotals={kas:0,air:0,sampah:0};parsed.deposits.forEach(x=>categories.forEach(cat=>depositTotals[cat]+=x.values[cat]));
      target.innerHTML=`<div class="summary-box"><b>Pratinjau ${escapeHtml(file.name)}</b><div class="grid stats" style="margin:12px 0"><div class="stat"><div class="label">Rincian tunggakan</div><div class="value">${parsed.counts.arrears}</div></div><div class="stat"><div class="label">Rumah dengan deposit</div><div class="value">${parsed.counts.deposits}</div></div><div class="stat"><div class="label">Saldo kas kategori</div><div class="value">${parsed.counts.cash}</div></div><div class="stat"><div class="label">Total tunggakan</div><div class="value">${money(Object.values(totals).reduce((a,b)=>a+b,0))}</div></div></div>
      <h4>Tunggakan menurut kategori</h4><p>Kas RT: ${money(totals.kas)} · Air: ${money(totals.air)} · Sampah: ${money(totals.sampah)}</p>
      <h4>Deposit warga (tetap terpisah)</h4><p>Kas RT: ${money(depositTotals.kas)} · Air: ${money(depositTotals.air)} · Sampah: ${money(depositTotals.sampah)}</p>
      <h4>Saldo kas pembuka</h4><p>${parsed.cash.map(x=>labels[x.category]+": "+money(x.amount)).join(" · ")||"Tidak diisi"}</p>
      <p class="tiny muted">Data tunggakan per bulan: ${parsed.arrears.slice(0,8).map(x=>escapeHtml(x.block+" / "+x.period+" / "+x.category+" / "+money(x.amount))).join("<br>")}${parsed.arrears.length>8?"<br>… dan "+(parsed.arrears.length-8)+" baris lainnya":""}</p>
      <button id="confirmMigration" class="btn primary" ${production||marker?.status==="completed"?"disabled":""}>Sahkan migrasi saldo awal</button></div>`;
      if(!production&&marker?.status!=="completed")$("#confirmMigration").addEventListener("click",()=>saveMigration().catch(err=>{const p=$("#migrationPreview");p.insertAdjacentHTML("beforeend",`<p class="error">${escapeHtml(err.message)}</p>`);}));
    }catch(err){parsed=null;target.textContent="File tidak dapat diproses: "+err.message;}
  });
}

async function saveMigration(){
  if(!parsed||!db)throw new Error("Data migrasi belum siap.");
  const projectId=db.app?.options?.projectId||"";
  if(projectId==="keuangan-rt-ppp")throw new Error("Penulisan ke proyek produksi diblokir.");
  if(!confirm("Sahkan migrasi saldo pembuka per 31 Oktober 2026? Proses hanya boleh dilakukan satu kali dan tidak mengubah transaksi bulan berjalan."))return;
  const button=$("#confirmMigration");button.disabled=true;button.textContent="Menyimpan…";
  const lock=root("opening_migrations/2026-10");
  const claim=await runTransaction(lock,current=>current&&current.status!=="failed"?undefined:{status:"processing",startedAt:Date.now(),recordedBy},{applyLocally:false});
  if(!claim.committed){button.disabled=false;button.textContent="Sahkan migrasi saldo awal";throw new Error("Migrasi sudah pernah dimulai. Periksa status batch sebelum mencoba lagi.");}
  const batchId=push(root("opening_migration_records")).key,now=Date.now(),updates={};
  try{
    const [existingArrears,existingDeposits,balances]=await Promise.all([read("arrearsLedger"),read("deposits"),read("category_balances")]);
    for(const x of parsed.arrears){
      const old=existingArrears?.[x.householdId]?.[x.period]?.[x.category];
      if(Number(old)>0)throw new Error("Sudah ada tunggakan pada "+x.block+" "+x.period+" "+x.category+". Tidak ditimpa.");
      updates[`arrearsLedger/${x.householdId}/${x.period}/${x.category}`]=x.amount;
    }
    for(const x of parsed.deposits){
      for(const cat of categories){
        if(Number(existingDeposits?.[x.householdId]?.[cat])>0)throw new Error("Deposit "+x.block+" "+labels[cat]+" sudah ada. Tidak ditimpa.");
        if(x.values[cat]>0)updates[`deposits/${x.householdId}/${cat}`]=x.values[cat];
      }
      for(const cat of categories){
        const amount=x.values[cat];if(amount<=0)continue;
        const entry=push(root("deposit_ledger"));
        updates[`deposit_ledger/${entry.key}`]={householdId:x.householdId,category:cat,amount,before:0,after:amount,type:"opening_balance_migration",date:"2026-10-31",period:"2026-10",batchId,source:"Buku manual",createdAt:now};
      }
    }
    for(const x of parsed.cash){
      const old=balances?.[x.category]||{};
      if(Number(old.balance)||Number(old.income)||Number(old.expense))throw new Error("Saldo kategori "+x.category+" sudah memiliki mutasi. Migrasi saldo kas dibatalkan untuk mencegah penimpaan.");
      updates[`category_balances/${x.category}`]={balance:x.amount,income:0,expense:0,openingBalance:x.amount,openingBalanceDate:"2026-10-31",openingMigrationId:batchId,updatedAt:now};
    }
    const summaryByHouse={};
    for(const x of parsed.arrears){summaryByHouse[x.householdId]??={kas:0,air:0,sampah:0,periodCount:0};summaryByHouse[x.householdId][x.category]+=x.amount;}
    for(const [id,s] of Object.entries(summaryByHouse)){
      s.total=s.kas+s.air+s.sampah;s.periodCount=new Set(parsed.arrears.filter(x=>x.householdId===id&&x.amount>0).map(x=>x.period)).size;s.updatedAt=now;
      updates[`arrearsSummary/${id}`]=s;
    }
    const record={id:batchId,status:"completed",openingDate:"2026-10-31",goLivePeriod:"2026-11",source:"Buku manual",arrears:parsed.arrears,deposits:parsed.deposits,cash:parsed.cash,recordedBy,createdAt:now};
    updates[`opening_migration_records/${batchId}`]=record;
    updates["opening_migrations/2026-10"]={status:"completed",batchId,completedAt:now,recordedBy,counts:parsed.counts};
    await update(root(),updates);
    $("#migrationPreview").insertAdjacentHTML("beforeend",'<p class="pill success">Migrasi tersimpan.</p>');
    button.textContent="Migrasi selesai";
  }catch(err){
    await update(lock,{status:"failed",failedAt:Date.now(),error:String(err.message||err)});
    button.disabled=false;button.textContent="Sahkan migrasi saldo awal";throw err;
  }
}
export async function renderOpeningMigration(c,homes,userId){households=homes||{};recordedBy=userId||null;await renderMigration(c);}
