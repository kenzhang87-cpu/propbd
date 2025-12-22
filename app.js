const API = "http://localhost:4001";

const state = {
  user: null,
  token: localStorage.getItem("bdx-token") || "",
  mode: "login",
  companies: [],
  selected: null,
  content: {},
  loading: false,
  error: "",
  apiError: ""
};

const el = (id) => document.getElementById(id);

async function api(path, opts = {}) {
  const headers = opts.headers || {};
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  if (!(opts.body instanceof FormData)) headers["Content-Type"] = "application/json";

  let res;
  try {
    res = await fetch(`${API}${path}`, { ...opts, headers });
  } catch (err) {
    state.apiError = "Cannot reach backend. Is it running on 4001?";
    throw err;
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || "Request failed");
  }
  state.apiError = "";
  return data;
}

async function loadCompanies() {
  state.companies = await api("/companies");
  if (!state.selected && state.companies.length) {
    state.selected = state.companies[0].id;
  }
}

async function loadContent(id) {
  if (!id) return;
  const data = await api(`/content/${id}`);
  state.content[id] = data;
}

function setUser(user, token) {
  state.user = user;
  state.token = token || "";
  if (token) localStorage.setItem("bdx-token", token);
  render();
}

function sparkline(points) {
  const w = 240;
  const h = 120;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = Math.max(1, max - min);
  const step = points.length > 1 ? w / (points.length - 1) : w;
  const coords = points
    .map((p, i) => {
      const x = i * step;
      const y = h - ((p - min) / span) * h;
      return `${x},${y}`;
    })
    .join(" ");
  return `
    <svg class="sparkline" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
      <defs>
        <linearGradient id="grad" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stop-color="#e34f4f" stop-opacity="0.8"/>
          <stop offset="100%" stop-color="#e34f4f" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <polyline fill="url(#grad)" stroke="none" points="${coords}  ${w},${h} 0,${h}"/>
      <polyline fill="none" stroke="#ff9a9a" stroke-width="2" points="${coords}" />
    </svg>
  `;
}

function sectionHeader(title, allowEdit, onEdit) {
  return `
    <div class="section-header">
      <div class="section-title">${title}</div>
      ${allowEdit ? `<button class="edit-btn" data-edit="${onEdit}">Edit</button>` : ""}
    </div>
  `;
}

function renderOverview(content, canEdit, company) {
  const summary = content.summary || synthesizeSummary(company, content);
  return `
    <div class="panel">
      ${sectionHeader("Company Overview", canEdit, "overview")}
      <div class="card overview" style="font-size:13px;color:#d0cede;">
        <strong>Summary:</strong> ${summary}
      </div>
      <div class="card overview">${content.overview || ""}</div>
    </div>
  `;
}

function renderChart(content, canEdit) {
  const isPrivate = content.pricePrivate;
  const ticker = content.ticker || "";
  const priceSeries = normalizePrices(content.prices);
  if (isPrivate) {
    return `
      <div class="panel">
        ${sectionHeader("Price Chart (Private)", canEdit, "prices")}
        <div class="card">
          <div style="color:var(--muted);margin-bottom:6px;">Private: showing manual series.</div>
          ${renderPriceChart(priceSeries)}
        </div>
      </div>
    `;
  }
  if (!ticker) {
    return `
      <div class="panel">
        ${sectionHeader("Price Chart", canEdit, "prices")}
        <div class="card" style="color:var(--muted);">Set a ticker to display a public chart (e.g. NASDAQ:VIRT).</div>
      </div>
    `;
  }
  return `
    <div class="panel">
      ${sectionHeader("Price Chart", canEdit, "prices")}
      <div class="card">
        <div style="color:var(--muted);margin-bottom:6px;">Public ticker: ${ticker} (TradingView embed).</div>
        <iframe
          src="https://s.tradingview.com/embed-widget/mini-symbol-overview/?symbol=${encodeURIComponent(ticker)}&locale=en&dateRange=12M&colorTheme=dark&trendLineColor=%23e34f4f"
          style="width:100%;height:420px;border:none;border-radius:12px;overflow:hidden;background:#0c0b10;"
          loading="lazy"
          referrerpolicy="no-referrer"
        ></iframe>
      </div>
    </div>
  `;
}

