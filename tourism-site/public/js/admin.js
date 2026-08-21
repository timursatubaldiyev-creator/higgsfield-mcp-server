const ADMIN_KEY = "meridian_admin_token";

async function fetchJSON(url, opts) {
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Ошибка запроса");
  return data;
}

function adminHeaders() {
  return { "x-admin-token": localStorage.getItem(ADMIN_KEY) || "", "Content-Type": "application/json" };
}

let countries = [];

function wireTokenGate() {
  const saved = localStorage.getItem(ADMIN_KEY);
  if (saved) verifyAndEnter(saved);

  document.getElementById("tokenSaveBtn").addEventListener("click", async () => {
    const val = document.getElementById("adminTokenInput").value.trim();
    if (!val) return;
    verifyAndEnter(val);
  });
}

async function verifyAndEnter(token) {
  const note = document.getElementById("tokenNote");
  try {
    await fetchJSON("/api/admin/leads", { headers: { "x-admin-token": token } });
    localStorage.setItem(ADMIN_KEY, token);
    document.getElementById("tokenGate").classList.add("hidden");
    document.getElementById("adminApp").classList.remove("hidden");
    boot();
  } catch (err) {
    note.textContent = "Неверный токен";
    note.classList.add("error");
  }
}

function wireTabs() {
  const tabs = document.querySelectorAll(".admin-tabs button");
  tabs.forEach((tab) =>
    tab.addEventListener("click", () => {
      tabs.forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
      document.getElementById(tab.dataset.panel).classList.add("active");
    })
  );
}

const STATUS_OPTIONS = ["new", "in_progress", "completed", "cancelled"];
const STATUS_LABELS = { new: "Новая", in_progress: "В работе", completed: "Завершена", cancelled: "Отменена" };

async function loadLeads() {
  const leads = await fetchJSON("/api/admin/leads", { headers: adminHeaders() });
  const body = document.getElementById("leadsBody");
  body.innerHTML = leads
    .slice()
    .reverse()
    .map(
      (l) => `
    <tr data-id="${l.id}">
      <td><strong>${l.name}</strong><br/>${l.phone}${l.email ? "<br/>" + l.email : ""}</td>
      <td>${l.countryId || "—"}<br/><small>${l.adults} взр. ${l.kids ? "+ " + l.kids + " дет." : ""}</small></td>
      <td>${l.budget || "—"}</td>
      <td>
        <select class="status-select">
          ${STATUS_OPTIONS.map((s) => `<option value="${s}" ${s === l.status ? "selected" : ""}>${STATUS_LABELS[s]}</option>`).join("")}
        </select>
      </td>
      <td><input class="amount-input" type="number" value="${l.amount ?? ""}" placeholder="сумма" style="width:90px;" /></td>
      <td>${l.pointsRedeemed ? `списано: ${l.pointsRedeemed}` : l.pointsRequested ? `хочет списать: ${l.pointsRequested}` : "—"}</td>
      <td><button class="btn btn-primary small-btn save-lead">Сохранить</button></td>
    </tr>`
    )
    .join("");

  body.querySelectorAll(".save-lead").forEach((btn) =>
    btn.addEventListener("click", async (e) => {
      const row = e.target.closest("tr");
      const id = row.dataset.id;
      const status = row.querySelector(".status-select").value;
      const amount = row.querySelector(".amount-input").value;
      await fetchJSON(`/api/admin/leads/${id}`, {
        method: "PATCH",
        headers: adminHeaders(),
        body: JSON.stringify({ status, amount: amount || undefined }),
      });
      btn.textContent = "Сохранено ✓";
      setTimeout(() => (btn.textContent = "Сохранить"), 1500);
    })
  );
}

function countryOptions() {
  return countries.map((c) => `<option value="${c.id}">${c.name}</option>`).join("");
}

async function loadHotels() {
  const hotels = await fetchJSON("/api/hotels");
  document.getElementById("hotelsBody").innerHTML = hotels
    .map(
      (h) => `
    <tr data-id="${h.id}">
      <td>${h.name}</td><td>${h.countryId}</td><td>${h.stars}</td><td>$${h.priceFrom}</td>
      <td><button class="btn btn-ghost small-btn delete-item" data-collection="hotels">Удалить</button></td>
    </tr>`
    )
    .join("");
  wireDeleteButtons("hotelsBody", loadHotels);
}

async function loadTours() {
  const tours = await fetchJSON("/api/tours");
  document.getElementById("toursBody").innerHTML = tours
    .map(
      (t) => `
    <tr data-id="${t.id}">
      <td>${t.title}</td><td>${t.countryId}</td><td>$${t.price}</td><td>${t.hot ? "🔥" : "—"}</td>
      <td><button class="btn btn-ghost small-btn delete-item" data-collection="tours">Удалить</button></td>
    </tr>`
    )
    .join("");
  wireDeleteButtons("toursBody", loadTours);
}

