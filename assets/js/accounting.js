/**
 * Double-entry accounting primitives for Keuangan RT.
 * Monetary values are integer rupiah. Every posted entry must balance.
 */
export const ACCOUNT = Object.freeze({
  CASH_KAS:"asset.cash.kas", CASH_AIR:"asset.cash.air", CASH_SAMPAH:"asset.cash.sampah",
  AR_KAS:"asset.receivable.kas", AR_AIR:"asset.receivable.air", AR_SAMPAH:"asset.receivable.sampah",
  DEPOSIT_KAS:"liability.deposit.kas", DEPOSIT_AIR:"liability.deposit.air", DEPOSIT_SAMPAH:"liability.deposit.sampah",
  ADVANCE_KAS:"liability.advance.kas", ADVANCE_AIR:"liability.advance.air", ADVANCE_SAMPAH:"liability.advance.sampah",
  REVENUE_KAS:"revenue.kas", REVENUE_AIR:"revenue.air", REVENUE_SAMPAH:"revenue.sampah",
  EXPENSE_KAS:"expense.kas", EXPENSE_AIR:"expense.air", EXPENSE_SAMPAH:"expense.sampah",
  OPENING_EQUITY:"equity.opening_balance"
});
const CATS=["kas","air","sampah"];
const amount=n=>{const v=Number(n);if(!Number.isSafeInteger(v)||v<0)throw new Error("Nominal jurnal harus bilangan bulat rupiah >= 0.");return v;};
const line=(account,debit=0,credit=0,meta={})=>({account,debit:amount(debit),credit:amount(credit),...meta});
export function assertBalanced(lines){
  if(!Array.isArray(lines)||lines.length<2)throw new Error("Jurnal minimal memiliki dua baris.");
  const debit=lines.reduce((s,x)=>s+amount(x.debit||0),0),credit=lines.reduce((s,x)=>s+amount(x.credit||0),0);
  if(debit!==credit)throw new Error(`Jurnal tidak seimbang: debit ${debit}, kredit ${credit}.`);
  return {debit,credit};
}
export function createJournalEntry({id,sourceType,sourceId,date,period,description,householdId=null,lines,createdAt=Date.now()}){
  if(!id||!sourceType||!sourceId)throw new Error("ID jurnal dan referensi sumber wajib diisi.");
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(period||""))throw new Error("Periode jurnal tidak valid.");
  const totals=assertBalanced(lines);
  return {id,sourceType,sourceId,date:date||null,period,description:String(description||"").slice(0,180),householdId,lines,totals,createdAt};
}
export function buildInvoiceJournal({id,period,date,householdId,category,amount:rawAmount,createdAt}){
  if(!CATS.includes(category))throw new Error("Kategori tagihan tidak valid.");
  const n=amount(rawAmount); if(!n)return null;
  return createJournalEntry({id,sourceType:"invoice",sourceId:id,date,period,householdId,description:"Pengakuan tagihan "+category,createdAt,lines:[
    line(ACCOUNT["AR_"+category.toUpperCase()],n,0,{householdId,category}),
    line(ACCOUNT["REVENUE_"+category.toUpperCase()],0,n,{category})
  ]});
}
export function buildInvoiceAdjustmentJournal({id,period,date,householdId,category,delta,createdAt}){
  if(!CATS.includes(category))throw new Error("Kategori penyesuaian tidak valid.");
  const n=amount(Math.abs(Number(delta)||0));if(!n)return null;
  const lines=delta>0?[
    line(ACCOUNT["AR_"+category.toUpperCase()],n,0,{householdId,category}),
    line(ACCOUNT["REVENUE_"+category.toUpperCase()],0,n,{category})
  ]:[
    line(ACCOUNT["REVENUE_"+category.toUpperCase()],n,0,{category}),
    line(ACCOUNT["AR_"+category.toUpperCase()],0,n,{householdId,category})
  ];
  return createJournalEntry({id,sourceType:"invoice_adjustment",sourceId:id,date,period,householdId,description:"Penyesuaian tagihan "+category,createdAt,lines});
}
export function buildPaymentJournal({id,period,date,householdId,items,createdAt}){
  const lines=[];
  for(const item of items||[]){
    const cat=item.category||item.cat;if(!CATS.includes(cat))throw new Error("Kategori pembayaran tidak valid.");
    const cash=amount(item.cash||0),depositUsed=amount(item.depositUsed||0),applied=amount(item.applied||0),surplus=amount(item.surplus||0);
    if(cash)lines.push(line(ACCOUNT["CASH_"+cat.toUpperCase()],cash,0,{category:cat}));
    if(depositUsed)lines.push(line(ACCOUNT["DEPOSIT_"+cat.toUpperCase()],depositUsed,0,{category:cat,householdId}));
    if(applied)lines.push(line(item.advance?ACCOUNT["ADVANCE_"+cat.toUpperCase()]:ACCOUNT["AR_"+cat.toUpperCase()],0,applied,{category:cat,householdId}));
    if(surplus)lines.push(line(ACCOUNT["DEPOSIT_"+cat.toUpperCase()],0,surplus,{category:cat,householdId}));
  }
  if(!lines.length)return null;
  return createJournalEntry({id,sourceType:"payment",sourceId:id,date,period,householdId,description:"Penerimaan pembayaran warga",createdAt,lines});
}
export function buildAdvanceApplicationJournal({id,period,date,householdId,category,amount:rawAmount,createdAt}){
  if(!CATS.includes(category))throw new Error("Kategori uang muka tidak valid.");
  const n=amount(rawAmount);if(!n)return null;
  return createJournalEntry({id,sourceType:"advance_application",sourceId:id,date,period,householdId,description:"Penerapan pembayaran di muka "+category,createdAt,lines:[
    line(ACCOUNT["ADVANCE_"+category.toUpperCase()],n,0,{category,householdId}),
    line(ACCOUNT["AR_"+category.toUpperCase()],0,n,{category,householdId})
  ]});
}
export function buildExpenseJournal({id,period,date,category,amount:rawAmount,description,createdAt}){
  if(!CATS.includes(category))throw new Error("Kategori pengeluaran tidak valid.");
  const n=amount(rawAmount);if(!n)return null;
  return createJournalEntry({id,sourceType:"expense",sourceId:id,date,period,description,createdAt,lines:[
    line(ACCOUNT["EXPENSE_"+category.toUpperCase()],n,0,{category}),
    line(ACCOUNT["CASH_"+category.toUpperCase()],0,n,{category})
  ]});
}
export function buildOpeningJournal({id,period,date,cash={},receivables={},deposits={},createdAt}){
  const lines=[];
  for(const cat of CATS){
    const c=amount(cash[cat]||0),r=amount(receivables[cat]||0),d=amount(deposits[cat]||0);
    if(c)lines.push(line(ACCOUNT["CASH_"+cat.toUpperCase()],c,0,{category:cat}));
    if(r)lines.push(line(ACCOUNT["AR_"+cat.toUpperCase()],r,0,{category:cat}));
    if(d)lines.push(line(ACCOUNT["DEPOSIT_"+cat.toUpperCase()],0,d,{category:cat}));
  }
  const debits=lines.reduce((s,x)=>s+x.debit,0),credits=lines.reduce((s,x)=>s+x.credit,0);
  if(debits>credits)lines.push(line(ACCOUNT.OPENING_EQUITY,0,debits-credits));
  else if(credits>debits)lines.push(line(ACCOUNT.OPENING_EQUITY,credits-debits,0));
  if(!lines.length)return null;
  return createJournalEntry({id,sourceType:"opening_balance",sourceId:id,date,period,description:"Saldo awal pembukuan",createdAt,lines});
}
export function summarizeLedger(entries){
  const accounts={};
  for(const entry of Object.values(entries||{})){
    assertBalanced(entry.lines||[]);
    for(const l of entry.lines||[]){
      const a=accounts[l.account]||(accounts[l.account]={debit:0,credit:0,balance:0});
      a.debit+=amount(l.debit||0);a.credit+=amount(l.credit||0);
      a.balance+=amount(l.debit||0)-amount(l.credit||0);
    }
  }
  const totalDebit=Object.values(accounts).reduce((s,a)=>s+a.debit,0);
  const totalCredit=Object.values(accounts).reduce((s,a)=>s+a.credit,0);
  return {accounts,totalDebit,totalCredit,balanced:totalDebit===totalCredit};
}
export function cashFlow(entries,{from,to}={}){
  const rows=[];
  for(const entry of Object.values(entries||{})){
    if(from&&entry.period<from||to&&entry.period>to)continue;
    if(entry.sourceType==="opening_balance")continue;
    for(const l of entry.lines||[]){
      if(!l.account.startsWith("asset.cash."))continue;
      const amount=Number(l.debit||0)-Number(l.credit||0);
      if(amount)rows.push({date:entry.date,period:entry.period,description:entry.description,account:l.account,amount,sourceId:entry.sourceId});
    }
  }
  const inflow=rows.filter(x=>x.amount>0).reduce((s,x)=>s+x.amount,0),outflow=rows.filter(x=>x.amount<0).reduce((s,x)=>s-x.amount,0);
  return {rows,inflow,outflow,net:inflow-outflow};
}
export function trialBalance(entries){
  const {accounts,totalDebit,totalCredit,balanced}=summarizeLedger(entries);
  return {rows:Object.entries(accounts).map(([account,v])=>({account,...v})),totalDebit,totalCredit,balanced};
}