function renderFinancials(content, canEdit) {
  const fin = normalizeFinancials(content.financials);
  const cols = Array.isArray(fin.columns) ? fin.columns : ["date", "revenue", "ebitda"];
  const rowsData = Array.isArray(fin.rows) ? fin.rows : [];

  const header = cols.map((c) => `<th>${c}</th>`).join("");
  const rows = rowsData
    .map(
      (r) =>
        `<tr>${cols.map((c) => `<td>${formatCell(r[c])}</td>`).join("")}</tr>`
    )
    .join("");
  return `
    <div class="panel">
      ${sectionHeader("Financials", canEdit, "financials")}
      <div class="card">
        <table class="fin-table">
          <thead><tr>${header}</tr></thead>
          <tbody>${rows || `<tr><td colspan="${cols.length}" style="color:var(--muted);">No financials</td></tr>`}</tbody>
        </table>
        <div style="margin-top:10px;">${renderFinChart({ columns: cols, rows: rowsData })}</div>
      </div>
    </div>
  `;
}

function renderNews(content, canEdit) {
  const items = (content.news || []).map((n) => `<li>${n}</li>`).join("");
  return `
    <div class="panel">
      ${sectionHeader("News", canEdit, "news")}
      <div class="card">
        <ul class="news-list">${items}</ul>
      </div>
    </div>
  `;
}

function renderCompany() {
  const company = state.companies.find((c) => c.id === state.selected);
  if (!company) return "<div class='panel'>No companies.</div>";
  const content = state.content[company.id] || {};
  const canEdit = state.user?.isAdmin;
  return `
    <div class="grid" style="gap:18px;">
      <div class="banner-cta panel">
        <div>
          <div style="color:#f7f7fb;font-weight:700;">${company.name}</div>
          <div style="color:var(--muted);font-size:16px;"></div>
        </div>
        <div class="actions" style="gap:6px;">
          <div class="badge">Editing: ${canEdit ? "Allowed" : "View only"}</div>
          ${canEdit ? `<button class="pill" data-edit-company>Rename</button>` : ""}
        </div>
      </div>
      ${renderOverview(content, canEdit, company)}
      ${renderChart(content, canEdit)}
      ${renderFinancials(content, canEdit)}
      ${renderNews(content, canEdit)}
    </div>
  `;
}

function normalizeFinancials(fin) {
  if (!fin) {
    return { columns: ["date", "revenue", "ebitda"], rows: [] };
  }
  // legacy format: [["Revenue","$.."], ...]
  if (Array.isArray(fin) && fin.length && Array.isArray(fin[0])) {
    return { columns: ["metric", "value"], rows: fin.map(([k, v]) => ({ metric: k, value: v })) };
  }
  if (typeof fin === "object") {
    const columns = Array.isArray(fin.columns) && fin.columns.length ? fin.columns : ["date", "revenue", "ebitda"];
    const rows = Array.isArray(fin.rows) ? fin.rows : [];
    return { columns, rows };
  }
  return { columns: ["date", "revenue", "ebitda"], rows: [] };
}

function normalizePrices(prices) {
  if (!prices) return [];
  // legacy array of numbers
  if (Array.isArray(prices) && prices.length && typeof prices[0] === "number") {
    return prices.map((v, i) => ({ date: `p${i + 1}`, value: v }));
  }
  if (Array.isArray(prices)) {
    return prices
      .map((p, i) => {
        if (typeof p === "object" && p) {
          return { date: p.date || `p${i + 1}`, value: Number(p.value) || 0 };
        }
        return null;
      })
      .filter(Boolean);
  }
  return [];
}

function formatCell(val) {
  if (val == null || val === "") return "—";
  if (typeof val === "number") return formatNumber(val);
  return val;
}

function formatNumber(n) {
  const num = Number(n);
  if (Number.isNaN(num)) return n;
  return num.toLocaleString();
}

