import { ref, set } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";
import { db } from "./firebase.js";
import { read, getMonthBills } from "./data.js?v=20261120-audit3";

const CATEGORIES = ["kas", "sampah", "air"];
const LABELS = { kas: "Kas RT", sampah: "Uang sampah", air: "Uang air" };
const money = n => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(Number(n) || 0);
const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const monthName = key => new Date(`${key}-01T00:00:00`).toLocaleDateString("id-ID", { month: "long", year: "numeric" });
const monthKeysUntil = period => {
  const [year, month] = period.split("-").map(Number);
  return Array.from({ length: month }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);
};
const normalizePhone = raw => {
  let digits = String(raw || "").replace(/\D/g, "");
  if (digits.startsWith("0")) digits = `62${digits.slice(1)}`;
  else if (digits.startsWith("8")) digits = `62${digits}`;
  return digits;
};
function remainingOf(bill) {
  if (!bill) return 0;
  if (bill.status === "paid" || bill.paid === true) return 0;
  if (bill.remaining !== undefined && bill.remaining !== null) return Math.max(0, Number(bill.remaining) || 0);
  const amount = Number(bill.amount) || 0;
  const paid = Number(bill.paidAmount) || 0;
  return Math.max(0, amount - paid);
}
function createMessage(house, period, periods) {
  const label = house.block || house.address || "-";
  const lines = [
    "PEMBERITAHUAN TAGIHAN RT",
    "",
    `Yth. Bapak/Ibu ${house.headName || "Warga"}`,
    `Alamat: ${label}`,
    `Periode pemberitahuan: ${monthName(period)}`,
    "",
    "RINCIAN TUNGGAKAN TAHUN BERJALAN"
  ];
  let totalPrevious = 0;
  periods.filter(p => p.key !== period && p.total > 0).forEach(p => {
    totalPrevious += p.total;
    lines.push(`${monthName(p.key)}:`);
    CATEGORIES.forEach(cat => { if (p.categories[cat] > 0) lines.push(`- ${LABELS[cat]}: ${money(p.categories[cat])}`); });
    lines.push(`Subtotal: ${money(p.total)}`, "");
  });
  const current = periods.find(p => p.key === period) || { categories: { kas: 0, sampah: 0, air: 0 }, total: 0 };
  lines.push("TAGIHAN BULAN BERJALAN:");
  CATEGORIES.forEach(cat => lines.push(`- ${LABELS[cat]}: ${money(current.categories[cat])}`));
  lines.push(`Subtotal bulan berjalan: ${money(current.total)}`, "", `Total tunggakan sebelumnya: ${money(totalPrevious)}`, `Tagihan bulan berjalan: ${money(current.total)}`, `TOTAL SISA KEWAJIBAN: ${money(totalPrevious + current.total)}`, "", "Mohon melakukan pembayaran kepada pengurus RT.", "Terima kasih atas partisipasinya.");
  return lines.join("\n");
}

