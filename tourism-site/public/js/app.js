const MONTH_NAMES = ["", "Янв", "Фев", "Мар", "Апр", "Май", "Июн", "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек"];
const REDUCE_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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

// ---------- bonus points redemption ----------
let cachedBalance = null;
async function ensureUserBalance() {
  const token = localStorage.getItem("meridian_token");
  if (!token) return null;
  if (cachedBalance !== null) return cachedBalance;
  try {
    const me = await fetchJSON("/api/me", { headers: { Authorization: `Bearer ${token}` } });
    cachedBalance = me.bonusPoints;
    return cachedBalance;
  } catch {
    return null;
  }
}

async function showBonusWidget(price) {
  const block = document.getElementById("bonusRedeemBlock");
  document.getElementById("modalTourPrice").value = price || "";
  const balance = await ensureUserBalance();
  if (!balance || !price) {
    block.style.display = "none";
    return;
  }
  const max = Math.min(balance, Math.floor(price * 0.3));
  document.getElementById("bonusAvailable").textContent = max.toLocaleString("ru-RU");
  const pointsInput = document.getElementById("modalPoints");
  pointsInput.max = max;
  pointsInput.value = 0;
  block.style.display = max > 0 ? "block" : "none";
}

function hideBonusWidget() {
  document.getElementById("bonusRedeemBlock").style.display = "none";
  document.getElementById("modalTourPrice").value = "";
  document.getElementById("modalPoints").value = 0;
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
const TAG_EXPLAIN = {
  "Всё включено": "Питание, напитки и часть развлечений уже включены в стоимость тура",
  Дайвинг: "Одни из лучших коралловых рифов Красного моря — прямо у побережья",
  Люкс: "Курорт для статусного отдыха: пятизвёздочные отели и премиальный сервис",
  Острова: "Десятки островов с белым песком в паре часов от аэропорта",
  Романтика: "Виллы на воде и приватные пляжи — популярное направление для медового месяца",
  "Горы и вино": "Можно совместить пляжный отдых на побережье с поездкой в горы за один тур",
};

function renderDestinations() {
  const grid = document.getElementById("destinationsGrid");
  grid.innerHTML = state.countries
    .map(
      (c) => `
    <article class="dest-card reveal" style="background:${c.gradient}">
      <span class="dest-tag tip">${c.tag}<span class="tip-bubble">${TAG_EXPLAIN[c.tag] || c.tag}</span></span>
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
      hideBonusWidget();
      openModal("requestModal");
    })
  );
  observeReveals();
  refreshTilts();
}

// ---------- accordion gallery: hover (or tap) to expand, click to open request ----------
function initAccordionGallery(countries) {
  const wrap = document.getElementById("accordionGallery");
  if (!wrap || !countries.length) return;

  const EXPAND_RATIO = 0.52;
  const DEFAULT_INDEX = Math.min(2, countries.length - 1);
  const total = countries.length;
  const activeFlexGrow = (EXPAND_RATIO * (total - 1)) / (1 - EXPAND_RATIO);
  const isTouch = window.matchMedia("(hover: none)").matches;

  wrap.innerHTML = countries
    .map(
      (c, i) => `
    <a href="#hotels" class="ag-panel ${i === DEFAULT_INDEX ? "ag-active" : ""}" data-index="${i}" data-country="${c.id}" style="background:${c.gradient}">
      <span class="ag-label">${c.name}</span>
      <span class="ag-cta">Подобрать тур →</span>
    </a>`
    )
    .join("");

  const panels = Array.from(wrap.querySelectorAll(".ag-panel"));

  function setActive(index) {
    panels.forEach((p, i) => {
      const active = i === index;
      p.classList.toggle("ag-active", active);
      p.style.flexGrow = active ? activeFlexGrow : 1;
    });
  }
  setActive(DEFAULT_INDEX);

  panels.forEach((panel, i) => {
    if (!isTouch) {
      panel.addEventListener("mouseenter", () => setActive(i));
    }
    panel.addEventListener("click", (e) => {
      if (isTouch && !panel.classList.contains("ag-active")) {
        e.preventDefault();
        setActive(i);
        return;
      }
      e.preventDefault();
      document.getElementById("modalCountry").value = panel.dataset.country;
      hideBonusWidget();
      openModal("requestModal");
    });
  });
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
        <button class="btn btn-primary pass-cta" data-country="${t.countryId}" data-tour="${t.title}" data-price="${t.price}">Забронировать</button>
      </div>
    </article>`;
    })
    .join("");

  grid.querySelectorAll(".pass-cta").forEach((btn) =>
    btn.addEventListener("click", async (e) => {
      document.getElementById("modalCountry").value = e.currentTarget.dataset.country;
      const commentField = document.querySelector('#modalRequestForm textarea[name="comment"]');
      commentField.value = `Интересует горящий тур: ${e.currentTarget.dataset.tour}`;
      await showBonusWidget(Number(e.currentTarget.dataset.price));
      openModal("requestModal");
    })
  );
  observeReveals();
  refreshTilts();
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
          <button class="btn btn-ghost hotel-cta" data-country="${h.countryId}" data-hotel="${h.name}" data-price="${h.priceFrom}">Подобрать тур</button>
        </div>
      </div>
    </article>`
    )
    .join("");

  grid.querySelectorAll(".hotel-cta").forEach((btn) =>
    btn.addEventListener("click", async (e) => {
      document.getElementById("modalCountry").value = e.currentTarget.dataset.country;
      const commentField = document.querySelector('#modalRequestForm textarea[name="comment"]');
      commentField.value = `Интересует отель: ${e.currentTarget.dataset.hotel}`;
      await showBonusWidget(Number(e.currentTarget.dataset.price));
      openModal("requestModal");
    })
  );
  observeReveals();
  refreshTilts();
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
          .map((m) => {
            const temp = c.avgSeaTemp[m];
            const tipText = temp ? `Вода в ${MONTH_NAMES[m].toLowerCase()}е: ~${temp}°C` : `Нет данных о температуре воды`;
            return `<span class="month-pill tip ${c.bestMonths.includes(m) ? "best" : ""}">${MONTH_NAMES[m]}<span class="tip-bubble">${tipText}</span></span>`;
          })
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

// ---------- special effects ----------

// parallax: hero background mesh drifts slower than the page scroll
function initParallax() {
  const mesh = document.getElementById("heroMesh");
  const hero = document.querySelector(".hero");
  if (!mesh || !hero || REDUCE_MOTION) return;
  let ticking = false;
  window.addEventListener(
    "scroll",
    () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const heroHeight = hero.offsetHeight;
        if (window.scrollY < heroHeight * 1.4) {
          mesh.style.transform = `translateY(${window.scrollY * 0.28}px)`;
        }
        ticking = false;
      });
    },
    { passive: true }
  );
}

// floating bokeh + drifting plane particles in the hero background
function spawnParticles() {
  const container = document.getElementById("heroParticles");
  if (!container || REDUCE_MOTION) return;
  const PLANE = "✈";
  const count = 16;
  for (let i = 0; i < count; i++) {
    const el = document.createElement("span");
    const isPlane = i % 5 === 0;
    el.className = isPlane ? "particle plane" : "particle";
    const size = isPlane ? 14 + Math.random() * 6 : 4 + Math.random() * 10;
    const left = Math.random() * 100;
    const duration = 14 + Math.random() * 12;
    const delay = Math.random() * -duration;
    const drift = (Math.random() - 0.5) * 160;
    el.style.left = `${left}%`;
    el.style.width = `${size}px`;
    el.style.height = `${size}px`;
    el.style.animationDuration = `${duration}s`;
    el.style.animationDelay = `${delay}s`;
    el.style.setProperty("--drift", `${drift}px`);
    el.style.setProperty("--spin", `${(Math.random() - 0.5) * 50}deg`);
    if (isPlane) {
      el.textContent = PLANE;
      el.style.color = "rgba(207,169,101,.55)";
    }
    container.appendChild(el);
  }
}

// count-up animation for hero stat numbers
function animateCounters() {
  const counters = document.querySelectorAll(".counter");
  if (!counters.length) return;
  counters.forEach((el) => {
    const target = Number(el.dataset.target) || 0;
    const suffix = el.dataset.suffix || "";
    if (REDUCE_MOTION) {
      el.textContent = target.toLocaleString("ru-RU") + suffix;
      return;
    }
    const duration = 1400;
    const start = performance.now();
    function tick(now) {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      el.textContent = Math.round(target * eased).toLocaleString("ru-RU") + suffix;
      if (progress < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  });
}

// subtle 3D tilt on cards, following the cursor
function enableTilt(selector) {
  if (REDUCE_MOTION) return;
  document.querySelectorAll(selector + ":not([data-tilt-bound])").forEach((card) => {
    card.setAttribute("data-tilt-bound", "1");
    const maxTilt = 7;
    card.addEventListener("mousemove", (e) => {
      const rect = card.getBoundingClientRect();
      const px = (e.clientX - rect.left) / rect.width - 0.5;
      const py = (e.clientY - rect.top) / rect.height - 0.5;
      card.style.transition = "none";
      card.style.transform = `perspective(900px) rotateX(${(-py * maxTilt).toFixed(2)}deg) rotateY(${(px * maxTilt).toFixed(2)}deg) translateZ(8px)`;
    });
    card.addEventListener("mouseleave", () => {
      card.style.transition = "";
      card.style.transform = "";
    });
  });
}
function refreshTilts() {
  enableTilt(".dest-card");
  enableTilt(".pass-card");
  enableTilt(".hotel-card");
}

// ---------- hero tour carousel: drag/swipe, arrows, dots, autoplay ----------
function initHeroCarousel(tours) {
  const container = document.getElementById("heroCarousel");
  const track = document.getElementById("hcTrack");
  const dotsWrap = document.getElementById("hcDots");
  if (!container || !track || !tours.length) return;

  track.innerHTML = tours
    .map(
      (t) => `
    <div class="hc-slide" style="background:${t.gradient}">
      <div class="hc-caption">
        <span class="hc-badge">${t.country}</span>
        <h4>${t.title}</h4>
        <p>${t.nights} ночей · от $${t.price}</p>
      </div>
    </div>`
    )
    .join("");
  dotsWrap.innerHTML = tours
    .map((_, i) => `<button class="hc-dot ${i === 0 ? "active" : ""}" data-i="${i}" aria-label="Слайд ${i + 1}" type="button"></button>`)
    .join("");

  let index = 0;
  const total = tours.length;
  function go(i) {
    index = (i + total) % total;
    track.style.transform = `translateX(-${index * 100}%)`;
    dotsWrap.querySelectorAll(".hc-dot").forEach((d, j) => d.classList.toggle("active", j === index));
  }
  document.getElementById("hcPrev").addEventListener("click", () => go(index - 1));
  document.getElementById("hcNext").addEventListener("click", () => go(index + 1));
  dotsWrap.querySelectorAll(".hc-dot").forEach((d) => d.addEventListener("click", (e) => go(Number(e.currentTarget.dataset.i))));

  let dragging = false;
  let startX = 0;
  let deltaX = 0;
  function down(x) {
    dragging = true;
    startX = x;
    deltaX = 0;
    track.style.transition = "none";
  }
  function move(x) {
    if (!dragging) return;
    deltaX = x - startX;
    track.style.transform = `translateX(calc(-${index * 100}% + ${deltaX}px))`;
  }
  function up() {
    if (!dragging) return;
    dragging = false;
    track.style.transition = "";
    if (Math.abs(deltaX) > 60) go(index + (deltaX < 0 ? 1 : -1));
    else go(index);
    deltaX = 0;
  }
  track.addEventListener("mousedown", (e) => down(e.clientX));
  window.addEventListener("mousemove", (e) => move(e.clientX));
  window.addEventListener("mouseup", up);
  track.addEventListener("touchstart", (e) => down(e.touches[0].clientX), { passive: true });
  track.addEventListener("touchmove", (e) => move(e.touches[0].clientX), { passive: true });
  track.addEventListener("touchend", up);

  if (!REDUCE_MOTION) {
    let timer = setInterval(() => go(index + 1), 5000);
    container.addEventListener("mouseenter", () => clearInterval(timer));
    container.addEventListener("mouseleave", () => {
      timer = setInterval(() => go(index + 1), 5000);
    });
  }
}

// ---------- tooltips: hover works via CSS, tap-to-toggle for touch ----------
function wireTooltips() {
  const isTouch = window.matchMedia("(hover: none)").matches;
  if (!isTouch) return;
  document.querySelectorAll(".tip").forEach((el) => {
    if (el.dataset.tipBound) return;
    el.dataset.tipBound = "1";
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      const wasOpen = el.classList.contains("tip-open");
      document.querySelectorAll(".tip.tip-open").forEach((t) => t.classList.remove("tip-open"));
      if (!wasOpen) el.classList.add("tip-open");
    });
  });
  document.addEventListener("click", () => document.querySelectorAll(".tip.tip-open").forEach((t) => t.classList.remove("tip-open")));
}

// ---------- iridescence background (vanilla WebGL analog of react-bits Iridescence) ----------
// Reconstructed from general shader-art knowledge, not a byte-for-byte port —
// reactbits.dev was unreachable to pull the original source. Tinted to the
// site's gold/ink palette instead of the component's default white.
function initIridescence() {
  const canvas = document.getElementById("iridescenceBg");
  if (!canvas) return;

  const gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
  if (!gl) {
    canvas.style.display = "none";
    return;
  }

  const vertexSrc = `
    attribute vec2 aPosition;
    varying vec2 vUv;
    void main() {
      vUv = aPosition * 0.5 + 0.5;
      gl_Position = vec4(aPosition, 0.0, 1.0);
    }
  `;

  const fragmentSrc = `
    precision highp float;
    varying vec2 vUv;
    uniform float uTime;
    uniform vec3 uColor;
    uniform vec2 uResolution;
    uniform float uAmplitude;
    uniform vec2 uMouse;

    void main() {
      float mr = min(uResolution.x, uResolution.y);
      vec2 uv = (vUv * uResolution - 0.5 * uResolution) / mr;
      uv += (uMouse - 0.5) * uAmplitude;

      float d = -uTime * 0.5;
      float a = 0.0;
      for (float i = 0.0; i < 8.0; ++i) {
        a += cos(i - d - a * uv.x);
        d += sin(uv.y * i + a);
      }
      d += uTime * 0.5;

      // Same flowing iridescence field as the original, but collapsed to a
      // single shimmer intensity so it tints uColor instead of rainbowing.
      float shimmer = cos(uv.x * d + uv.y * a) * 0.5 + 0.5;
      shimmer *= cos(a - d) * 0.35 + 0.65;
      vec3 col = uColor * shimmer;
      gl_FragColor = vec4(col, 1.0);
    }
  `;

  function compile(type, src) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  const vs = compile(gl.VERTEX_SHADER, vertexSrc);
  const fs = compile(gl.FRAGMENT_SHADER, fragmentSrc);
  if (!vs || !fs) {
    canvas.style.display = "none";
    return;
  }

  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    canvas.style.display = "none";
    return;
  }
  gl.useProgram(program);

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const aPosition = gl.getAttribLocation(program, "aPosition");
  gl.enableVertexAttribArray(aPosition);
  gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 0, 0);

  const uTime = gl.getUniformLocation(program, "uTime");
  const uColor = gl.getUniformLocation(program, "uColor");
  const uResolution = gl.getUniformLocation(program, "uResolution");
  const uAmplitude = gl.getUniformLocation(program, "uAmplitude");
  const uMouse = gl.getUniformLocation(program, "uMouse");

  // gold accent (--gold: #cbb37c), amplitude/speed match the requested config
  gl.uniform3f(uColor, 0.796, 0.702, 0.486);
  gl.uniform1f(uAmplitude, 0.1);
  gl.uniform2f(uMouse, 0.5, 0.5);
  const SPEED = 1.0;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const w = Math.floor(window.innerWidth * dpr);
    const h = Math.floor(window.innerHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
      gl.uniform2f(uResolution, w, h);
    }
  }
  resize();
  window.addEventListener("resize", resize, { passive: true });

  if (REDUCE_MOTION) {
    gl.uniform1f(uTime, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return;
  }

  const start = performance.now();
  (function frame(now) {
    gl.uniform1f(uTime, ((now - start) / 1000) * SPEED);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    requestAnimationFrame(frame);
  })(start);
}

// ---------- white glow cursor (desktop mice only) ----------
function initCursorGlow() {
  if (REDUCE_MOTION) return;
  if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
  const glow = document.createElement("div");
  glow.id = "cursorGlow";
  document.body.appendChild(glow);
  let x = window.innerWidth / 2;
  let y = window.innerHeight / 2;
  window.addEventListener(
    "mousemove",
    (e) => {
      x = e.clientX;
      y = e.clientY;
      glow.classList.add("active");
    },
    { passive: true }
  );
  document.addEventListener("mouseleave", () => glow.classList.remove("active"));
  (function loop() {
    glow.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
    requestAnimationFrame(loop);
  })();
}

// ---------- promo popup: auto-opens once per session, 7-10s after load ----------
function initPromoPopup() {
  if (sessionStorage.getItem("meridian_promo_shown")) return;
  const delay = 7000 + Math.random() * 3000;
  setTimeout(() => {
    if (document.querySelector(".modal-overlay.open")) return; // don't interrupt another open modal
    openModal("promoModal");
    sessionStorage.setItem("meridian_promo_shown", "1");
  }, delay);

  document.getElementById("closePromoModal").addEventListener("click", () => closeModal("promoModal"));
  document.getElementById("promoModal").addEventListener("click", (e) => {
    if (e.target.id === "promoModal") closeModal("promoModal");
  });
  document.getElementById("promoCta").addEventListener("click", () => {
    closeModal("promoModal");
    hideBonusWidget();
    openModal("requestModal");
  });
}

// ---------- 3D globe: auto-rotates, drag to spin (mouse + touch) ----------
const GLOBE_PINS = [
  { countryId: "turkey", rx: 8, ry: 15, color: "#b9975f" },
  { countryId: "egypt", rx: -6, ry: 65, color: "#a8a179" },
  { countryId: "uae", rx: 14, ry: 105, color: "#cbb37c" },
  { countryId: "thailand", rx: -12, ry: 205, color: "#9fae8f" },
  { countryId: "maldives", rx: -22, ry: 245, color: "#8fabb0" },
  { countryId: "georgia", rx: 28, ry: 325, color: "#b08a85" },
];

function renderGlobePins() {
  const pins = document.getElementById("globePins");
  const legend = document.getElementById("globeLegend");
  if (!pins || !legend) return;
  const radius = 150;
  pins.innerHTML = GLOBE_PINS.map((p) => {
    const name = countryName(p.countryId);
    return `<span class="globe-pin" title="${name}" style="color:${p.color}; transform:rotateY(${p.ry}deg) rotateX(${p.rx}deg) translateZ(${radius}px);"></span>`;
  }).join("");
  legend.innerHTML = GLOBE_PINS.map(
    (p) => `<span class="globe-legend-item"><span class="globe-legend-dot" style="color:${p.color}; background:${p.color};"></span>${countryName(p.countryId)}</span>`
  ).join("");
}

function initGlobe() {
  const wrap = document.getElementById("globeWrap");
  const globe = document.getElementById("globe");
  if (!wrap || !globe) return;
  renderGlobePins();

  let rotY = 0;
  let rotX = -10;
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let startRotY = 0;
  let startRotX = 0;
  const autoplay = !REDUCE_MOTION;

  function apply() {
    globe.style.transform = `rotateX(${rotX}deg) rotateY(${rotY}deg)`;
  }
  apply();

  function tick() {
    if (autoplay && !dragging) {
      rotY += 0.05;
      apply();
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  function down(x, y) {
    dragging = true;
    startX = x;
    startY = y;
    startRotY = rotY;
    startRotX = rotX;
  }
  function move(x, y) {
    if (!dragging) return;
    rotY = startRotY + (x - startX) * 0.4;
    rotX = Math.max(-70, Math.min(70, startRotX - (y - startY) * 0.4));
    apply();
  }
  function up() {
    dragging = false;
  }

  wrap.addEventListener("mousedown", (e) => down(e.clientX, e.clientY));
  window.addEventListener("mousemove", (e) => move(e.clientX, e.clientY));
  window.addEventListener("mouseup", up);
  wrap.addEventListener("touchstart", (e) => down(e.touches[0].clientX, e.touches[0].clientY), { passive: true });
  wrap.addEventListener("touchmove", (e) => move(e.touches[0].clientX, e.touches[0].clientY), { passive: true });
  wrap.addEventListener("touchend", up);
}

// lightweight canvas confetti burst — no external libraries
function fireConfetti(originEl) {
  if (REDUCE_MOTION) return;
  const canvas = document.getElementById("confettiCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const rect = originEl ? originEl.getBoundingClientRect() : { left: window.innerWidth / 2, top: window.innerHeight / 3, width: 0, height: 0 };
  const originX = rect.left + rect.width / 2;
  const originY = rect.top + rect.height / 2;

  const colors = ["#c1502e", "#e0964f", "#12666a", "#f4c07a", "#faf3e6"];
  const pieces = Array.from({ length: 70 }, () => ({
    x: originX,
    y: originY,
    vx: (Math.random() - 0.5) * 11,
    vy: -(Math.random() * 9 + 4),
    size: 5 + Math.random() * 5,
    color: colors[Math.floor(Math.random() * colors.length)],
    rotation: Math.random() * 360,
    spin: (Math.random() - 0.5) * 18,
    shape: Math.random() > 0.5 ? "rect" : "circle",
  }));

  const gravity = 0.32;
  const start = performance.now();
  function frame(now) {
    const elapsed = now - start;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let alive = false;
    pieces.forEach((p) => {
      p.vy += gravity;
      p.x += p.vx;
      p.y += p.vy;
      p.rotation += p.spin;
      if (p.y < window.innerHeight + 20) alive = true;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate((p.rotation * Math.PI) / 180);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = Math.max(0, 1 - elapsed / 2200);
      if (p.shape === "rect") {
        ctx.fillRect(-p.size / 2, -p.size / 3, p.size, p.size * 0.6);
      } else {
        ctx.beginPath();
        ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    });
    if (alive && elapsed < 2200) {
      requestAnimationFrame(frame);
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }
  requestAnimationFrame(frame);
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
  document.getElementById("openRequestBtn").addEventListener("click", () => {
    hideBonusWidget();
    openModal("requestModal");
  });
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
    fireConfetti(form.querySelector('button[type="submit"]'));
    form.reset();
    hideBonusWidget();
    cachedBalance = null;
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
    hideBonusWidget();
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
      fireConfetti(e.target.querySelector('button[type="submit"]'));
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
  initIridescence();
  wireModals();
  wireForms();
  wireBurger();
  observeReveals();
  initParallax();
  spawnParticles();
  animateCounters();
  initCursorGlow();
  initPromoPopup();

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
  initAccordionGallery(countries);
  renderHotTours(tours.filter((t) => t.hot));
  renderDiscounts(discounts);
  renderHotelFilters();
  renderHotels();
  renderReviews();
  renderSeason();
  renderPartners(partners);
  renderBonusPreview();

  initHeroCarousel(
    tours.map((t) => ({
      title: t.title,
      nights: t.nights,
      price: t.price,
      country: countryName(t.countryId),
      gradient: countries.find((c) => c.id === t.countryId)?.gradient || "var(--ink)",
    }))
  );
  wireTooltips();
  initGlobe();
}

init().catch((err) => console.error("Ошибка загрузки данных:", err));
