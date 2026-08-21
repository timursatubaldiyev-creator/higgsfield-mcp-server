const MONTH_NAMES = ["", "Янв", "Фев", "Мар", "Апр", "Май", "Июн", "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек"];

const state = { countries: [], tours: [], hotels: [], reviews: [], selectedHotelCountry: "" };

async function fetchJSON(url, opts) {
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Ошибка запроса");
  return data;
}

function countryName(id) {
  const c = state.countries.find((c) => c.id === id);
  return c ? c.name : "—";
}

// ---------- selects ----------
function fillCountrySelects() {
  const selects = ["qfCountry", "cfCountry", "modalCountry", "reviewCountry"];
  selects.forEach((selId) => {
    const el = document.getElementById(selId);
    if (!el) return;
    state.countries.forEach((c) => {
      const opt = document.createElement("option");
      opt.value = c.id;
      opt.textContent = c.name;
      el.appendChild(opt);
    });
  });
}

// ---------- destinations ----------
function renderDestinations() {
  const grid = document.getElementById("destinationsGrid");
  grid.innerHTML = state.countries
    .map(
      (c) => `
    <article class="dest-card reveal" style="background:${c.gradient}">
      <span class="dest-tag">${c.tag}</span>
      <h3>${c.name}</h3>
      <p>${c.description}</p>
      <div class="dest-meta">
        <span>${c.region}</span>
        <a href="#hotels" data-country="${c.id}" class="dest-link">Подобрать тур →</a>
      </div>
    </article>`
    )
    .join("");

  grid.querySelectorAll(".dest-link").forEach((a) =>
    a.addEventListener("click", (e) => {
      const countryId = e.currentTarget.dataset.country;
      document.getElementById("modalCountry").value = countryId;
      openModal("requestModal");
    })
  );
  observeReveals();
}

// ---------- hot tours (boarding pass cards) ----------
function renderHotTours(tours) {
  const grid = document.getElementById("hotGrid");
  if (!tours.length) {
    grid.innerHTML = `<p style="opacity:.7">Сейчас горящих туров нет — загляните позже.</p>`;
    return;
  }
  grid.innerHTML = tours
    .map((t) => {
      const hotel = state.hotels.find((h) => h.id === t.hotelId);
      return `
    <article class="pass-card reveal">
      <div class="pass-main">
        ${t.discountPercent ? `<span class="pass-badge">−${t.discountPercent}%</span>` : ""}
        <h3>${t.title}</h3>
        <p class="pass-meta">${t.nights} ночей · вылет ${formatDate(t.startDate)} ${hotel ? "· " + hotel.board : ""}</p>
        <ul class="pass-includes">${t.includes.map((i) => `<li>${i}</li>`).join("")}</ul>
      </div>
      <div class="pass-stub">
        ${t.oldPrice ? `<span class="pass-old">$${t.oldPrice}</span>` : ""}
        <span class="pass-price">$${t.price}</span>
        <span class="pass-seats">осталось ${t.seatsLeft} мест</span>
        <button class="btn btn-primary pass-cta" data-country="${t.countryId}" data-tour="${t.title}">Забронировать</button>
      </div>
    </article>`;
    })
    .join("");

  grid.querySelectorAll(".pass-cta").forEach((btn) =>
    btn.addEventListener("click", (e) => {
      document.getElementById("modalCountry").value = e.currentTarget.dataset.country;
      const commentField = document.querySelector('#modalRequestForm textarea[name="comment"]');
      commentField.value = `Интересует горящий тур: ${e.currentTarget.dataset.tour}`;
      openModal("requestModal");
    })
  );
  observeReveals();
}

// ---------- discounts ----------
function renderDiscounts(discounts) {
  const grid = document.getElementById("discountsGrid");
  grid.innerHTML = discounts
    .map(
      (d) => `
    <article class="discount-card reveal">
      <div class="discount-percent">−${d.percent}%</div>
      <h3>${d.title}</h3>
      <p>${d.description}</p>
      <span class="discount-valid">Действует до ${formatDate(d.validUntil)}</span>
    </article>`
    )
    .join("");
  observeReveals();
}

// ---------- hotels ----------
function renderHotelFilters() {
  const row = document.getElementById("hotelFilters");
  const chips = [{ id: "", name: "Все страны" }, ...state.countries];
  row.innerHTML = chips
    .map((c) => `<button class="filter-chip ${c.id === "" ? "active" : ""}" data-country="${c.id}">${c.name}</button>`)
    .join("");
  row.querySelectorAll(".filter-chip").forEach((chip) =>
    chip.addEventListener("click", (e) => {
      row.querySelectorAll(".filter-chip").forEach((c) => c.classList.remove("active"));
      e.currentTarget.classList.add("active");
      state.selectedHotelCountry = e.currentTarget.dataset.country;
      renderHotels();
    })
  );
}