async function loadDiscounts() {
  const discounts = await fetchJSON("/api/discounts");
  document.getElementById("discountsBody").innerHTML = discounts
    .map(
      (d) => `
    <tr data-id="${d.id}">
      <td>${d.title}</td><td>${d.percent}%</td><td>${d.validUntil}</td>
      <td><button class="btn btn-ghost small-btn delete-item" data-collection="discounts">Удалить</button></td>
    </tr>`
    )
    .join("");
  wireDeleteButtons("discountsBody", loadDiscounts);
}

async function loadReviews() {
  const reviews = await fetchJSON("/api/admin/reviews", { headers: adminHeaders() });
  const pending = reviews.filter((r) => r.status === "pending");
  document.getElementById("reviewsBody").innerHTML = pending.length
    ? pending
        .map(
          (r) => `
    <tr data-id="${r.id}">
      <td>${r.name}</td><td>${r.text}</td><td>${"★".repeat(r.rating)}</td>
      <td>
        <button class="btn btn-primary small-btn approve-review">Одобрить</button>
        <button class="btn btn-ghost small-btn delete-item" data-collection="reviews">Отклонить</button>
      </td>
    </tr>`
        )
        .join("")
    : `<tr><td colspan="4" style="color:var(--ink-soft)">Нет отзывов на модерации</td></tr>`;

  document.querySelectorAll(".approve-review").forEach((btn) =>
    btn.addEventListener("click", async (e) => {
      const id = e.target.closest("tr").dataset.id;
      await fetchJSON(`/api/admin/reviews/${id}`, {
        method: "PUT",
        headers: adminHeaders(),
        body: JSON.stringify({ status: "approved" }),
      });
      loadReviews();
    })
  );
  wireDeleteButtons("reviewsBody", loadReviews);
}

function wireDeleteButtons(bodyId, reload) {
  document.getElementById(bodyId).querySelectorAll(".delete-item").forEach((btn) =>
    btn.addEventListener("click", async (e) => {
      const collection = e.target.dataset.collection;
      const id = e.target.closest("tr").dataset.id;
      if (!confirm("Удалить запись?")) return;
      await fetchJSON(`/api/admin/${collection}/${id}`, { method: "DELETE", headers: adminHeaders() });
      reload();
    })
  );
}

function wireNewItemForms() {
  document.getElementById("hotelForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const payload = Object.fromEntries(fd.entries());
    payload.stars = Number(payload.stars);
    payload.priceFrom = Number(payload.priceFrom);
    payload.amenities = (payload.amenities || "").split(",").map((s) => s.trim()).filter(Boolean);
    payload.gradient = "linear-gradient(135deg,#c1502e,#e0964f)";
    payload.externalReviews = { tripadvisor: { rating: 0, count: 0, url: "https://www.tripadvisor.com/" }, booking: { rating: 0, count: 0, url: "https://www.booking.com/" } };
    await fetchJSON("/api/admin/hotels", { method: "POST", headers: adminHeaders(), body: JSON.stringify(payload) });
    e.target.reset();
    loadHotels();
  });

  document.getElementById("tourForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const payload = Object.fromEntries(fd.entries());
    payload.nights = Number(payload.nights);
    payload.price = Number(payload.price);
    payload.hot = fd.get("hot") === "on";
    payload.includes = ["Перелёт", "Трансфер", "Страховка"];
    payload.seatsLeft = 10;
    payload.discountPercent = 0;
    payload.oldPrice = null;
    await fetchJSON("/api/admin/tours", { method: "POST", headers: adminHeaders(), body: JSON.stringify(payload) });
    e.target.reset();
    loadTours();
  });

  document.getElementById("discountForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const payload = Object.fromEntries(fd.entries());
    payload.percent = Number(payload.percent);
    await fetchJSON("/api/admin/discounts", { method: "POST", headers: adminHeaders(), body: JSON.stringify(payload) });
    e.target.reset();
    loadDiscounts();
  });
}

async function boot() {
  countries = await fetchJSON("/api/countries");
  document.getElementById("hotelCountrySelect").innerHTML = countryOptions();
  document.getElementById("tourCountrySelect").innerHTML = countryOptions();
  wireTabs();
  wireNewItemForms();
  await Promise.all([loadLeads(), loadHotels(), loadTours(), loadDiscounts(), loadReviews()]);
}

wireTokenGate();