function synthesizeSummary(company, content) {
  const name = company?.name || "The company";
  const overview = (content.overview || "").replace(/\s+/g, " ").trim();

  const fin = normalizeFinancials(content.financials);
  const rows = Array.isArray(fin.rows) ? fin.rows : [];
  const firstRow = rows[0] || {};
  const revenueKey = (fin.columns || []).find((c) => c.toLowerCase().includes("revenue"));
  const ebitdaKey = (fin.columns || []).find((c) => c.toLowerCase().includes("ebitda"));
  const revenue = revenueKey ? firstRow[revenueKey] : null;
  const ebitda = ebitdaKey ? firstRow[ebitdaKey] : null;

  const parts = [];
  parts.push(`${name} operates as a multi-asset trading and market-making firm.`);
  if (overview) parts.push(overview);
  if (content.ticker) parts.push(`Public marker: ${content.ticker}.`);
  if (revenue) parts.push(`Recent revenue: ${formatNumber(revenue)}.`);
  if (ebitda) parts.push(`EBITDA: ${formatNumber(ebitda)}.`);
  parts.push("Key regions: Americas, EMEA, and APAC.");
  parts.push("Focus products: equities, ETFs, options, FX, and digital assets.");

  const sentence = parts.join(" ");
  const words = sentence.split(/\s+/).slice(0, 150).join(" ");
  return words;
}

function renderFinChart(fin) {
  const numCols = fin.columns.filter((c) => c.toLowerCase() !== "date");
  if (!fin.rows.length || !numCols.length) return `<div style="color:var(--muted);font-size:12px;">Add financial rows to view chart.</div>`;

  const width = 420;
  const height = 180;
  const padding = 30;
  const dates = fin.rows.map((r) => r.date || "");
  const xStep = fin.rows.length > 1 ? (width - padding * 2) / (fin.rows.length - 1) : width / 2;

  const series = numCols.map((col, idx) => {
    const values = fin.rows.map((r) => Number(r[col]) || 0);
    return { col, values, color: paletteColor(idx) };
  });

  const allVals = series.flatMap((s) => s.values);
  const min = Math.min(...allVals);
  const max = Math.max(...allVals);
  const span = max - min || 1;

  const polylines = series
    .map((s) => {
      const pts = s.values
        .map((v, i) => {
          const x = padding + i * xStep;
          const y = height - padding - ((v - min) / span) * (height - padding * 2);
          return `${x},${y}`;
        })
        .join(" ");
      return `<polyline fill="none" stroke="${s.color}" stroke-width="2" points="${pts}" />`;
    })
    .join("");

  const labels = dates
    .map((d, i) => {
      const x = padding + i * xStep;
      return `<text x="${x}" y="${height - 8}" fill="#888" font-size="10" text-anchor="middle">${d}</text>`;
    })
    .join("");

  const yTicks = 4;
  const yTickVals = Array.from({ length: yTicks + 1 }, (_, i) => min + (span / yTicks) * i);
  const labelsY = yTickVals
    .map((v) => `<text x="${padding - 6}" y="${height - padding - ((v - min) / span) * (height - padding * 2) + 4}" fill="#888" font-size="10" text-anchor="end">${formatNumber(v)}</text>`)
    .join("");

  const circles = series
    .map((s) =>
      s.values
        .map((v, i) => {
          const x = padding + i * xStep;
          const y = height - padding - ((v - min) / span) * (height - padding * 2);
          return `<circle cx="${x}" cy="${y}" r="3" fill="${s.color}" data-tip="${s.col}: ${formatNumber(v)} (${dates[i]})"><title>${formatNumber(v)}</title></circle>`;
        })
        .join("")
    )
    .join("");

  const legend = series
    .map((s) => `<span style="color:${s.color};font-size:12px;">● ${s.col}</span>`)
    .join(" · ");

  return `
    <div style="margin-top:8px;">
      <svg viewBox="0 0 ${width} ${height}" style="width:100%;max-width:100%;background:#0f0e17;border:1px solid var(--border);border-radius:8px;" class="chart chart-fin">
        <line x1="${padding}" y1="${padding}" x2="${padding}" y2="${height - padding}" stroke="#333" />
        <line x1="${padding}" y1="${height - padding}" x2="${width - padding + 10}" y2="${height - padding}" stroke="#333" />
        ${labelsY}
        ${polylines}
        ${labels}
        ${circles}
      </svg>
      <div style="margin-top:6px;color:var(--muted);font-size:12px;">${legend}</div>
    </div>
  `;
}

