import { firebaseConfigured, db } from "./firebase.js";
import { login, logout, observeSession } from "./auth.js";
import { getHouseholds, getMonthBills, getPayments, getExpenses, saveHousehold, createRecord, read, getPublicDashboard, getPublicBills, publishPublicSnapshot, getBillingSettings, saveBillingSettings, createExpense } from "./data.js";
import { renderPaymentPage } from "./payments.js";
import { renderWhatsAppPage } from "./whatsapp.js";

const $ = s => document.querySelector(s);
const money = n => new Intl.NumberFormat("id-ID",{style:"currency",currency:"IDR",maximumFractionDigits:0}).format(Number(n)||0);
const monthKey = () => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`; };
let currentUser=null, currentProfile=null, page="dashboard", households={};

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
  const names={dashboard:"Dashboard",publicBills:"Daftar Tagihan",households:"Rumah & Warga",payments:"Pembayaran",deposits:"Deposit Warga",kas:"Kas RT",sampah:"Uang Sampah",air:"Uang Air",expenses:"Pengeluaran",transactions:"Semua Transaksi",reports:"Laporan",whatsapp:"WhatsApp Tagihan",users:"Pengguna",settings:"Pengaturan"};
  title(names[page]||"Dashboard");
  const c=$("#pageContent");
  c.innerHTML='<div class="panel">Memuat data…</div>';
  try{
    households=await getHouseholds();
    if(page==="dashboard") await renderDashboard(c);
    else if(page==="publicBills") await renderPublicBills(c, true);
    else if(page==="households") renderHouseholds(c);
    else if(page==="payments") await renderPaymentPage(c,{households,monthKey:monthKey(),money,toast,currentUser});
    else if(page==="deposits") await renderDeposits(c);
    else if(["kas","sampah","air"].includes(page)) await renderCategory(c,page);
    else if(page==="expenses") renderExpenses(c);
    else if(page==="transactions") await renderTransactions(c);
    else if(page==="reports") await renderReports(c);
    else if(page==="whatsapp") await renderWhatsAppPage(c,{households,currentUser,currentProfile,toast});
    else if(page==="users") c.innerHTML='<div class="muted-note">Semua akun yang berhasil login memiliki hak pengelolaan yang sama. Penambahan akun dilakukan melalui Firebase Authentication oleh pemilik proyek.</div>';
    else if(page==="settings") await renderSettings(c);
  }catch(e){c.innerHTML=`<div class="muted-note">Gagal memuat data: ${e.message}</div>`;}
}
async function renderSettings(c){
  const settings=await getBillingSettings();
  const field=(label,name,value,help)=>`<label class="field">${label}<input name="${name}" type="number" min="0" step="100" inputmode="numeric" value="${Number(value)||0}" required><small class="muted tiny">${help}</small></label>`;
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
  $("#billingSettingsForm").addEventListener("submit",async e=>{
    e.preventDefault(); const f=new FormData(e.currentTarget);
    const values=Object.fromEntries(["kasMonthly","sampahMonthly","waterAdmin","waterPerM3","openingKas","openingAir","openingSampah"].map(k=>[k,f.get(k)]));
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
  c.innerHTML=`<div class="grid stats">${card("Total rumah",homes.length,"Data rumah terdaftar")}${card("Total anggota",homes.reduce((s,h)=>s+Object.keys(h.members||{}).length,0),"Anggota keluarga")}${card("Saldo operasional",money(operating),"Kas + sampah + air")}${card("Total deposit warga",money(deposits),"Kewajiban deposit, bukan saldo operasional")}</div>
  <div class="section-head"><h3>Saldo setiap kategori</h3><span class="pill">Periode ${monthKey()}</span></div>
  <div class="grid category-grid">${categoryCard("Kas RT",totals[0].balance,totals[0].income,totals[0].expense,totals[0].deposit)}${categoryCard("Uang Sampah",totals[1].balance,totals[1].income,totals[1].expense,totals[1].deposit)}${categoryCard("Uang Air",totals[2].balance,totals[2].income,totals[2].expense,totals[2].deposit)}</div>
  <div class="section-head"><h3>Catatan penting</h3></div><div class="muted-note">Deposit dipisahkan per kategori dan tidak dapat dipindahkan antar-kategori. Saldo kategori ditampilkan terpisah dari deposit warga.</div>
  <div class="toolbar" style="margin-top:16px"><button id="publishPublicBtn" class="btn secondary">Perbarui dashboard & daftar tagihan publik</button><span class="tiny muted">Hanya menerbitkan label rumah dan nominal tagihan.</span></div>`;
  $("#publishPublicBtn").addEventListener("click", async ()=>{
    try{
      const allBills=await read("bills")||{};
      const transactions=await read("transactions")||{};
      const expenses=await read("expenses")||{};
      await publishPublicSnapshot(monthKey(),households,balances,allBills,transactions,expenses);
      toast("Informasi publik berhasil diperbarui.");
    }catch(e){toast("Gagal memperbarui tampilan publik: "+e.message);}
  });
}
function renderHouseholds(c){
  const rows=Object.values(households).sort((a,b)=>(a.block||"").localeCompare(b.block||""));
  c.innerHTML=`<div class="toolbar"><input id="houseSearch" class="search-input" placeholder="Cari blok, alamat, nama kepala keluarga"><button id="addHouse" class="btn primary">+ Tambah rumah</button></div><div class="section-head"><h3>Daftar rumah (${rows.length})</h3></div><div class="table-wrap"><table><thead><tr><th>Blok / No. Rumah</th><th>Kepala keluarga</th><th>Alamat</th><th>Anggota</th><th>Status</th></tr></thead><tbody id="houseRows">${rows.map(h=>houseRow(h)).join("")||'<tr><td colspan="5" class="empty">Belum ada data rumah.</td></tr>'}</tbody></table></div>`;
  $("#houseSearch").addEventListener("input",e=>{$("#houseRows").innerHTML=rows.filter(h=>`${h.block} ${h.address} ${h.headName}`.toLowerCase().includes(e.target.value.toLowerCase())).map(h=>houseRow(h)).join("");});
  $("#addHouse").addEventListener("click",()=>houseDialog());
}
function houseRow(h){return `<tr><td><b>${h.block||"-"}</b></td><td>${h.headName||"-"}</td><td>${h.address||"-"}</td><td>${Object.keys(h.members||{}).length}</td><td><span class="pill ${h.status==="active"?"success":"warning"}">${h.status||"active"}</span></td></tr>`;}
function houseDialog(){
  $("#dialogContent").innerHTML=`<h3>Tambah rumah / keluarga</h3><form id="houseForm"><div class="form-grid"><label class="field">Blok / nomor rumah<input name="block" required></label><label class="field">Nama kepala keluarga<input name="headName" required></label><label class="field full-row">Alamat lengkap<input name="address" required></label><label class="field">Nomor HP<input name="phone"></label><label class="field">Nomor WhatsApp<input name="whatsappNumber" placeholder="Contoh: 081234567890"></label><label class="field">Meteran air awal (m³)<input name="initialWaterMeter" type="number" min="0" step="0.01" value="0" required><small class="muted tiny">Angka meter saat rumah pertama kali didaftarkan.</small></label><label class="field">Status<select name="status"><option value="active">Dihuni</option><option value="empty">Kosong</option><option value="rented">Kontrak</option></select></label><label class="field full-row">Anggota keluarga (satu nama per baris, opsional)<textarea name="members" rows="4" placeholder="Nama - hubungan&#10;Siti - Istri&#10;Budi - Anak"></textarea></label></div><button class="btn primary full">Simpan rumah</button></form>`;
  $("#genericDialog").showModal();
  $("#houseForm").addEventListener("submit",async e=>{e.preventDefault();const f=new FormData(e.target);const members={};String(f.get("members")||"").split("\n").filter(Boolean).forEach((line,i)=>{const [name,relation]=line.split("-").map(x=>x.trim());members[`m${i+1}`]={name,relation:relation||"lainnya",status:"active"};});members.head={name:f.get("headName"),relation:"kepala_keluarga",status:"active"};await saveHousehold({block:f.get("block"),headName:f.get("headName"),address:f.get("address"),phone:f.get("phone"),whatsapp:{primaryNumber:f.get("whatsappNumber")||f.get("phone")||"",enabled:true},initialWaterMeter:Math.max(0,Number(f.get("initialWaterMeter"))||0),currentWaterMeter:Math.max(0,Number(f.get("initialWaterMeter"))||0),status:f.get("status"),members});$("#genericDialog").close();toast("Data rumah tersimpan.");render();});
}
async function renderDeposits(c){
  const data=await read("deposits")||{};
  const rows=[];
  Object.entries(data).forEach(([hid,cats])=>Object.entries(cats||{}).forEach(([cat,amount])=>rows.push({hid,cat,amount})));
  c.innerHTML=`<div class="grid stats">${card("Deposit kas",money(rows.filter(x=>x.cat==="kas").reduce((s,x)=>s+Number(x.amount||0),0)))}${card("Deposit sampah",money(rows.filter(x=>x.cat==="sampah").reduce((s,x)=>s+Number(x.amount||0),0)))}${card("Deposit air",money(rows.filter(x=>x.cat==="air").reduce((s,x)=>s+Number(x.amount||0),0)))}${card("Total deposit",money(rows.reduce((s,x)=>s+Number(x.amount||0),0)),"Tidak termasuk saldo operasional")}</div><div class="section-head"><h3>Saldo deposit per rumah</h3></div><div class="table-wrap"><table><thead><tr><th>Rumah</th><th>Kategori</th><th>Saldo deposit</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${households[x.hid]?.block||x.hid}</td><td>${x.cat}</td><td class="amount">${money(x.amount)}</td></tr>`).join("")||'<tr><td colspan="3" class="empty">Belum ada deposit.</td></tr>'}</tbody></table></div><div class="muted-note" style="margin-top:14px">Deposit tidak dapat dipindahkan antar-kategori. Perubahan deposit harus tercatat di deposit ledger dan melalui proses transaksi yang tervalidasi.</div>`;
}
async function renderCategory(c,cat){
  const bal=(await read(`category_balances/${cat}`))||{};
  const bills=await getMonthBills(monthKey());
  const due=Object.values(bills).reduce((s,h)=>s+Number(h?.[cat]?.remaining||0),0);
  c.innerHTML=`<div class="grid stats">${card("Saldo operasional",money(bal.balance))}${card("Pemasukan",money(bal.income))}${card("Pengeluaran",money(bal.expense))}${card("Deposit warga",money(bal.deposit))}</div><div class="section-head"><h3>Tagihan belum dibayar · ${monthKey()}</h3><span class="pill warning">${money(due)}</span></div><div class="muted-note">Tagihan dan pembayaran kategori ini dikelola melalui tab Pembayaran. Deposit kategori ini hanya dapat digunakan untuk kategori yang sama.</div>`;
}
function renderExpenses(c){
  c.innerHTML=`<div class="panel">
    <div class="section-head" style="margin-top:0"><h3>Catat pengeluaran</h3><span class="pill">Saldo terpisah</span></div>
    <p class="muted tiny">Pilih sumber dana yang benar. Pengeluaran akan mengurangi saldo kategori tersebut dan masuk ke riwayat transaksi.</p>
    <form id="expenseForm"><div class="form-grid">
      <label class="field">Sumber dana<select name="category" required><option value="kas">Kas RT</option><option value="air">Kas Air</option><option value="sampah">Kas Sampah</option></select></label>
      <label class="field">Nominal (Rp)<input name="amount" type="number" min="1" step="1" required></label>
      <label class="field">Tanggal<input name="date" type="date" value="${new Date().toISOString().slice(0,10)}" required></label>
      <label class="field full-row">Keterangan pengeluaran<input name="description" maxlength="180" placeholder="Contoh: pembelian perlengkapan kebersihan" required></label>
      <label class="field full-row">Bukti / nomor kuitansi / tautan bukti<input name="proof" maxlength="500" placeholder="Nomor kuitansi atau tautan foto bukti" required></label>
    </div><button class="btn primary" type="submit">Simpan pengeluaran</button></form>
  </div>
  <div class="panel" style="margin-top:14px"><h3>Riwayat pengeluaran</h3><div id="expenseHistory" class="table-wrap">Memuat…</div></div>`;
  const drawHistory=async()=>{
    const rows=Object.values(await getExpenses()||{}).sort((a,b)=>Number(b.createdAt||0)-Number(a.createdAt||0));
    $("#expenseHistory").innerHTML=`<table><thead><tr><th>Tanggal</th><th>Sumber dana</th><th>Keterangan</th><th>Bukti</th><th>Nominal</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${escapeHtml(x.date||"-")}</td><td>${escapeHtml(({kas:"Kas RT",air:"Kas Air",sampah:"Kas Sampah"})[x.category]||x.category)}</td><td>${escapeHtml(x.description||"-")}</td><td>${escapeHtml(x.proof||"-")}</td><td class="amount">${money(x.amount)}</td></tr>`).join("")||'<tr><td colspan="5" class="empty">Belum ada pengeluaran.</td></tr>'}</tbody></table>`;
  };
  drawHistory();
  $("#expenseForm").addEventListener("submit",async e=>{
    e.preventDefault(); const f=new FormData(e.currentTarget); const button=e.currentTarget.querySelector('button[type="submit"]');
    button.disabled=true; button.textContent="Menyimpan…";
    try{
      await createExpense({category:f.get("category"),amount:f.get("amount"),date:f.get("date"),description:f.get("description"),proof:f.get("proof"),recordedBy:currentUser?.uid});
      toast("Pengeluaran berhasil disimpan dan saldo kategori diperbarui.");
      e.currentTarget.reset(); e.currentTarget.elements.date.value=new Date().toISOString().slice(0,10); await drawHistory();
    }catch(err){toast("Gagal menyimpan pengeluaran: "+err.message);}
    finally{button.disabled=false;button.textContent="Simpan pengeluaran";}
  });
}
async function renderTransactions(c){
  const tx=await read("transactions")||{};
  const rows=Object.values(tx).sort((a,b)=>(b.date||0)-(a.date||0));
  c.innerHTML=`<div class="section-head"><h3>Riwayat transaksi</h3></div><div class="table-wrap"><table><thead><tr><th>Tanggal</th><th>Jenis</th><th>Kategori</th><th>Keterangan</th><th>Nominal</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${new Date(x.date||x.createdAt).toLocaleDateString("id-ID")}</td><td>${x.type||"-"}</td><td>${x.category||"-"}</td><td>${x.description||x.referenceId||"-"}</td><td class="amount">${money(x.amount)}</td></tr>`).join("")||'<tr><td colspan="5" class="empty">Belum ada transaksi.</td></tr>'}</tbody></table></div>`;
}
async function renderReports(c){
  const sums=await read("category_balances")||{};
  c.innerHTML=`<div class="grid category-grid">${["kas","sampah","air"].map(k=>categoryCard(k.toUpperCase(),sums[k]?.balance,sums[k]?.income,sums[k]?.expense,sums[k]?.deposit)).join("")}</div><div class="muted-note" style="margin-top:16px">Laporan final akan menyediakan filter periode, ekspor CSV/Excel dan cetak PDF setelah alur transaksi tervalidasi.</div>`;
}
render();