function renderHotels() {
  const grid = document.getElementById("hotelsGrid");
  const list = state.hotels.filter((h) => !state.selectedHotelCountry || h.countryId === state.selectedHotelCountry);
  grid.innerHTML = list
    .map(
      (h) => `
    <article class="hotel-card reveal">
      <div class="hotel-media" style="background:${h.gradient}"></div>
      <div class="hotel-body">
        <div class="hotel-stars">${"★".repeat(h.stars)}</div>
        <h3>${h.name}</h3>
        <p class="hotel-board">${h.board} · ${countryName(h.countryId)}</p>
        <p class="desc">${h.description}</p>
        <ul class="amenities">${h.amenities.map((a) => `<li>${a}</li>`).join("")}</ul>
        <div class="ext-reviews">
          <div class="ext-review"><span class="score">${h.externalReviews.tripadvisor.rating}</span> · Tripadvisor (${h.externalReviews.tripadvisor.count})<br/><a href="${h.externalReviews.tripadvisor.url}" target="_blank" rel="noopener">открыть →</a></div>
          <div class="ext-review"><span class="score">${h.externalReviews.booking.rating}</span> · Booking (${h.externalReviews.booking.count})<br/><a href="${h.externalReviews.booking.url}" target="_blank" rel="noopener">открыть →</a></div>
        </div>
        <div class="hotel-price">
          <span>от <strong>$${h.priceFrom}</strong></span>
          <button class="btn btn-ghost hotel-cta" data-country="${h.countryId}" data-hotel="${h.name}">Подобрать тур</button>
        </div>
      </div>
    </article>`
    )
    .join("");

  grid.querySelectorAll(".hotel-cta").forEach((btn) =>
    btn.addEventListener("click", (e) => {
      document.getElementById("modalCountry").value = e.currentTarget.dataset.country;
      const commentField = document.querySelector('#modalRequestForm textarea[name="comment"]');
      commentField.value = `Интересует отель: ${e.currentTarget.dataset.hotel}`;
      openModal("requestModal");
    })
  );
  observeReveals();
}

// ---------- reviews ----------
function renderReviews() {
  const grid = document.getElementById("reviewsGrid");
  grid.innerHTML = state.reviews
    .slice()
    .reverse()
    .map(
      (r) => `
    <article class="review-card reveal">
      <div class="review-stars">${"★".repeat(r.rating)}${"☆".repeat(5 - r.rating)}</div>
      <p>«${r.text}»</p>
      <div class="review-name">${r.name} ${r.countryId ? "· " + countryName(r.countryId) : ""}</div>
      <div class="review-date">${formatDate(r.date)}</div>
    </article>`
    )
    .join("");
  observeReveals();
}