function paletteColor(i) {
  const colors = ["#e34f4f", "#6ce3a6", "#6fa7ff", "#f5c84c", "#c17dff"];
  return colors[i % colors.length];
}

function renderPriceChart(points) {
  if (!points.length) return `<div style="color:var(--muted);font-size:12px;">No price points</div>`;
  const width = 420;
  const height = 180;
  const padding = 30;
  const vals = points.map((p) => Number(p.value) || 0);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const step = points.length > 1 ? (width - padding * 2) / (points.length - 1) : width / 2;
  const scaleY = (v) => height - padding - ((v - min) / span) * (height - padding * 2);
  const scaleX = (i) => padding + i * step;
  const poly = points.map((p, i) => `${scaleX(i)},${scaleY(Number(p.value))}`).join(" ");

  const yTicks = 4;
  const yTickVals = Array.from({ length: yTicks + 1 }, (_, i) => min + (span / yTicks) * i);
  const labelsX = points
    .map((p, i) => `<text x="${scaleX(i)}" y="${height - 6}" fill="#888" font-size="10" text-anchor="middle">${p.date}</text>`)
    .join("");
  const labelsY = yTickVals
    .map((v) => `<text x="${padding - 6}" y="${scaleY(v) + 4}" fill="#888" font-size="10" text-anchor="end">${formatNumber(v)}</text>`)
    .join("");

  const circles = points
    .map(
      (p, i) =>
        `<circle cx="${scaleX(i)}" cy="${scaleY(Number(p.value))}" r="3" fill="#e34f4f" data-tip="Price: ${formatNumber(p.value)} (${p.date})" />
         <title>${formatNumber(p.value)}</title>`
    )
    .join("");

  return `
    <svg viewBox="0 0 ${width} ${height}" style="width:100%;max-width:100%;background:#0f0e17;border:1px solid var(--border);border-radius:8px;" class="chart chart-price">
      <line x1="${padding}" y1="${padding}" x2="${padding}" y2="${height - padding}" stroke="#333" />
      <line x1="${padding}" y1="${height - padding}" x2="${width - padding + 10}" y2="${height - padding}" stroke="#333" />
      ${labelsY}
      ${labelsX}
      <polyline fill="none" stroke="#e34f4f" stroke-width="2" points="${poly}" />
      ${circles}
    </svg>
  `;
}

function renderCompanies() {
  return `
    <div class="nav-row">
      <button class="pill" data-new-company style="font-weight:700;">[+ New]</button>
      ${state.companies
        .map(
          (c) =>
            `<button class="pill ${c.id === state.selected ? "active" : ""}" data-company="${c.id}">${c.name}</button>`
        )
        .join("")}
    </div>
  `;
}

function renderShell() {
  const username = state.user?.username || "";
  return `
    <div class="shell">
      ${state.apiError ? `<div class="panel" style="border:1px solid #e34f4f;color:#ff8b8b;">${state.apiError}</div>` : ""}
      <div class="hero">
        <div class="brand">
          <div class="badge">PropBD</div>
          <div>
            <div style="font-size:20px;font-weight:700;">PropBD</div>
            <div style="font-size:13px;color:var(--muted);">Proprietary research on HFT / MM / Prop firms.</div>
          </div>
        </div>
        <div class="actions">
          <div class="badge" style="background:#1f1d2a;color:#f7f7fb;">User: ${username}</div>
          <button class="pill" data-logout>Logout</button>
        </div>
      </div>
      <div style="margin:16px 0 10px 0;">${renderCompanies()}</div>
      <div class="banner-cta panel" style="margin-bottom:14px;">
        <div>Choose a firm above, then edit sections if you are logged in as admin (admin/password).</div>
        <div class="badge" style="background:rgba(227,79,79,0.15);color:#f7f7fb;border:1px solid var(--border);">Content saved to backend</div>
      </div>
      ${renderCompany()}
    </div>
  `;
}

