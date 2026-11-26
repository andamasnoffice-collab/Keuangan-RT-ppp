import { firebaseConfigured, db } from "./firebase.js";
import { onValue, ref, set } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";
import { login, logout, observeSession, reauthenticate } from "./auth.js";
import { getHouseholds, getMonthBills, getPayments, getExpenses, saveHousehold, setHouseholdArrearPeriod, read, getFinancialPosition, getPublicDashboard, getPublicBills, getBillingSettings, saveBillingSettings, createExpense, createMonthlyBills, saveWaterReading, editWaterReading, getMonthTransactions, importWaterStatement, deleteMasterData, buildAnnualSummary, refreshPublicSnapshotSafely, syncHouseholdBillingHistory, waiveHouseholdBill } from "./data.js?v=20261126-cashflow-detail2";
import { renderPaymentPage } from "./payments.js?v=20261126-cashflow3";
import { renderWhatsAppPage } from "./whatsapp.js?v=20261126-arrears1";
import { renderOpeningMigration } from "./migration.js?v=20261126-arrears1";
import { cashFlow, trialBalance, summarizeLedger } from "./accounting.js?v=20261126-mutation1";

const $ = s => document.querySelector(s);
const money = n => "Rp " + new Intl.NumberFormat("id-ID",{maximumFractionDigits:0}).format(Number(n)||0);
const blockCollator=new Intl.Collator("id",{numeric:true,sensitivity:"base"});
const compareBlocks=(a,b)=>blockCollator.compare(String(a||"").trim(),String(b||"").trim());
const parseRupiah = value => Number(String(value??"").replace(/[^0-9-]/g,"")) || 0;
const formatRupiahInput = value => String(value??"").replace(/[^0-9]/g,"").replace(/\B(?=(\d{3})+(?!\d))/g,".");
function bindRupiahInputs(root){root.querySelectorAll("input[data-rupiah]").forEach(input=>{input.value=formatRupiahInput(input.value);input.addEventListener("input",()=>{const before=input.value;input.value=formatRupiahInput(before);try{input.setSelectionRange(input.value.length,input.value.length);}catch{}});});}
const monthKey = () => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`; };
const THEME_KEY="keuangan-rt-theme";
function applyTheme(theme){
  const chosen=theme==="dark"?"dark":"light";
  document.documentElement.dataset.theme=chosen;
  const button=$("#themeToggle");
  if(button){
    const dark=chosen==="dark";
    button.setAttribute("aria-label",dark?"Aktifkan mode terang":"Aktifkan mode gelap");
    button.title=dark?"Ganti ke mode terang":"Ganti ke mode gelap";
    const label=button.querySelector(".theme-label");
    if(label)label.textContent=dark?"Mode Terang":"Mode Gelap";
  }
}
let savedTheme="light";
try{savedTheme=localStorage.getItem(THEME_KEY)||"light";}catch{}
applyTheme(savedTheme);

let currentUser=null, currentProfile=null, page="dashboard", households={}, householdsLoadedAt=0;

function setFirebaseStatus(state,label){
  const el=$("#firebaseStatus"),text=$("#connectionLabel");
  if(!el||!text)return;
  el.classList.remove("is-online","is-offline","is-checking","is-unconfigured");
  el.classList.add(state);
  text.textContent=label;
}
if(!firebaseConfigured||!db){
  setFirebaseStatus("is-unconfigured","Belum dikonfigurasi");
}else{
  setFirebaseStatus("is-checking","Menghubungkan Firebase…");
  onValue(ref(db,".info/connected"),snapshot=>{
    const connected=snapshot.val()===true;
    setFirebaseStatus(connected?"is-online":"is-offline",connected?"Firebase Online":"Firebase Offline");
  },error=>{
    setFirebaseStatus("is-offline","Firebase Offline");
    console.error("Firebase connection monitor:",error);
  });
}

$("#themeToggle").addEventListener("click",()=>{
  const next=document.documentElement.dataset.theme==="dark"?"light":"dark";
  applyTheme(next);
  try{localStorage.setItem(THEME_KEY,next);}catch{}
});
$("#loginOpenBtn").addEventListener("click",()=>$("#loginDialog").showModal());
$("#loginCloseBtn").addEventListener("click",()=>$("#loginDialog").close());
$("#loginForm").addEventListener("submit", async e=>{
  e.preventDefault(); $("#loginError").textContent="";
  try {
    await login($("#loginEmail").value.trim(),$("#loginPassword").value);
    $("#loginDialog").close();
    $("#loginPassword").value="";
  } catch(err) { $("#loginError").textContent=err.message; }
});
$("#logoutBtn").addEventListener("click",()=>logout());
$("#mobileMenu").addEventListener("click",()=>$(".sidebar").classList.toggle("open"));
document.addEventListener("click",e=>{
  const drawer=$(".sidebar");
  if(!drawer?.classList.contains("open"))return;
  if(e.target.closest(".sidebar")||e.target.closest("#mobileMenu"))return;
  drawer.classList.remove("open");
});
document.addEventListener("keydown",e=>{
  if(e.key==="Escape")$(".sidebar")?.classList.remove("open");
});
$("#billingQuickBtn").addEventListener("click",async()=>{
  if(!currentUser)return;
  if(page!=="dashboard"){
    page="dashboard";
    document.querySelectorAll(".nav-item").forEach(item=>item.classList.toggle("active",item.dataset.page===page));
    await render();
  }
  requestAnimationFrame(()=>$("#billingCreationPanel")?.scrollIntoView({behavior:"smooth",block:"center"}));
});
$("#mobileActionDock").addEventListener("click",async e=>{
  const button=e.target.closest("[data-dock-action]");
  if(!button||!currentUser)return;
  const action=button.dataset.dockAction;
  if(action==="payments"||action==="waterMeters"){
    page=action;
    document.querySelectorAll(".nav-item").forEach(item=>item.classList.toggle("active",item.dataset.page===page));
    $(".sidebar").classList.remove("open");
    await render();
    return;
  }
  if(action==="billing"||action==="publish"){
    if(page!=="dashboard"){
      page="dashboard";
      document.querySelectorAll(".nav-item").forEach(item=>item.classList.toggle("active",item.dataset.page===page));
      await render();
    }
    const target=action==="billing"?$("#createMonthlyBillsBtn"):$("#publishPublicBtn");
    target?.click();
  }
});

$("#sideNav").addEventListener("click",e=>{
  const b=e.target.closest("[data-page]"); if(!b)return;
  if(!currentUser && !["dashboard","publicBills"].includes(b.dataset.page)) return;
  page=b.dataset.page; document.querySelectorAll(".nav-item").forEach(x=>x.classList.toggle("active",x===b));
  $(".sidebar").classList.remove("open"); currentUser ? render() : renderGuestPage();
});
observeSession((user,profile)=>{
  currentUser=user; currentProfile=profile;
  $("#userLabel").textContent = user ? (user.email || "Pengguna login") : "Belum login";
  $("#loginOpenBtn").classList.toggle("hidden",!!user);
  $("#logoutBtn").classList.toggle("hidden",!user);
  $("#mobileActionDock").classList.toggle("hidden",!user);
  $("#billingQuickBtn").classList.toggle("hidden",!user);
  if(user) {
    document.querySelectorAll("#sideNav [data-page]").forEach(x=>x.classList.remove("hidden"));
    render();
  } else {
    document.querySelectorAll("#sideNav [data-page]").forEach(x=>{
      x.classList.toggle("hidden", !["dashboard","publicBills"].includes(x.dataset.page));
    });
    if(!["dashboard","publicBills"].includes(page)) page="dashboard";
    document.querySelectorAll(".nav-item").forEach(x=>x.classList.toggle("active",x.dataset.page===page));
    renderGuestPage();
  }
});

function toast(msg){const t=$("#toast");t.textContent=msg;t.classList.add("show");setTimeout(()=>t.classList.remove("show"),2600);}
function title(s){$("#pageTitle").textContent=s;}
function card(label,value,sub=""){return `<div class="stat"><div class="label">${label}</div><div class="value">${value}</div><div class="sub">${sub}</div></div>`;}
function categoryCard(name,cashBalance,availableBalance,deposit,advance){return `<div class="category-card"><h4>${name}</h4><div class="balance">${money(availableBalance)}</div><div class="muted tiny">Dana bebas digunakan</div><div class="metric-row"><span>Uang kas/bank</span><b>${money(cashBalance)}</b></div><div class="metric-row"><span>Deposit warga</span><b>${money(deposit)}</b></div><div class="metric-row"><span>Uang muka belum diterapkan</span><b>${money(advance)}</b></div></div>`;}

async function render(){
  if(!currentUser){ renderGuestPage(); return; }
  const names={dashboard:"Dashboard",publicBills:"Daftar Tagihan",payments:"Pembayaran",householdLedger:"Mutasi Warga",households:"Rumah & Warga",deposits:"Deposit Warga",kas:"Kas RT",sampah:"Uang Sampah",air:"Uang Air",waterMeters:"Meteran Air",expenses:"Pengeluaran",transactions:"Semua Transaksi",reports:"Laporan",whatsapp:"WhatsApp Tagihan",settings:"Pengaturan",masterData:"Master Data",openingMigration:"Migrasi Pembukuan"};
  title(names[page]||"Dashboard");
  const c=$("#pageContent");
  c.innerHTML='<div class="panel">Memuat data…</div>';
  try{
    if(!householdsLoadedAt || Date.now()-householdsLoadedAt>60000){households=await getHouseholds();householdsLoadedAt=Date.now();}
    if(page==="dashboard") await renderDashboard(c);
    else if(page==="publicBills") await renderPublicBills(c, true);
    else if(page==="households") renderHouseholds(c);
    else if(page==="householdLedger") await renderHouseholdLedger(c);
    else if(page==="payments") await renderPaymentPage(c,{households,monthKey:monthKey(),money,toast,currentUser});
    else if(page==="deposits") await renderDeposits(c);
    else if(["kas","sampah","air"].includes(page)) await renderCategory(c,page);
    else if(page==="waterMeters") await renderWaterMeters(c);
    else if(page==="expenses") await renderExpenses(c);
    else if(page==="transactions") await renderTransactions(c);
    else if(page==="reports") await renderReports(c);
    else if(page==="whatsapp") await renderWhatsAppPage(c,{households,currentUser,currentProfile,toast});
    else if(page==="settings") await renderSettings(c);
    else if(page==="masterData") renderMasterData(c);
    else if(page==="openingMigration") await renderOpeningMigration(c,households,currentUser?.uid);
  }catch(e){c.innerHTML=`<div class="muted-note">Gagal memuat data: ${e.message}</div>`;}
}
async function renderSettings(c){
  const settings=await getBillingSettings();
  const field=(label,name,value,help)=>`<label class="field">${label}<input name="${name}" type="text" inputmode="numeric" data-rupiah value="${formatRupiahInput(value)}" placeholder="Rp 0" required><small class="muted tiny">${help}</small></label>`;
  c.innerHTML=`
    <div class="panel">
      <div class="section-head" style="margin-top:0"><h3>Tarif dan iuran bulanan</h3><span class="pill success">Dapat diubah kapan saja</span></div>
      <p class="muted tiny">Atur nominal di sini tanpa mengubah atau memasang ulang aplikasi. Perubahan disimpan ke Firebase dan digunakan sebagai tarif untuk pembentukan tagihan berikutnya.</p>
      <form id="billingSettingsForm"><div class="form-grid">
        ${field("Kas RT per rumah / bulan","kasMonthly",settings.kasMonthly,"Iuran kas tetap setiap bulan.")}
        ${field("Iuran sampah per rumah / bulan","sampahMonthly",settings.sampahMonthly,"Iuran sampah tetap setiap bulan.")}
        ${field("Administrasi air per rumah / bulan","waterAdmin",settings.waterAdmin,"Beban administrasi tetap, di luar pemakaian air.")}
        ${field("Tarif pemakaian air per m³","waterPerM3",settings.waterPerM3,"Dikalikan selisih meter akhir dan meter awal.")}
        <div class="full-row"><h4>Titik awal pembukuan digital</h4><p class="muted tiny">Bulan pertama aplikasi mulai menerbitkan tagihan, mencatat penerimaan, dan menyusun laporan.</p></div>
        <label class="field">Bulan mulai aplikasi<input name="goLivePeriod" type="month" value="${settings.goLivePeriod||monthKey()}" required><small class="muted tiny">Menjadi patokan awal pembukuan untuk semua rumah.</small></label>
        <div class="full-row"><h4>Saldo kas/bank awal</h4><p class="muted tiny">Isi seluruh uang nyata yang tersimpan pada tanggal mulai, termasuk deposit Air dan uang muka Kas RT/Sampah. Sistem memisahkan kewajiban tersebut dari dana bebas.</p></div>
        ${field("Saldo kas/bank awal Kas RT","openingKas",settings.openingBalances?.kas,"Termasuk kewajiban warga yang masih tersimpan.")}
        ${field("Saldo kas/bank awal Air","openingAir",settings.openingBalances?.air,"Termasuk deposit Air yang masih tersimpan.")}
        ${field("Saldo kas/bank awal Sampah","openingSampah",settings.openingBalances?.sampah,"Termasuk uang muka yang masih tersimpan.")}
      </div>
      <div class="summary-box" style="margin:8px 0 16px"><b>Rumus tagihan air</b><p class="tiny muted">Administrasi air + (pemakaian m³ × tarif per m³).</p><p class="tiny muted">Kas RT dan sampah menggunakan nominal tetap per rumah setiap bulan.</p></div>
      <button class="btn primary" type="submit">Simpan pengaturan tarif</button>
      <span id="settingsSavedAt" class="muted tiny" style="margin-left:10px">${settings.updatedAt?`Terakhir diubah: ${new Date(settings.updatedAt).toLocaleString("id-ID")}`:"Belum pernah disimpan"}</span>
      </form>
    </div>
    <div class="muted-note" style="margin-top:14px">Catatan: perubahan tarif tidak boleh menimpa tagihan bulan yang sudah terbentuk. Pengaturan ini menyimpan tarif ke Firebase; tagihan dibuat satu kali secara manual dari Dashboard, sedangkan pencatatan dan koreksi meter tersedia pada tab Meteran Air.</div>`;
  bindRupiahInputs($("#billingSettingsForm"));
  $("#billingSettingsForm").addEventListener("submit",async e=>{
    e.preventDefault(); const f=new FormData(e.currentTarget);
    const values=Object.fromEntries(["kasMonthly","sampahMonthly","waterAdmin","waterPerM3","openingKas","openingAir","openingSampah"].map(k=>[k,parseRupiah(f.get(k))])); values.goLivePeriod=String(f.get("goLivePeriod")||"");
    const button=e.currentTarget.querySelector('button[type="submit"]'); button.disabled=true; button.textContent="Menyimpan…";
    try{const saved=await saveBillingSettings(values); $("#settingsSavedAt").textContent=`Tersimpan: ${new Date(saved.updatedAt).toLocaleString("id-ID")}`; toast("Pengaturan tarif berhasil disimpan ke Firebase.");}
    catch(err){toast("Gagal menyimpan: "+err.message);}
    finally{button.disabled=false;button.textContent="Simpan pengaturan tarif";}
  });

}

async function renderGuestPage(){
  const names={dashboard:"Dashboard",publicBills:"Daftar Tunggakan"};
  title(names[page]||"Dashboard");
  const c=$("#pageContent");
  c.innerHTML='<div class="panel">Memuat informasi publik…</div>';
  try{
    if(page==="publicBills") await renderPublicBills(c, false);
    else await renderPublicDashboard(c);
  }catch(e){
    c.innerHTML=`<div class="muted-note">Informasi publik belum tersedia. Pengurus perlu memperbarui tampilan publik dari aplikasi setelah login. (${e.message})</div>`;
  }
}

async function renderPublicDashboard(c){
  const [d,announcement]=await Promise.all([getPublicDashboard(),read("public_views/announcement")]);
  const announcementHtml=announcement?.active&&announcement?.message?'<section class="panel public-announcement"><div class="announcement-heading"><span class="announcement-icon">!</span><div><span class="eyebrow">PENGUMUMAN WARGA</span><h3>'+escapeHtml(announcement.title||"Pengumuman")+'</h3></div></div><div class="announcement-message">'+escapeHtml(announcement.message).replace(/\n/g,"<br>")+'</div><div class="tiny muted">Diperbarui '+(announcement.updatedAt?new Date(announcement.updatedAt).toLocaleString("id-ID"):"-")+'</div></section>':"";
  if(!d){
    c.innerHTML=announcementHtml+'<div class="panel"><h3>Dashboard Keuangan Perum Puri Papahan</h3><p class="muted">Ringkasan publik belum dipublikasikan oleh pengurus.</p><p class="tiny muted">Informasi keuangan akan muncul setelah pengurus menerbitkan ringkasan.</p></div>';
    return;
  }
  const cats=d.categories||{},labels={kas:"Kas RT",air:"Air",sampah:"Uang Sampah"};
  const totalBalance=["kas","air","sampah"].reduce((sum,key)=>sum+(Number(cats[key]?.balance)||0),0);
  c.innerHTML=announcementHtml+`
    <div class="grid stats">
      ${card("Rumah terdaftar",Number(d.householdCount)||0,"Jumlah rumah")}
      ${card("Rumah dengan tunggakan",Number(d.outstandingHouseholds)||0,"Seluruh periode")}
      ${card("Total tunggakan",money(d.totalOutstanding),"Akumulasi lintas tahun")}
      ${card("Saldo operasional total",money(totalBalance),"Dana bebas seluruh kategori")}
    </div>
    <div class="section-head"><div><h3>Mutasi keuangan per kategori</h3><p class="tiny muted">Pilih kategori untuk melihat saldo awal, pemasukan, pengeluaran, dan saldo akhir setiap bulan.</p></div><span class="pill">Hanya lihat</span></div>
    <div class="grid stats">
      ${["kas","air","sampah"].map(cat=>`<button type="button" class="stat stat-button" data-category-mutation="${cat}"><div class="label">Saldo ${labels[cat]}</div><div class="value">${money(cats[cat]?.balance)}</div><div class="sub">Klik untuk melihat mutasi bulanan</div></button>`).join("")}
    </div>
    <div id="publicCategoryMutation" class="panel" hidden></div>
    <div class="section-head"><h3>Informasi publik</h3><span class="pill">Transparansi RT</span></div>
    <div class="muted-note">Warga dapat melihat saldo operasional dan mutasi per kategori. Nama warga, nomor telepon, anggota keluarga, bukti pembayaran pribadi, serta deposit per rumah tidak dipublikasikan.</div>
    <div class="tiny muted">Pembaruan terakhir: ${d.updatedAt?new Date(d.updatedAt).toLocaleString("id-ID"):"-"}</div>
    <button type="button" class="btn secondary" id="guestViewBills">Lihat daftar tunggakan</button>`;
  document.querySelectorAll("[data-category-mutation]").forEach(btn=>{
    btn.addEventListener("click",()=>showPublicCategoryMutation(btn.dataset.categoryMutation,d));
  });
  $("#guestViewBills").onclick=()=>{page="publicBills";document.querySelectorAll(".nav-item").forEach(x=>x.classList.toggle("active",x.dataset.page===page));renderGuestPage();};
}

function showPublicCategoryMutation(cat,dashboard){
  const panel=$("#publicCategoryMutation");
  if(!panel)return;
  const labels={kas:"Kas RT",air:"Uang Air",sampah:"Uang Sampah"};
  const category=dashboard.categories?.[cat]||{};
  const period=/^\\d{4}-(0[1-9]|1[0-2])$/.test(dashboard.period||"")?dashboard.period:monthKey();
  const year=Number(period.slice(0,4));
  const goLive=/^\\d{4}-(0[1-9]|1[0-2])$/.test(dashboard.goLivePeriod||"")?dashboard.goLivePeriod:period;
  const firstPeriod=goLive>`${year}-01`?goLive:`${year}-01`;
  const firstMonth=Number(firstPeriod.slice(5,7)),lastMonth=Number(period.slice(5,7));
  const months=dashboard.financeByMonth||{};
  const values=key=>months[key]?.byCategory?.[cat]||{income:0,expenses:0,incomeItems:[],expenseItems:[]};
  const activeKeys=Array.from({length:Math.max(0,lastMonth-firstMonth+1)},(_,i)=>`${year}-${String(firstMonth+i).padStart(2,"0")}`);
  const totalIncome=activeKeys.reduce((sum,key)=>sum+Math.max(0,Number(values(key).income)||0),0);
  const totalExpenses=activeKeys.reduce((sum,key)=>sum+Math.max(0,Number(values(key).expenses)||0),0);
  const opening=(Number(category.balance)||0)-totalIncome+totalExpenses;
  let running=opening;
  const monthNames=["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
  const rows=activeKeys.map(key=>{
    const data=values(key),income=Math.max(0,Number(data.income)||0),expense=Math.max(0,Number(data.expenses)||0);
    const start=running,end=start+income-expense;running=end;
    return `<tr><td><b>${monthNames[Number(key.slice(5,7))-1]}</b></td><td class="amount">${money(start)}</td><td class="amount income-value">${money(income)}</td><td class="amount expense-value">${money(expense)}</td><td><button type="button" class="btn outline btn-sm" data-category-month-detail="${key}">Lihat rincian</button></td><td class="amount"><b>${money(end)}</b></td></tr>`;
  }).join("");
  panel.hidden=false;
  panel.innerHTML=`
    <div class="section-head"><div><h3>Mutasi ${labels[cat]} ${year}</h3><p class="tiny muted">Periode aktif: ${firstPeriod} sampai ${period}. Saldo akhir berjalan ke bulan berikutnya.</p></div><button type="button" class="btn outline" id="closePublicCategoryMutation">Tutup</button></div>
    <div class="grid stats">
      ${card("Dana bebas saat ini",money(category.balance),"Setelah dikurangi kewajiban")}
      ${card("Uang kas/bank",money(category.cashBalance??category.balance),"Saldo uang nyata")}
      ${card("Penerimaan dialokasikan",money(totalIncome),"Pembayaran warga yang diakui sebagai pemasukan")}
      ${card("Pengeluaran tercatat",money(totalExpenses),"Pengeluaran dengan keterangan")}
      ${card("Deposit Air",money(category.depositLiability),"Kewajiban deposit warga")}
      ${card("Uang muka",money(category.advanceLiability),"Kewajiban pembayaran di muka")}
    </div>
    <div class="table-wrap"><table class="ledger-table"><thead><tr><th>Bulan</th><th>Saldo awal</th><th>Pemasukan</th><th>Pengeluaran</th><th>Rincian</th><th>Saldo akhir</th></tr></thead><tbody>${rows||'<tr><td colspan="6" class="empty">Belum ada periode pembukuan aktif pada tahun ini.</td></tr>'}<tr class="ledger-total"><td><b>Akumulasi periode aktif</b></td><td class="amount">${money(opening)}</td><td class="amount income-value">${money(totalIncome)}</td><td class="amount expense-value">${money(totalExpenses)}</td><td></td><td class="amount"><b>${money(running)}</b></td></tr></tbody></table></div>
    <div id="publicCategoryMonthDetails" class="public-category-month-details" hidden></div>
    <p class="tiny muted ledger-note">Rincian pemasukan bersumber dari pembayaran warga yang benar-benar dialokasikan ke tagihan. Deposit Air dan pembayaran di muka yang belum diterapkan tidak dihitung sebagai pemasukan baru. Bukti pembayaran pribadi tidak ditampilkan.</p>`;
  $("#closePublicCategoryMutation").onclick=()=>{panel.hidden=true;};
  panel.querySelectorAll("[data-category-month-detail]").forEach(button=>button.addEventListener("click",()=>{
    const key=button.dataset.categoryMonthDetail,data=values(key),box=$("#publicCategoryMonthDetails");
    const renderItems=(title,items,kind)=>`<section class="public-cashflow-group"><h4>${title} <span>${money(items.reduce((sum,x)=>sum+(Number(x.amount)||0),0))}</span></h4>${items.length?items.map(item=>`<div class="public-cashflow-item"><div><b>${escapeHtml(item.description||title)}</b><small>${escapeHtml(formatPublicDate(item.date))}</small></div><strong class="${kind}">${money(item.amount)}</strong></div>`).join(""):'<p class="muted tiny">Belum ada transaksi.</p>'}</section>`;
    box.hidden=false;
    box.innerHTML=`<div class="section-head"><h4>Rincian ${monthNames[Number(key.slice(5,7))-1]} ${year}</h4><span class="pill"> ${(data.incomeItems||[]).length+(data.expenseItems||[]).length} transaksi</span></div>${renderItems("Pemasukan · Pembayaran warga",data.incomeItems||[],"income-value")}${renderItems("Pengeluaran",data.expenseItems||[],"expense-value")}`;
    box.scrollIntoView({behavior:"smooth",block:"nearest"});
  }));
}

function formatPublicMonth(value){
  if(!/^\d{4}-\d{2}$/.test(String(value||"")))return String(value||"-");
  const [year,month]=value.split("-").map(Number);
  return new Date(year,month-1,1).toLocaleDateString("id-ID",{month:"long",year:"numeric"});
}

function formatPublicDate(value){
  if(!value)return "-";
  const d=typeof value==="number"?new Date(value):new Date(value);
  return Number.isNaN(d.getTime())?String(value):d.toLocaleDateString("id-ID");
}

async function renderPublicBills(c, authenticated){
  const rows=await read("public_views/allOutstanding")||{};
  const list=Object.values(rows).sort((a,b)=>compareBlocks(a.label,b.label));
  const totals=list.reduce((acc,x)=>{
    acc.kas+=Number(x.kas)||0; acc.sampah+=Number(x.sampah)||0; acc.air+=Number(x.air)||0; acc.total+=Number(x.total)||0;
    return acc;
  },{kas:0,sampah:0,air:0,total:0});
  const categoryLine=(label,detail)=>{
    const amount=Number(detail?.amount)||0;
    if(amount<=0)return "";
    const count=Number(detail?.periodCount)||0;
    const periods=Array.isArray(detail?.periods)?detail.periods:[];
    const suffix=periods.length?periods.map(escapeHtml).join(", "):(count+" bulan");
    const usage=label==="Air"&&Number(detail?.usageM3)>0?`<span class="arrears-usage">${Number(detail.usageM3).toLocaleString("id-ID",{maximumFractionDigits:3})} m³</span>`:"";
    return `<div class="arrears-category-row"><div><b>${label}</b><small>${suffix}${usage}</small></div><strong>${money(amount)}</strong></div>`;
  };
  c.innerHTML=`<div class="section-head"><div><h3>Daftar Tunggakan</h3><p class="tiny muted">Rincian kewajiban setiap rumah</p></div><span class="pill">Sampai ${monthKey()}</span></div>
  <div class="grid stats">
    ${card("Total tunggakan",money(totals.total),"Akumulasi semua rumah")}
    ${card("Kas RT",money(totals.kas),"Sisa kewajiban")}
    ${card("Sampah",money(totals.sampah),"Sisa kewajiban")}
    ${card("Air",money(totals.air),"Sisa kewajiban")}
  </div>
  <div class="muted-note">Rincian menunjukkan sisa tagihan yang belum lunas setelah dikurangi pembayaran. Air menampilkan pemakaian meter (m³) jika data meter periode tersebut tersedia. Nama kepala keluarga dan nomor telepon tidak ditampilkan.</div>
  <div id="publicBillCards" class="arrears-card-list">
    ${list.map(x=>{
      const details=x.details||{};
      const lines=categoryLine("Kas RT",details.kas)+categoryLine("Sampah",details.sampah)+categoryLine("Air",details.air);
      return `<article class="panel arrears-house-card">
        <div class="arrears-house-head"><div><span class="eyebrow">BLOK / RUMAH</span><h4>${escapeHtml(x.label||"Rumah")}</h4></div><span class="pill">${Number(x.periodCount)||0} bulan tertunggak</span></div>
        <div class="arrears-category-list">${lines||'<p class="muted tiny">Tidak ada rincian kategori.</p>'}</div>
        <div class="arrears-total"><span>Total tunggakan</span><strong>${money(x.total||0)}</strong></div>
      </article>`;
    }).join("")||'<div class="panel empty">Tidak ada tunggakan sampai bulan berjalan.</div>'}
  </div>`;
}

function escapeHtml(value){
  return String(value??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
}

async function renderDashboard(c){
  const [balances,position]=await Promise.all([read("category_balances"),getFinancialPosition()]);
  const totals=["kas","sampah","air"].map(k=>({...balances?.[k],cashBalance:position[k].cashBalance,availableBalance:position[k].availableBalance,deposit:position[k].depositLiability,advance:position[k].advanceLiability}));
  const operating=position.totals.availableBalance,deposits=position.totals.depositLiability,advances=position.totals.advanceLiability,cashOnHand=position.totals.cashBalance;
  const homes=Object.values(households);
  const announcement=await read("public_views/announcement")||{active:false,title:"",message:""};
  c.innerHTML=`  <section class="panel announcement-editor" style="margin-top:16px"><div class="section-head" style="margin-top:0"><div><h3>Pengumuman warga</h3><p class="tiny muted">Tulis informasi yang akan dibaca seluruh warga pada Dashboard publik.</p></div><span class="pill">Publik</span></div><label class="field">Judul pengumuman<input id="announcementTitle" maxlength="90" value="${escapeHtml(announcement.title||"")}" placeholder="Contoh: Jadwal kerja bakti"></label><label class="field">Isi pengumuman<textarea id="announcementMessage" rows="4" maxlength="2000" placeholder="Tuliskan informasi untuk warga...">${escapeHtml(announcement.message||"")}</textarea></label><div class="toolbar"><label class="announcement-toggle"><input id="announcementActive" type="checkbox" ${announcement.active?"checked":""}> Tampilkan pengumuman kepada warga</label><button type="button" id="saveAnnouncementBtn" class="btn secondary">Simpan Pengumuman</button></div><p class="tiny muted" id="announcementStatus">${announcement.updatedAt?"Terakhir diperbarui "+new Date(announcement.updatedAt).toLocaleString("id-ID"):"Belum ada pengumuman tersimpan."}</p></section><div id="billingCreationPanel" class="panel" style="margin-top:16px"><div class="section-head" style="margin-top:0"><div><h3>Pembuatan tagihan bulanan</h3><p class="tiny muted">Tagihan dibuat manual oleh pengurus. Satu periode hanya dapat dibuat satu kali.</p></div><span id="billingRunBadge" class="pill">Memeriksa periode…</span></div><div class="toolbar dashboard-billing-actions" style="margin-top:12px"><button type="button" id="createMonthlyBillsBtn" class="btn primary">Buat Tagihan Bulan Ini · ${monthKey()}</button><button type="button" id="publishPublicBtn" class="btn secondary">Perbarui Ringkasan Publik & Arus Kas</button></div><p id="billingRunMessage" class="tiny muted" style="margin-top:8px"></p></div><div class="grid stats">${card("Total rumah",homes.length,"Data rumah terdaftar")}${card("Total anggota",homes.reduce((s,h)=>s+Object.keys(h.members||{}).length,0),"Anggota keluarga")}${card("Uang kas/bank",money(cashOnHand),"Uang nyata yang tercatat")}${card("Dana bebas digunakan",money(operating),"Setelah dikurangi seluruh kewajiban")}${card("Deposit warga",money(deposits),"Kewajiban deposit Air")}${card("Uang muka",money(advances),"Kas RT/Sampah untuk bulan mendatang")}</div>

  <div class="section-head"><h3>Saldo setiap kategori</h3><span class="pill">Periode ${monthKey()}</span></div>
  <div class="grid category-grid">${categoryCard("Kas RT",totals[0].cashBalance,totals[0].availableBalance,totals[0].deposit,totals[0].advance)}${categoryCard("Uang Sampah",totals[1].cashBalance,totals[1].availableBalance,totals[1].deposit,totals[1].advance)}${categoryCard("Uang Air",totals[2].cashBalance,totals[2].availableBalance,totals[2].deposit,totals[2].advance)}</div>
  <div class="section-head"><h3>Rekonsiliasi kas</h3></div><div class="muted-note"><b>Rumus sederhana: dana bebas = uang kas/bank − deposit warga − uang muka.</b> Uang kas/bank adalah uang nyata yang sudah diterima. Deposit Air dan pembayaran Kas RT/Sampah untuk bulan mendatang masih menjadi kewajiban, sehingga belum boleh dipakai untuk pengeluaran. Saat kewajiban diterapkan ke tagihan, dana bebas bertambah tanpa menambah uang kas/bank.</div>

