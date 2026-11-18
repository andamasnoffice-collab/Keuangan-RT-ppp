import { firebaseConfigured, db } from "./firebase.js";
import { onValue, ref } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";
import { login, logout, observeSession, reauthenticate } from "./auth.js";
import { getHouseholds, getMonthBills, getPayments, getExpenses, saveHousehold, createRecord, read, getPublicDashboard, getPublicBills, publishPublicSnapshot, refreshPublicSnapshot, getBillingSettings, saveBillingSettings, createExpense, createMonthlyBills, saveWaterReading, editWaterReading, getMonthTransactions, importWaterStatement, deleteMasterData } from "./data.js?v=20261118-arrears-ledger1";
import { renderPaymentPage } from "./payments.js?v=20261118-4";
import { renderWhatsAppPage } from "./whatsapp.js";

const $ = s => document.querySelector(s);
const money = n => "Rp " + new Intl.NumberFormat("id-ID",{maximumFractionDigits:0}).format(Number(n)||0);
const parseRupiah = value => Number(String(value??"").replace(/[^0-9-]/g,"")) || 0;
const formatRupiahInput = value => String(value??"").replace(/[^0-9]/g,"").replace(/\B(?=(\d{3})+(?!\d))/g,".");
function bindRupiahInputs(root){root.querySelectorAll("input[data-rupiah]").forEach(input=>{input.value=formatRupiahInput(input.value);input.addEventListener("input",()=>{const start=input.selectionStart;const before=input.value;input.value=formatRupiahInput(before);try{input.setSelectionRange(input.value.length,input.value.length);}catch{}});});}
const monthKey = () => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`; };
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
function categoryCard(name,balance,income,expense,deposit){return `<div class="category-card"><h4>${name}</h4><div class="balance">${money(balance)}</div><div class="muted tiny">Saldo operasional</div><div class="metric-row"><span>Pemasukan</span><b>${money(income)}</b></div><div class="metric-row"><span>Pengeluaran</span><b>${money(expense)}</b></div><div class="metric-row"><span>Deposit warga</span><b>${money(deposit)}</b></div></div>`;}
async function render(){
  if(!currentUser){ renderGuestPage(); return; }
  const names={dashboard:"Dashboard",publicBills:"Daftar Tagihan",households:"Rumah & Warga",payments:"Pembayaran",deposits:"Deposit Warga",kas:"Kas RT",sampah:"Uang Sampah",air:"Uang Air",waterMeters:"Meteran Air",expenses:"Pengeluaran",transactions:"Semua Transaksi",reports:"Laporan",whatsapp:"WhatsApp Tagihan",users:"Pengguna",settings:"Pengaturan",masterData:"Master Data"};
  title(names[page]||"Dashboard");
  const c=$("#pageContent");
  c.innerHTML='<div class="panel">Memuat data…</div>';
  try{
    if(!householdsLoadedAt || Date.now()-householdsLoadedAt>60000){households=await getHouseholds();householdsLoadedAt=Date.now();}
    if(page==="dashboard") await renderDashboard(c);
    else if(page==="publicBills") await renderPublicBills(c, true);
    else if(page==="households") renderHouseholds(c);
    else if(page==="payments") await renderPaymentPage(c,{households,monthKey:monthKey(),money,toast,currentUser});
    else if(page==="deposits") await renderDeposits(c);
    else if(["kas","sampah","air"].includes(page)) await renderCategory(c,page);
    else if(page==="waterMeters") await renderWaterMeters(c);
    else if(page==="expenses") await renderExpenses(c);
    else if(page==="transactions") await renderTransactions(c);
    else if(page==="reports") await renderReports(c);
    else if(page==="whatsapp") await renderWhatsAppPage(c,{households,currentUser,currentProfile,toast});
    else if(page==="users") c.innerHTML='<div class="muted-note">Semua akun yang berhasil login memiliki hak pengelolaan yang sama. Penambahan akun dilakukan melalui Firebase Authentication oleh pemilik proyek.</div>';
    else if(page==="settings") await renderSettings(c);
    else if(page==="masterData") renderMasterData(c);
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
        <div class="full-row"><h4>Saldo awal operasional</h4><p class="muted tiny">Isi saldo awal kas, air, dan sampah. Perubahan saldo awal berikutnya menyesuaikan saldo berjalan berdasarkan selisihnya.</p></div>
        ${field("Saldo awal Kas RT","openingKas",settings.openingBalances?.kas,"Saldo awal kas RT.")}
        ${field("Saldo awal Kas Air","openingAir",settings.openingBalances?.air,"Saldo awal khusus pengelolaan air.")}
        ${field("Saldo awal Sampah","openingSampah",settings.openingBalances?.sampah,"Saldo awal dana sampah.")}
      </div>
      <div class="summary-box" style="margin:8px 0 16px"><b>Rumus tagihan air</b><p class="tiny muted">Administrasi air + (pemakaian m³ × tarif per m³).</p><p class="tiny muted">Kas RT dan sampah menggunakan nominal tetap per rumah setiap bulan.</p></div>
      <button class="btn primary" type="submit">Simpan pengaturan tarif</button>
      <span id="settingsSavedAt" class="muted tiny" style="margin-left:10px">${settings.updatedAt?`Terakhir diubah: ${new Date(settings.updatedAt).toLocaleString("id-ID")}`:"Belum pernah disimpan"}</span>
      </form>
    </div>
    <div class="muted-note" style="margin-top:14px">Catatan: perubahan tarif tidak boleh menimpa tagihan bulan yang sudah terbentuk. Pengaturan ini menyimpan tarif ke Firebase; proses pembentukan tagihan bulanan otomatis dan pencatatan meter air merupakan tahap implementasi terpisah.</div>`;
  bindRupiahInputs($("#billingSettingsForm"));
  $("#billingSettingsForm").addEventListener("submit",async e=>{
    e.preventDefault(); const f=new FormData(e.currentTarget);
    const values=Object.fromEntries(["kasMonthly","sampahMonthly","waterAdmin","waterPerM3","openingKas","openingAir","openingSampah"].map(k=>[k,parseRupiah(f.get(k))]));
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
  const d=await getPublicDashboard();
  if(!d){
    c.innerHTML='<div class="panel"><h3>Dashboard Keuangan RT</h3><p class="muted">Ringkasan publik belum dipublikasikan oleh pengurus.</p><p class="tiny muted">Informasi keuangan akan muncul setelah pengurus menerbitkan ringkasan.</p></div>';
    return;
  }
  const cats=d.categories||{};
  const fmt=n=>money(n);
  const cardButton=(id,label,value,sub)=>`<button type="button" class="stat stat-button" data-finance-detail="${id}"><div class="label">${label}</div><div class="value">${fmt(value)}</div><div class="sub">${sub||"Klik untuk rincian bulanan"}</div></button>`;
  c.innerHTML=`
    <div class="grid stats">
      ${card("Rumah terdaftar",Number(d.householdCount)||0,"Jumlah rumah")}
      ${card("Rumah dengan tunggakan",Number(d.outstandingHouseholds)||0,"Seluruh periode")}
      ${card("Total tunggakan",fmt(d.totalOutstanding),"Akumulasi lintas tahun")}
      ${card("Saldo operasional total",fmt(["kas","sampah","air"].reduce((s,k)=>s+(Number(cats[k]?.balance)||0),0)),"Seluruh kategori")}
    </div>
    <div class="section-head"><h3>Saldo operasional per kategori</h3><span class="pill">Hanya lihat</span></div>
    <div class="grid stats">
      ${cardButton("kas","Saldo Kas RT",cats.kas?.balance,"Klik untuk rincian pemasukan & pengeluaran")}
      ${cardButton("air","Saldo Air",cats.air?.balance,"Klik untuk rincian pemasukan & pengeluaran")}
      ${cardButton("sampah","Saldo Sampah",cats.sampah?.balance,"Klik untuk rincian pemasukan & pengeluaran")}
    </div>
    <div class="grid stats">
      ${cardButton("income","Total pemasukan",Object.values(d.financeByMonth||{}).reduce((s,m)=>s+(Number(m.totals?.income)||0),0),"Klik untuk daftar pemasukan per bulan")}
      ${cardButton("expenses","Total pengeluaran",Object.values(d.financeByMonth||{}).reduce((s,m)=>s+(Number(m.totals?.expenses)||0),0),"Klik untuk daftar pengeluaran per bulan")}
    </div>
    <div id="publicFinanceDetail" class="panel" hidden></div>
    <div class="section-head"><h3>Informasi publik</h3><span class="pill">Transparansi RT</span></div>
    <div class="muted-note">Warga dapat melihat saldo operasional dan rincian arus kas. Nama warga, nomor telepon, anggota keluarga, bukti pembayaran pribadi, serta deposit per rumah tidak dipublikasikan.</div>
    <div class="tiny muted">Pembaruan terakhir: ${d.updatedAt?new Date(d.updatedAt).toLocaleString("id-ID"):"-"}</div>
    <button class="btn secondary" id="guestViewBills">Lihat daftar tunggakan</button>`;
  document.querySelectorAll("[data-finance-detail]").forEach(btn=>{
    btn.addEventListener("click",()=>showPublicFinanceDetail(btn.dataset.financeDetail,d));
  });
  $("#guestViewBills").onclick=()=>{page="publicBills";document.querySelectorAll(".nav-item").forEach(x=>x.classList.toggle("active",x.dataset.page===page));renderGuestPage();};
}

function showPublicFinanceDetail(kind, dashboard){
  const panel=$("#publicFinanceDetail");
  const months=dashboard.financeByMonth||{};
  const monthKeys=Object.keys(months).sort().reverse();
  const titleText=kind==="income"?"Rincian pemasukan":kind==="expenses"?"Rincian pengeluaran":`Arus kas kategori ${kind.toUpperCase()}`;
  panel.hidden=false;
  panel.innerHTML=`<div class="section-head"><h3>${titleText}</h3><button type="button" class="btn outline" id="closePublicDetail">Tutup</button></div>
    <label class="field">Pilih bulan<select id="publicFinanceMonth">${monthKeys.map(m=>`<option value="${m}">${m}</option>`).join("")||'<option value="">Belum ada data</option>'}</select></label>
    <div id="publicFinanceRows"></div>`;
  $("#closePublicDetail").onclick=()=>{panel.hidden=true;};
  const draw=()=>{
    const month=$("#publicFinanceMonth").value;
    const bucket=months[month]||{income:[],expenses:[],totals:{}};
    const list=kind==="income"?bucket.income:kind==="expenses"?bucket.expenses:[...bucket.income,...bucket.expenses].filter(x=>x.category===kind);
    const rows=list.filter(x=>kind==="income"||kind==="expenses"||x.category===kind);
    const total=rows.reduce((s,x)=>s+(Number(x.amount)||0),0);
    $("#publicFinanceRows").innerHTML=`<div class="grid stats">${card("Jumlah transaksi",rows.length,"Bulan "+(month||"-"))}${card("Total",money(total),kind==="expenses"?"Pengeluaran":"Pemasukan")}</div>
      <div class="table-wrap"><table><thead><tr><th>Tanggal</th><th>Kategori</th><th>Keterangan</th><th>Nominal</th></tr></thead><tbody>
      ${rows.map(x=>`<tr><td>${formatPublicDate(x.date)}</td><td>${escapeHtml(x.category||"-")}</td><td>${escapeHtml(x.description||"-")}</td><td class="amount">${money(x.amount)}</td></tr>`).join("")||'<tr><td colspan="4" class="empty">Belum ada transaksi pada bulan ini.</td></tr>'}
      </tbody></table></div>`;
  };
  $("#publicFinanceMonth").addEventListener("change",draw);
  draw();
}

function formatPublicDate(value){
  if(!value)return "-";
  const d=typeof value==="number"?new Date(value):new Date(value);
  return Number.isNaN(d.getTime())?String(value):d.toLocaleDateString("id-ID");
}

async function renderPublicBills(c, authenticated){
  const rows=await read("public_views/allOutstanding")||{};
  const list=Object.values(rows).sort((a,b)=>(a.label||"").localeCompare(b.label||""));
  const totals=list.reduce((acc,x)=>{
    acc.kas+=Number(x.kas)||0; acc.sampah+=Number(x.sampah)||0; acc.air+=Number(x.air)||0; acc.total+=Number(x.total)||0;
    return acc;
  },{kas:0,sampah:0,air:0,total:0});
  c.innerHTML=`<div class="section-head"><h3>Daftar Tunggakan</h3><span class="pill">Akumulasi sampai ${monthKey()}</span></div>
  <div class="grid stats">
    ${card("Total tunggakan",money(totals.total),"Tagihan berjalan + seluruh tunggakan sebelumnya")}
    ${card("Kas RT",money(totals.kas),"Sisa kewajiban")}
    ${card("Sampah",money(totals.sampah),"Sisa kewajiban")}
    ${card("Air",money(totals.air),"Sisa kewajiban")}
  </div>
  <div class="muted-note">Setiap rumah ditampilkan satu kali. Nominal merupakan akumulasi tagihan bulan berjalan dan seluruh bulan sebelumnya yang belum lunas, setelah dikurangi pembayaran yang sudah tercatat. Tidak menampilkan nama kepala keluarga, nomor telepon, atau anggota keluarga.</div>
  <div id="publicBillTable" class="table-wrap"></div>`;
  $("#publicBillTable").innerHTML=`<table><thead><tr><th>Blok / Rumah</th><th>Kas RT</th><th>Sampah</th><th>Air</th><th>Bulan tertunggak</th><th>Total harus dibayar</th></tr></thead><tbody>
    ${list.map(x=>`<tr><td>${escapeHtml(x.label||"Rumah")}</td><td>${money(x.kas||0)}</td><td>${money(x.sampah||0)}</td><td>${money(x.air||0)}</td><td>${Number(x.periodCount)||0}</td><td class="amount">${money(x.total||0)}</td></tr>`).join("")||'<tr><td colspan="6" class="empty">Tidak ada tunggakan sampai bulan berjalan.</td></tr>'}
    </tbody></table>`;
}

function escapeHtml(value){
  return String(value??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
}

async function renderDashboard(c){
  const balances=await read("category_balances")||{};
  const totals=["kas","sampah","air"].map(k=>balances[k]||{});
  const operating=totals.reduce((s,x)=>s+(Number(x.balance)||0),0);
  const deposits=totals.reduce((s,x)=>s+(Number(x.deposit)||0),0);
  const homes=Object.values(households);
  c.innerHTML=`  <div class="panel" style="margin-top:16px"><div class="section-head" style="margin-top:0"><div><h3>Pembuatan tagihan bulanan</h3><p class="tiny muted">Tagihan dibuat manual oleh pengurus. Satu periode hanya dapat dibuat satu kali.</p></div><span id="billingRunBadge" class="pill">Memeriksa periode…</span></div><button id="createMonthlyBillsBtn" class="btn primary">Buat Tagihan Bulan Ini · ${monthKey()}</button><p id="billingRunMessage" class="tiny muted" style="margin-top:8px"></p></div><div class="grid stats">${card("Total rumah",homes.length,"Data rumah terdaftar")}${card("Total anggota",homes.reduce((s,h)=>s+Object.keys(h.members||{}).length,0),"Anggota keluarga")}${card("Saldo operasional",money(operating),"Kas + sampah + air")}${card("Total deposit warga",money(deposits),"Kewajiban deposit, bukan saldo operasional")}</div>
  <div class="section-head"><h3>Saldo setiap kategori</h3><span class="pill">Periode ${monthKey()}</span></div>
  <div class="grid category-grid">${categoryCard("Kas RT",totals[0].balance,totals[0].income,totals[0].expense,totals[0].deposit)}${categoryCard("Uang Sampah",totals[1].balance,totals[1].income,totals[1].expense,totals[1].deposit)}${categoryCard("Uang Air",totals[2].balance,totals[2].income,totals[2].expense,totals[2].deposit)}</div>
  <div class="section-head"><h3>Catatan penting</h3></div><div class="muted-note">Deposit dipisahkan per kategori dan tidak dapat dipindahkan antar-kategori. Saldo kategori ditampilkan terpisah dari deposit warga.</div>

  <div class="toolbar" style="margin-top:16px"><button id="publishPublicBtn" class="btn secondary">Perbarui dashboard & daftar tagihan publik</button><span class="tiny muted">Hanya menerbitkan label rumah dan nominal tagihan.</span></div>`;
  const run=await read(`billing_runs/${monthKey()}`);
  const runBadge=$("#billingRunBadge"),runButton=$("#createMonthlyBillsBtn"),runMessage=$("#billingRunMessage");
  if(run?.status==="completed"){
    runBadge.className="pill success";runBadge.textContent="Sudah dibuat";
    runButton.disabled=true;runButton.textContent="Tagihan bulan ini sudah dibuat";
    runMessage.textContent=`Periode ${monthKey()} sudah dibuat untuk ${run.householdCount||0} rumah. Tidak dapat dibuat ulang.`;
  }else if(run?.status==="processing"){
    runBadge.className="pill warning";runBadge.textContent="Sedang diproses";
    runButton.disabled=true;runMessage.textContent="Pembuatan tagihan sedang berlangsung.";
  }else if(run?.status==="failed"){
    runBadge.className="pill warning";runBadge.textContent="Perlu dicoba ulang";
    runMessage.textContent="Percobaan sebelumnya gagal. Tombol dapat digunakan kembali setelah penyebab kegagalan diperiksa.";
  }else{
    runBadge.className="pill";runBadge.textContent="Belum dibuat";
    runMessage.textContent="Klik sekali untuk membuat tagihan penuh bagi semua rumah aktif dan kontrak.";
  }
  runButton.addEventListener("click",async()=>{
    if(!confirm(`Buat tagihan penuh periode ${monthKey()} untuk seluruh rumah aktif dan kontrak? Proses ini hanya dapat berhasil satu kali.`))return;
    runButton.disabled=true;runButton.textContent="Membuat tagihan…";
    try{
      const result=await createMonthlyBills(monthKey(),currentUser?.uid);
      await refreshPublicSnapshot(result.period,households);
      toast(`Tagihan ${result.period} berhasil dibuat untuk ${result.householdCount} rumah. Daftar tunggakan publik ikut diperbarui.`);
      await render();
    }catch(err){
      toast("Tagihan tidak dibuat: "+err.message);
      runButton.disabled=false;runButton.textContent="Buat Tagihan Bulan Ini · "+monthKey();
    }
  });
  $("#publishPublicBtn").addEventListener("click", async ()=>{
    try{
      const [financeSummary,arrearsSummary,arrearsLedger]=await Promise.all([read("financeSummaryByMonth"),read("arrearsSummary"),read("arrearsLedger")]);
      await publishPublicSnapshot(monthKey(),households,balances,financeSummary||{},arrearsSummary||{},arrearsLedger||{});
      toast("Informasi publik berhasil diperbarui.");
    }catch(e){toast("Gagal memperbarui tampilan publik: "+e.message);}
  });
}
function renderHouseholds(c){
  const rows=Object.entries(households).map(([id,h])=>({...h,id})).sort((a,b)=>(a.block||"").localeCompare(b.block||""));
  c.innerHTML=`<div class="toolbar"><input id="houseSearch" class="search-input" placeholder="Cari blok, alamat, nama kepala keluarga"><button id="addHouse" class="btn primary">+ Tambah rumah</button></div><div class="section-head"><h3>Daftar rumah (${rows.length})</h3></div><div class="table-wrap"><table><thead><tr><th>Blok / No. Rumah</th><th>Kepala keluarga</th><th>Alamat</th><th>Anggota</th><th>Status</th><th>Aksi</th></tr></thead><tbody id="houseRows">${rows.map(h=>houseRow(h)).join("")||'<tr><td colspan="6" class="empty">Belum ada data rumah.</td></tr>'}</tbody></table></div>`;
  const draw=filter=>{$("#houseRows").innerHTML=rows.filter(h=>`${h.block} ${h.address} ${h.headName}`.toLowerCase().includes(filter.toLowerCase())).map(h=>houseRow(h)).join("")||'<tr><td colspan="6" class="empty">Tidak ada rumah yang cocok.</td></tr>';};
  $("#houseSearch").addEventListener("input",e=>draw(e.target.value));
  $("#addHouse").addEventListener("click",()=>houseDialog());
  $("#houseRows").addEventListener("click",e=>{const b=e.target.closest("[data-edit-house]");if(!b)return;const h=rows.find(x=>x.id===b.dataset.editHouse);if(h)houseDialog(h);});
}
function houseRow(h){return `<tr><td><b>${escapeHtml(h.block||"-")}</b></td><td>${escapeHtml(h.headName||"-")}</td><td>${escapeHtml(h.address||"-")}</td><td>${Object.keys(h.members||{}).length}</td><td><span class="pill ${h.status==="active"?"success":"warning"}">${escapeHtml(h.status||"active")}</span></td><td><button class="btn small outline" type="button" data-edit-house="${escapeHtml(h.id)}">Edit</button></td></tr>`;}
function houseDialog(existing=null){
  const editing=!!existing;
  const membersText=Object.entries(existing?.members||{}).filter(([key])=>key!=="head").map(([,v])=>v.name?`${v.name} - ${v.relation||"lainnya"}`:"").filter(Boolean).join("\n");
  $("#dialogContent").innerHTML=`<h3>${editing?"Edit rumah / keluarga":"Tambah rumah / keluarga"}</h3><form id="houseForm"><div class="form-grid"><label class="field">Blok / nomor rumah<input name="block" value="${escapeHtml(existing?.block||"")}" required></label><label class="field">Nama kepala keluarga<input name="headName" value="${escapeHtml(existing?.headName||"")}" required></label><label class="field full-row">Alamat lengkap<input name="address" value="${escapeHtml(existing?.address||"")}" required></label><label class="field">Nomor HP<input name="phone" value="${escapeHtml(existing?.phone||"")}"></label><label class="field">Nomor WhatsApp<input name="whatsappNumber" value="${escapeHtml(existing?.whatsapp?.primaryNumber||"")}" placeholder="Contoh: 081234567890"></label><label class="field">Meteran air awal (m³)<input name="initialWaterMeter" type="number" min="0" step="0.01" value="${Number(existing?.initialWaterMeter??existing?.currentWaterMeter)||0}" required><small class="muted tiny">${editing?"Ubah hanya jika melakukan koreksi data meter awal.":"Angka meter saat rumah pertama kali didaftarkan."}</small></label><label class="field">Status<select name="status"><option value="active" ${existing?.status==="active"?"selected":""}>Dihuni</option><option value="empty" ${existing?.status==="empty"?"selected":""}>Kosong</option><option value="rented" ${existing?.status==="rented"?"selected":""}>Kontrak</option></select></label><label class="field full-row">Anggota keluarga (satu nama per baris, opsional)<textarea name="members" rows="4" placeholder="Nama - hubungan&#10;Siti - Istri&#10;Budi - Anak">${escapeHtml(membersText)}</textarea></label></div><button class="btn primary full">${editing?"Simpan perubahan":"Simpan rumah"}</button></form>`;
  $("#genericDialog").showModal();
  $("#houseForm").addEventListener("submit",async e=>{
    e.preventDefault();const f=new FormData(e.target),members={};
    String(f.get("members")||"").split("\n").map(x=>x.trim()).filter(Boolean).forEach((line,i)=>{const [name,relation]=line.split("-").map(x=>x.trim());members[`m${i+1}`]={name,relation:relation||"lainnya",status:"active"};});
    members.head={name:f.get("headName"),relation:"kepala_keluarga",status:"active"};
    const initial= Math.max(0,Number(f.get("initialWaterMeter"))||0);
    const data={...(existing||{}),block:f.get("block").trim(),headName:f.get("headName").trim(),address:f.get("address").trim(),phone:f.get("phone").trim(),whatsapp:{...(existing?.whatsapp||{}),primaryNumber:f.get("whatsappNumber")||f.get("phone")||"",enabled:true},initialWaterMeter:editing?Number(existing.initialWaterMeter??initial):initial,currentWaterMeter:editing?Number(existing.currentWaterMeter??initial):initial,status:f.get("status"),members};
    if(existing)data.id=existing.id;
    await saveHousehold(data);households=await getHouseholds();householdsLoadedAt=Date.now();$("#genericDialog").close();toast(editing?"Perubahan rumah tersimpan.":"Data rumah tersimpan.");await render();
  });
}

async function renderDeposits(c){
  const data=await read("deposits")||{};
  const rows=[];
  Object.entries(data).forEach(([hid,cats])=>Object.entries(cats||{}).forEach(([cat,amount])=>rows.push({hid,cat,amount})));
  c.innerHTML=`<div class="grid stats">${card("Deposit kas",money(rows.filter(x=>x.cat==="kas").reduce((s,x)=>s+Number(x.amount||0),0)))}${card("Deposit sampah",money(rows.filter(x=>x.cat==="sampah").reduce((s,x)=>s+Number(x.amount||0),0)))}${card("Deposit air",money(rows.filter(x=>x.cat==="air").reduce((s,x)=>s+Number(x.amount||0),0)))}${card("Total deposit",money(rows.reduce((s,x)=>s+Number(x.amount||0),0)),"Tidak termasuk saldo operasional")}</div><div class="section-head"><h3>Saldo deposit per rumah</h3></div><div class="table-wrap"><table><thead><tr><th>Rumah</th><th>Kategori</th><th>Saldo deposit</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${households[x.hid]?.block||x.hid}</td><td>${x.cat}</td><td class="amount">${money(x.amount)}</td></tr>`).join("")||'<tr><td colspan="3" class="empty">Belum ada deposit.</td></tr>'}</tbody></table></div><div class="muted-note" style="margin-top:14px">Deposit tidak dapat dipindahkan antar-kategori. Perubahan deposit harus tercatat di deposit ledger dan melalui proses transaksi yang tervalidasi.</div>`;
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
    else if((ch===","||ch===";"||ch==="\\t")&&!quoted){row.push(cell);cell="";}
    else if((ch==="\\n"||ch==="\\r")&&!quoted){if(ch==="\\r"&&next==="\\n")i++;row.push(cell);if(row.some(v=>String(v).trim()))rows.push(row);row=[];cell="";}
    else cell+=ch;
  }
  row.push(cell);if(row.some(v=>String(v).trim()))rows.push(row);
  return rows;
}
function normalizeWaterImportRows(matrix){
  if(!matrix.length)return [];
  const headers=matrix[0].map(v=>String(v??"").trim().toLowerCase());
  const find=patterns=>headers.findIndex(h=>patterns.some(p=>h.includes(p)));
  const ix={block:find(["blok","no. rumah"]),name:find(["nama kepala","nama"]),previous:find(["meter september","meteran september","meter awal"]),current:find(["meter oktober","meteran oktober","meter akhir"]),usage:find(["pemakaian","jml"]),amount:find(["tagihan oktober","tagihan air","nominal tagihan","tagihan (rp)"])};
  if(ix.block<0)throw new Error("Kolom Blok tidak ditemukan. Gunakan file template impor Keuangan RT.");
  return matrix.slice(1).filter(r=>String(r[ix.block]??"").trim()).map(r=>{
    const num=i=>{if(i<0||r[i]===undefined||r[i]===null||String(r[i]).trim()==="")return null;const v=Number(String(r[i]).replace(/[^0-9,-]/g,"").replace(",", "."));return Number.isFinite(v)?v:null;};
    return {block:String(r[ix.block]).trim(),headName:ix.name>=0?String(r[ix.name]??"").trim():"",previousMeter:num(ix.previous),currentMeter:num(ix.current),usage:num(ix.usage),amount:num(ix.amount)};
  });
}
async function renderWaterMeters(c){
  const period=monthKey(),settings=await getBillingSettings(),readings=await read(`water_readings/${period}`)||{},run=await read(`billing_runs/${period}`);
  const homes=Object.entries(households).filter(([,h])=>h&&h.status!=="empty"&&h.status!=="inactive").sort((a,b)=>String(a[1].block||"").localeCompare(String(b[1].block||"")));
  const recorded=homes.filter(([id])=>!!readings[id]).length;
  c.innerHTML=`<div class="grid stats">${card("Rumah aktif",homes.length,"Dihuni dan kontrak")}${card("Meter tercatat",recorded,"Periode "+period)}${card("Belum tercatat",homes.length-recorded,"Menunggu pencatatan meter")}</div>
  <div class="panel water-meter-panel">
    <div class="section-head" style="margin-top:0"><div><h3>Meteran air · ${period}</h3><p class="muted tiny">Masukkan angka akhir pada setiap rumah. Pemakaian dihitung otomatis.</p></div><span class="pill">${money(settings.waterPerM3||0)} / m³</span></div>
    <div class="toolbar water-import-toolbar"><button class="btn outline" id="openWaterImport" type="button">⇧ Impor data Excel / CSV</button><span class="muted tiny">Impor daftar meter dan nominal tagihan per periode.</span></div>
    <div id="waterImportPanel" class="muted-note hidden">
      <form id="waterImportForm">
        <div class="form-grid">
          <label class="field">Periode data<input type="month" name="period" value="2026-10" required></label>
          <label class="field">Pilih file Excel / CSV<input type="file" id="waterImportFile" accept=".xlsx,.xls,.csv" required></label>
        </div>
        <p class="muted tiny">Kolom yang dikenali: Blok, Nama Kepala Keluarga, Meter September, Meter Oktober, Pemakaian, dan Tagihan Oktober (Rp).</p>
        <div id="waterImportPreview"></div>
        <button class="btn primary" id="confirmWaterImport" type="submit" disabled>Impor ke Firebase</button>
        <button class="btn outline" id="cancelWaterImport" type="button">Batal</button>
      </form>
    </div>
    ${!run||run.status!=="completed"?'<div class="muted-note">Tagihan bulan ini belum dibuat. Klik Buat Tagihan Bulan Ini di bagian atas Dashboard terlebih dahulu.</div>':homes.map(([id,h])=>{
      const previous=Number(h.currentWaterMeter??h.initialWaterMeter)||0,saved=readings[id];
      return `<div class="water-meter-line" data-house="${escapeHtml(id)}" data-previous="${previous}" data-rate="${Number(settings.waterPerM3)||0}" data-admin="${Number(settings.waterAdmin)||0}">
  <div class="water-meter-home"><b>${escapeHtml(h.block||"Rumah")}</b><small>Awal: ${previous.toLocaleString("id-ID")} m³</small></div>
  <div class="water-meter-entry"><input class="meter-current" type="number" min="${Number(saved?.previousMeter??previous)}" step="0.001" inputmode="decimal" value="${saved?Number(saved.currentMeter):""}" placeholder="Angka meter akhir" ${saved?"disabled":""}><small class="meter-preview">${saved?"Tersimpan · "+saved.usage+" m³ · "+money(saved.totalAmount):"Isi angka meter akhir"}</small></div>
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
      await refreshPublicSnapshot(period,households);
      toast(`Impor selesai: ${result.created} rumah baru, ${result.matched} rumah cocok, ${result.charges} tagihan air. Daftar publik diperbarui.`);
      await render();
    }catch(err){toast("Impor gagal: "+err.message);button.disabled=false;button.textContent="Impor ke Firebase";}
  });
  c.querySelectorAll(".water-meter-line").forEach(row=>{
    const input=row.querySelector(".meter-current");if(!input)return;
    const button=row.querySelector(".meter-save"),wasSaved=input.disabled,previous=Number(input.min||row.dataset.previous),rate=Number(row.dataset.rate),admin=Number(row.dataset.admin);
    const preview=()=>{const current=Number(input.value),valid=input.value!==""&&Number.isFinite(current)&&current>=previous,usage=valid?current-previous:0;row.querySelector(".meter-preview").textContent=valid?"Pemakaian "+usage.toLocaleString("id-ID")+" m³ · Tagihan "+money(admin+Math.round(usage*rate)):input.value&&current<previous?"Angka tidak boleh lebih kecil dari meter awal":"Isi angka meter akhir";button.disabled=!valid;input.setCustomValidity(input.value!==""&&current<previous?"Meter akhir tidak boleh lebih kecil dari meter awal.":"");};
    input.addEventListener("input",preview);
    button.addEventListener("click",async()=>{if(button.hasAttribute("data-edit-mode")&&input.disabled){input.disabled=false;button.textContent="Simpan koreksi";input.focus();preview();return;}if(!input.reportValidity())return;button.disabled=true;button.textContent="…";try{const payload={period,householdId:row.dataset.house,currentMeter:input.value,recordedBy:currentUser?.uid};const result=wasSaved?await editWaterReading(payload):await saveWaterReading(payload);households=await getHouseholds();householdsLoadedAt=Date.now();await refreshPublicSnapshot(period,households);toast("Meter "+result.usage+" m³ tersimpan. Tagihan "+money(result.totalAmount)+" · daftar tunggakan diperbarui.");await render();}catch(err){toast("Gagal menyimpan meter: "+err.message);button.disabled=false;button.textContent=wasSaved?"Simpan koreksi":"Simpan";}});
  });
}
async function renderCategory(c,cat){
  const bal=(await read(`category_balances/${cat}`))||{};
  const period=monthKey();
  const bills=await getMonthBills(period);
  const due=Object.values(bills).reduce((s,h)=>s+Number(h?.[cat]?.remaining||0),0);
  const labels={kas:"Kas RT",sampah:"Uang Sampah",air:"Kas Air"};
  const stats=`<div class="grid stats">${card("Saldo operasional",money(bal.balance))}${card("Pemasukan",money(bal.income))}${card("Pengeluaran",money(bal.expense))}${card("Deposit warga",money(bal.deposit))}</div><div class="section-head"><h3>Tagihan belum dibayar · ${period}</h3><span class="pill warning">${money(due)}</span></div>`;
  c.innerHTML=stats+`<div class="muted-note">${labels[cat]}: tagihan dan pembayaran dikelola melalui tab Pembayaran. Deposit kategori ini hanya dapat digunakan untuk kategori yang sama.${cat==="air"?' Pencatatan angka meter bulanan tersedia di tab Meteran Air.':''}</div>`;
}
async function renderExpenses(c){
  const current=monthKey();
  c.innerHTML=`<div class="panel">
    <div class="section-head" style="margin-top:0"><h3>Catat pengeluaran</h3><span class="pill">Saldo terpisah</span></div>
    <p class="muted tiny">Pilih sumber dana yang benar. Pengeluaran akan mengurangi saldo kategori tersebut dan masuk ke riwayat transaksi.</p>
    <form id="expenseForm"><div class="form-grid">
      <label class="field">Sumber dana<select name="category" required><option value="kas">Kas RT</option><option value="air">Kas Air</option><option value="sampah">Kas Sampah</option></select></label>
      <label class="field">Nominal (Rp)<input name="amount" type="text" inputmode="numeric" data-rupiah placeholder="Rp 0" required></label>
      <label class="field">Tanggal<input name="date" type="date" value="${new Date().toISOString().slice(0,10)}" required></label>
      <label class="field full-row">Keterangan pengeluaran<input name="description" maxlength="180" placeholder="Contoh: pembelian perlengkapan kebersihan" required></label>
      <label class="field full-row">Bukti / nomor kuitansi / tautan bukti<input name="proof" maxlength="500" placeholder="Nomor kuitansi atau tautan foto bukti" required></label>
    </div><button class="btn primary" type="submit">Simpan pengeluaran</button></form>
  </div>
  <div class="panel" style="margin-top:14px"><div class="section-head"><h3>Riwayat pengeluaran</h3><label class="field">Periode<input id="expensePeriod" type="month" value="${current}"></label></div><div id="expenseHistory" class="table-wrap">Memuat…</div></div>`;
  bindRupiahInputs($("#expenseForm"));
  const drawHistory=async()=>{
    const period=$("#expensePeriod").value||current;
    const rows=Object.values(await getExpenses(period)||{}).sort((a,b)=>Number(b.createdAt||0)-Number(a.createdAt||0));
    $("#expenseHistory").innerHTML=`<table><thead><tr><th>Tanggal</th><th>Sumber dana</th><th>Keterangan</th><th>Bukti</th><th>Nominal</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${escapeHtml(x.date||"-")}</td><td>${escapeHtml(({kas:"Kas RT",air:"Kas Air",sampah:"Kas Sampah"})[x.category]||x.category)}</td><td>${escapeHtml(x.description||"-")}</td><td>${escapeHtml(x.proof||"-")}</td><td class="amount">${money(x.amount)}</td></tr>`).join("")||'<tr><td colspan="5" class="empty">Tidak ada pengeluaran pada periode ini.</td></tr>'}</tbody></table>`;
  };
  await drawHistory();
  $("#expensePeriod").addEventListener("change",drawHistory);
  $("#expenseForm").addEventListener("submit",async e=>{
    e.preventDefault(); const f=new FormData(e.currentTarget); const button=e.currentTarget.querySelector('button[type="submit"]');
    button.disabled=true; button.textContent="Menyimpan…";
    try{
      await createExpense({category:f.get("category"),amount:parseRupiah(f.get("amount")),date:f.get("date"),description:f.get("description"),proof:f.get("proof"),recordedBy:currentUser?.uid});
      toast("Pengeluaran berhasil disimpan dan saldo kategori diperbarui.");
      e.currentTarget.reset(); e.currentTarget.elements.date.value=new Date().toISOString().slice(0,10); $("#expensePeriod").value=String(f.get("date")).slice(0,7); await drawHistory();
    }catch(err){toast("Gagal menyimpan pengeluaran: "+err.message);}
    finally{button.disabled=false;button.textContent="Simpan pengeluaran";}
  });
}

function renderMasterData(c){
  c.innerHTML=`<div class="grid two">
    <section class="panel"><h3>Hapus data berdasarkan periode</h3><p class="muted">Menghapus tagihan, pembayaran, pengeluaran, transaksi, meter air, ringkasan, dan rincian tunggakan pada satu bulan. Data rumah, tarif, saldo kategori dan periode lain dipertahankan.</p>
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
  const current=monthKey();
  c.innerHTML=`<div class="section-head"><h3>Riwayat transaksi</h3><label class="field">Periode<input id="transactionPeriod" type="month" value="${current}"></label></div><div id="transactionHistory" class="table-wrap">Memuat…</div>`;
  const draw=async()=>{
    const period=$("#transactionPeriod").value||current;
    const tx=await getMonthTransactions(period);
    const rows=Object.values(tx).sort((a,b)=>Number(b.createdAt||b.date||0)-Number(a.createdAt||a.date||0));
    $("#transactionHistory").innerHTML=`<table><thead><tr><th>Tanggal</th><th>Jenis</th><th>Kategori</th><th>Keterangan</th><th>Nominal</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${new Date(x.date||x.createdAt).toLocaleDateString("id-ID")}</td><td>${escapeHtml(x.type||"-")}</td><td>${escapeHtml(x.category||"-")}</td><td>${escapeHtml(x.description||x.referenceId||"-")}</td><td class="amount">${money(x.amount)}</td></tr>`).join("")||'<tr><td colspan="5" class="empty">Tidak ada transaksi pada periode ini.</td></tr>'}</tbody></table>`;
  };
  await draw();
  $("#transactionPeriod").addEventListener("change",draw);
}

async function renderReports(c){
  const sums=await read("category_balances")||{};
  c.innerHTML=`<div class="grid category-grid">${["kas","sampah","air"].map(k=>categoryCard(k.toUpperCase(),sums[k]?.balance,sums[k]?.income,sums[k]?.expense,sums[k]?.deposit)).join("")}</div><div class="muted-note" style="margin-top:16px">Laporan final akan menyediakan filter periode, ekspor CSV/Excel dan cetak PDF setelah alur transaksi tervalidasi.</div>`;
}
render();