function renderAuth() {
  const isLogin = state.mode === "login";
  return `
    <div class="auth">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
        <div style="font-size:18px;font-weight:700;">PropBD</div>
        <div class="badge">Access</div>
      </div>
      <p class="note">Use admin/password for admin edits. Regular users can register below.</p>
      <form id="auth-form">
        <label>
          Username
          <input name="username" required placeholder="admin" />
        </label>
        <label>
          Password
          <input type="password" name="password" required placeholder="${isLogin ? "••••••" : "min 4 chars"}" />
        </label>
        <button type="submit">${isLogin ? "Login" : "Register"}</button>
        <button type="button" class="toggle" data-toggle>${isLogin ? "Need to register?" : "Have an account?"}</button>
        <div id="auth-error" class="error"></div>
      </form>
    </div>
  `;
}

function render() {
  const root = document.getElementById("app");
  if (!state.user) {
    root.innerHTML = renderAuth();
    bindAuth();
    return;
  }
  root.innerHTML = renderShell();
  bindShell();
  bindTooltips();
}

function bindAuth() {
  const form = document.getElementById("auth-form");
  const toggle = document.querySelector("[data-toggle]");
  const error = document.getElementById("auth-error");

  toggle.addEventListener("click", () => {
    state.mode = state.mode === "login" ? "register" : "login";
    render();
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const username = data.get("username").trim();
    const password = data.get("password").trim();
    error.textContent = "";

    (async () => {
      try {
        if (state.mode === "login") {
          const res = await api("/auth/login", {
            method: "POST",
            body: JSON.stringify({ username, password })
          });
          await loadCompanies();
          if (state.selected) await loadContent(state.selected);
          setUser({ username: res.username, isAdmin: res.isAdmin }, res.token);
        } else {
          if (password.length < 4) throw new Error("Password too short");
          await api("/auth/register", {
            method: "POST",
            body: JSON.stringify({ username, password })
          });
          error.style.color = "#6ce3a6";
          error.textContent = "Registered. Now log in.";
          state.mode = "login";
        }
      } catch (err) {
        error.style.color = "#ff7b7b";
        error.textContent = err.message || "Error";
      }
    })();
  });
}