export async function renderWhatsAppPage(container, { households, currentUser, currentProfile, toast }) {
  const now = new Date();
  const currentPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const homes = Object.entries(households).map(([id, h]) => ({ id, ...h }));
  const blocks = [...new Set(homes.map(h => h.block).filter(Boolean))].sort();
  const [year, month] = currentPeriod.split("-").map(Number);
  const monthOptions = Array.from({ length: month }, (_, i) => {
    const key = `${year}-${String(i + 1).padStart(2, "0")}`;
    return `<option value="${key}" ${key === currentPeriod ? "selected" : ""}>${monthName(key)}</option>`;
  }).join("");

  container.innerHTML = `
    <div class="grid stats" id="waStats">
      <div class="stat"><div class="label">Rumah dengan tagihan</div><div class="value" id="waCount">-</div><div class="sub">Dalam tahun berjalan</div></div>
      <div class="stat"><div class="label">Total kewajiban</div><div class="value" id="waTotal">-</div><div class="sub">Tunggakan + bulan berjalan</div></div>
      <div class="stat"><div class="label">Sudah ditandai dikirim</div><div class="value" id="waSent">-</div><div class="sub">Konfirmasi manual pengurus</div></div>
      <div class="stat"><div class="label">Belum ditandai dikirim</div><div class="value" id="waPending">-</div><div class="sub">Perlu tindakan pengurus</div></div>
    </div>
    <div class="panel" style="margin-top:18px">
      <div class="section-head" style="margin-top:0"><h3>Siapkan pemberitahuan</h3><span class="pill success">WhatsApp biasa</span></div>
      <div class="form-grid">
        <label class="field">Periode pemberitahuan<select id="waPeriod">${monthOptions}</select></label>
        <label class="field">Blok<select id="waBlock"><option value="">Semua blok</option>${blocks.map(b => `<option value="${esc(b)}">${esc(b)}</option>`).join("")}</select></label>
        <label class="field full-row">Cari rumah<input id="waSearch" placeholder="Nama kepala keluarga, blok, atau nomor WhatsApp"></label>
      </div>
      <div class="muted-note">WhatsApp menampilkan tunggakan dari Januari sampai periode yang dipilih pada tahun tersebut. Aplikasi tetap menyimpan dan menghitung seluruh tunggakan lintas tahun. Nominal sisa diambil dari nilai <b>remaining</b> pada tagihan; deposit tidak dikurangi dua kali.</div>
    </div>
    <div class="section-head"><h3>Daftar penerima</h3><span class="pill" id="waResultCount">Memuat…</span></div>
    <div id="waRecipients" class="wa-list"><div class="panel empty">Mengambil tagihan tahun berjalan…</div></div>`;

  const periodEl = container.querySelector("#waPeriod");
  const blockEl = container.querySelector("#waBlock");
  const searchEl = container.querySelector("#waSearch");
  const listEl = container.querySelector("#waRecipients");
  let records = [];

  async function load() {
    listEl.innerHTML = '<div class="panel empty">Mengambil tagihan…</div>';
    const period = periodEl.value;
    const keys = monthKeysUntil(period);
    const [billSets, history] = await Promise.all([
      Promise.all(keys.map(getMonthBills)),
      read(`whatsapp_notifications/${period}`).catch(() => ({}))
    ]);
    const sentHistory = history || {};
    records = homes.map(house => {
      const periods = keys.map((key, i) => {
        const bill = billSets[i]?.[house.id] || {};
        const categories = Object.fromEntries(CATEGORIES.map(cat => [cat, remainingOf(bill[cat])]));
        return { key, categories, total: Object.values(categories).reduce((a, b) => a + b, 0) };
      });
      const total = periods.reduce((sum, p) => sum + p.total, 0);
      const phone = normalizePhone(house.whatsapp?.primaryNumber || house.phone);
      const historyItem = sentHistory[house.id] || {};
      return { house, periods, total, phone, history: historyItem, message: createMessage(house, period, periods) };
    }).filter(x => x.total > 0);
    draw();
  }

  function draw() {
    const query = searchEl.value.trim().toLowerCase();
    const block = blockEl.value;
    const filtered = records.filter(r => (!block || r.house.block === block) && (!query || `${r.house.block} ${r.house.address} ${r.house.headName} ${r.phone}`.toLowerCase().includes(query)));
    const total = records.reduce((s, r) => s + r.total, 0);
    const sent = records.filter(r => r.history.status === "sent_marked").length;
    container.querySelector("#waCount").textContent = records.length;
    container.querySelector("#waTotal").textContent = money(total);
    container.querySelector("#waSent").textContent = sent;
    container.querySelector("#waPending").textContent = records.length - sent;
    container.querySelector("#waResultCount").textContent = `${filtered.length} rumah`;
    if (!filtered.length) {
      listEl.innerHTML = '<div class="panel empty">Tidak ada rumah dengan sisa tagihan pada filter ini.</div>';
      return;
    }
    listEl.innerHTML = filtered.map(r => {
      const disabled = !r.phone || r.phone.length < 10;
      const status = r.history.status === "sent_marked" ? '<span class="pill success">Ditandai terkirim</span>' : r.history.status === "opened" ? '<span class="pill warning">WhatsApp dibuka</span>' : '<span class="pill">Belum dikirim</span>';
      return `<article class="panel wa-recipient" data-house="${esc(r.house.id)}">
        <div class="wa-recipient-head"><div><b>${esc(r.house.block || r.house.address || "Rumah")}</b><div class="muted tiny">${esc(r.house.headName || "Tanpa nama")} · ${esc(r.house.address || "")}</div><div class="muted tiny">${esc(r.phone || "Nomor WhatsApp belum diisi")}</div></div><div class="wa-status">${status}</div></div>
        <div class="wa-recipient-total"><span>Total sisa kewajiban</span><b>${money(r.total)}</b></div>
        <details><summary>Lihat rincian pesan</summary><pre class="wa-message">${esc(r.message)}</pre></details>
        <div class="wa-actions">${disabled ? '<button class="btn outline" disabled>Nomor belum valid</button>' : `<button class="btn primary wa-open" data-house="${esc(r.house.id)}">Buka WhatsApp</button>`}${r.history.status !== "sent_marked" ? `<button class="btn outline wa-mark" data-house="${esc(r.house.id)}" ${disabled ? "disabled" : ""}>Tandai sudah dikirim</button>` : '<span class="tiny muted">Dikirim: ' + esc(r.history.sentAt ? new Date(r.history.sentAt).toLocaleString("id-ID") : "-") + '</span>'}</div>
      </article>`;
    }).join("");

    listEl.querySelectorAll(".wa-open").forEach(btn => btn.addEventListener("click", () => {
      const record = records.find(r => r.house.id === btn.dataset.house);
      if (!record) return;
      const url = `https://wa.me/${record.phone}?text=${encodeURIComponent(record.message)}`;
      window.open(url, "_blank", "noopener,noreferrer");
      saveHistory(record, "opened").then(() => { record.history.status = "opened"; record.history.openedAt = Date.now(); draw(); }).catch(err => toast(`WhatsApp dibuka, tetapi riwayat gagal disimpan: ${err.message}`));
    }));
    listEl.querySelectorAll(".wa-mark").forEach(btn => btn.addEventListener("click", async () => {
      const record = records.find(r => r.house.id === btn.dataset.house);
      if (!record || !confirm(`Tandai pesan untuk ${record.house.block || record.house.headName} sudah dikirim?`)) return;
      try {
        await saveHistory(record, "sent_marked");
        record.history = { ...record.history, status: "sent_marked", sentAt: Date.now(), sentBy: currentUser?.uid || null, sentByName: currentProfile?.name || currentUser?.email || "Pengurus" };
        toast("Riwayat pengiriman diperbarui."); draw();
      } catch (err) { toast(`Gagal menyimpan riwayat: ${err.message}`); }
    }));
  }

  async function saveHistory(record, status) {
    if (!db) throw new Error("Firebase belum dikonfigurasi.");
    const nowTs = Date.now();
    const previous = record.history || {};
    const data = {
      householdId: record.house.id,
      phone: record.phone,
      period: periodEl.value,
      status,
      openedAt: status === "opened" ? nowTs : (previous.openedAt || null),
      sentAt: status === "sent_marked" ? nowTs : (previous.sentAt || null),
      sentBy: status === "sent_marked" ? (currentUser?.uid || null) : (previous.sentBy || null),
      sentByName: status === "sent_marked" ? (currentProfile?.name || currentUser?.email || "Pengurus") : (previous.sentByName || null),
      amountAtNotification: record.total,
      updatedAt: nowTs
    };
    await set(ref(db, `whatsapp_notifications/${periodEl.value}/${record.house.id}`), data);
  }

  periodEl.addEventListener("change", load);
  blockEl.addEventListener("change", draw);
  searchEl.addEventListener("input", draw);
  await load();
}