// ---------- season / live weather ----------
async function renderSeason() {
  const grid = document.getElementById("seasonGrid");
  grid.innerHTML = state.countries
    .map(
      (c) => `
    <article class="season-card reveal" data-weather="${c.id}">
      <h3>${c.name}</h3>
      <p class="season-city">${c.weatherCity.name}</p>
      <div class="season-now"><strong>—</strong><span>сейчас</span></div>
      <div class="season-months">
        ${Array.from({ length: 12 }, (_, i) => i + 1)
          .map((m) => `<span class="month-pill ${c.bestMonths.includes(m) ? "best" : ""}">${MONTH_NAMES[m]}</span>`)
          .join("")}
      </div>
    </article>`
    )
    .join("");
  observeReveals();

  state.countries.forEach(async (c) => {
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${c.weatherCity.lat}&longitude=${c.weatherCity.lon}&current_weather=true`;
      const data = await fetchJSON(url);
      const temp = Math.round(data.current_weather?.temperature);
      const card = document.querySelector(`[data-weather="${c.id}"] .season-now strong`);
      if (card && Number.isFinite(temp)) card.textContent = `${temp}°C`;
    } catch {
      /* weather is a nice-to-have; ignore failures */
    }
  });
}

// ---------- partners ----------
function renderPartners(partners) {
  const row = document.getElementById("partnersRow");
  row.innerHTML = partners
    .map((p) => `<div class="partner-chip reveal">${p.name}<small>${p.kind}</small></div>`)
    .join("");
  observeReveals();
}

// ---------- bonus balance on homepage ----------
async function renderBonusPreview() {
  const token = localStorage.getItem("meridian_token");
  if (!token) return;
  try {
    const me = await fetchJSON("/api/me", { headers: { Authorization: `Bearer ${token}` } });
    document.querySelector(".bonus-card-value").innerHTML = `${me.bonusPoints} <span>баллов</span>`;
    document.querySelector(".bonus-card-hint").textContent = `С возвращением, ${me.name.split(" ")[0]}!`;
  } catch {
    localStorage.removeItem("meridian_token");
  }
}

// ---------- helpers ----------
function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
}

function observeReveals() {
  const els = document.querySelectorAll(".reveal:not(.observed)");
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("in");
          io.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.15 }
  );
  els.forEach((el) => {
    el.classList.add("observed");
    io.observe(el);
  });
}

// ---------- modals ----------
function openModal(id) {
  document.getElementById(id).classList.add("open");
  document.body.style.overflow = "hidden";
}
function closeModal(id) {
  document.getElementById(id).classList.remove("open");
  document.body.style.overflow = "";
}

function wireModals() {
  document.getElementById("openRequestBtn").addEventListener("click", () => openModal("requestModal"));
  document.getElementById("closeRequestModal").addEventListener("click", () => closeModal("requestModal"));
  document.getElementById("openReviewBtn").addEventListener("click", () => openModal("reviewModal"));
  document.getElementById("closeReviewModal").addEventListener("click", () => closeModal("reviewModal"));
  [["requestModal"], ["reviewModal"]].forEach(([id]) => {
    document.getElementById(id).addEventListener("click", (e) => {
      if (e.target.id === id) closeModal(id);
    });
  });

  const starPicker = document.getElementById("starPicker");
  starPicker.querySelectorAll("button").forEach((btn) =>
    btn.addEventListener("click", () => {
      const val = Number(btn.dataset.star);
      document.getElementById("reviewRating").value = val;
      starPicker.querySelectorAll("button").forEach((b) => b.classList.toggle("active", Number(b.dataset.star) <= val));
    })
  );
  starPicker.querySelectorAll("button").forEach((b) => b.classList.toggle("active", Number(b.dataset.star) <= 5));
}

// ---------- forms ----------
async function submitLead(form, noteEl) {
  const fd = new FormData(form);
  const payload = Object.fromEntries(fd.entries());
  noteEl.textContent = "Отправляем...";
  noteEl.classList.remove("error");
  try {
    const token = localStorage.getItem("meridian_token");
    await fetchJSON("/api/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(payload),
    });
    noteEl.textContent = "Заявка отправлена! Мы свяжемся с вами в ближайшее время.";
    form.reset();
  } catch (err) {
    noteEl.textContent = err.message;
    noteEl.classList.add("error");
  }
}

function wireForms() {
  document.getElementById("contactRequestForm").addEventListener("submit", (e) => {
    e.preventDefault();
    submitLead(e.target, document.getElementById("contactFormNote"));
  });

  document.getElementById("modalRequestForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const noteEl = document.getElementById("modalFormNote");
    await submitLead(e.target, noteEl);
    setTimeout(() => closeModal("requestModal"), 1400);
  });

  document.getElementById("quickFinderForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    document.getElementById("modalCountry").value = fd.get("countryId") || "";
    document.querySelector('#modalRequestForm input[name="budget"]').value = fd.get("budget") || "";
    document.querySelector('#modalRequestForm input[name="dateFrom"]').value = fd.get("dateFrom") || "";
    openModal("requestModal");
  });

  document.getElementById("reviewForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const noteEl = document.getElementById("reviewFormNote");
    const fd = new FormData(e.target);
    const payload = Object.fromEntries(fd.entries());
    noteEl.textContent = "Отправляем...";
    noteEl.classList.remove("error");
    try {
      await fetchJSON("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      noteEl.textContent = "Спасибо! Отзыв появится после проверки модератором.";
      e.target.reset();
      setTimeout(() => closeModal("reviewModal"), 1600);
    } catch (err) {
      noteEl.textContent = err.message;
      noteEl.classList.add("error");
    }
  });
}

function wireBurger() {
  const burger = document.getElementById("burgerBtn");
  const nav = document.getElementById("mainNav");
  burger.addEventListener("click", () => {
    const isOpen = nav.style.display === "flex";
    nav.style.display = isOpen ? "none" : "flex";
    nav.style.flexDirection = "column";
    nav.style.position = "absolute";
    nav.style.top = "100%";
    nav.style.left = "0";
    nav.style.right = "0";
    nav.style.background = "var(--paper)";
    nav.style.padding = "1.2rem 28px";
    nav.style.borderBottom = "1px solid var(--line)";
  });
}

async function init() {
  wireModals();
  wireForms();
  wireBurger();
  observeReveals();

  const [countries, tours, hotels, reviews, partners, discounts] = await Promise.all([
    fetchJSON("/api/countries"),
    fetchJSON("/api/tours"),
    fetchJSON("/api/hotels"),
    fetchJSON("/api/reviews"),
    fetchJSON("/api/partners"),
    fetchJSON("/api/discounts"),
  ]);

  state.countries = countries;
  state.tours = tours;
  state.hotels = hotels;
  state.reviews = reviews;

  fillCountrySelects();
  renderDestinations();
  renderHotTours(tours.filter((t) => t.hot));
  renderDiscounts(discounts);
  renderHotelFilters();
  renderHotels();
  renderReviews();
  renderSeason();
  renderPartners(partners);
  renderBonusPreview();
}

init().catch((err) => console.error("Ошибка загрузки данных:", err));