`;
  $("#saveAnnouncementBtn").addEventListener("click",async()=>{
    const button=$("#saveAnnouncementBtn"),titleText=$("#announcementTitle").value.trim(),message=$("#announcementMessage").value.trim(),active=$("#announcementActive").checked;
    if(active&&!message){toast("Isi pengumuman terlebih dahulu atau nonaktifkan tampilannya.");return;}
    button.disabled=true;button.textContent="Menyimpan…";
    try{
      await set(ref(db,"public_views/announcement"),{title:titleText||"Pengumuman Warga",message,active,updatedAt:Date.now(),updatedBy:currentUser?.uid||null});
      $("#announcementStatus").textContent="Berhasil disimpan · "+new Date().toLocaleString("id-ID");
      toast("Pengumuman berhasil disimpan.");
    }catch(err){toast("Pengumuman gagal disimpan: "+err.message);}
    finally{button.disabled=false;button.textContent="Simpan Pengumuman";}
  });
  const run=await read(`billing_runs/${monthKey()}`);
  const runBadge=$("#billingRunBadge"),runButton=$("#createMonthlyBillsBtn"),runMessage=$("#billingRunMessage");
  const quickLabel=$("#billingQuickLabel");
  if(quickLabel)quickLabel.textContent=run?.status==="completed"?"Tagihan · Selesai":run?.status==="processing"?"Tagihan · Diproses":"Tagihan Bulanan";
  const quickBtn=$("#billingQuickBtn");
  if(quickBtn)quickBtn.classList.toggle("is-complete",run?.status==="completed");
  if(run?.status==="completed"){
    runBadge.className="pill success";runBadge.textContent="Sudah dibuat";
    runButton.disabled=true;runButton.textContent="Tagihan bulan ini sudah dibuat";
    runMessage.textContent=`Periode ${monthKey()} sudah dibuat untuk ${run.householdCount||0} rumah. Tidak dapat dibuat ulang.`;
  }else if(run?.status==="processing"){
    runBadge.className="pill warning";runBadge.textContent="Sedang diproses";
    runButton.disabled=true;runMessage.textContent="Pembuatan tagihan sedang berlangsung.";
  }else if(run?.status==="needs_reconciliation"){
    runBadge.className="pill danger";runBadge.textContent="Perlu rekonsiliasi";
    runButton.disabled=true;runButton.textContent="Tagihan perlu pemeriksaan";
    runMessage.textContent="Data tagihan utama sudah tersimpan, tetapi pembaruan ringkasan/tunggakan tidak selesai. Jangan buat ulang periode ini.";
  }else if(run?.status==="failed"){
    runBadge.className="pill warning";runBadge.textContent="Perlu dicoba ulang";
    runMessage.textContent="Percobaan sebelumnya gagal sebelum data utama tersimpan. Periksa penyebabnya sebelum mencoba kembali.";
  }else{
    runBadge.className="pill";runBadge.textContent="Belum dibuat";
    runMessage.textContent="Klik sekali untuk membuat tagihan penuh bagi semua rumah aktif dan kontrak.";
  }
  runButton.addEventListener("click",async()=>{
    if(!confirm(`Buat tagihan penuh periode ${monthKey()} untuk seluruh rumah aktif dan kontrak? Proses ini hanya dapat berhasil satu kali.`))return;
    runButton.disabled=true;runButton.textContent="Membuat tagihan…";
    try{
      const result=await createMonthlyBills(monthKey(),currentUser?.uid);
      toast(`Tagihan ${result.period} berhasil dibuat untuk ${result.householdCount} rumah. Daftar tunggakan publik ikut diperbarui.`);
      await render();
    }catch(err){
      toast("Tagihan tidak dibuat: "+err.message);
      runButton.disabled=false;runButton.textContent="Buat Tagihan Bulan Ini · "+monthKey();
    }
  });
  $("#publishPublicBtn").addEventListener("click", async ()=>{
    const button=$("#publishPublicBtn");
    button.disabled=true;button.textContent="Memperbarui…";
    try{
      const synced=await refreshPublicSnapshotSafely();
      if(!synced)throw new Error("Snapshot belum berhasil ditulis. Coba ulang setelah koneksi Firebase stabil.");
      toast("Dashboard, daftar tunggakan, dan arus kas berhasil disinkronkan.");
    }catch(e){toast("Gagal memperbarui tampilan publik: "+e.message);}
    finally{button.disabled=false;button.textContent="Perbarui Ringkasan Publik & Arus Kas";}
  });
}
function renderHouseholds(c){
  const rows=Object.entries(households).map(([id,h])=>({...h,id})).sort((a,b)=>compareBlocks(a.block,b.block));
  c.innerHTML=`<div class="household-tools"><div class="toolbar"><input id="houseSearch" class="search-input" placeholder="Cari blok, alamat, nama kepala keluarga"><button type="button" id="addHouse" class="btn primary">+ Tambah rumah</button></div><div class="toolbar household-import-actions"><button type="button" id="downloadHouseTemplate" class="btn secondary">↓ Export Template Excel</button><label class="btn outline file-button" for="houseImportFile">↑ Impor Excel / CSV</label><input id="houseImportFile" type="file" accept=".xlsx,.xls,.csv" hidden></div></div><div id="houseImportPreview"></div><div class="section-head"><h3>Daftar rumah (${rows.length})</h3><span class="pill">Master data warga</span></div><div class="table-wrap"><table><thead><tr><th>Blok / No. Rumah</th><th>Kepala keluarga</th><th>Alamat</th><th>Anggota</th><th>Status</th><th>Aksi</th></tr></thead><tbody id="houseRows">${rows.map(h=>houseRow(h)).join("")||'<tr><td colspan="6" class="empty">Belum ada data rumah.</td></tr>'}</tbody></table></div>`;
  const draw=filter=>{$("#houseRows").innerHTML=rows.filter(h=>`${h.block} ${h.address} ${h.headName}`.toLowerCase().includes(filter.toLowerCase())).map(h=>houseRow(h)).join("")||'<tr><td colspan="6" class="empty">Tidak ada rumah yang cocok.</td></tr>';};
  $("#houseSearch").addEventListener("input",e=>draw(e.target.value));
  $("#addHouse").addEventListener("click",()=>houseDialog());
  $("#houseRows").addEventListener("click",e=>{const waive=e.target.closest("[data-waive-house]");if(waive){const h=rows.find(x=>x.id===waive.dataset.waiveHouse);if(h)houseWaiverDialog(h);return;}const b=e.target.closest("[data-edit-house]");if(!b)return;const h=rows.find(x=>x.id===b.dataset.editHouse);if(h)houseDialog(h);});
  $("#downloadHouseTemplate").addEventListener("click",downloadHouseholdTemplate);
  $("#houseImportFile").addEventListener("change",handleHouseholdImport);
}
function houseWaiverDialog(house) {
  const current=monthKey();
  $("#dialogContent").innerHTML=`<h3>Pemutihan tagihan · ${escapeHtml(house.block||"Rumah")}</h3>
    <p class="muted tiny">Pilih bulan dan kategori yang diputihkan. Nominal sisa akan dihapus dari tunggakan, tanpa penerimaan pembayaran atau pengurangan saldo kas.</p>
    <form id="houseWaiverForm"><div class="form-grid">
      <label class="field">Bulan tagihan<input name="period" type="month" max="${current}" value="${current}" required></label>
      <label class="field full-row">Kategori yang diputihkan</label>
      <label class="field"><span><input type="checkbox" name="category" value="kas"> Kas RT</span></label>
      <label class="field"><span><input type="checkbox" name="category" value="air"> Air</span></label>
      <label class="field"><span><input type="checkbox" name="category" value="sampah"> Sampah</span></label>
      <label class="field full-row">Alasan pemutihan<input name="reason" maxlength="180" placeholder="Contoh: rumah kosong / kebijakan pengurus" required></label>
    </div><div class="muted-note">Pemutihan hanya berlaku untuk kategori dan bulan yang dipilih. Pembayaran yang sudah masuk tetap tercatat; hanya sisa tagihan yang diputihkan.</div><button class="btn primary full" type="submit">Terapkan pemutihan</button></form>`;
  $("#genericDialog").showModal();
  $("#houseWaiverForm").addEventListener("submit",async e=>{
    e.preventDefault();
    const form=e.currentTarget,values=new FormData(form),period=String(values.get("period")||""),reason=String(values.get("reason")||"").trim(),categories=values.getAll("category");
    if(!categories.length){toast("Pilih minimal satu kategori.");return;}
    if(!confirm(`Putihkan ${categories.join(", ")} untuk ${house.block} periode ${period}? Sisa kewajiban terpilih akan menjadi Rp 0 dan tidak dapat ditagih kembali.`))return;
    const button=form.querySelector('button[type="submit"]');button.disabled=true;button.textContent="Memproses…";
    try{
      const results=[];
      for(const category of categories)results.push(await waiveHouseholdBill({householdId:house.id,period,category,reason,recordedBy:currentUser?.uid}));
      $("#genericDialog").close();
      toast(`Pemutihan berhasil: ${results.map(x=>x.category+" "+money(x.amount)).join(" · ")}.`);
      await render();
    }catch(err){toast("Pemutihan gagal: "+err.message);button.disabled=false;button.textContent="Terapkan pemutihan";}
  });
}
const HOUSE_IMPORT_HEADERS=["Blok / No Rumah","Nama Kepala Keluarga","Alamat Lengkap","Nomor HP","Nomor WhatsApp","Status (active/empty/rented)","Meter Air Awal (m3)","Anggota 1 - Nama","Anggota 1 - Hubungan","Anggota 2 - Nama","Anggota 2 - Hubungan","Anggota 3 - Nama","Anggota 3 - Hubungan","Anggota 4 - Nama","Anggota 4 - Hubungan","Anggota 5 - Nama","Anggota 5 - Hubungan","Periode Tunggakan Awal (YYYY-MM)","Tunggakan Awal Kas RT (Rp)","Tunggakan Awal Air (Rp)","Tunggakan Awal Sampah (Rp)","Bulan Mulai Kewajiban (YYYY-MM)"];
function downloadHouseholdTemplate(){
  ensureXLSX().then(XLSX=>{
    const wb=XLSX.utils.book_new();
    const template=[HOUSE_IMPORT_HEADERS];
    const ws=XLSX.utils.aoa_to_sheet(template);
    ws["!cols"]=HOUSE_IMPORT_HEADERS.map((h,i)=>({wch:i<3?25:i<7?19:22}));
    XLSX.utils.book_append_sheet(wb,ws,"Data Rumah Warga");
    const guide=[
      ["PANDUAN IMPOR DATA RUMAH & WARGA"],
      ["Isi satu baris untuk satu rumah. Baris pertama (judul kolom) jangan diubah."],
      ["Kolom wajib: Blok / No Rumah, Nama Kepala Keluarga, Alamat Lengkap."],
      ["Status: active = dihuni, empty = kosong, rented = kontrak. Jika kosong, sistem menganggap active."],
      ["Meter Air Awal: angka meter saat rumah mulai dicatat, satuan m³. Isi 0 jika belum ada data."],
      ["Anggota: isi nama dan hubungan pada pasangan kolom Anggota 1 sampai Anggota 5. Kolom anggota boleh kosong."],
      ["Periode Tunggakan Awal: format YYYY-MM, contoh 2026-01. Wajib diisi jika salah satu nominal tunggakan awal lebih dari 0."],
      ["Bulan Mulai Kewajiban: format YYYY-MM. Isi bulan pertama rumah mulai dikenai Kas RT dan Sampah. Jika kosong, digunakan titik awal pembukuan digital."],
      ["Tunggakan awal Kas RT, Air, Sampah: isi sisa tagihan yang belum dibayar, angka rupiah tanpa tanda Rp."],
      ["Nomor HP/WhatsApp: gunakan format teks, contoh 081234567890."],
      ["Baris dengan Blok/No Rumah yang sudah ada di database akan dilewati, tidak menimpa data lama."],
      ["Baris duplikat dalam file juga dilewati. Periksa pratinjau sebelum mengimpor."],
      ["Impor tidak memasukkan meter bulanan, pembayaran, deposit, maupun transaksi."],
      ["Simpan file sebagai .xlsx atau .csv UTF-8. Jangan menghapus atau mengganti nama header."]
    ];
    XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(guide),"Panduan");
    const data=XLSX.write(wb,{bookType:"xlsx",type:"array"});
    const url=URL.createObjectURL(new Blob([data],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}));
    const a=document.createElement("a");a.href=url;a.download="Template_Rumah_Warga_Keuangan_Puri_Papahan.xlsx";a.click();URL.revokeObjectURL(url);
  }).catch(e=>toast("Template gagal dibuat: "+e.message));
}
function parseHouseholdImport(matrix){
  if(!matrix.length)throw new Error("File kosong.");
  const headers=matrix[0].map(v=>String(v??"").trim().toLowerCase());
  const find=name=>headers.indexOf(name.toLowerCase());
  const ix=Object.fromEntries(HOUSE_IMPORT_HEADERS.map(h=>[h,find(h)]));
  const required=HOUSE_IMPORT_HEADERS.slice(0,3);
  const missing=required.filter(h=>ix[h]<0);
  if(missing.length)throw new Error("Kolom wajib tidak ditemukan: "+missing.join(", "));
  const val=(row,h)=>ix[h]<0?"":String(row[ix[h]]??"").trim();
  const num=(row,h)=>{const raw=val(row,h);if(!raw)return 0;const n=Number(raw.replace(/[^0-9,.-]/g,"").replace(",", "."));return Number.isFinite(n)?n:NaN;};
  return matrix.slice(1).filter(row=>val(row,HOUSE_IMPORT_HEADERS[0])).map((row,index)=>{
    const status=(val(row,HOUSE_IMPORT_HEADERS[5])||"active").toLowerCase();
    const period=val(row,HOUSE_IMPORT_HEADERS[17]);
    const arrears={kas:num(row,HOUSE_IMPORT_HEADERS[18]),air:num(row,HOUSE_IMPORT_HEADERS[19]),sampah:num(row,HOUSE_IMPORT_HEADERS[20])};
    const members=[];
    for(let n=1;n<=5;n++){const name=val(row,`Anggota ${n} - Nama`);const relation=val(row,`Anggota ${n} - Hubungan`);if(name)members.push({name,relation:relation||"lainnya"});}
    return {rowNumber:index+2,block:val(row,HOUSE_IMPORT_HEADERS[0]),headName:val(row,HOUSE_IMPORT_HEADERS[1]),address:val(row,HOUSE_IMPORT_HEADERS[2]),phone:val(row,HOUSE_IMPORT_HEADERS[3]),whatsapp:val(row,HOUSE_IMPORT_HEADERS[4]),status,initialWaterMeter:num(row,HOUSE_IMPORT_HEADERS[6]),period,arrears,billingStartPeriod:val(row,"Bulan Mulai Kewajiban (YYYY-MM)"),members};
  });
}
async function handleHouseholdImport(event){
  const file=event.target.files?.[0];if(!file)return;
  const input=event.target;input.disabled=true;
  try{
    let matrix;
    if(file.name.toLowerCase().endsWith(".csv"))matrix=parseCsvText(await file.text());
    else{const XLSX=await ensureXLSX();const wb=XLSX.read(await file.arrayBuffer(),{type:"array"});matrix=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{header:1,defval:""});}
    const parsed=parseHouseholdImport(matrix),existingBlocks=new Set(Object.values(households).map(h=>String(h.block||"").trim().toLowerCase()));
    const seen=new Set();let invalid=0,duplicates=0;
    parsed.forEach(row=>{
      const key=row.block.toLowerCase();
      row.errors=[];
      if(!row.headName)row.errors.push("Nama kepala keluarga kosong");
      if(!row.address)row.errors.push("Alamat kosong");
      if(!["active","empty","rented"].includes(row.status))row.errors.push("Status tidak valid");
      if(!Number.isFinite(row.initialWaterMeter)||row.initialWaterMeter<0)row.errors.push("Meter awal tidak valid");
      if(Object.values(row.arrears).some(v=>!Number.isFinite(v)||v<0))row.errors.push("Nominal tunggakan tidak valid");
      if(Object.values(row.arrears).some(v=>v>0)&&!/^\d{4}-(0[1-9]|1[0-2])$/.test(row.period))row.errors.push("Periode tunggakan harus YYYY-MM");
      if(existingBlocks.has(key)||seen.has(key)){row.duplicate=true;duplicates++;}else seen.add(key);
      if(row.errors.length)invalid++;
    });
    const ready=parsed.filter(x=>!x.duplicate&&!x.errors.length);
    const errors=parsed.filter(x=>x.errors.length);
    const preview=$("#houseImportPreview");
    preview.innerHTML=`<section class="panel import-preview"><div class="section-head"><div><h3>Pratinjau impor rumah & warga</h3><p class="tiny muted">${escapeHtml(file.name)}</p></div><span class="pill">${parsed.length} baris</span></div><div class="grid stats"><div class="stat"><div class="label">Siap diimpor</div><div class="value">${ready.length}</div></div><div class="stat"><div class="label">Duplikat dilewati</div><div class="value">${duplicates}</div></div><div class="stat"><div class="label">Perlu diperbaiki</div><div class="value">${invalid}</div></div></div><div class="table-wrap"><table><thead><tr><th>Baris</th><th>Blok</th><th>Kepala keluarga</th><th>Status</th><th>Keterangan</th></tr></thead><tbody>${parsed.slice(0,100).map(x=>`<tr><td>${x.rowNumber}</td><td>${escapeHtml(x.block)}</td><td>${escapeHtml(x.headName)}</td><td>${escapeHtml(x.status)}</td><td>${x.duplicate?'<span class="pill warning">Duplikat · dilewati</span>':x.errors.length?'<span class="pill danger">'+escapeHtml(x.errors.join(", "))+'</span>':'<span class="pill success">Siap</span>'}</td></tr>`).join("")}</tbody></table></div><p class="tiny muted">Hanya rumah baru yang valid akan ditambahkan. Data rumah yang sudah ada tidak ditimpa.</p><button type="button" id="confirmHouseImport" class="btn primary" ${ready.length?"":"disabled"}>Impor ${ready.length} rumah ke Firebase</button><button type="button" id="cancelHouseImport" class="btn outline">Batal</button></section>`;
    $("#cancelHouseImport").addEventListener("click",()=>{preview.innerHTML="";input.value="";});
    $("#confirmHouseImport").addEventListener("click",async()=>{
      const button=$("#confirmHouseImport");button.disabled=true;button.textContent="Mengimpor…";
      let created=0,failed=[];const importSettings=await getBillingSettings();
      for(const row of ready){
        try{
          const members={head:{name:row.headName,relation:"kepala_keluarga",status:"active"}};
          row.members.forEach((member,index)=>members[`m${index+1}`]={...member,status:"active"});
          const openingArrears=row.arrears;
          const hasArrears=Object.values(openingArrears).some(v=>v>0);
          const data={billingStartPeriod:row.billingStartPeriod||(hasArrears?row.period:(importSettings.goLivePeriod||monthKey())),block:row.block,headName:row.headName,address:row.address,phone:row.phone,whatsapp:{primaryNumber:row.whatsapp||row.phone||"",enabled:true},initialWaterMeter:row.initialWaterMeter,currentWaterMeter:row.initialWaterMeter,status:row.status,members,openingArrears,openingArrearsPeriod:hasArrears?row.period:null,openingArrearsRecorded:hasArrears,importedAt:Date.now(),importedBy:currentUser?.uid||null};
          const id=await saveHousehold(data);
          if(hasArrears)for(const cat of ["kas","air","sampah"])if(openingArrears[cat]>0)await setHouseholdArrearPeriod(id,row.period,cat,openingArrears[cat]);
          await syncHouseholdBillingHistory(id);
          created++;
        }catch(err){failed.push(row.block+": "+err.message);}
      }
      households=await getHouseholds();householdsLoadedAt=Date.now();
      preview.innerHTML=`<div class="muted-note">Impor selesai. Berhasil: ${created}. Gagal: ${failed.length}. ${failed.length?escapeHtml(failed.join(" | ")):""}</div>`;
      toast(`Impor rumah selesai: ${created} berhasil, ${failed.length} gagal.`);
      await render();
    });
  }catch(err){$("#houseImportPreview").innerHTML='<div class="muted-note">'+escapeHtml(err.message)+'</div>';toast("Impor gagal dibaca: "+err.message);}
  finally{input.disabled=false;}
}
function houseRow(h){return `<tr><td><b>${escapeHtml(h.block||"-")}</b></td><td>${escapeHtml(h.headName||"-")}</td><td>${escapeHtml(h.address||"-")}</td><td>${Object.keys(h.members||{}).length}</td><td><span class="pill ${h.status==="active"?"success":"warning"}">${escapeHtml(h.status||"active")}</span></td><td><div class="toolbar"><button class="btn small outline" type="button" data-edit-house="${escapeHtml(h.id)}">Edit</button><button class="btn small secondary" type="button" data-waive-house="${escapeHtml(h.id)}">Pemutihan</button></div></td></tr>`;}
async function renderHouseholdLedger(c){
  const homes=Object.entries(households||{}).map(([id,h])=>({id,...h})).sort((a,b)=>compareBlocks(a.block,b.block));
  c.innerHTML=`<section class="panel household-ledger-page"><div class="section-head" style="margin-top:0"><div><h3>Mutasi keuangan per warga</h3><p class="tiny muted">Pembayaran tunai, deposit masuk, dan deposit yang dipakai ditampilkan terpisah.</p></div><span class="pill">Data Firebase</span></div><div class="house-ledger-filter"><label class="field">Pilih rumah<select id="houseLedgerHouse"><option value="">Pilih blok / nomor rumah</option>${homes.map(h=>`<option value="${escapeHtml(h.id)}">${escapeHtml(h.block||"-")} · ${escapeHtml(h.headName||"")}</option>`).join("")}</select></label><label class="field">Tahun mutasi<input id="houseLedgerYear" type="number" min="2000" max="2100" value="${new Date().getFullYear()}"></label><button type="button" id="loadHouseLedger" class="btn primary">Tampilkan</button></div><div id="houseLedgerContent"><div class="empty">Pilih rumah untuk melihat mutasi keuangannya.</div></div><p class="tiny muted">Deposit otomatis mengurangi tagihan kategori yang sama. Pembayaran dari deposit bukan uang tunai baru dan tidak dihitung sebagai pemasukan kas dua kali.</p></section>`;
  const load=async()=>{
    const id=$("#houseLedgerHouse").value,year=Number($("#houseLedgerYear").value),target=$("#houseLedgerContent");
    if(!id){target.innerHTML='<div class="empty">Pilih rumah terlebih dahulu.</div>';return;}
    if(!Number.isInteger(year)||year<2000||year>2100){toast("Tahun mutasi tidak valid.");return;}
    target.innerHTML='<div class="empty">Memuat mutasi tahunan…</div>';
    try{
      const periods=Array.from({length:12},(_,i)=>`${year}-${String(i+1).padStart(2,"0")}`);
      const [months,currentDeposits,arrearsNow]=await Promise.all([Promise.all(periods.map(period=>getPayments(period))),read(`deposits/${id}`),read(`arrearsSummary/${id}`)]);
      const sums=periods.map((period,index)=>{
        const payments=Object.values(months[index]||{}).filter(x=>x?.householdId===id);
        const row={period,cash:{kas:0,air:0,sampah:0},depositIn:{kas:0,air:0,sampah:0},depositUsed:{kas:0,air:0,sampah:0},count:payments.length};
        payments.forEach(payment=>(payment.items||[]).forEach(item=>{
          if(!["kas","air","sampah"].includes(item.cat))return;
          row.cash[item.cat]+=Number(item.cash)||0;
          row.depositIn[item.cat]+=Number(item.surplus)||0;
          row.depositUsed[item.cat]+=Number(item.depositUsed)||0;
        }));
        row.cashTotal=Object.values(row.cash).reduce((a,b)=>a+b,0);
        row.depositInTotal=Object.values(row.depositIn).reduce((a,b)=>a+b,0);
        row.depositUsedTotal=Object.values(row.depositUsed).reduce((a,b)=>a+b,0);
        return row;
      });
      const fmt=n=>money(n),monthNames=["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
      const total={kas:0,air:0,sampah:0,depositInKas:0,depositInAir:0,depositInSampah:0,depositUsedKas:0,depositUsedAir:0,depositUsedSampah:0,cash:0,depositIn:0,depositUsed:0};
      sums.forEach(row=>{for(const cat of ["kas","air","sampah"]){total[cat]+=row.cash[cat];total["depositIn"+cat[0].toUpperCase()+cat.slice(1)]+=row.depositIn[cat];total["depositUsed"+cat[0].toUpperCase()+cat.slice(1)]+=row.depositUsed[cat];}total.cash+=row.cashTotal;total.depositIn+=row.depositInTotal;total.depositUsed+=row.depositUsedTotal;});
      const cell=(cash,used)=>`<b>${fmt((Number(cash)||0)+(Number(used)||0))}</b>`;
      const depositCards=["kas","air","sampah"].map(cat=>`<div class="deposit-balance-card"><span>${cat==="kas"?"Kas RT":cat==="air"?"Air":"Sampah"}</span><b>${fmt(currentDeposits?.[cat]||0)}</b></div>`).join("");
      const arrearsCards=["kas","air","sampah"].map(cat=>`<div class="deposit-balance-card"><span>${cat==="kas"?"Kas RT":cat==="air"?"Air":"Sampah"}</span><b>${fmt(arrearsNow?.[cat]||0)}</b></div>`).join("");
      target.innerHTML=`<div class="house-ledger-heading"><div><b>Mutasi ${escapeHtml(homes.find(h=>h.id===id)?.block||"")}</b><span class="tiny muted"> · ${year}</span></div><span class="pill">${sums.reduce((a,b)=>a+b.count,0)} catatan</span></div>
        <div class="table-wrap"><table class="house-ledger-table compact-house-ledger"><thead><tr><th>Bulan</th><th>Kas RT</th><th>Air</th><th>Sampah</th></tr></thead><tbody>${sums.map((row,i)=>`<tr><td>${monthNames[i]}</td><td>${cell(row.cash.kas,row.depositUsed.kas)}</td><td>${cell(row.cash.air,row.depositUsed.air)}</td><td>${cell(row.cash.sampah,row.depositUsed.sampah)}</td></tr>`).join("")}<tr class="ledger-total"><td>Total ${year}</td><td>${cell(total.kas,total.depositUsedKas)}</td><td>${cell(total.air,total.depositUsedAir)}</td><td>${cell(total.sampah,total.depositUsedSampah)}</td></tr></tbody></table></div>
        <div class="house-ledger-status-grid">
          <section class="deposit-balance-wrap"><b>Sisa deposit saat ini</b><div class="deposit-balance-grid">${depositCards}</div></section>
          <section class="deposit-balance-wrap"><b>Sisa tunggakan saat ini</b><div class="deposit-balance-grid">${arrearsCards}</div><div class="house-ledger-grand-total">Total kurang bayar: <strong>${fmt(arrearsNow?.total||0)}</strong></div></section>
        </div>
        <p class="tiny muted">Nominal per bulan adalah total yang sudah dibayar (tunai + deposit terpakai). Sisa deposit dan tunggakan menunjukkan posisi terbaru dari Firebase.</p>`
    }catch(err){target.innerHTML=`<div class="muted-note">Gagal memuat mutasi: ${escapeHtml(err.message)}</div>`;}
  };
  $("#loadHouseLedger").addEventListener("click",load);
  $("#houseLedgerHouse").addEventListener("change",load);
}

function houseDialog(existing=null){
  const editing=!!existing;
  const openingArrearsRecorded=!!existing?.openingArrearsRecorded;
  const membersText=Object.entries(existing?.members||{}).filter(([key])=>key!=="head").map(([,v])=>v.name?`${v.name} - ${v.relation||"lainnya"}`:"").filter(Boolean).join("\n");
  $("#dialogContent").innerHTML=`<h3>${editing?"Edit rumah / keluarga":"Tambah rumah / keluarga"}</h3><form id="houseForm"><div class="form-grid"><label class="field">Blok / nomor rumah<input name="block" value="${escapeHtml(existing?.block||"")}" required></label><label class="field">Nama kepala keluarga<input name="headName" value="${escapeHtml(existing?.headName||"")}" required></label><label class="field full-row">Alamat lengkap<input name="address" value="${escapeHtml(existing?.address||"")}" required></label><label class="field">Nomor HP<input name="phone" value="${escapeHtml(existing?.phone||"")}"></label><label class="field">Nomor WhatsApp<input name="whatsappNumber" value="${escapeHtml(existing?.whatsapp?.primaryNumber||"")}" placeholder="Contoh: 081234567890"></label><label class="field">Meteran air awal (m³)<input name="initialWaterMeter" type="number" min="0" step="0.01" value="${Number(existing?.initialWaterMeter??existing?.currentWaterMeter)||0}" required><small class="muted tiny">${editing?"Ubah hanya jika melakukan koreksi data meter awal.":"Angka meter saat rumah pertama kali didaftarkan."}</small></label><label class="field">Status<select name="status"><option value="active" ${existing?.status==="active"?"selected":""}>Dihuni</option><option value="empty" ${existing?.status==="empty"?"selected":""}>Kosong</option><option value="rented" ${existing?.status==="rented"?"selected":""}>Kontrak</option></select></label><div class="field full-row opening-arrears-box"><b>Tunggakan awal (migrasi dari catatan manual)</b><small class="muted tiny">${openingArrearsRecorded?"Tunggakan awal sudah pernah dimigrasikan dan dikunci agar tidak tercatat dua kali.":"Masukkan sisa kewajiban yang belum dibayar. Setelah disimpan, nilai dicatat satu kali ke ledger tunggakan."}</small></div>${openingArrearsRecorded?`<div class="summary-box field full-row"><b>Tunggakan awal tersimpan</b><div class="opening-arrears-saved"><span>Kas RT: ${money(existing?.openingArrears?.kas||0)}</span><span>Air: ${money(existing?.openingArrears?.air||0)}</span><span>Sampah: ${money(existing?.openingArrears?.sampah||0)}</span></div></div>`:`<label class="field">Kas RT (Rp)<input name="openingArrearsKas" type="text" inputmode="numeric" data-rupiah value="${Number(existing?.openingArrears?.kas)||0}"></label><label class="field">Air (Rp)<input name="openingArrearsAir" type="text" inputmode="numeric" data-rupiah value="${Number(existing?.openingArrears?.air)||0}"></label><label class="field">Sampah (Rp)<input name="openingArrearsSampah" type="text" inputmode="numeric" data-rupiah value="${Number(existing?.openingArrears?.sampah)||0}"></label>`}<label class="field">Bulan mulai kewajiban<input name="billingStartPeriod" type="month" value="${existing?.billingStartPeriod||existing?.openingArrearsPeriod||monthKey()}" required><small class="muted tiny">Acuan awal Kas RT dan Sampah. Sistem menghitung setiap bulan sejak periode ini, termasuk jika nominal tunggakan awal Rp 0.</small></label><label class="field full-row">Anggota keluarga (satu nama per baris, opsional)<textarea name="members" rows="4" placeholder="Nama - hubungan&#10;Siti - Istri&#10;Budi - Anak">${escapeHtml(membersText)}</textarea></label></div><button class="btn primary full">${editing?"Simpan perubahan":"Simpan rumah"}</button></form>`;
  $("#genericDialog").showModal();
  bindRupiahInputs($("#houseForm"));
  $("#houseForm").addEventListener("submit",async e=>{
    e.preventDefault();const f=new FormData(e.target),members={};
    String(f.get("members")||"").split("\n").map(x=>x.trim()).filter(Boolean).forEach((line,i)=>{const [name,relation]=line.split("-").map(x=>x.trim());members[`m${i+1}`]={name,relation:relation||"lainnya",status:"active"};});
    members.head={name:f.get("headName"),relation:"kepala_keluarga",status:"active"};
    const initial= Math.max(0,Number(f.get("initialWaterMeter"))||0);
    const shouldRecordOpeningArrears=!openingArrearsRecorded;
    const openingArrears=shouldRecordOpeningArrears?{kas:parseRupiah(f.get("openingArrearsKas")),air:parseRupiah(f.get("openingArrearsAir")),sampah:parseRupiah(f.get("openingArrearsSampah"))}:(existing.openingArrears||{kas:0,air:0,sampah:0});
    const billingStartPeriod=String(f.get("billingStartPeriod")||existing?.billingStartPeriod||existing?.openingArrearsPeriod||"");
    const openingArrearsPeriod=shouldRecordOpeningArrears?billingStartPeriod:(existing.openingArrearsPeriod||billingStartPeriod);
    if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(billingStartPeriod))throw new Error("Bulan mulai kewajiban harus dipilih.");
    const data={...(existing||{}),billingStartPeriod,block:f.get("block").trim(),headName:f.get("headName").trim(),address:f.get("address").trim(),phone:f.get("phone").trim(),whatsapp:{...(existing?.whatsapp||{}),primaryNumber:f.get("whatsappNumber")||f.get("phone")||"",enabled:true},initialWaterMeter:editing?Number(existing.initialWaterMeter??initial):initial,currentWaterMeter:editing?Number(existing.currentWaterMeter??initial):initial,status:f.get("status"),members,openingArrears,openingArrearsPeriod,openingArrearsRecorded:openingArrearsRecorded||shouldRecordOpeningArrears};
    if(existing)data.id=existing.id;
    const id=await saveHousehold(data);
    if(shouldRecordOpeningArrears){for(const cat of ["kas","air","sampah"])if(openingArrears[cat]>0)await setHouseholdArrearPeriod(id,openingArrearsPeriod,cat,openingArrears[cat]);}
    const historySync=await syncHouseholdBillingHistory(id);
    await refreshPublicSnapshotSafely();
    households=await getHouseholds();householdsLoadedAt=Date.now();$("#genericDialog").close();toast(historySync.created?`Data rumah tersimpan. ${historySync.created} periode kewajiban lama disinkronkan.`:editing?"Perubahan rumah tersimpan.":"Data rumah dan tunggakan awal tersimpan.");await render();
  });
}

async function renderDeposits(c){
  const data=await read("deposits")||{},rows=[];
  Object.entries(data).forEach(([hid,cats])=>Object.entries(cats||{}).forEach(([cat,amount])=>{if(Number(amount)>0)rows.push({hid,cat,amount:Number(amount)});}));
  const airTotal=rows.filter(x=>x.cat==="air").reduce((sum,x)=>sum+x.amount,0);
  const legacy=rows.filter(x=>x.cat!=="air"),legacyTotal=legacy.reduce((sum,x)=>sum+x.amount,0);
  c.innerHTML=`<div class="grid stats">${card("Total deposit Air",money(airTotal),"Kewajiban kepada warga")}${card("Catatan deposit lama",money(legacyTotal),"Kas RT/Sampah · perlu verifikasi")}</div>
  <div class="section-head"><div><h3>Deposit Air per rumah</h3><p class="tiny muted">Deposit hanya dapat digunakan untuk membayar tagihan Air rumah yang sama.</p></div></div>
  <div class="table-wrap"><table><thead><tr><th>Rumah</th><th>Saldo deposit Air</th></tr></thead><tbody>${rows.filter(x=>x.cat==="air").map(x=>`<tr><td>${escapeHtml(households[x.hid]?.block||x.hid)}</td><td class="amount">${money(x.amount)}</td></tr>`).join("")||'<tr><td colspan="2" class="empty">Belum ada deposit Air.</td></tr>'}</tbody></table></div>
  ${legacy.length?`<div class="muted-note" style="margin-top:14px"><b>Perlu pemeriksaan data lama.</b> Ditemukan deposit non-Air sebesar ${money(legacyTotal)}. Aturan baru tidak mengizinkan deposit Kas RT atau Sampah. Data lama tidak dihapus otomatis; periksa dan selesaikan melalui koreksi pembukuan.</div><div class="table-wrap" style="margin-top:10px"><table><thead><tr><th>Rumah</th><th>Kategori lama</th><th>Nominal</th></tr></thead><tbody>${legacy.map(x=>`<tr><td>${escapeHtml(households[x.hid]?.block||x.hid)}</td><td>${escapeHtml(x.cat)}</td><td class="amount">${money(x.amount)}</td></tr>`).join("")}</tbody></table></div>`:""}
  <div class="muted-note" style="margin-top:14px">Deposit bukan pemasukan. Saldo deposit mengurangi dana bebas yang boleh digunakan untuk pengeluaran sampai deposit tersebut dipakai membayar tagihan Air.</div>`;
}

async function ensureXLSX(){
  if(window.XLSX)return window.XLSX;
  await new Promise((resolve,reject)=>{
    const s=document.createElement("script");s.src="https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";s.onload=resolve;s.onerror=()=>reject(new Error("Pustaka pembaca Excel gagal dimuat. Periksa koneksi internet."));document.head.appendChild(s);
  });
  return window.XLSX;
}
function parseCsvText(text){
  const rows=[];let row=[],cell="",quoted=false;
  for(let i=0;i<text.length;i++){const ch=text[i],next=text[i+1];
    if(ch==='"'&&quoted&&next==='"'){cell+='"';i++;}
    else if(ch==='"')quoted=!quoted;
    else if((ch===","||ch===";"||ch==="\t")&&!quoted){row.push(cell);cell="";}
    else if((ch==="\n"||ch==="\r")&&!quoted){if(ch==="\r"&&next==="\n")i++;row.push(cell);if(row.some(v=>String(v).trim()))rows.push(row);row=[];cell="";}
    else cell+=ch;
  }
  row.push(cell);if(row.some(v=>String(v).trim()))rows.push(row);
  return rows;
}
function normalizeWaterImportRows(matrix){
  if(!matrix.length)return [];
  const headers=matrix[0].map(v=>String(v??"").trim().toLowerCase());
  const find=patterns=>headers.findIndex(h=>patterns.some(p=>h.includes(p)));
  const ix={block:find(["blok","no. rumah"]),name:find(["nama kepala","nama"]),previous:find(["meter awal","meter sebelumnya","meter september","meteran september"]),current:find(["meter akhir","meter sekarang","meter oktober","meteran oktober"]),usage:find(["pemakaian","jml"]),amount:find(["tagihan oktober","tagihan air","nominal tagihan","tagihan (rp)"])};
  if(ix.block<0)throw new Error("Kolom Blok tidak ditemukan. Gunakan file template impor Keuangan RT.");
  return matrix.slice(1).filter(r=>String(r[ix.block]??"").trim()).map(r=>{
    const num=i=>{if(i<0||r[i]===undefined||r[i]===null||String(r[i]).trim()==="")return null;const v=Number(String(r[i]).replace(/[^0-9,-]/g,"").replace(",", "."));return Number.isFinite(v)?v:null;};
    return {block:String(r[ix.block]).trim(),headName:ix.name>=0?String(r[ix.name]??"").trim():"",previousMeter:num(ix.previous),currentMeter:num(ix.current),usage:num(ix.usage),amount:num(ix.amount)};
  });
}
async function renderWaterMeters(c){
  const period=monthKey(),settings=await getBillingSettings(),readings=await read(`water_readings/${period}`)||{},run=await read(`billing_runs/${period}`);
  const homes=Object.entries(households).filter(([,h])=>h&&h.status!=="empty"&&h.status!=="inactive").sort((a,b)=>compareBlocks(a[1].block,b[1].block));
  const recorded=homes.filter(([id])=>!!readings[id]).length;
  c.innerHTML=`<div class="grid stats">${card("Rumah aktif",homes.length,"Dihuni dan kontrak")}${card("Meter tercatat",recorded,"Periode "+period)}${card("Belum tercatat",homes.length-recorded,"Menunggu pencatatan meter")}</div>
  <div class="panel water-meter-panel">
    <div class="section-head" style="margin-top:0"><div><h3>Meteran air · ${period}</h3><p class="muted tiny">Masukkan angka akhir pada setiap rumah. Pemakaian dihitung otomatis.</p></div><span class="pill">${money(settings.waterPerM3||0)} / m³</span></div>
    <div class="toolbar water-import-toolbar"><button class="btn outline" id="openWaterImport" type="button">⇧ Impor data Excel / CSV</button><span class="muted tiny">Impor daftar meter dan nominal tagihan per periode.</span></div>
    <div id="waterImportPanel" class="muted-note hidden">
      <form id="waterImportForm">
        <div class="form-grid">
          <label class="field">Periode data<input type="month" name="period" value="${period}" required></label>
          <label class="field">Pilih file Excel / CSV<input type="file" id="waterImportFile" accept=".xlsx,.xls,.csv" required></label>
        </div>
        <p class="muted tiny">Kolom yang dikenali: Blok, Nama Kepala Keluarga, Meter Awal, Meter Akhir, Pemakaian, dan Tagihan (Rp). Format lama dengan nama bulan juga didukung.</p>
        <div id="waterImportPreview"></div>
        <button class="btn primary" id="confirmWaterImport" type="submit" disabled>Impor ke Firebase</button>
        <button class="btn outline" id="cancelWaterImport" type="button">Batal</button>
      </form>
    </div>
    ${!run||run.status!=="completed"?'<div class="muted-note">Tagihan bulan ini belum dibuat. Klik Buat Tagihan Bulan Ini di bagian atas Dashboard terlebih dahulu.</div>':homes.map(([id,h])=>{
      const previous=Number(h.currentWaterMeter??h.initialWaterMeter)||0,saved=readings[id];
      return `<div class="water-meter-line" data-house="${escapeHtml(id)}" data-previous="${previous}" data-rate="${Number(settings.waterPerM3)||0}" data-admin="${Number(settings.waterAdmin)||0}">
  <div class="water-meter-home"><b>${escapeHtml(h.block||"Rumah")}</b><small>Awal: ${previous.toLocaleString("id-ID")} m³</small></div>
  <div class="water-meter-entry"><input class="meter-current" type="number" min="${Number(saved?.previousMeter??previous)}" step="0.001" inputmode="decimal" value="${saved?Number(saved.currentMeter):""}" placeholder="Angka meter akhir" ${saved?"disabled":""}><small class="meter-preview">${saved?(saved.amountNeedsReview?"Meter tersimpan · nominal perlu dilengkapi":"Tersimpan · "+saved.usage+" m³ · "+money(saved.totalAmount)):"Isi angka meter akhir"}</small></div>
  <div class="water-meter-actions"><button class="btn ${saved?"outline":"primary"} small meter-save" type="button" ${saved?"data-edit-mode":"disabled"}>${saved?"Edit":"Simpan"}</button></div>
</div>`;}).join("")||'<div class="empty">Belum ada rumah aktif atau kontrak.</div>'}
  </div>`;
  const importPanel=$("#waterImportPanel"),importForm=$("#waterImportForm");
  let parsedImportRows=[];
  $("#openWaterImport").addEventListener("click",()=>importPanel.classList.toggle("hidden"));
  $("#cancelWaterImport").addEventListener("click",()=>{importPanel.classList.add("hidden");importForm.reset();parsedImportRows=[];$("#waterImportPreview").innerHTML="";$("#confirmWaterImport").disabled=true;});
  $("#waterImportFile").addEventListener("change",async e=>{
    const file=e.target.files?.[0];parsedImportRows=[];$("#confirmWaterImport").disabled=true;$("#waterImportPreview").textContent="Membaca file…";
    if(!file)return;
    try{
      let matrix;
      if(file.name.toLowerCase().endsWith(".csv"))matrix=parseCsvText(await file.text());
      else {const XLSX=await ensureXLSX();const workbook=XLSX.read(await file.arrayBuffer(),{type:"array"});const sheet=workbook.Sheets[workbook.SheetNames[0]];matrix=XLSX.utils.sheet_to_json(sheet,{header:1,defval:""});}
      parsedImportRows=normalizeWaterImportRows(matrix);
      if(!parsedImportRows.length)throw new Error("Tidak ada baris data yang dapat dibaca.");
      const missing=parsedImportRows.filter(x=>!x.headName||x.amount===null||x.previousMeter===null||x.currentMeter===null).length;
      $("#waterImportPreview").innerHTML=`<div class="summary-box"><b>Pratinjau ${parsedImportRows.length} baris</b><p class="tiny muted">${missing} baris memiliki data kosong dan perlu diperiksa. Nominal dari file tidak dihitung ulang.</p><div class="table-wrap"><table><thead><tr><th>Blok</th><th>Nama</th><th>Meter awal</th><th>Meter akhir</th><th>Pemakaian</th><th>Tagihan</th></tr></thead><tbody>${parsedImportRows.slice(0,12).map(x=>`<tr><td>${escapeHtml(x.block)}</td><td>${escapeHtml(x.headName||"Belum dilengkapi")}</td><td>${x.previousMeter??"—"}</td><td>${x.currentMeter??"—"}</td><td>${x.usage??"—"}</td><td>${x.amount===null?"—":money(x.amount)}</td></tr>`).join("")}</tbody></table></div>${parsedImportRows.length>12?'<small class="muted tiny">Menampilkan 12 baris pertama dari seluruh data.</small>':""}</div>`;
      $("#confirmWaterImport").disabled=false;
    }catch(err){$("#waterImportPreview").textContent="Gagal membaca file: "+err.message;toast("Gagal membaca file impor.");}
  });
  importForm.addEventListener("submit",async e=>{
    e.preventDefault();if(!parsedImportRows.length)return;
    const period=new FormData(importForm).get("period");
    if(!confirm(`Impor ${parsedImportRows.length} rumah/blok untuk periode ${period}? Proses ini hanya dapat dilakukan sekali per periode dan tidak menimpa tagihan air yang sudah ada.`))return;
    const button=$("#confirmWaterImport");button.disabled=true;button.textContent="Mengimpor…";
    try{
      const result=await importWaterStatement({period,rows:parsedImportRows,recordedBy:currentUser?.uid});
      households=await getHouseholds();householdsLoadedAt=Date.now();
      toast(`Impor selesai: ${result.created} rumah baru, ${result.matched} rumah cocok, ${result.charges} tagihan air. Daftar publik diperbarui.`);
      await render();
    }catch(err){toast("Impor gagal: "+err.message);button.disabled=false;button.textContent="Impor ke Firebase";}
  });
  c.querySelectorAll(".water-meter-line").forEach(row=>{
    const input=row.querySelector(".meter-current");if(!input)return;
    const button=row.querySelector(".meter-save"),wasSaved=input.disabled,previous=Number(input.min||row.dataset.previous),rate=Number(row.dataset.rate),admin=Number(row.dataset.admin);
    const preview=()=>{const current=Number(input.value),valid=input.value!==""&&Number.isFinite(current)&&current>=previous,usage=valid?current-previous:0;row.querySelector(".meter-preview").textContent=valid?"Pemakaian "+usage.toLocaleString("id-ID")+" m³ · Tagihan "+money(admin+Math.round(usage*rate)):input.value&&current<previous?"Angka tidak boleh lebih kecil dari meter awal":"Isi angka meter akhir";button.disabled=!valid;input.setCustomValidity(input.value!==""&&current<previous?"Meter akhir tidak boleh lebih kecil dari meter awal.":"");};
    input.addEventListener("input",preview);
    button.addEventListener("click",async()=>{if(button.hasAttribute("data-edit-mode")&&input.disabled){input.disabled=false;button.textContent="Simpan koreksi";input.focus();preview();return;}if(!input.reportValidity())return;button.disabled=true;button.textContent="…";try{const payload={period,householdId:row.dataset.house,currentMeter:input.value,recordedBy:currentUser?.uid};const result=wasSaved?await editWaterReading(payload):await saveWaterReading(payload);households=await getHouseholds();householdsLoadedAt=Date.now();toast("Meter "+result.usage+" m³ tersimpan. Tagihan "+money(result.totalAmount)+" · daftar tunggakan diperbarui.");await render();}catch(err){toast("Gagal menyimpan meter: "+err.message);button.disabled=false;button.textContent=wasSaved?"Simpan koreksi":"Simpan";}});
  });
}
async function renderCategory(c,cat){
  const [bal,monthly,position,settings,arrearsLedger]=await Promise.all([
    read(`category_balances/${cat}`),
    read("financeSummaryByMonth"),
    getFinancialPosition(),
    getBillingSettings(),
    read("arrearsLedger")
  ]);
  const balance={...(bal||{}),deposit:position[cat].depositLiability,cashBalance:position[cat].cashBalance,availableBalance:position[cat].availableBalance,advance:position[cat].advanceLiability},period=monthKey(),year=Number(period.slice(0,4));
  const goLive=/^\d{4}-(0[1-9]|1[0-2])$/.test(settings.goLivePeriod||"")?settings.goLivePeriod:`${year}-01`;
  const yearStart=`${year}-01`;
  const firstPeriod=goLive>yearStart?goLive:yearStart;
  const firstMonth=Number(firstPeriod.slice(5,7));
  const lastMonth=Number(period.slice(5,7));
  const monthDue={};
  for(const ledger of Object.values(arrearsLedger||{})){
    for(const [key,row] of Object.entries(ledger||{})){
      if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(key)||key>period)continue;
      const amount=Math.max(0,Number(row?.[cat])||0);
      if(amount>0)monthDue[key]=(monthDue[key]||0)+amount;
    }
  }
  const due=Object.values(monthDue).reduce((sum,n)=>sum+n,0);
  const dueRows=Object.entries(monthDue).sort(([a],[b])=>a.localeCompare(b));
  const labels={kas:"Kas RT",sampah:"Uang Sampah",air:"Uang Air"};
  const monthNames=["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
  const activeKeys=Array.from({length:Math.max(0,lastMonth-firstMonth+1)},(_,i)=>`${year}-${String(firstMonth+i).padStart(2,"0")}`);
  const activeIncome=activeKeys.reduce((sum,key)=>sum+(Number(monthly?.[key]?.byCategory?.[cat]?.income)||0),0);
  const activeExpenses=activeKeys.reduce((sum,key)=>sum+(Number(monthly?.[key]?.byCategory?.[cat]?.expenses)||0),0);
  const opening=balance.availableBalance-activeIncome+activeExpenses;
  let running=opening,totalIn=0,totalOut=0;
  const rows=activeKeys.map(key=>{
    const monthIndex=Number(key.slice(5,7))-1,name=monthNames[monthIndex];
    const data=monthly?.[key]?.byCategory?.[cat]||{};
    const income=Math.max(0,Number(data.income)||0),expense=Math.max(0,Number(data.expenses)||0);
    const start=running,end=start+income-expense;
    running=end;totalIn+=income;totalOut+=expense;
    return `<tr><td><b>${name}</b></td><td class="amount">${money(start)}</td><td class="amount income-value">${money(income)}</td><td class="amount expense-value">${money(expense)}</td><td class="amount">${money(end)}</td></tr>`;
  }).join("");
  const ledgerRows=rows||'<tr><td colspan="5" class="empty">Belum ada periode pembukuan aktif pada tahun ini.</td></tr>';
  const stats=`<div class="grid stats">${card("Dana bebas saat ini",money(balance.availableBalance),"Setelah dikurangi kewajiban")}${card("Uang kas/bank",money(balance.cashBalance),"Saldo uang nyata")}${card("Penerimaan dialokasikan",money(activeIncome))}${card("Pengeluaran tercatat",money(activeExpenses))}${card("Deposit Air",money(balance.deposit))}${card("Uang muka",money(balance.advance))}</div>
  <div class="section-head"><div><h3>Total Tunggakan sampai ${period}</h3><p class="tiny muted">Akumulasi sisa kewajiban ${labels[cat]} sejak awal pembukuan digital</p></div><span class="pill warning">${money(due)}</span></div>
  <div class="table-wrap" style="margin-bottom:16px"><table><thead><tr><th>Periode tunggakan</th><th>Sisa belum dibayar</th></tr></thead><tbody>${dueRows.map(([key,amount])=>`<tr><td>${key}</td><td class="amount">${money(amount)}</td></tr>`).join("")||'<tr><td colspan="2" class="empty">Tidak ada tunggakan sejak awal pembukuan.</td></tr>'}</tbody><tfoot><tr><th>Total sampai ${period}</th><th class="amount">${money(due)}</th></tr></tfoot></table></div>`;
  const ledger=`<section class="panel monthly-ledger">
    <div class="section-head ledger-heading"><div><h3>Mutasi bulanan ${year}</h3><p class="tiny muted">Periode aktif: ${firstPeriod} sampai ${period}. Dana bebas berjalan ke bulan berikutnya.</p></div><span class="pill">${firstPeriod} – ${period}</span></div>
    <div class="table-wrap"><table class="ledger-table"><thead><tr><th>Bulan</th><th>Saldo awal</th><th>Pemasukan</th><th>Pengeluaran</th><th>Saldo akhir</th></tr></thead><tbody>${ledgerRows}<tr class="ledger-total"><td><b>Akumulasi periode aktif</b></td><td class="amount">${money(opening)}</td><td class="amount income-value">${money(totalIn)}</td><td class="amount expense-value">${money(totalOut)}</td><td class="amount">${money(running)}</td></tr></tbody></table></div>
    <p class="tiny muted ledger-note">Periode sebelum bulan mulai aplikasi tidak ditampilkan sebagai mutasi digital. Saldo awal dihitung dari dana bebas saat ini dikurangi penerimaan yang sudah dialokasikan dan ditambah pengeluaran sejak periode aktif.</p>
  </section>`;
  c.innerHTML=stats+ledger+`<div class="muted-note">${labels[cat]}: mutasi menampilkan transaksi yang sudah masuk ke ringkasan keuangan bulanan. Deposit dan uang muka ditampilkan sebagai kewajiban, bukan pemasukan.${cat==="air"?' Pencatatan angka meter bulanan tersedia di tab Meteran Air.':''}</div>`;
}
async function renderExpenses(c){
  const current=monthKey(); let position=await getFinancialPosition();
  const categoryNames={kas:"Kas RT",air:"Kas Air",sampah:"Kas Sampah"};
  const moneyLine=cat=>`<div class="expense-position-grid"><div><small>Uang kas/bank</small><b>${money(position[cat].cashBalance)}</b></div><div><small>Deposit warga</small><b>${money(position[cat].depositLiability)}</b></div><div><small>Uang muka</small><b>${money(position[cat].advanceLiability)}</b></div><div class="expense-available"><small>Dana bebas</small><b>${money(position[cat].availableBalance)}</b></div></div>`;
  c.innerHTML=`<div class="panel expense-entry-panel">
    <div class="section-head" style="margin-top:0"><div><h3>Catat pengeluaran</h3><p class="tiny muted">Isi data pengeluaran. Sistem akan memeriksa dana bebas sebelum menyimpan.</p></div><span class="pill">Pengeluaran</span></div>
    <form id="expenseForm"><div class="form-grid">
      <label class="field">1. Sumber dana<select name="category" required><option value="kas">Kas RT</option><option value="air">Kas Air</option><option value="sampah">Kas Sampah</option></select></label>
      <label class="field">2. Jumlah pengeluaran (Rp)<input name="amount" type="text" inputmode="numeric" data-rupiah placeholder="Contoh: 50.000" required></label>
      <label class="field">3. Tanggal pengeluaran<input name="date" type="date" value="${new Date().toISOString().slice(0,10)}" required></label>
      <label class="field">4. Keterangan<input name="description" maxlength="180" placeholder="Contoh: pembelian perlengkapan kebersihan" required></label>
      <label class="field full-row">Bukti / nomor kuitansi<input name="proof" maxlength="500" placeholder="Nomor kuitansi atau tautan foto bukti" required><small class="muted tiny">Wajib diisi agar transaksi mudah diperiksa kembali.</small></label>
    </div><div id="expensePosition">${moneyLine("kas")}</div><button class="btn primary full" type="submit">Simpan pengeluaran</button></form>
  </div>
  <div class="panel" style="margin-top:14px"><div class="section-head"><div><h3>Riwayat pengeluaran</h3><p class="tiny muted">Pilih bulan untuk melihat transaksi.</p></div><label class="field">Bulan<input id="expensePeriod" type="month" value="${current}"></label></div><div id="expenseHistory" class="table-wrap">Memuat…</div></div>`;
  bindRupiahInputs($("#expenseForm"));
  const categorySelect=$("#expenseForm").elements.category;
  $("#expensePosition").innerHTML=moneyLine(categorySelect.value);
  categorySelect.addEventListener("change",async()=>{
    try{position=await getFinancialPosition();$("#expensePosition").innerHTML=moneyLine(categorySelect.value);}
    catch(error){toast("Gagal memperbarui saldo kategori: "+error.message);}
  });
  const drawHistory=async()=>{
    const period=$("#expensePeriod").value||current;
    const rows=Object.values(await getExpenses(period)||{}).sort((a,b)=>Number(b.createdAt||0)-Number(a.createdAt||0));
    $("#expenseHistory").innerHTML=`<table><thead><tr><th>Tanggal</th><th>Sumber dana</th><th>Keterangan</th><th>Bukti</th><th>Nominal</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${escapeHtml(x.date||"-")}</td><td>${escapeHtml(categoryNames[x.category]||x.category)}</td><td>${escapeHtml(x.description||"-")}</td><td>${escapeHtml(x.proof||"-")}</td><td class="amount">${money(x.amount)}</td></tr>`).join("")||'<tr><td colspan="5" class="empty">Belum ada pengeluaran pada bulan ini.</td></tr>'}</tbody></table>`;
  };
  await drawHistory();
  $("#expensePeriod").addEventListener("change",drawHistory);
  $("#expenseForm").addEventListener("submit",async e=>{
    e.preventDefault();const f=new FormData(e.currentTarget),button=e.currentTarget.querySelector('button[type="submit"]');
    button.disabled=true;button.textContent="Menyimpan…";
    try{
      position=await getFinancialPosition();
      $("#expensePosition").innerHTML=moneyLine(categorySelect.value);
      const requestedAmount=parseRupiah(f.get("amount"));
      if(requestedAmount>Number(position[categorySelect.value]?.availableBalance||0)){
        throw new Error("Dana bebas terbaru untuk "+(categoryNames[categorySelect.value]||categorySelect.value)+" hanya "+money(position[categorySelect.value]?.availableBalance||0)+". Saldo pada formulir sudah diperbarui; sesuaikan nominal pengeluaran.");
      }
      const saved=await createExpense({category:f.get("category"),amount:requestedAmount,date:f.get("date"),description:f.get("description"),proof:f.get("proof"),recordedBy:currentUser?.uid});
      toast(saved.summarySyncPending?"Pengeluaran tersimpan, tetapi ringkasan bulanan perlu diperiksa. Jangan catat ulang.":"Pengeluaran berhasil disimpan.");
      e.currentTarget.reset();e.currentTarget.elements.date.value=new Date().toISOString().slice(0,10);$("#expensePeriod").value=String(f.get("date")).slice(0,7);
      const latest=await getFinancialPosition();for(const cat of ["kas","air","sampah"])position[cat]=latest[cat];
      $("#expensePosition").innerHTML=moneyLine(categorySelect.value);await drawHistory();
    }catch(err){toast("Gagal menyimpan pengeluaran: "+err.message);}
    finally{button.disabled=false;button.textContent="Simpan pengeluaran";}
  });
}

