import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "data");
const PUBLIC_DIR = path.join(__dirname, "public");

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "dev-admin-token";
const PORT = process.env.PORT || 3000;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

if (!process.env.JWT_SECRET) {
  console.warn(
    "[warn] JWT_SECRET is not set — using an insecure dev default. Set it in production."
  );
}
if (!process.env.ADMIN_TOKEN) {
  console.warn(
    "[warn] ADMIN_TOKEN is not set — using an insecure dev default. Set it in production."
  );
}

// ---------- tiny JSON file storage ----------
function readCollection(name) {
  const file = path.join(DATA_DIR, `${name}.json`);
  if (!fs.existsSync(file)) return [];
  return JSON.parse(fs.readFileSync(file, "utf-8"));
}
function writeCollection(name, data) {
  const file = path.join(DATA_DIR, `${name}.json`);
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf-8");
}
// runtime collections created on first write if missing
["leads", "users"].forEach((name) => {
  const file = path.join(DATA_DIR, `${name}.json`);
  if (!fs.existsSync(file)) writeCollection(name, []);
});

// ---------- auth helpers ----------
function signToken(user) {
  return jwt.sign({ sub: user.id, email: user.email }, JWT_SECRET, {
    expiresIn: "30d",
  });
}
function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Не авторизован" });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const users = readCollection("users");
    const user = users.find((u) => u.id === payload.sub);
    if (!user) return res.status(401).json({ error: "Не авторизован" });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: "Недействительный токен" });
  }
}
function requireAdmin(req, res, next) {
  const token = req.headers["x-admin-token"];
  if (!token || token !== ADMIN_TOKEN) {
    return res.status(403).json({ error: "Неверный админ-токен" });
  }
  next();
}
function publicUser(u) {
  const { passwordHash, ...rest } = u;
  return rest;
}
function countryDisplayName(id) {
  if (!id) return "";
  const c = readCollection("countries").find((c) => c.id === id);
  return c ? c.name : id;
}

