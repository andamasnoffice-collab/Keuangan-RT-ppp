import { ref, push } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";
import { db } from "./firebase.js";
import { applyMonthlySummaryDelta, setHouseholdArrearPeriod, writeAndVerify, getHouseholdArrearLedger, read, refreshPublicSnapshotSafely } from "./data.js?v=20261120-audit5";

const categories=["kas","air","sampah"];
const fixedCategories=["kas","sampah"];
const blockCollator=new Intl.Collator("id",{numeric:true,sensitivity:"base"});
const labels={kas:"Kas RT",air:"Air",sampah:"Sampah"};
const money=n=>"Rp "+new Intl.NumberFormat("id-ID",{maximumFractionDigits:0}).format(Number(n)||0);
const parseRupiah=value=>Number(String(value??"").replace(/[^0-9-]/g,""))||0;
const formatRupiahInput=value=>String(value??"").replace(/[^0-9]/g,"").replace(/\B(?=(\d{3})+(?!\d))/g,".");
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const num=n=>Math.max(0,Number(n)||0);
const monthLabel=period=>{const [y,m]=period.split("-").map(Number);return new Intl.DateTimeFormat("id-ID",{month:"long",year:"numeric"}).format(new Date(y,m-1,1));};

export async function renderPaymentPage(container,{households,monthKey,toast,currentUser}){
  const homes=Object.entries(households||{}).map(([id,h])=>({id,...h})).sort((a,b)=>blockCollator.compare(String(a.block||"").trim(),String(b.block||"").trim()));
  container.innerHTML=`<div class="panel payment-panel">
    <div class="section-head" style="margin-top:0"><div><h3>Pencatatan pembayaran warga</h3><small class="muted">Kas RT dan Sampah dilunasi penuh per bulan secara berurutan. Air menggunakan nominal dan deposit Air.</small></div><span class="pill success">Satu pintu</span></div>
    <label class="field full-row">Pilih rumah<select id="payHouse"><option value="">Pilih blok / nomor rumah</option>${homes.map(h=>`<option value="${esc(h.id)}">${esc(h.block||"")} · ${esc(h.headName||"")} · ${esc(h.address||"")}</option>`).join("")}</select></label>
    <div id="billChecklist"><div class="empty">Pilih rumah untuk menampilkan tagihan.</div></div>
  </div>`;
  const select=container.querySelector("#payHouse");
  select.addEventListener("change",async()=>{
    const id=select.value,box=container.querySelector("#billChecklist");
    if(!id){box.innerHTML='<div class="empty">Pilih rumah untuk menampilkan tagihan.</div>';return;}
    box.innerHTML='<div class="empty">Mengambil tagihan dan deposit…</div>';
    try{
      const [ledger,dep]=await Promise.all([getHouseholdArrearLedger(id),read(`deposits/${id}`)]);
      const periods=Object.keys(ledger||{}).filter(p=>/^\d{4}-(0[1-9]|1[0-2])$/.test(p)).sort();
      const periodBills=periods.map(period=>({period,categories:ledger[period]||{}}));
      const rowsFor=cat=>periodBills.filter(row=>num(row.categories?.[cat])>0);
      const ledgerYears=periods.map(p=>Number(p.slice(0,4)));
      const currentYear=new Date().getFullYear();
      const firstYear=ledgerYears.length?Math.min(currentYear,...ledgerYears):currentYear;
      const lastYear=ledgerYears.length?Math.max(currentYear,...ledgerYears):currentYear;
      const displayPeriods=[];
      for(let year=firstYear;year<=lastYear;year++){
        for(let month=1;month<=12;month++){
          const period=`${year}-${String(month).padStart(2,"0")}`;
          displayPeriods.push({period,categories:ledger[period]||{},billExists:!!ledger[period]});
        }
      }
      const fixedRows=Object.fromEntries(fixedCategories.map(cat=>[cat,displayPeriods.map(row=>({
        ...row,billExists:row.billExists&&Object.prototype.hasOwnProperty.call(row.categories,cat),
        amount:num(row.categories?.[cat])
      }))]));
      const airRows=rowsFor("air");
      const airGross=airRows.reduce((sum,row)=>sum+num(row.categories.air),0);
      const airDeposit=num(dep?.air);
      const airDepositUsed=Math.min(airGross,airDeposit);
      box.innerHTML=`
        <div class="section-head payment-period"><h3>Daftar tagihan rumah</h3><span class="pill">Tagihan yang sudah tersedia</span></div>
        <div class="payment-categories">
          ${fixedCategories.map(cat=>{
            const rows=fixedRows[cat];
            return `<section class="payment-category" data-category="${cat}">
              <div class="payment-category-head"><div><h4>${labels[cat]}</h4><span class="muted tiny">Centang bulan yang dilunasi penuh</span></div><strong class="fixed-total">${money(0)}</strong></div>
              <div class="payment-month-checklist" data-fixed-list="${cat}">
                ${rows.map(row=>{
                  const paid=row.billExists&&row.amount===0;
                  const status=!row.billExists?"Tagihan belum dibuat":paid?"Sudah lunas":`Sisa tagihan: ${money(row.amount)}`;
                  return `<label class="pay-month-row ${paid?"is-paid":!row.billExists?"is-not-created":""}"><input type="checkbox" class="fixed-month-check" data-period="${row.period}" data-amount="${row.amount}" data-bill-exists="${row.billExists}" ${paid?"checked disabled":!row.billExists?"disabled":""}><span><b>${monthLabel(row.period)}</b><small>${status}</small></span><strong>${row.billExists?money(row.amount):"—"}</strong></label>`;
                }).join("")}
              </div>
              <small class="muted fixed-help">Wajib berurutan. Centang bulan pertama yang belum lunas, lalu bulan berikutnya. Tidak bisa melompati bulan.</small>
            </section>`;
          }).join("")}
          <section class="payment-category" data-category="air">
            <div class="payment-category-head"><div><h4>Air</h4><span class="muted tiny">Pembayaran nominal bebas</span></div><strong>${money(airGross)}</strong></div>
            <div class="payment-metrics payment-arrears-metrics">
              <div><small>Total sisa tagihan Air</small><b>${money(airGross)}</b></div>
              <div><small>Deposit Air tersedia</small><b>${money(airDeposit)}</b></div>
            </div>
            <div class="muted tiny payment-deposit-note">Deposit Air otomatis digunakan sebesar ${money(airDepositUsed)}. Deposit Kas RT dan Sampah tidak digunakan.</div>
            <label class="field payment-amount-field">Nominal tunai Air (Rp)<input class="air-payment-amount" type="text" inputmode="numeric" data-rupiah value="0"><small class="payment-result">Belum ada pembayaran Air.</small></label>
          </section>
        </div>
        <div class="form-grid payment-meta">
          <label class="field">Tanggal pembayaran<input id="paymentDate" type="date" value="${new Date().toISOString().slice(0,10)}"></label>
          <label class="field">Metode pembayaran<select id="paymentMethod"><option>Tunai</option><option>Transfer</option><option>QRIS</option></select></label>
          <label class="field full-row">Catatan / nomor bukti (opsional)<input id="paymentNote" maxlength="180" placeholder="Nomor kuitansi atau catatan pembayaran"></label>
        </div>
        <div class="summary-box payment-summary">
          <div class="summary-line"><span>Kas RT dipilih</span><b id="sumKas">${money(0)}</b></div>
          <div class="summary-line"><span>Sampah dipilih</span><b id="sumSampah">${money(0)}</b></div>
          <div class="summary-line"><span>Deposit Air digunakan</span><b id="sumDeposit">${money(airDepositUsed)}</b></div>
          <div class="summary-line"><span>Tunai diterima</span><b id="sumCash">${money(0)}</b></div>
          <div class="summary-line"><span>Kelebihan Air menjadi deposit</span><b id="sumSurplus">${money(0)}</b></div>
          <div class="summary-line"><span>Sisa tagihan Air setelah pembayaran</span><b id="sumAirShort">${money(Math.max(0,airGross-airDepositUsed))}</b></div>
          <div class="summary-line"><span><b>Total tunai yang diterima</b></span><b id="sumTotal">${money(0)}</b></div>
        </div>
        <p class="muted-note payment-note">Kas RT dan Sampah selalu dibayar penuh sesuai nominal bulan yang dicentang. Air dapat dibayar sebagian; kelebihan pembayaran Air masuk ke deposit Air.</p>
        <button id="savePayment" class="btn primary full" type="button">Simpan pembayaran</button>`;
      const allFixedChecks=[...box.querySelectorAll(".fixed-month-check")];
      const airInput=box.querySelector(".air-payment-amount");
      const getSelected=cat=>[...box.querySelectorAll(`.payment-category[data-category="${cat}"] .fixed-month-check:checked`)].filter(c=>num(c.dataset.amount)>0);
      const updateFixed=cat=>{
        const checks=[...box.querySelectorAll(`.payment-category[data-category="${cat}"] .fixed-month-check`)];
        const billable=checks.filter(c=>c.dataset.billExists==="true");
        let openIndex=billable.findIndex(c=>!c.checked);
        checks.forEach(c=>{
          if(c.dataset.billExists!=="true"){c.disabled=true;return;}
          if(c.checked&&num(c.dataset.amount)===0){c.disabled=true;return;}
          c.disabled=openIndex<0?true:billable.indexOf(c)>openIndex;
        });
        const total=checks.filter(c=>c.checked&&num(c.dataset.amount)>0).reduce((s,c)=>s+num(c.dataset.amount),0);
        box.querySelector(`.payment-category[data-category="${cat}"] .fixed-total`).textContent=money(total);
      };
      const calculate=()=>{
        const kas=getSelected("kas").reduce((s,c)=>s+num(c.dataset.amount),0);
        const sampah=getSelected("sampah").reduce((s,c)=>s+num(c.dataset.amount),0);
        const airCash=parseRupiah(airInput.value);
        const airApplied=Math.min(airCash,Math.max(0,airGross-airDepositUsed));
        const surplus=Math.max(0,airCash-airApplied);
        const airShort=Math.max(0,airGross-airDepositUsed-airApplied);
        box.querySelector("#sumKas").textContent=money(kas);
        box.querySelector("#sumSampah").textContent=money(sampah);
        box.querySelector("#sumDeposit").textContent=money(airDepositUsed);
        box.querySelector("#sumCash").textContent=money(kas+sampah+airCash);
        box.querySelector("#sumSurplus").textContent=money(surplus);
        box.querySelector("#sumAirShort").textContent=money(airShort);
        box.querySelector("#sumTotal").textContent=money(kas+sampah+airCash);
        airInput.nextElementSibling.textContent=surplus>0?`Lebih bayar menjadi deposit Air: ${money(surplus)}`:airShort>0?`Sisa tagihan Air: ${money(airShort)}`:airGross>0?"Tagihan Air lunas.":"Tidak ada tagihan Air.";
      };
      allFixedChecks.forEach(check=>check.addEventListener("change",()=>{
        const cat=check.closest(".payment-category").dataset.category;
        if(!check.checked){
          const checks=[...box.querySelectorAll(`.payment-category[data-category="${cat}"] .fixed-month-check`)];
          const billable=checks.filter(c=>c.dataset.billExists==="true");
          const idx=billable.indexOf(check);
          billable.slice(idx+1).forEach(c=>{if(num(c.dataset.amount)>0)c.checked=false;});
        }
        updateFixed(cat);calculate();
      }));
      airInput.addEventListener("input",()=>{airInput.value=formatRupiahInput(airInput.value);calculate();});
      fixedCategories.forEach(updateFixed);calculate();
      box.querySelector("#savePayment").addEventListener("click",async()=>{
        const button=box.querySelector("#savePayment");
        const selected=Object.fromEntries(fixedCategories.map(cat=>[cat,getSelected(cat).map(c=>({period:c.dataset.period,amount:num(c.dataset.amount)}))]));
        const kasTotal=selected.kas.reduce((s,x)=>s+x.amount,0),sampahTotal=selected.sampah.reduce((s,x)=>s+x.amount,0);
        const airCash=parseRupiah(airInput.value),airApplied=Math.min(airCash,Math.max(0,airGross-airDepositUsed)),airSurplus=Math.max(0,airCash-airApplied);
        if(!kasTotal&&!sampahTotal&&!airDepositUsed&&!airCash){toast("Centang bulan Kas RT/Sampah atau isi pembayaran Air terlebih dahulu.");return;}
        const date=box.querySelector("#paymentDate").value;
        if(!date){toast("Tanggal pembayaran wajib diisi.");return;}
        button.disabled=true;button.textContent="Menyimpan…";
        let primarySaved=false,summaryDeltasRecovery=[],paymentPeriodRecovery="";
        try{
          const updates={},timestamp=Date.now(),paymentPeriod=String(date).slice(0,7);
          paymentPeriodRecovery=paymentPeriod;
          const paymentRef=push(ref(db,`paymentsByMonth/${paymentPeriod}`));
          const summaryDeltas=[];summaryDeltasRecovery=summaryDeltas;
          let totalApplied=0,totalDepositUsed=0,totalSurplus=0;
          const items=[];
          for(const cat of fixedCategories){
            const chosen=selected[cat];
            for(const item of chosen){
              const current=await read(`bills/${item.period}/${id}/${cat}`)||{};
              const currentRemaining=num(current.remaining??item.amount);
              if(currentRemaining<=0)throw new Error(`Tagihan ${labels[cat]} ${monthLabel(item.period)} sudah lunas. Muat ulang data sebelum menyimpan.`);
              if(currentRemaining!==item.amount)throw new Error(`Nominal tagihan ${labels[cat]} ${monthLabel(item.period)} berubah. Muat ulang data sebelum menyimpan.`);
              updates[`bills/${item.period}/${id}/${cat}/paidAmount`]=num(current.paidAmount)+currentRemaining;
              updates[`bills/${item.period}/${id}/${cat}/remaining`]=0;
              updates[`bills/${item.period}/${id}/${cat}/status`]="paid";
              updates[`arrearsLedger/${id}/${item.period}/${cat}`]=0;
              const txRef=push(ref(db,`transactionsByMonth/${paymentPeriod}`));
              const desc=`Pelunasan ${labels[cat]} bulan ${monthLabel(item.period)}`;
              updates[`transactionsByMonth/${paymentPeriod}/${txRef.key}`]={id:txRef.key,type:"payment",category:cat,amount:currentRemaining,householdId:id,referenceId:paymentRef.key,date,description:desc,recordedBy:currentUser?.uid||null,createdAt:timestamp};
              summaryDeltas.push({id:txRef.key,category:cat,amount:currentRemaining,description:desc});
              totalApplied+=currentRemaining;
              items.push({cat,period:item.period,cash:currentRemaining,depositUsed:0,applied:currentRemaining,surplus:0,remaining:0});
            }
          }
          for(const cat of fixedCategories){
            const amount=selected[cat].reduce((sum,item)=>sum+item.amount,0);
            if(amount>0){
              const balance=await read(`category_balances/${cat}`)||{};
              updates[`category_balances/${cat}`]={...balance,balance:num(balance.balance)+amount,income:num(balance.income)+amount,updatedAt:timestamp};
            }
          }
          if(airGross>0||airCash>0||airDepositUsed>0){
            let depositLeft=airDepositUsed,cashLeft=airApplied;
            for(const row of airRows){
              const due=num(row.categories.air);
              if(due<=0)continue;
              const useDeposit=Math.min(due,depositLeft);depositLeft-=useDeposit;
              const useCash=Math.min(Math.max(0,due-useDeposit),cashLeft);cashLeft-=useCash;
              const paidNow=useDeposit+useCash;
              if(paidNow>0){
                const current=await read(`bills/${row.period}/${id}/air`)||{};
                const currentRemaining=num(current.remaining??(Number(current.amount||0)-Number(current.paidAmount||0)));
                if(currentRemaining!==due)throw new Error(`Sisa tagihan Air ${monthLabel(row.period)} berubah. Muat ulang data sebelum menyimpan.`);
                const remaining=Math.max(0,currentRemaining-paidNow);
                updates[`bills/${row.period}/${id}/air/paidAmount`]=num(current.paidAmount)+paidNow;
                updates[`bills/${row.period}/${id}/air/remaining`]=remaining;
                updates[`bills/${row.period}/${id}/air/status`]=remaining===0?"paid":"partial";
                updates[`arrearsLedger/${id}/${row.period}/air`]=remaining;
              }
            }
            const newAirDeposit=airDeposit-airDepositUsed+airSurplus;
            updates[`deposits/${id}/air`]=newAirDeposit;
            if(airDepositUsed||airSurplus){
              const depositRef=push(ref(db,"deposit_ledger"));
              updates[`deposit_ledger/${depositRef.key}`]={householdId:id,category:"air",amount:airSurplus-airDepositUsed,before:airDeposit,after:newAirDeposit,type:airSurplus&&airDepositUsed?"deposit_adjustment":airSurplus?"deposit_in":"deposit_applied",date,createdAt:timestamp,paymentId:paymentRef.key};
            }
            const airAppliedTotal=airApplied+airDepositUsed;
            if(airAppliedTotal>0){
              const balance=await read("category_balances/air")||{};
              updates["category_balances/air"]={...balance,balance:num(balance.balance)+airAppliedTotal,income:num(balance.income)+airAppliedTotal,updatedAt:timestamp};
              const txRef=push(ref(db,`transactionsByMonth/${paymentPeriod}`));
              const desc=airDepositUsed&&airApplied?"Pembayaran Air (tunai + deposit)":airDepositUsed?"Pelunasan Air dari deposit":"Pembayaran Air";
              updates[`transactionsByMonth/${paymentPeriod}/${txRef.key}`]={id:txRef.key,type:"payment",category:"air",amount:airAppliedTotal,householdId:id,referenceId:paymentRef.key,date,description:desc,recordedBy:currentUser?.uid||null,createdAt:timestamp};
              summaryDeltas.push({id:txRef.key,category:"air",amount:airAppliedTotal,description:desc});
              totalApplied+=airAppliedTotal;
            }
            totalDepositUsed+=airDepositUsed;totalSurplus+=airSurplus;
            items.push({cat:"air",cash:airCash,depositUsed:airDepositUsed,applied:airAppliedTotal,surplus:airSurplus,remaining:Math.max(0,airGross-airDepositUsed-airApplied)});
          }
          const totalCash=kasTotal+sampahTotal+airCash;
          updates[`paymentsByMonth/${paymentPeriod}/${paymentRef.key}`]={id:paymentRef.key,householdId:id,householdLabel:homes.find(h=>h.id===id)?.block||"",period:paymentPeriod,date,method:box.querySelector("#paymentMethod").value,note:box.querySelector("#paymentNote").value.trim(),items,cashReceived:totalCash,depositUsed:totalDepositUsed,appliedToBills:totalApplied,surplusDeposit:totalSurplus,recordedBy:currentUser?.uid||null,createdAt:timestamp};
          const auditRef=push(ref(db,"audit_logs"));
          updates[`audit_logs/${auditRef.key}`]={type:"payment_recorded",paymentId:paymentRef.key,householdId:id,period:paymentPeriod,recordedBy:currentUser?.uid||null,createdAt:timestamp};
          await writeAndVerify(updates,[`paymentsByMonth/${paymentPeriod}/${paymentRef.key}`]);
          primarySaved=true;
          for(const item of summaryDeltas)await applyMonthlySummaryDelta(paymentPeriod,item.id,{type:"income",category:item.category,amount:item.amount,date,description:item.description});
          for(const cat of categories){
            for(const row of periodBills){
              const path=`bills/${row.period}/${id}/${cat}/remaining`;
              if(Object.prototype.hasOwnProperty.call(updates,path))await setHouseholdArrearPeriod(id,row.period,cat,updates[path]);
            }
          }
          const publicSynced=await refreshPublicSnapshotSafely();
          toast(publicSynced?"Pembayaran tersimpan, arus kas diperbarui, dan daftar publik disinkronkan.":"Pembayaran tersimpan, tetapi sinkronisasi daftar publik tertunda.");
          select.dispatchEvent(new Event("change"));
        }catch(err){
          if(primarySaved){
            try{
              for(const item of summaryDeltasRecovery)await applyMonthlySummaryDelta(paymentPeriodRecovery,item.id,{type:"income",category:item.category,amount:item.amount,date,description:item.description});
              const latestLedger=await getHouseholdArrearLedger(id);
              for(const cat of categories)for(const row of periodBills)await setHouseholdArrearPeriod(id,row.period,cat,latestLedger?.[row.period]?.[cat]||0);
              const synced=await refreshPublicSnapshotSafely();
              toast(synced?"Pembayaran tersimpan dan sinkronisasi ringkasan berhasil dipulihkan.":"Pembayaran tersimpan; sinkronisasi publik masih tertunda.");
            }catch(recoveryError){
              toast("Pembayaran utama sudah tersimpan. Jangan ulangi pembayaran ini; perlu pemeriksaan sinkronisasi: "+recoveryError.message);
            }
            select.dispatchEvent(new Event("change"));
          }else toast("Gagal menyimpan pembayaran: "+err.message);
        }
        finally{button.disabled=false;button.textContent="Simpan pembayaran";}
      });
    }catch(err){box.innerHTML=`<div class="muted-note">Gagal memuat tagihan: ${esc(err.message)}</div>`;}
  });
}
