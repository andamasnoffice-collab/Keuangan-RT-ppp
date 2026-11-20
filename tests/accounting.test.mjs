import test from "node:test";
import assert from "node:assert/strict";
import {buildInvoiceJournal,buildPaymentJournal,buildExpenseJournal,buildOpeningJournal,summarizeLedger,cashFlow,trialBalance} from "../assets/js/accounting.js";
const period="2026-11",date="2026-11-20";
test("invoice accrual records receivable and revenue, not cash",()=>{
 const j=buildInvoiceJournal({id:"inv1",period,date,householdId:"h1",category:"kas",amount:100000});
 assert.equal(j.totals.debit,100000);assert.equal(j.lines.some(x=>x.account==="asset.cash.kas"),false);
});
test("partial cash payment balances and increases cash only by received amount",()=>{
 const j=buildPaymentJournal({id:"p1",period,date,householdId:"h1",items:[{cat:"air",cash:40000,depositUsed:0,applied:40000,surplus:0}]});
 assert.equal(j.totals.debit,40000);assert.equal(j.totals.credit,40000);
});
test("overpayment credits deposit liability, not revenue",()=>{
 const j=buildPaymentJournal({id:"p2",period,date,householdId:"h1",items:[{cat:"air",cash:70000,depositUsed:0,applied:50000,surplus:20000}]});
 assert.equal(j.lines.find(x=>x.account==="liability.deposit.air").credit,20000);
 assert.equal(j.lines.some(x=>x.account==="revenue.air"),false);
});
test("deposit application debits liability and credits receivable without cash movement",()=>{
 const j=buildPaymentJournal({id:"p3",period,date,householdId:"h1",items:[{cat:"air",cash:0,depositUsed:30000,applied:30000,surplus:0}]});
 assert.equal(j.lines.find(x=>x.account==="liability.deposit.air").debit,30000);
 assert.equal(j.lines.find(x=>x.account==="asset.receivable.air").credit,30000);
 assert.equal(j.lines.some(x=>x.account==="asset.cash.air"),false);
});
test("expense debits expense and credits cash",()=>{
 const j=buildExpenseJournal({id:"e1",period,date,category:"kas",amount:15000,description:"ATK"});
 assert.equal(j.lines[0].debit,15000);assert.equal(j.lines[1].credit,15000);
});
test("opening balances create balanced entry with separate deposits",()=>{
 const j=buildOpeningJournal({id:"o1",period,date,cash:{kas:500000},receivables:{kas:100000},deposits:{air:50000}});
 assert.equal(j.totals.debit,j.totals.credit);
 assert.equal(j.lines.find(x=>x.account==="liability.deposit.air").credit,50000);
});
test("ledger and cash flow exclude invoices and deposit applications from cash movement",()=>{
 const invoice=buildInvoiceJournal({id:"i",period,date,householdId:"h1",category:"air",amount:50000});
 const payment=buildPaymentJournal({id:"p",period,date,householdId:"h1",items:[{cat:"air",cash:60000,depositUsed:0,applied:50000,surplus:10000}]});
 const expense=buildExpenseJournal({id:"e",period,date,category:"air",amount:5000});
 const entries={i:invoice,p:payment,e:expense};
 const ledger=summarizeLedger(entries),flow=cashFlow(entries),tb=trialBalance(entries);
 assert.equal(ledger.balanced,true);assert.equal(tb.balanced,true);
 assert.equal(flow.inflow,60000);assert.equal(flow.outflow,5000);assert.equal(flow.net,55000);
});

test("future fixed prepayment is cash received but not recognized as income until invoice application",()=>{
 const {paymentRecognizedCash}=await import("../assets/js/accounting.js");
 assert.equal(paymentRecognizedCash({cash:100000,applied:100000,advance:true}),0);
 assert.equal(paymentRecognizedCash({cash:100000,applied:100000}),100000);
});
test("air overpayment recognizes only cash applied to receivables, not deposit surplus",()=>{
 const {paymentRecognizedCash}=await import("../assets/js/accounting.js");
 assert.equal(paymentRecognizedCash({cash:70000,applied:70000,cashApplied:50000}),50000);
});
