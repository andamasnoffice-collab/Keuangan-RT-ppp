import { ref, push, update } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";
import { db } from "./firebase.js";

const categories=["kas","sampah","air"];
const labels={kas:"Kas RT",sampah:"Uang Sampah",air:"Uang Air"};
const money=n=>new Intl.NumberFormat("id-ID",{style:"currency",currency:"IDR",maximumFractionDigits:0}).format(Number(n)||0);

export async function renderPaymentPage(container,{households,monthKey,toast}){
  const homes=Object.entries(households).map(([id,h])=>({id,...h}));
  container.innerHTML=`<div class="panel"><div class="section-head" style="margin-top:0"><h3>Pencatatan pembayaran warga</h3><span class="pill success">Satu pintu</span></div><div class="form-grid"><label class="field full-row">Pilih rumah<select id="payHouse"><option value="">Pilih rumah / kepala keluarga</option>${homes.map(h=>`<option value="${h.id}">${h.block||""} · ${h.headName||""} · ${h.address||""}</option>`).join("")}</select></label></div><div id="billChecklist"><div class="empty">Pilih rumah untuk menampilkan tagihan.</div></div></div>`;
  const select=container.querySelector("#payHouse");
  select.addEventListener("change",async()=>{
    const id=select.value, box=container.querySelector("#billChecklist");
    if(!id){box.innerHTML='<div class="empty">Pilih rumah untuk menampilkan tagihan.</div>';return;}
    const {getMonthBills,read}=await import("./data.js");
    const [allBills,dep]=await Promise.all([getMonthBills(monthKey),read(`deposits/${id}`)]);
    const bill=allBills[id]||{};
    box.innerHTML=`<h3 style="margin:20px 0 10px">Tagihan periode ${monthKey}</h3>${categories.map(cat=>{
      const b=bill[cat]||{};const remaining=Number(b.remaining??b.amount??0);const deposit=Number(dep?.[cat]||0);
      return `<label class="check-row"><input type="checkbox" class="bill-check" data-cat="${cat}" data-due="${remaining}" ${remaining>0?"":"disabled"}><span class="grow"><b>${labels[cat]}</b><small>Tagihan tersisa ${money(remaining)} · Deposit tersedia ${money(deposit)}</small></span><b>${money(remaining)}</b></label>`;
    }).join("")}
    <div class="form-grid"><label class="field">Uang diterima (Rp)<input id="received" type="number" min="0" step="1" value="0"></label><label class="field">Metode pembayaran<select id="method"><option>Tunai</option><option>Transfer</option><option>QRIS</option></select></label></div>
    <div class="summary-box"><div class="summary-line"><span>Total tagihan dipilih</span><b id="selectedTotal">${money(0)}</b></div><div class="summary-line"><span>Uang diterima</span><b id="receivedLabel">${money(0)}</b></div><div class="summary-line"><span>Lebih bayar menjadi deposit kategori terkait</span><b id="surplusLabel">${money(0)}</b></div><div class="summary-line"><span>Kurang bayar</span><b id="shortLabel">${money(0)}</b></div></div>
    <div class="muted-note" style="margin-top:12px">Aturan: kelebihan pembayaran dari kategori tertentu menjadi deposit kategori yang sama. Tidak ada pemindahan deposit antar-kategori. Pembayaran yang menyentuh beberapa kategori harus dialokasikan sesuai pilihan tagihan.</div>
    <button id="savePayment" class="btn primary full" style="margin-top:14px">Simpan pembayaran</button>`;
    const rec=box.querySelector("#received");
    const updateTotals=()=>{
      const total=[...box.querySelectorAll(".bill-check:checked")].reduce((s,x)=>s+Number(x.dataset.due),0);
      const received=Number(rec.value)||0, surplus=Math.max(0,received-total),short=Math.max(0,total-received);
      box.querySelector("#selectedTotal").textContent=money(total);box.querySelector("#receivedLabel").textContent=money(received);box.querySelector("#surplusLabel").textContent=money(surplus);box.querySelector("#shortLabel").textContent=money(short);
    };
    box.querySelectorAll(".bill-check").forEach(x=>x.addEventListener("change",updateTotals));rec.addEventListener("input",updateTotals);
    box.querySelector("#savePayment").addEventListener("click",async()=>{
      const selected=[...box.querySelectorAll(".bill-check:checked")];
      if(!selected.length){toast("Pilih minimal satu tagihan.");return;}
      const received=Number(rec.value)||0,total=selected.reduce((s,x)=>s+Number(x.dataset.due),0);
      if(received<=0){toast("Masukkan uang yang diterima.");return;}
      const allocations={};selected.forEach(x=>allocations[x.dataset.cat]=Math.min(Number(x.dataset.due),received));
      // Keamanan: penulisan transaksi keuangan produksi wajib melalui backend tepercaya.
      // Client-side multipath write sengaja tidak diaktifkan sebelum Cloud Function tersedia.
      toast("Form valid. Backend transaksi aman belum dikonfigurasi; pembayaran belum disimpan.");
    });
  });
}