// fire-and-forget Telegram notification for new leads; no-op if not configured
function notifyTelegram(lead) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  const lines = [
    "🆕 Новая заявка — Меридиан",
    `Имя: ${lead.name}`,
    `Телефон: ${lead.phone}`,
    lead.email ? `Email: ${lead.email}` : null,
    `Направление: ${countryDisplayName(lead.countryId) || "не указано"}`,
    lead.budget ? `Бюджет: ${lead.budget}` : null,
    lead.dateFrom ? `Даты: ${lead.dateFrom}${lead.dateTo ? " — " + lead.dateTo : ""}` : null,
    `Гости: ${lead.adults} взр.${lead.kids ? ", " + lead.kids + " дет." : ""}`,
    lead.comment ? `Комментарий: ${lead.comment}` : null,
    lead.pointsRequested ? `Хочет списать баллов: ${lead.pointsRequested}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: lines }),
  }).catch((err) => console.warn("[telegram] notify failed:", err.message));
}

const app = express();
app.use(express.json());
app.use(express.static(PUBLIC_DIR));

// ---------- read-only content endpoints ----------
app.get("/api/countries", (req, res) => res.json(readCollection("countries")));

app.get("/api/tours", (req, res) => {
  let tours = readCollection("tours");
  const { country, hot } = req.query;
  if (country) tours = tours.filter((t) => t.countryId === country);
  if (hot === "true") tours = tours.filter((t) => t.hot);
  res.json(tours);
});

app.get("/api/hotels", (req, res) => {
  let hotels = readCollection("hotels");
  const { country } = req.query;
  if (country) hotels = hotels.filter((h) => h.countryId === country);
  res.json(hotels);
});

app.get("/api/reviews", (req, res) => {
  let reviews = readCollection("reviews").filter((r) => r.status !== "pending");
  const { country } = req.query;
  if (country) reviews = reviews.filter((r) => r.countryId === country);
  res.json(reviews);
});

app.post("/api/reviews", (req, res) => {
  const { name, countryId, rating, text } = req.body || {};
  if (!name || !text) return res.status(400).json({ error: "Укажите имя и текст отзыва" });
  const reviews = readCollection("reviews");
  const review = {
    id: crypto.randomUUID(),
    name: String(name).slice(0, 200),
    countryId: countryId || "",
    rating: Math.min(5, Math.max(1, Number(rating) || 5)),
    text: String(text).slice(0, 2000),
    date: new Date().toISOString().slice(0, 10),
    status: "pending",
  };
  reviews.push(review);
  writeCollection("reviews", reviews);
  res.status(201).json({ ok: true });
});

app.get("/api/partners", (req, res) => res.json(readCollection("partners")));
app.get("/api/discounts", (req, res) => res.json(readCollection("discounts")));

// ---------- lead / tour request form ----------
app.post("/api/leads", (req, res) => {
  const { name, phone, email, countryId, budget, dateFrom, dateTo, adults, kids, comment, tourPrice, pointsRequested } =
    req.body || {};
  if (!name || !phone) {
    return res.status(400).json({ error: "Укажите имя и телефон" });
  }

  let userId = null;
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (token) {
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      userId = payload.sub;
    } catch {
      /* not authenticated — anonymous lead is fine */
    }
  }

  const leads = readCollection("leads");
  const lead = {
    id: crypto.randomUUID(),
    name: String(name).slice(0, 200),
    phone: String(phone).slice(0, 50),
    email: email ? String(email).slice(0, 200) : "",
    countryId: countryId || "",
    budget: budget || "",
    dateFrom: dateFrom || "",
    dateTo: dateTo || "",
    adults: Number(adults) || 1,
    kids: Number(kids) || 0,
    comment: comment ? String(comment).slice(0, 2000) : "",
    userId,
    status: "new",
    amount: null,
    // client-supplied hint only — never trusted for money math, just shown to the manager
    tourPriceHint: Math.max(0, Number(tourPrice) || 0) || null,
    // how many points the tourist would like to redeem; actually deducted (and capped
    // against the real, admin-confirmed amount) only when the lead is marked completed
    pointsRequested: userId ? Math.max(0, Math.floor(Number(pointsRequested)) || 0) : 0,
    pointsRedeemed: 0,
    createdAt: new Date().toISOString(),
  };
  leads.push(lead);
  writeCollection("leads", leads);
  notifyTelegram(lead);
  res.status(201).json({ ok: true, id: lead.id });
});

// ---------- auth ----------
app.post("/api/auth/register", async (req, res) => {
  const { name, email, phone, password } = req.body || {};
  if (!name || !email || !password) {
    return res.status(400).json({ error: "Заполните имя, email и пароль" });
  }
  const users = readCollection("users");
  if (users.some((u) => u.email.toLowerCase() === String(email).toLowerCase())) {
    return res.status(409).json({ error: "Пользователь с таким email уже существует" });
  }
  const passwordHash = await bcrypt.hash(password, 10);
  const user = {
    id: crypto.randomUUID(),
    name: String(name).slice(0, 200),
    email: String(email).toLowerCase(),
    phone: phone || "",
    passwordHash,
    bonusPoints: 0,
    bonusHistory: [],
    createdAt: new Date().toISOString(),
  };
  users.push(user);
  writeCollection("users", users);
  res.status(201).json({ token: signToken(user), user: publicUser(user) });
});

app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body || {};
  const users = readCollection("users");
  const user = users.find((u) => u.email.toLowerCase() === String(email || "").toLowerCase());
  if (!user || !(await bcrypt.compare(password || "", user.passwordHash))) {
    return res.status(401).json({ error: "Неверный email или пароль" });
  }
  res.json({ token: signToken(user), user: publicUser(user) });
});

app.get("/api/me", requireAuth, (req, res) => res.json(publicUser(req.user)));

app.get("/api/me/leads", requireAuth, (req, res) => {
  const leads = readCollection("leads");
  const mine = leads.filter(
    (l) => l.userId === req.user.id || l.email.toLowerCase() === req.user.email.toLowerCase()
  );
  res.json(mine);
});

// ---------- admin: reviews moderation ----------
app.get("/api/admin/reviews", requireAdmin, (req, res) => res.json(readCollection("reviews")));

// ---------- admin: leads ----------
app.get("/api/admin/leads", requireAdmin, (req, res) => res.json(readCollection("leads")));

app.patch("/api/admin/leads/:id", requireAdmin, (req, res) => {
  const leads = readCollection("leads");
  const lead = leads.find((l) => l.id === req.params.id);
  if (!lead) return res.status(404).json({ error: "Заявка не найдена" });

  const { status, amount } = req.body || {};
  const wasCompleted = lead.status === "completed";
  if (status) lead.status = status;
  if (amount !== undefined) lead.amount = Number(amount) || null;

  // settle loyalty points once, when a lead is marked completed with a final amount:
  // 1) redeem the points the tourist requested (capped at their balance and 30% of the amount)
  // 2) award 5% of the amount actually payable (after redemption) as new bonus points
  if (!wasCompleted && lead.status === "completed" && lead.amount) {
    const users = readCollection("users");
    const user =
      users.find((u) => u.id === lead.userId) ||
      users.find((u) => u.email.toLowerCase() === lead.email.toLowerCase());
    if (user) {
      const redeemCap = Math.floor(lead.amount * 0.3);
      const redeemed = Math.min(lead.pointsRequested || 0, user.bonusPoints, redeemCap);
      if (redeemed > 0) {
        user.bonusPoints -= redeemed;
        user.bonusHistory.push({
          points: -redeemed,
          reason: `Списание на тур: ${lead.countryId || "—"}`,
          date: new Date().toISOString(),
        });
        lead.pointsRedeemed = redeemed;
      }

      const payable = Math.max(0, lead.amount - redeemed);
      const earned = Math.round(payable * 0.05);
      user.bonusPoints += earned;
      user.bonusHistory.push({
        points: earned,
        reason: `Тур: ${lead.countryId || "—"} (${lead.amount}$)`,
        date: new Date().toISOString(),
      });
      writeCollection("users", users);
    }
  }

  writeCollection("leads", leads);
  res.json({ ok: true, lead });
});

// ---------- admin: generic CRUD for editable catalogs ----------
const EDITABLE_COLLECTIONS = new Set(["hotels", "tours", "discounts", "countries", "reviews"]);

app.post("/api/admin/:collection", requireAdmin, (req, res) => {
  const { collection } = req.params;
  if (!EDITABLE_COLLECTIONS.has(collection)) return res.status(404).end();
  const items = readCollection(collection);
  const item = { id: crypto.randomUUID(), ...req.body };
  items.push(item);
  writeCollection(collection, items);
  res.status(201).json(item);
});

app.put("/api/admin/:collection/:id", requireAdmin, (req, res) => {
  const { collection, id } = req.params;
  if (!EDITABLE_COLLECTIONS.has(collection)) return res.status(404).end();
  const items = readCollection(collection);
  const idx = items.findIndex((i) => i.id === id);
  if (idx === -1) return res.status(404).json({ error: "Не найдено" });
  items[idx] = { ...items[idx], ...req.body, id };
  writeCollection(collection, items);
  res.json(items[idx]);
});

app.delete("/api/admin/:collection/:id", requireAdmin, (req, res) => {
  const { collection, id } = req.params;
  if (!EDITABLE_COLLECTIONS.has(collection)) return res.status(404).end();
  const items = readCollection(collection).filter((i) => i.id !== id);
  writeCollection(collection, items);
  res.json({ ok: true });
});

app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) return next();
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

app.listen(PORT, () => {
  console.log(`Meridian Travel запущен: http://localhost:${PORT}`);
});
