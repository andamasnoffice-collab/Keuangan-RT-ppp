import { ref, push, update } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";
import { db } from "./firebase.js";

const categories=["kas","air","sampah"];
const labels={kas:"Kas RT",air:"Kas Air",sampah:"Uang Sampah"};
const money=n=>"Rp "+new Intl.NumberFormat("id-ID",{maximumFractionDigits:0}).format(Number(n)||0);
const parseRupiah=value=>Number(String(value??"").replace(/[^0-9-]/g,""))||0;
const formatRupiahInput=value=>String(value??"").replace(/[^0-9]/g,"").replace(/\\B(?=(\\d{3})+(?!\\d))/g,".");
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const num=n=>Math.max(0,Number(n)||0);

export async function renderPaymentPage(container,{households,monthKey,toast,currentUser}){
  const homes=Object.entries(households||{}).map(([id,h])=>({id,...h})).sort((a,b)=>String(a.block||"").localeCompare(String(b.block||"")));
  container.innerHTML=`<div class="panel payment-panel">
    <div class="section-head" style="margin-top:0"><div><h3>Pencatatan pembayaran warga</h3><small class="muted">Pembayaran dan deposit dihitung terpisah untuk setiap kategori.</small></div><span class="pill success">Satu pintu</span></div>
    <label class="field full-row">Pilih rumah<select id="payHouse"><option value="">Pilih blok / nomor rumah</option>${homes.map(h=>`<option value="${esc(h.id)}">${esc(h.block||"")} · ${esc(h.headName||"")} · ${esc(h.address||"")}</option>`).join("")}</select></label>
    <div id="billChecklist"><div class="empty">Pilih rumah untuk menampilkan tagihan dan deposit.</div></div>
  </div>`;
  const select=container.querySelector("#payHouse");
  select.addEventListener("change",async()=>{
    const id=select.value,box=container.querySelector("#billChecklist");
    if(!id){box.innerHTML='<div class="empty">Pilih rumah untuk menampilkan tagihan dan deposit.</div>';return;}
    box.innerHTML='<div class="empty">Mengambil tagihan dan deposit…</div>';
    try{
      const {getMonthBills,read}=await import("./data.js");
      const [allBills,dep]=await Promise.all([getMonthBills(monthKey),read(`deposits/${id}`)]);
      const bill=allBills[id]||{};
      box.innerHTML=`
        <div class="section-head payment-period"><h3>Tagihan periode ${esc(monthKey)}</h3><span class="pill">Deposit otomatis diperhitungkan</span></div>
        <div class="payment-categories">${categories.map(cat=>{
          const b=bill[cat]||{};
          const gross=num(b.remaining??(num(b.amount)-num(b.paidAmount)));
          const deposit=num(dep?.[cat]);
          const depositUsed=Math.min(gross,deposit);
          const net=Math.max(0,gross-depositUsed);
          return `<section class="payment-category" data-category="${cat}" data-gross="${gross}" data-deposit="${deposit}" data-deposit-used="${depositUsed}" data-net="${net}">
            <div class="payment-category-head"><div><h4>${labels[cat]}</h4><span class="muted tiny">Sisa tagihan sebelum deposit</span></div><strong>${money(gross)}</strong></div>
            <div class="payment-metrics">
              <div><small>Deposit tersedia</small><b>${money(deposit)}</b></div>
              <div><small>Deposit dipakai</small><b class="deposit-used">${money(depositUsed)}</b></div>
              <div><small>Sisa setelah deposit</small><b class="net-due">${money(net)}</b></div>
            </div>
            <label class="pay-exact"><input type="checkbox" class="pay-exact-check" ${net<=0?"disabled":""}><span><b>Bayar pas</b><small>Isi otomatis sebesar sisa setelah deposit</small></span></label>
            <label class="field payment-amount-field">Nominal dibayar manual (Rp)<input class="payment-amount" type="text" inputmode="numeric" data-rupiah value="0"><small class="payment-result">Belum ada pembayaran manual.</small></label>
          </section>`;
        }).join("")}</div>
        <div class="form-grid payment-meta">
          <label class="field">Tanggal pembayaran<input id="paymentDate" type="date" value="${new Date().toISOString().slice(0,10)}"></label>
          <label class="field">Metode pembayaran<select id="paymentMethod"><option>Tunai</option><option>Transfer</option><option>QRIS</option></select></label>
          <label class="field full-row">Catatan / nomor bukti (opsional)<input id="paymentNote" maxlength="180" placeholder="Nomor kuitansi atau catatan pembayaran"></label>
        </div>
        <div class="summary-box payment-summary">
          <div class="summary-line"><span>Total tagihan awal</span><b id="sumGross">${money(0)}</b></div>
          <div class="summary-line"><span>Deposit yang digunakan</span><b id="sumDeposit">${money(0)}</b></div>
          <div class="summary-line"><span>Pembayaran manual</span><b id="sumCash">${money(0)}</b></div>
          <div class="summary-line"><span>Kelebihan menjadi deposit</span><b id="sumSurplus">${money(0)}</b></div>
          <div class="summary-line"><span>Sisa kurang bayar</span><b id="sumShort">${money(0)}</b></div>
        </div>
        <p class="muted-note payment-note">Deposit otomatis mengurangi tagihan kategori yang sama. Jika pembayaran manual melebihi sisa tagihan, kelebihannya masuk deposit kategori tersebut. Deposit tidak dapat dipindahkan antar-kategori.</p>
        <button id="savePayment" class="btn primary full" type="button">Simpan pembayaran</button>`;
      box.querySelectorAll("input[data-rupiah]").forEach(input=>{input.addEventListener("input",()=>{input.value=formatRupiahInput(input.value);});});
      const cards=[...box.querySelectorAll(".payment-category")];
      const calculate=()=>{
        let gross=0,depositUsed=0,cash=0,surplus=0,short=0;
        cards.forEach(card=>{
          const due=num(card.dataset.net),depUsed=num(card.dataset.depositUsed);
          const input=card.querySelector(".payment-amount"),check=card.querySelector(".pay-exact-check");
          if(check.checked) input.value=String(due);
          const paid=parseRupiah(input.value),applied=Math.min(paid,due),extra=Math.max(0,paid-due),remaining=Math.max(0,due-paid);
          card.querySelector(".payment-result").textContent=extra>0?`Lebih bayar menjadi deposit: ${money(extra)}`:remaining>0?`Kurang bayar: ${money(remaining)}`:due===0?"Tidak ada pembayaran manual yang diperlukan.":"Tagihan kategori ini lunas.";
          gross+=num(card.dataset.gross);depositUsed+=depUsed;cash+=paid;surplus+=extra;short+=remaining;
        });
        box.querySelector("#sumGross").textContent=money(gross);
        box.querySelector("#sumDeposit").textContent=money(depositUsed);
        box.querySelector("#sumCash").textContent=money(cash);
        box.querySelector("#sumSurplus").textContent=money(surplus);
        box.querySelector("#sumShort").textContent=money(short);
      };
      cards.forEach(card=>{
        card.querySelector(".pay-exact-check").addEventListener("change",e=>{if(!e.target.checked)card.querySelector(".payment-amount").value="0";calculate();});
        card.querySelector(".payment-amount").addEventListener("input",()=>{if(!card.querySelector(".pay-exact-check").checked)calculate();});
      });
      calculate();
      box.querySelector("#savePayment").addEventListener("click",async()=>{
        const button=box.querySelector("#savePayment");
        const entries=cards.map(card=>{
          const cat=card.dataset.category,gross=num(card.dataset.gross),deposit=num(card.dataset.deposit),depositUsed=num(card.dataset.depositUsed),net=num(card.dataset.net),cash=parseRupiah(card.querySelector(".payment-amount").value);
          return {cat,gross,deposit,depositUsed,net,cash,applied:Math.min(cash,net),surplus:Math.max(0,cash-net),remaining:Math.max(0,net-cash)};
        }).filter(x=>(x.gross>0||x.cash>0)&&(x.depositUsed>0||x.cash>0));
        if(!entries.length){toast("Tidak ada pembayaran atau penggunaan deposit untuk disimpan.");return;}
        const date=box.querySelector("#paymentDate").value;
        if(!date){toast("Tanggal pembayaran wajib diisi.");return;}
        button.disabled=true;button.textContent="Menyimpan…";
        try{
          const updates={},timestamp=Date.now();
          const paymentRef=push(ref(db,"payments"));
          const transactionIds=[];
          let totalCash=0,totalApplied=0,totalDepositUsed=0,totalSurplus=0;
          for(const x of entries){
            const {cat}=x;
            const currentBill=bill[cat]||{};
            const oldPaid=num(currentBill.paidAmount);
            const newPaid=oldPaid+x.depositUsed+x.applied;
            const newRemaining=Math.max(0,x.gross-x.depositUsed-x.applied);
            const oldDeposit=x.deposit;
            const newDeposit=oldDeposit-x.depositUsed+x.surplus;
            updates[`bills/${monthKey}/${id}/${cat}/paidAmount`]=newPaid;
            updates[`bills/${monthKey}/${id}/${cat}/remaining`]=newRemaining;
            updates[`bills/${monthKey}/${id}/${cat}/status`]=newRemaining===0?"paid":"partial";
            updates[`deposits/${id}/${cat}`]=newDeposit;
            const ledgerRef=push(ref(db,"deposit_ledger"));
            updates[`deposit_ledger/${ledgerRef.key}`]={householdId:id,category:cat,amount:x.surplus-x.depositUsed,before:oldDeposit,after:newDeposit,type:x.surplus>0&&x.depositUsed>0?"deposit_adjustment":x.surplus>0?"deposit_in":x.depositUsed>0?"deposit_applied":"payment",date,createdAt:timestamp,paymentId:paymentRef.key};
            const balanceRef=push(ref(db,"transactions"));
            transactionIds.push(balanceRef.key);
            if(x.applied>0){
              const balancePath=`category_balances/${cat}`;
              const {read}=await import("./data.js");
              const balance=await read(balancePath)||{};
              updates[balancePath]={...balance,balance:num(balance.balance)+x.applied,income:num(balance.income)+x.applied,updatedAt:timestamp};
              updates[`transactions/${balanceRef.key}`]={id:balanceRef.key,type:"payment",category:cat,amount:x.applied,householdId:id,referenceId:paymentRef.key,date,description:`Pembayaran ${labels[cat]}`,recordedBy:currentUser?.uid||null,createdAt:timestamp};
            }else{
              updates[`transactions/${balanceRef.key}`]=null;
            }
            totalCash+=x.cash;totalApplied+=x.applied;totalDepositUsed+=x.depositUsed;totalSurplus+=x.surplus;
          }
          updates[`payments/${paymentRef.key}`]={id:paymentRef.key,householdId:id,householdLabel:homes.find(h=>h.id===id)?.block||"",period:monthKey,date,method:box.querySelector("#paymentMethod").value,note:box.querySelector("#paymentNote").value.trim(),items:entries.map(x=>({...x})),cashReceived:totalCash,depositUsed:totalDepositUsed,appliedToBills:totalApplied,surplusDeposit:totalSurplus,recordedBy:currentUser?.uid||null,createdAt:timestamp};
          const auditRef=push(ref(db,"audit_logs"));
          updates[`audit_logs/${auditRef.key}`]={type:"payment_recorded",paymentId:paymentRef.key,householdId:id,period:monthKey,recordedBy:currentUser?.uid||null,createdAt:timestamp};
          await update(ref(db),updates);
          toast("Pembayaran tersimpan. Deposit dan sisa tagihan diperbarui.");
          await select.dispatchEvent(new Event("change"));
        }catch(err){toast("Gagal menyimpan pembayaran: "+err.message);}
        finally{button.disabled=false;button.textContent="Simpan pembayaran";}
      });
    }catch(err){box.innerHTML=`<div class="muted-note">Gagal memuat tagihan: ${esc(err.message)}</div>`;}
  });
}