function bindShell() {
  document.querySelectorAll("[data-company]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.selected = btn.getAttribute("data-company");
      loadContent(state.selected).then(render);
    });
  });

  const logout = document.querySelector("[data-logout]");
  if (logout) logout.addEventListener("click", () => setUser(null));

  document.querySelectorAll("[data-edit]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.getAttribute("data-edit");
      openEditor(key);
    });
  });

  const editCompany = document.querySelector("[data-edit-company]");
  if (editCompany && state.user?.isAdmin) {
    editCompany.addEventListener("click", () => {
      const company = state.companies.find((c) => c.id === state.selected);
      const newName = prompt("New company name:", company?.name || "");
      if (!newName || !company) return;
      api(`/companies/${company.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name: newName.trim() })
      })
        .then((resp) => {
          state.companies = resp.companies;
          render();
        })
        .catch((err) => alert(err.message || "Failed to rename"));
    });
  }

  const newBtn = document.querySelector("[data-new-company]");
  if (newBtn) {
    newBtn.addEventListener("click", () => {
      if (!state.user?.isAdmin) return;
      const modal = document.createElement("div");
      modal.style.position = "fixed";
      modal.style.inset = "0";
      modal.style.background = "rgba(0,0,0,0.6)";
      modal.style.display = "flex";
      modal.style.alignItems = "center";
      modal.style.justifyContent = "center";
      modal.style.zIndex = "999";

      const wrap = document.createElement("div");
      wrap.style.background = "#0f0e17";
      wrap.style.border = "1px solid var(--border)";
      wrap.style.borderRadius = "12px";
      wrap.style.padding = "16px";
      wrap.style.width = "420px";
      wrap.style.maxWidth = "90vw";

      wrap.innerHTML = `
        <div style="font-weight:700;margin-bottom:10px;">New Company</div>
        <label style="display:grid;gap:4px;color:#d8d6e4;">Name<input id="new-name" style="padding:10px;border-radius:10px;border:1px solid var(--border);background:#0f0e17;color:#f7f7fb;"></label>
        <label style="display:grid;gap:4px;color:#d8d6e4;">Ticker (optional)<input id="new-ticker" style="padding:10px;border-radius:10px;border:1px solid var(--border);background:#0f0e17;color:#f7f7fb;"></label>
        <label style="color:#d8d6e4;"><input type="checkbox" id="new-private"> Private prices</label>
        <div class="actions" style="margin-top:10px;">
          <button class="pill" id="new-save" style="background:var(--accent);color:#0c0b10;">Create</button>
          <button class="pill" id="new-cancel">Cancel</button>
        </div>
        <div id="new-error" class="error"></div>
      `;

      modal.appendChild(wrap);
      document.body.appendChild(modal);

      const nameInp = wrap.querySelector("#new-name");
      const tickerInp = wrap.querySelector("#new-ticker");
      const privInp = wrap.querySelector("#new-private");
      const err = wrap.querySelector("#new-error");
      wrap.querySelector("#new-cancel").onclick = () => modal.remove();
      wrap.querySelector("#new-save").onclick = () => {
        err.textContent = "";
        const name = nameInp.value.trim();
        if (!name) {
          err.textContent = "Name required";
          return;
        }
        const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || `c-${Date.now()}`;
        api("/companies", {
          method: "POST",
          body: JSON.stringify({
            id,
            name,
            ticker: tickerInp.value.trim(),
            pricePrivate: !!privInp.checked,
            overview: "",
            financials: { columns: ["date","revenue","ebitda"], rows: [] },
            news: [],
            prices: []
          })
        })
          .then((resp) => {
            state.companies = resp.companies;
            state.selected = resp.id;
            return loadContent(resp.id);
          })
          .then(() => {
            modal.remove();
            render();
          })
          .catch((e) => {
            err.textContent = e.message || "Error creating company";
          });
      };
    });
  }
}

function bindTooltips() {
  const tip = document.getElementById("tooltip");
  if (!tip) return;
  const circles = document.querySelectorAll(".chart circle[data-tip]");
  circles.forEach((c) => {
    c.addEventListener("mouseenter", () => {
      tip.textContent = c.getAttribute("data-tip");
      tip.style.opacity = "1";
    });
    c.addEventListener("mouseleave", () => {
      tip.style.opacity = "0";
    });
    c.addEventListener("mousemove", (e) => {
      tip.style.left = `${e.clientX + 10}px`;
      tip.style.top = `${e.clientY - 10}px`;
    });
  });
}

function openEditor(section) {
  if (!state.user?.isAdmin) return;
  const company = state.companies.find((c) => c.id === state.selected);
  const content = state.content[company.id] || {};

  const modal = document.createElement("div");
  modal.style.position = "fixed";
  modal.style.inset = "0";
  modal.style.background = "rgba(0,0,0,0.6)";
  modal.style.display = "flex";
  modal.style.alignItems = "center";
  modal.style.justifyContent = "center";
  modal.style.zIndex = "999";

  const wrapper = document.createElement("div");
  wrapper.style.background = "#0f0e17";
  wrapper.style.border = "1px solid var(--border)";
  wrapper.style.borderRadius = "12px";
  wrapper.style.padding = "16px";
  wrapper.style.width = "520px";
  wrapper.style.maxWidth = "90vw";
  wrapper.style.boxShadow = "0 20px 60px rgba(0,0,0,0.5)";

  const title = document.createElement("div");
  title.textContent = `Edit ${section} — ${company.name}`;
  title.style.fontWeight = "700";
  title.style.marginBottom = "10px";

  let area = null;
  let finState = null;
  let priceState = null;
  let summaryInput = null;
  let overviewInput = null;

  if (section === "prices") {
    const wrap = document.createElement("div");
    wrap.style.display = "grid";
    wrap.style.gap = "10px";

    const tickerLabel = document.createElement("label");
    tickerLabel.style.color = "#d8d6e4";
    tickerLabel.textContent = "Ticker (Google Finance format, e.g. VIRT:NASDAQ)";
    const tickerInput = document.createElement("input");
    tickerInput.value = content.ticker || "";
    tickerInput.style.padding = "10px";
    tickerInput.style.borderRadius = "10px";
    tickerInput.style.border = "1px solid var(--border)";
    tickerInput.style.background = "#0f0e17";
    tickerInput.style.color = "#f7f7fb";
    tickerLabel.appendChild(tickerInput);

    const privLabel = document.createElement("label");
    privLabel.style.color = "#d8d6e4";
    const priv = document.createElement("input");
    priv.type = "checkbox";
    priv.checked = !!content.pricePrivate;
    privLabel.appendChild(priv);
    privLabel.appendChild(document.createTextNode(" Private (hide chart)"));

    priceState = normalizePrices(content.prices);

    const tableHost = document.createElement("div");

    const renderPriceTable = () => {
      const table = document.createElement("table");
      table.className = "fin-table";
      table.style.width = "100%";
      const thead = document.createElement("thead");
      const trh = document.createElement("tr");
      ["date", "value"].forEach((c) => {
        const th = document.createElement("th");
        th.textContent = c;
        trh.appendChild(th);
      });
      thead.appendChild(trh);
      const tbody = document.createElement("tbody");
      priceState.forEach((r, idx) => {
        const tr = document.createElement("tr");
        ["date", "value"].forEach((c) => {
          const td = document.createElement("td");
          const inp = document.createElement("input");
          inp.style.width = "100%";
          inp.style.background = "#0f0e17";
          inp.style.color = "#f7f7fb";
          inp.style.border = "1px solid var(--border)";
          inp.style.borderRadius = "6px";
          inp.value = r[c] ?? "";
          inp.oninput = () => {
            priceState[idx][c] = c === "value" ? Number(inp.value) || 0 : inp.value;
          };
          td.appendChild(inp);
          tr.appendChild(td);
        });
        const tdDel = document.createElement("td");
        const del = document.createElement("button");
        del.className = "pill";
        del.textContent = "✕";
        del.onclick = () => {
          priceState.splice(idx, 1);
          renderPriceTable();
        };
        tdDel.appendChild(del);
        tr.appendChild(tdDel);
        tbody.appendChild(tr);
      });
      table.innerHTML = "";
      table.appendChild(thead);
      table.appendChild(tbody);
      tableHost.innerHTML = "";
      tableHost.appendChild(table);
    };

    const addRow = document.createElement("button");
    addRow.className = "pill";
    addRow.textContent = "Add row";
    addRow.onclick = () => {
      priceState.push({ date: `p${priceState.length + 1}`, value: 0 });
      renderPriceTable();
    };

    wrap.appendChild(tickerLabel);
    wrap.appendChild(privLabel);
    wrap.appendChild(addRow);
    wrap.appendChild(tableHost);
    renderPriceTable();
    wrapper.appendChild(wrap);
    area = {};
    area._tickerInput = tickerInput;
    area._privInput = priv;
    area._priceState = priceState;
  } else if (section === "financials") {
    finState = normalizeFinancials(content.financials);
    const wrap = document.createElement("div");
    wrap.style.display = "grid";
    wrap.style.gap = "10px";

    const colBar = document.createElement("div");
    colBar.className = "actions";
    const addCol = document.createElement("button");
    addCol.className = "pill";
    addCol.textContent = "Add column";
    addCol.onclick = () => {
      const name = prompt("Column name");
      if (!name) return;
      if (!finState.columns.includes(name)) finState.columns.push(name);
      renderTable();
    };
    const addRow = document.createElement("button");
    addRow.className = "pill";
    addRow.textContent = "Add row";
    addRow.onclick = () => {
      const row = {};
      finState.columns.forEach((c) => (row[c] = ""));
      finState.rows.push(row);
      renderTable();
    };
    colBar.appendChild(addCol);
    colBar.appendChild(addRow);

    const tableHost = document.createElement("div");

    const renderTable = () => {
      const table = document.createElement("table");
      table.className = "fin-table";
      table.style.width = "100%";
      const thead = document.createElement("thead");
      const trh = document.createElement("tr");
      finState.columns.forEach((c, idx) => {
        const th = document.createElement("th");
        th.textContent = c;
        const del = document.createElement("button");
        del.textContent = "✕";
        del.style.marginLeft = "6px";
        del.style.fontSize = "10px";
        del.className = "pill";
        del.onclick = () => {
          finState.columns.splice(idx, 1);
          finState.rows = finState.rows.map((r) => {
            const nr = { ...r };
            delete nr[c];
            return nr;
          });
          renderTable();
        };
        th.appendChild(del);
        trh.appendChild(th);
      });
      thead.appendChild(trh);
      const tbody = document.createElement("tbody");
      finState.rows.forEach((r, ridx) => {
        const tr = document.createElement("tr");
        finState.columns.forEach((c) => {
          const td = document.createElement("td");
          const inp = document.createElement("input");
          inp.style.width = "100%";
          inp.style.background = "#0f0e17";
          inp.style.color = "#f7f7fb";
          inp.style.border = "1px solid var(--border)";
          inp.style.borderRadius = "6px";
          inp.value = r[c] ?? "";
          inp.oninput = () => {
            finState.rows[ridx][c] = inp.value;
          };
          td.appendChild(inp);
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      });
      table.innerHTML = "";
      table.appendChild(thead);
      table.appendChild(tbody);
      tableHost.innerHTML = "";
      tableHost.appendChild(table);
    };

    renderTable();
    wrap.appendChild(colBar);
    wrap.appendChild(tableHost);
    wrapper.appendChild(wrap);
  } else if (section === "news") {
    area = document.createElement("textarea");
    area.className = "edit-area";
    area.value = (content.news || []).join("\n");
    wrapper.appendChild(area);
  } else {
    const wrap = document.createElement("div");
    wrap.style.display = "grid";
    wrap.style.gap = "10px";

    const sumLabel = document.createElement("label");
    sumLabel.style.color = "#d8d6e4";
    sumLabel.textContent = "Summary (150 words max)";
    summaryInput = document.createElement("textarea");
    summaryInput.className = "edit-area";
    summaryInput.value = content.summary || "";
    summaryInput.maxLength = 1200;
    sumLabel.appendChild(summaryInput);

    const ovLabel = document.createElement("label");
    ovLabel.style.color = "#d8d6e4";
    ovLabel.textContent = "Overview (long form)";
    overviewInput = document.createElement("textarea");
    overviewInput.className = "edit-area";
    overviewInput.value = content.overview || "";
    ovLabel.appendChild(overviewInput);

    wrap.appendChild(sumLabel);
    wrap.appendChild(ovLabel);
    wrapper.appendChild(wrap);
  }

  const actions = document.createElement("div");
  actions.className = "actions";
  actions.style.marginTop = "10px";

  const save = document.createElement("button");
  save.textContent = "Save";
  save.className = "pill";
  save.style.background = "var(--accent)";
  save.style.color = "#0c0b10";

  const cancel = document.createElement("button");
  cancel.textContent = "Cancel";
  cancel.className = "pill";

  actions.appendChild(save);
  actions.appendChild(cancel);
  wrapper.appendChild(title);
  wrapper.appendChild(actions);
  modal.appendChild(wrapper);
  document.body.appendChild(modal);

  cancel.addEventListener("click", () => modal.remove());
  save.addEventListener("click", () => {
    if (section === "prices") {
      content.prices = Array.isArray(area._priceState) ? area._priceState : [];
      content.ticker = area._tickerInput?.value || "";
      content.pricePrivate = !!area._privInput?.checked;
    } else if (section === "financials") {
      content.financials = finState;
    } else if (section === "news") {
      const val = area.value.trim();
      content.news = val ? val.split("\\n").map((line) => line.trim()).filter(Boolean) : [];
    } else {
      content.summary = (summaryInput?.value || "").trim();
      content.overview = (overviewInput?.value || "").trim();
    }

    api(`/content/${company.id}`, {
      method: "PUT",
      body: JSON.stringify({
        overview: content.overview,
        summary: content.summary,
        prices: content.prices || [],
        financials: content.financials || [],
        news: content.news || [],
        pricePrivate: content.pricePrivate,
        ticker: content.ticker
      })
    })
      .then(() => {
        modal.remove();
        render();
      })
      .catch((err) => {
        alert(err.message || "Failed to save");
      });
  });
}

// Attempt to auto-login with stored token? Not supported server-side; require login.
function bootstrap() {
  try {
    render();
  } catch (err) {
    console.error(err);
    const root = document.getElementById("app");
    if (root) root.innerHTML = `<div style="color:#f7f7fb;padding:20px;font-family:system-ui;">Failed to load UI. Check console.</div>`;
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootstrap);
} else {
  bootstrap();
}
