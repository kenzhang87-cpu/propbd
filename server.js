import express from "express";
import cors from "cors";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { initDb, run, all, get } from "./db.js";

const PORT = process.env.PORT || 4001;
const HOST = process.env.HOST || "0.0.0.0";
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Resolve client directory robustly for both local and Vercel bundling
const candidateClientDirs = [
  path.join(process.cwd(), "client"),
  path.join(__dirname, "client"),
  path.join(__dirname, "..", "client")
];
const clientDir = candidateClientDirs.find((p) => fs.existsSync(path.join(p, "index.html"))) || candidateClientDirs[0];

initDb();

const companiesQuery = async () => {
  return all(`SELECT id, name FROM companies ORDER BY name`);
};

const authMiddleware = async (req, res, next) => {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "unauthorized" });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch (e) {
    return res.status(401).json({ error: "invalid token" });
  }
};

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get("/health", (_req, res) => res.json({ ok: true }));

  app.post("/auth/register", async (req, res) => {
    const { username, password } = req.body;
    if (!username?.trim() || !password) {
      return res.status(400).json({ error: "username and password required" });
    }
    if (username === "admin") {
      return res.status(400).json({ error: "username reserved" });
    }
    try {
      const hash = await bcrypt.hash(password, 10);
      await run(`INSERT INTO users(username, password_hash, is_admin) VALUES (?, ?, 0)`, [
        username.trim(),
        hash
      ]);
      res.json({ ok: true });
    } catch (e) {
      return res.status(400).json({ error: "user exists" });
    }
  });

  app.post("/auth/login", async (req, res) => {
    const { username, password } = req.body;
    if (!username?.trim() || !password) {
      return res.status(400).json({ error: "username and password required" });
    }
    const user = await get(`SELECT * FROM users WHERE username=?`, [username.trim()]);
    if (!user) return res.status(401).json({ error: "invalid credentials" });
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: "invalid credentials" });

    const token = jwt.sign(
      { id: user.id, username: user.username, isAdmin: !!user.is_admin },
      JWT_SECRET,
      { expiresIn: "7d" }
    );
    res.json({ token, username: user.username, isAdmin: !!user.is_admin });
  });

  app.get("/companies", async (_req, res) => {
    const list = await companiesQuery();
    res.json(list);
  });

  app.post("/companies", authMiddleware, async (req, res) => {
    if (!req.user?.isAdmin) return res.status(403).json({ error: "admin required" });
    const { id, name, ticker = "", pricePrivate = false, overview = "", financials = { columns: ["date","revenue","ebitda"], rows: [] }, news = [], prices = [] } = req.body;
    const slug = String(id || "").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
    if (!slug) return res.status(400).json({ error: "id required" });
    if (!name?.trim()) return res.status(400).json({ error: "name required" });

    try {
      await run(`INSERT INTO companies(id, name) VALUES (?, ?)`, [slug, name.trim()]);
      await run(
        `INSERT OR REPLACE INTO company_content(id, overview, prices, financials, news, price_private, ticker)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          slug,
          overview,
          JSON.stringify(prices),
          JSON.stringify(financials),
          JSON.stringify(news),
          pricePrivate ? 1 : 0,
          ticker || null
        ]
      );
      const list = await companiesQuery();
      res.json({ ok: true, companies: list, id: slug });
    } catch (e) {
      res.status(400).json({ error: "could not create company" });
    }
  });

  app.patch("/companies/:id", authMiddleware, async (req, res) => {
    if (!req.user?.isAdmin) return res.status(403).json({ error: "admin required" });
    const { id } = req.params;
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: "name required" });
    const exists = await get(`SELECT id FROM companies WHERE id=?`, [id]);
    if (!exists) return res.status(404).json({ error: "not found" });
    await run(`UPDATE companies SET name=? WHERE id=?`, [name.trim(), id]);
    const list = await companiesQuery();
    res.json({ ok: true, companies: list });
  });

  app.get("/content/:id", async (req, res) => {
    const { id } = req.params;
    const row = await get(`SELECT * FROM company_content WHERE id=?`, [id]);
    if (!row) return res.status(404).json({ error: "not found" });
    res.json({
      id: row.id,
      overview: row.overview || "",
      summary: row.summary || "",
      prices: safeParse(row.prices, []),
      financials: safeParse(row.financials, []),
      news: safeParse(row.news, []),
      pricePrivate: !!row.price_private,
      ticker: row.ticker || ""
    });
  });

  app.put("/content/:id", authMiddleware, async (req, res) => {
    if (!req.user?.isAdmin) return res.status(403).json({ error: "admin required" });
    const { id } = req.params;
    const { overview, summary, prices, financials, news, pricePrivate, ticker } = req.body;

    const exists = await get(`SELECT id FROM company_content WHERE id=?`, [id]);
    if (!exists) return res.status(404).json({ error: "not found" });

    const payload = {
      overview: overview ?? "",
      summary: summary ?? "",
      prices: Array.isArray(prices) ? prices : [],
      financials: financials ?? [],
      news: Array.isArray(news) ? news : [],
      pricePrivate: !!pricePrivate,
      ticker: ticker || ""
    };

    await run(
      `UPDATE company_content SET overview=?, summary=?, prices=?, financials=?, news=?, price_private=?, ticker=? WHERE id=?`,
      [
        payload.overview,
        payload.summary,
        JSON.stringify(payload.prices),
        JSON.stringify(payload.financials),
        JSON.stringify(payload.news),
        payload.pricePrivate ? 1 : 0,
        payload.ticker || null,
        id
      ]
    );

    res.json({ ok: true, content: payload });
  });

  // Serve the client as static assets so deployed environments can use same origin
  app.use(express.static(clientDir, { index: "index.html" }));
  app.get("*", (_req, res) => {
    const indexPath = path.join(clientDir, "index.html");
    if (fs.existsSync(indexPath)) {
      return res.sendFile(indexPath);
    }
    res.status(404).send("client index not found");
  });

  return app;
}

const app = createApp();

if (!process.env.VERCEL) {
  app.listen(PORT, HOST, () => {
    console.log(`PropBD backend running on http://${HOST}:${PORT}`);
  });
}

function safeParse(str, fallback) {
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

export default app;