function renderMasterData(c){
  c.innerHTML=`<div class="grid two">
    <section class="panel"><h3>Hapus data berdasarkan periode</h3><p class="muted">Menghapus transaksi periode terpilih, mengembalikan mutasi deposit pada periode itu, menghitung ulang saldo kategori dari seluruh mutasi tersisa, memperbarui tunggakan, dan membatalkan rekap tahunan dari tahun tersebut ke atas. Data rumah, tarif, serta transaksi periode lain dipertahankan.</p>
      <label class="field">Pilih periode<input id="masterDeletePeriod" type="month" value="${monthKey()}"></label>
      <button class="btn danger" id="deletePeriodBtn" type="button">Hapus data periode</button>
    </section>
    <section class="panel danger-panel"><h3>Hapus seluruh database aplikasi</h3><p>PERMANEN. Menghapus data rumah, semua tagihan, pembayaran, deposit, saldo kategori, meter air, transaksi, ringkasan, pengaturan tarif/saldo awal, dan tampilan publik. Riwayat audit dan akun Firebase Authentication tidak dihapus.</p>
      <label class="check-row"><input type="checkbox" id="masterAllCheck"><span>Saya memahami seluruh data operasional aplikasi akan dihapus permanen.</span></label>
      <button class="btn danger" id="deleteAllBtn" type="button" disabled>Hapus semua data aplikasi</button>
    </section>
  </div>
  <div class="muted-note" style="margin-top:16px"><b>Pengaman:</b> setiap penghapusan meminta password akun Firebase yang sedang login, lalu konfirmasi teks khusus. Tindakan tidak dapat dibatalkan. Disarankan ekspor/backup data sebelum menghapus.</div>`;
  $("#masterAllCheck").addEventListener("change",e=>$("#deleteAllBtn").disabled=!e.target.checked);
  $("#deletePeriodBtn").addEventListener("click",()=>runMasterDelete("period"));
  $("#deleteAllBtn").addEventListener("click",()=>runMasterDelete("all"));
}
async function runMasterDelete(mode){
  const period=$("#masterDeletePeriod")?.value||"";
  const phrase=mode==="all"?"HAPUS SEMUA DATA":"HAPUS "+period;
  const label=mode==="all"?"SELURUH DATABASE APLIKASI":`DATA PERIODE ${period}`;
  const dlg=$("#genericDialog"),box=$("#dialogContent");
  box.innerHTML=`<h3>Konfirmasi penghapusan</h3><p class="error">Anda akan menghapus <b>${label}</b>. Tindakan ini permanen dan tidak dapat dibatalkan.</p>
    <form id="masterConfirmForm" class="form-stack">
      <label class="field">Ketik <b>${phrase}</b> untuk melanjutkan<input name="phrase" autocomplete="off" required></label>
      <label class="field">Masukkan ulang password Firebase<input name="password" type="password" autocomplete="current-password" required></label>
      <p class="muted tiny">Password diverifikasi ulang ke Firebase Authentication sebelum penghapusan.</p>
      <div class="form-actions"><button type="button" class="btn outline" id="cancelMasterDelete">Batal</button><button type="submit" class="btn danger">Konfirmasi hapus</button></div>
      <p id="masterDeleteError" class="error" role="alert"></p>
    </form>`;
  dlg.showModal();
  $("#cancelMasterDelete").addEventListener("click",()=>dlg.close());
  $("#masterConfirmForm").addEventListener("submit",async e=>{
    e.preventDefault();const form=e.currentTarget,fd=new FormData(form);
    if(String(fd.get("phrase")||"").trim()!==phrase){$("#masterDeleteError").textContent="Teks konfirmasi tidak cocok.";return;}
    const btn=form.querySelector('button[type="submit"]');btn.disabled=true;btn.textContent="Memverifikasi…";
    try{
      await reauthenticate(String(fd.get("password")||""));
      await deleteMasterData({mode,period,recordedBy:currentUser?.uid});
      dlg.close();toast(mode==="all"?"Seluruh data aplikasi berhasil dihapus.":"Data periode berhasil dihapus.");
      households=await getHouseholds();householdsLoadedAt=Date.now();page="masterData";await render();
    }catch(err){$("#masterDeleteError").textContent="Penghapusan gagal: "+err.message;btn.disabled=false;btn.textContent="Konfirmasi hapus";}
  });
}
async function renderTransactions(c){
  const current=monthKey(),currentYear=Number(current.slice(0,4));
  const [monthly,balances,settings]=await Promise.all([read("financeSummaryByMonth"),read("category_balances"),getBillingSettings()]);
  const goLive=/^\d{4}-(0[1-9]|1[0-2])$/.test(settings?.goLivePeriod||"")?settings.goLivePeriod:`${currentYear}-01`;
  const years=[...new Set([currentYear,...Object.keys(monthly||{}).filter(validPeriod).map(p=>Number(p.slice(0,4)))])].filter(y=>y>=Number(goLive.slice(0,4))&&y<=currentYear).sort((a,b)=>b-a);
  const categories=["kas","air","sampah"],labels={kas:"Kas RT",air:"Air",sampah:"Sampah",lainnya:"Lainnya"};
  const monthNames=["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
  c.innerHTML=`<section class="panel"><div class="section-head"><div><h3>Rekap mutasi bulanan</h3><p class="tiny muted">Pemasukan diringkas per kategori. Pengeluaran diringkas berdasarkan keterangan transaksi.</p></div><label class="field">Tahun<select id="transactionYear">${years.map(y=>`<option value="${y}" ${y===currentYear?"selected":""}>${y}</option>`).join("")}</select></label></div><div id="transactionHistory" class="table-wrap">Memuat rekap…</div></section>`;
  const host=$("#transactionHistory");
  const draw=()=>{
    const year=Number($("#transactionYear").value),yearStart=`${year}-01`,yearEnd=year===currentYear?current:`${year}-12`,periods=[];
    for(let p=yearStart;p<=yearEnd;p=nextMonth(p))if(p>=goLive)periods.push(p);
    const baseOpening=categories.reduce((sum,cat)=>sum+(Number(balances?.[cat]?.openingBalance??settings?.openingBalances?.[cat])||0),0);
    const netBefore=Object.entries(monthly||{}).filter(([p])=>validPeriod(p)&&p>=goLive&&p<yearStart).reduce((sum,[,row])=>sum+(Number(row?.income)||0)-(Number(row?.expenses)||0),0);
    let running=baseOpening+netBefore,totalIncome=0,totalExpense=0;
    const detailList=(items,type)=>{
      const grouped=new Map();
      for(const item of Object.values(items||{})){
        const desc=String(item.description||(type==="income"?"Pemasukan":"Pengeluaran")),category=labels[item.category]||labels.lainnya;
        const key=type==="expense"?desc+"|"+category:category,old=grouped.get(key)||{description:type==="income"?category:desc,category,amount:0,count:0};
        old.amount+=Math.max(0,Number(item.amount)||0);old.count++;grouped.set(key,old);
      }
      return [...grouped.values()].sort((a,b)=>b.amount-a.amount);
    };
    const detailTable=(title,items)=>`<div class="panel" style="margin:8px 0"><b>${title}</b><div class="table-wrap"><table><thead><tr><th>Keterangan</th><th>Kategori</th><th>Jumlah transaksi</th><th>Nominal</th></tr></thead><tbody>${items.map(x=>`<tr><td>${escapeHtml(x.description)}</td><td>${escapeHtml(x.category)}</td><td>${x.count}</td><td class="amount">${money(x.amount)}</td></tr>`).join("")||'<tr><td colspan="4" class="empty">Tidak ada rincian.</td></tr>'}</tbody></table></div></div>`;
    const rows=periods.map(period=>{
      const row=monthly?.[period]||{},start=running,income=Math.max(0,Number(row.income)||0),expense=Math.max(0,Number(row.expenses)||0),end=start+income-expense;
      running=end;totalIncome+=income;totalExpense+=expense;
      const incomeByCategory=categories.map(cat=>({category:labels[cat],amount:Math.max(0,Number(row.byCategory?.[cat]?.income)||0)})).filter(x=>x.amount>0);
      const expenseByCategory=categories.map(cat=>({category:labels[cat],amount:Math.max(0,Number(row.byCategory?.[cat]?.expenses)||0)})).filter(x=>x.amount>0);
      const incomeItems=detailList(row.incomeItems,"income"),expenseItems=detailList(row.expenseItems,"expense"),month=monthNames[Number(period.slice(5,7))-1];
      const incomeBreakdown=incomeByCategory.map(x=>`<span class="pill">${x.category}: <b>${money(x.amount)}</b></span>`).join(" ")||'<span class="muted tiny">Belum ada pemasukan</span>';
      const expenseBreakdown=expenseByCategory.map(x=>`<span class="pill">${x.category}: <b>${money(x.amount)}</b></span>`).join(" ")||'<span class="muted tiny">Belum ada pengeluaran</span>';
      return `<tr><td><b>${month}</b></td><td class="amount">${money(start)}</td><td class="amount income-value">${money(income)}</td><td class="amount expense-value">${money(expense)}</td><td class="amount"><b>${money(end)}</b></td></tr><tr><td colspan="5"><details class="transaction-month-detail"><summary>Lihat rincian ${month} · Pemasukan ${money(income)} · Pengeluaran ${money(expense)}</summary><div class="grid stats" style="margin:10px 0"><div class="stat"><div class="label">Pemasukan per kategori</div><div class="value">${incomeBreakdown}</div></div><div class="stat"><div class="label">Pengeluaran per kategori</div><div class="value">${expenseBreakdown}</div></div></div>${detailTable("Rincian pemasukan",incomeItems)}${detailTable("Rincian pengeluaran",expenseItems)}<p class="tiny muted">Saldo akhir bulan ini: <b>${money(end)}</b>. Saldo tersebut menjadi saldo awal bulan berikutnya.</p></details></td></tr>`;
    }).join("");
    host.innerHTML=`<table><thead><tr><th>Bulan</th><th>Saldo awal</th><th>Total pemasukan</th><th>Total pengeluaran</th><th>Saldo akhir</th></tr></thead><tbody>${rows||'<tr><td colspan="5" class="empty">Belum ada mutasi pada tahun ini.</td></tr>'}<tr class="ledger-total"><td><b>Total tahun ${year}</b></td><td class="amount">${money(baseOpening+netBefore)}</td><td class="amount income-value">${money(totalIncome)}</td><td class="amount expense-value">${money(totalExpense)}</td><td class="amount"><b>${money(running)}</b></td></tr></tbody></table><p class="tiny muted" style="margin-top:10px">Klik “Lihat rincian” pada setiap bulan untuk melihat sumber pemasukan dan keterangan pengeluaran. Transaksi asli tetap tersimpan; yang diringkas hanya tampilannya.</p>`;
  };
  $("#transactionYear").addEventListener("change",draw);draw();
}

async function renderReports(c){
  const [sums,archives,journals,arrears,deposits,billingSettings]=await Promise.all([read("category_balances"),read("annual_summaries"),read("journal_entries"),read("arrearsLedger"),read("deposits"),getBillingSettings()]);
  const currentYear=new Date().getFullYear();
  const years=[...new Set([...Object.keys(archives||{}).map(Number),currentYear])].filter(y=>Number.isInteger(y)&&y>=2000&&y<=currentYear).sort((a,b)=>b-a);
  const options=years.map(y=>`<option value="${y}">${y}</option>`).join("");
  c.innerHTML=`<div class="section-head"><div><h3>Laporan Tahunan</h3><p class="tiny muted">Rekap ringkas per tahun agar laporan historis tidak perlu membaca seluruh transaksi.</p></div><span class="pill">Admin</span></div>
    <div class="panel"><div class="toolbar"><label class="field">Pilih tahun<select id="annualReportYear">${options}</select></label><button type="button" class="btn primary" id="buildAnnualReportBtn">Buat / Perbarui Rekap Tahun</button></div><p class="tiny muted" id="annualReportStatus">Rekap tahunan disimpan terpisah. Data transaksi asli tetap dipertahankan.</p></div>
    <div id="annualReportContent" class="panel" style="margin-top:14px">Memuat rekap…</div>
    <div id="doubleEntryReport" class="panel" style="margin-top:14px">Memuat laporan jurnal…</div>
    <div class="muted-note" style="margin-top:12px">Rekap tahunan menyimpan total pemasukan dan pengeluaran per kategori, saldo operasional hasil perhitungan, serta posisi tunggakan, deposit, dan uang muka pada saat rekap dibuat. Saldo dana bebas dihitung untuk akhir periode yang dipilih. Untuk tahun yang sudah lewat, gunakan rekap tersimpan. Jika ada koreksi transaksi lama, buat ulang rekap tahun terkait.</div>`;
  const draw=async()=>{
    const year=$("#annualReportYear").value;
    const row=await read(`annual_summaries/${year}`);
    const host=$("#annualReportContent");
    if(!row){host.innerHTML='<p class="muted">Belum ada rekap tahun ini. Klik “Buat / Perbarui Rekap Tahun”.</p>';return;}
    const names={kas:"Kas RT",sampah:"Uang Sampah",air:"Uang Air"};
    const legacySummary=Number(row.version||1)<3?'<div class="muted-note" style="margin-bottom:12px">Rekap ini dibuat dengan rumus lama. Klik “Buat / Perbarui Rekap Tahun” untuk menghitung ulang saldo bebas dan kewajiban uang muka.</div>':"";
    host.innerHTML=legacySummary+`<div class="section-head"><h3>Rekap Keuangan ${row.year}</h3><span class="pill">Dibuat ${new Date(row.generatedAt).toLocaleString("id-ID")}</span></div>
      <div class="grid category-grid">${["kas","sampah","air"].map(cat=>{const x=row.byCategory?.[cat]||{};return `<div class="category-card"><h4>${names[cat]}</h4><div class="balance">${money(x.closingOperatingBalance)}</div><div class="muted tiny">Dana bebas akhir tahun</div><div class="metric-row"><span>Penerimaan dialokasikan</span><b>${money(x.income)}</b></div><div class="metric-row"><span>Pengeluaran</span><b>${money(x.expenses)}</b></div><div class="metric-row"><span>Deposit Air</span><b>${money(x.depositLiability)}</b></div><div class="metric-row"><span>Uang muka</span><b>${money(x.advanceLiability)}</b></div></div>`;}).join("")}</div>
      <div class="table-wrap"><table><thead><tr><th>Kategori</th><th>Saldo awal</th><th>Pemasukan</th><th>Pengeluaran</th><th>Saldo akhir operasional</th><th>Deposit Air (saat rekap)</th><th>Uang muka (saat rekap)</th></tr></thead><tbody>${["kas","sampah","air"].map(cat=>{const x=row.byCategory?.[cat]||{};return `<tr><td>${names[cat]}</td><td class="amount">${money(x.openingBalance)}</td><td class="amount">${money(x.income)}</td><td class="amount">${money(x.expenses)}</td><td class="amount">${money(x.closingOperatingBalance)}</td><td class="amount">${money(x.depositLiability)}</td><td class="amount">${money(x.advanceLiability)}</td></tr>`;}).join("")}</tbody></table></div>
      <div class="grid stats" style="margin-top:14px">${card("Total tunggakan saat rekap",money(row.arrearsAtSnapshot?.total),"Posisi saat rekap dibuat")}${card("Total deposit Air",money(row.depositLiabilityAtSnapshot),"Kewajiban warga")}${card("Uang muka",money(row.advanceLiabilityAtSnapshot),"Belum diterapkan ke tagihan")}${card("Dana bebas saat rekap",money(row.operatingBalanceAtSnapshot),"Setelah seluruh kewajiban")}</div>`;
  };
  $("#annualReportYear").addEventListener("change",draw);
  $("#buildAnnualReportBtn").addEventListener("click",async()=>{
    const button=$("#buildAnnualReportBtn");button.disabled=true;button.textContent="Menyimpan rekap…";
    try{const result=await buildAnnualSummary($("#annualReportYear").value,currentUser?.uid);$("#annualReportStatus").textContent="Rekap "+result.year+" tersimpan dan dikonfirmasi Firebase.";toast("Rekap tahunan berhasil disimpan.");await draw();}
    catch(error){$("#annualReportStatus").textContent="Gagal membuat rekap: "+error.message;toast("Rekap gagal: "+error.message);}
    finally{button.disabled=false;button.textContent="Buat / Perbarui Rekap Tahun";}
  });
  await draw();
  const accountingHost=$("#doubleEntryReport");
  const drawAccounting=()=>{
    const year=$("#annualReportYear").value,flow=cashFlow(journals||{},{from:(archives?.[year]?.periodStart||(billingSettings?.goLivePeriod>year+"-01"?billingSettings.goLivePeriod:year+"-01")),to:(archives?.[year]?.periodEnd||year+"-12")}),tb=trialBalance(journals||{}),ledger=summarizeLedger(journals||{});
    const accountBalance=key=>Number(ledger.accounts[key]?.balance)||0;
    const receivable=["kas","air","sampah"].reduce((n,cat)=>n+Math.max(0,accountBalance("asset.receivable."+cat)),0);
    const depositLiability=["kas","air","sampah"].reduce((n,cat)=>n+Math.max(0,-accountBalance("liability.deposit."+cat)),0);
    const advanceLiability=["kas","sampah"].reduce((n,cat)=>n+Math.max(0,-accountBalance("liability.advance."+cat)),0);
    accountingHost.innerHTML=`<div class="section-head"><div><h3>Pembukuan Akrual · Jurnal Debit/Kredit</h3><p class="tiny muted">Tagihan bukan penerimaan kas. Laporan dihitung dari jurnal yang diposting.</p></div><span class="pill ${tb.balanced?"success":"danger"}">${tb.balanced?"Seimbang":"Tidak seimbang"}</span></div>
      <div class="grid stats"><div class="stat"><div class="label">Kas masuk ${year}</div><div class="value">${money(flow.inflow)}</div></div><div class="stat"><div class="label">Kas keluar ${year}</div><div class="value">${money(flow.outflow)}</div></div><div class="stat"><div class="label">Piutang</div><div class="value">${money(receivable)}</div></div><div class="stat"><div class="label">Utang deposit</div><div class="value">${money(depositLiability)}</div></div><div class="stat"><div class="label">Uang muka belum diterapkan</div><div class="value">${money(advanceLiability)}</div></div></div>
      <div class="summary-box" style="margin:14px 0"><div class="summary-line"><span>Arus kas bersih ${year}</span><b>${money(flow.net)}</b></div><div class="summary-line"><span>Total debit</span><b>${money(tb.totalDebit)}</b></div><div class="summary-line"><span>Total kredit</span><b>${money(tb.totalCredit)}</b></div></div>
      <h4>Neraca saldo per akun</h4><div class="table-wrap"><table><thead><tr><th>Akun</th><th>Debit</th><th>Kredit</th><th>Saldo (D-K)</th></tr></thead><tbody>${tb.rows.map(x=>`<tr><td>${x.account}</td><td class="amount">${money(x.debit)}</td><td class="amount">${money(x.credit)}</td><td class="amount">${money(x.balance)}</td></tr>`).join("")||'<tr><td colspan="4">Belum ada jurnal.</td></tr>'}</tbody><tfoot><tr><th>Total</th><th>${money(tb.totalDebit)}</th><th>${money(tb.totalCredit)}</th><th>—</th></tr></tfoot></table></div>
      <p class="tiny muted" style="margin-top:12px">Piutang dan deposit dihitung dari jurnal terposting. Pastikan saldo awal dan koreksi meter juga telah dijurnal agar laporan lengkap.</p>`;
  };
  drawAccounting();
  $("#annualReportYear").addEventListener("change",drawAccounting);
}
render();
