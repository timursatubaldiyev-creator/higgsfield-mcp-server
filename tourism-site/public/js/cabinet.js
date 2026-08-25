const TOKEN_KEY = "meridian_token";

async function fetchJSON(url, opts) {
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Ошибка запроса");
  return data;
}

const STATUS_LABELS = { new: "Новая", in_progress: "В работе", completed: "Завершена", cancelled: "Отменена" };
let countries = [];
function countryName(id) {
  const c = countries.find((c) => c.id === id);
  return c ? c.name : id || "Без направления";
}

function wireTabs() {
  const tabLogin = document.getElementById("tabLogin");
  const tabRegister = document.getElementById("tabRegister");
  const loginForm = document.getElementById("loginForm");
  const registerForm = document.getElementById("registerForm");

  tabLogin.addEventListener("click", () => {
    tabLogin.classList.add("active");
    tabRegister.classList.remove("active");
    loginForm.classList.remove("hidden");
    registerForm.classList.add("hidden");
  });
  tabRegister.addEventListener("click", () => {
    tabRegister.classList.add("active");
    tabLogin.classList.remove("active");
    registerForm.classList.remove("hidden");
    loginForm.classList.add("hidden");
  });
}

function wireAuthForms() {
  document.getElementById("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const note = document.getElementById("loginNote");
    note.classList.remove("error");
    note.textContent = "Входим...";
    const fd = new FormData(e.target);
    try {
      const data = await fetchJSON("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.fromEntries(fd.entries())),
      });
      localStorage.setItem(TOKEN_KEY, data.token);
      showDashboard();
    } catch (err) {
      note.textContent = err.message;
      note.classList.add("error");
    }
  });

  document.getElementById("registerForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const note = document.getElementById("registerNote");
    note.classList.remove("error");
    note.textContent = "Создаём аккаунт...";
    const fd = new FormData(e.target);
    try {
      const data = await fetchJSON("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.fromEntries(fd.entries())),
      });
      localStorage.setItem(TOKEN_KEY, data.token);
      showDashboard();
    } catch (err) {
      note.textContent = err.message;
      note.classList.add("error");
    }
  });

  document.getElementById("logoutBtn").addEventListener("click", () => {
    localStorage.removeItem(TOKEN_KEY);
    location.reload();
  });
}

function formatDate(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
}

async function showDashboard() {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) return;
  try {
    const [me, leads, countryList] = await Promise.all([
      fetchJSON("/api/me", { headers: { Authorization: `Bearer ${token}` } }),
      fetchJSON("/api/me/leads", { headers: { Authorization: `Bearer ${token}` } }),
      fetchJSON("/api/countries"),
    ]);
    countries = countryList;

    document.getElementById("authBlock").classList.add("hidden");
    document.getElementById("dashBlock").classList.remove("hidden");
    document.getElementById("logoutBtn").classList.remove("hidden");
    document.getElementById("balanceValue").textContent = me.bonusPoints;

    const list = document.getElementById("leadsList");
    if (leads.length) {
      list.innerHTML = leads
        .slice()
        .reverse()
        .map(
          (l) => `
        <div class="lead-item">
          <strong>${countryName(l.countryId)}</strong>
          <span class="lead-status ${l.status}">${STATUS_LABELS[l.status] || l.status}</span>
          <div style="color:var(--ink-soft);margin-top:.3rem;">
            ${formatDate(l.createdAt)} · бюджет: ${l.budget || "—"} · ${l.adults} взр. ${l.kids ? "+ " + l.kids + " дет." : ""}
          </div>
          ${l.comment ? `<div style="margin-top:.3rem;">${l.comment}</div>` : ""}
          ${l.pointsRedeemed ? `<div style="margin-top:.3rem;color:var(--terracotta-deep);font-weight:600;">Списано баллов: ${l.pointsRedeemed}</div>` : l.pointsRequested ? `<div style="margin-top:.3rem;color:var(--ink-soft);">Запрошено к списанию: ${l.pointsRequested}</div>` : ""}
        </div>`
        )
        .join("");
    }
  } catch {
    localStorage.removeItem(TOKEN_KEY);
  }
}

wireTabs();
wireAuthForms();
showDashboard();
