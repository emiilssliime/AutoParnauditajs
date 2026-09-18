const express = require("express");
const path = require("path");

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;

function cleanText(html = "") {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(td|th|tr|p|div|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&euro;|&#8364;/gi, "€")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

function normalize(s = "") {
  return String(s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function extractRows(html = "") {
  const rows = [];
  const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let m;
  while ((m = rowRe.exec(html))) {
    const cells = [];
    const cellRe = /<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)>/gi;
    let c;
    while ((c = cellRe.exec(m[1]))) {
      const text = cleanText(c[1]).replace(/\s+/g, " ").trim();
      if (text) cells.push(text);
    }
    if (cells.length >= 2) rows.push(cells);
  }
  return rows;
}

function findValue(rows, labels) {
  const wanted = labels.map(normalize);
  for (const row of rows) {
    if (!row.length) continue;
    const key = normalize(row[0]).replace(/:$/, "");
    if (wanted.some(x => key === x || key.includes(x))) {
      return row.slice(1).join(" ").trim();
    }
  }
  return "";
}

function firstMatch(text, regexes) {
  for (const re of regexes) {
    const m = text.match(re);
    if (m) return (m[1] || m[0]).trim();
  }
  return "";
}

function parseMoney(v = "") {
  const n = Number(String(v).replace(/[^\d]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function parseNumber(v = "") {
  const n = Number(String(v).replace(/[^\d]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function detectFuel(explicitFuel = "", engine = "") {
  const f = normalize(explicitFuel);
  const e = normalize(engine);
  const source = f || e;

  if (/\b(plug[- ]?in|phev)\b/.test(source) || /hibrid/.test(source)) return "Hibrīds";
  if (f && /(elektr|electric|ev)/.test(f)) return "Elektrisks";
  if (/(dizel|diesel)/.test(source)) return "Dīzelis";
  if (/(benzin|petrol|gasoline)/.test(source)) return "Benzīns";
  if (/(lpg|gaze|gāze)/.test(source)) return "Gāze";
  return explicitFuel || "";
}

function classificationFromFuel(fuel = "") {
  const f = normalize(fuel);
  return {
    isElectric: /elektr|electric|^ev$/.test(f),
    isHybrid: /hibrid|hybrid|phev|plug[- ]?in/.test(f),
    isDiesel: /dizel|diesel/.test(f),
    isPetrol: /benzin|petrol|gasoline/.test(f)
  };
}

function inferMakeModelFromUrl(url) {
  try {
    const u = new URL(url);
    const p = u.pathname.split("/").filter(Boolean);
    const carsIdx = p.findIndex(x => x === "cars");
    if (carsIdx >= 0) {
      const make = p[carsIdx + 1] || "";
      const model = p[carsIdx + 2] || "";
      const title = s => s.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
      return { make: title(make), model: title(model) };
    }
  } catch {}
  return { make: "", model: "" };
}

function listingCategoryUrl(url) {
  try {
    const u = new URL(url);
    const p = u.pathname.split("/").filter(Boolean);
    const carsIdx = p.findIndex(x => x === "cars");
    if (carsIdx >= 0 && p[carsIdx + 1] && p[carsIdx + 2]) {
      return `${u.origin}/lv/transport/cars/${p[carsIdx + 1]}/${p[carsIdx + 2]}/`;
    }
  } catch {}
  return "";
}

async function fetchText(url, timeoutMs = 12000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; AutoParbauditajs/5.3; +https://autoparbauditajs.onrender.com/)",
        "Accept-Language": "lv-LV,lv;q=0.9,en;q=0.8"
      }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function parseSSListing(html, url) {
  const rows = extractRows(html);
  const text = cleanText(html);
  const urlInfo = inferMakeModelFromUrl(url);

  const make = findValue(rows, ["marka"]) || urlInfo.make;
  const model = findValue(rows, ["modelis"]) || urlInfo.model;
  const year = findValue(rows, ["izlaiduma gads", "gads"]) ||
    firstMatch(text, [/\b(19\d{2}|20[0-2]\d)\b/]);

  const explicitFuel = findValue(rows, ["degvielas tips", "degviela"]);
  let engine = findValue(rows, ["motors", "dzinējs", "dzinēja tilpums"]);
  if (!engine) {
    engine = firstMatch(text, [
      /\b(\d\.\d\s*(?:dīzelis|dizelis|diesel|benzīns|benzins|petrol|hybrid|hibrīds|hibrids))\b/i,
      /\b(\d{3,4}\s*cm3)\b/i
    ]);
  }
  const fuel = detectFuel(explicitFuel, engine);

  const power = findValue(rows, ["jauda", "motora jauda"]);
  const gearbox = findValue(rows, ["ātrumkārba", "atrūmkārba", "atrumkarba", "kārba", "transmisija"]);
  const mileage = findValue(rows, ["nobraukums", "nobraukums, km", "nobraukums km"]);
  let price = findValue(rows, ["cena"]);
  if (!price) {
    price = firstMatch(text, [
      /Cena[:\s]*([\d\s.,]+)\s*€/i,
      /([\d\s.,]{3,})\s*€/
    ]);
  }

  const cls = classificationFromFuel(fuel);
  return {
    make, model, year, engine, fuel, power, gearbox, mileage, price,
    classification: cls
  };
}

function uniqueSortedPrices(html) {
  const text = cleanText(html);
  const out = [];
  const patterns = [
    /(\d{3,6})\s*€/g,
    /€\s*(\d{3,6})/g
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(text))) {
      const n = Number(m[1]);
      if (n >= 500 && n <= 250000) out.push(n);
    }
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

function summarizeMarket(prices, listingPrice) {
  if (!prices.length) return null;
  const sorted = [...prices].sort((a,b)=>a-b);
  const avg = Math.round(sorted.reduce((a,b)=>a+b,0) / sorted.length);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  const current = parseMoney(listingPrice);
  const diffPct = current && median ? Math.round(((current - median) / median) * 100) : null;
  return {
    count: sorted.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    median,
    average: avg,
    listingPrice: current || null,
    differencePercent: diffPct
  };
}

async function tavilySearch(query, domain) {
  const key = process.env.TAVILY_API_KEY;
  if (!key) {
    return {
      status: "unavailable",
      message: "Papildu informācija pašlaik nav pieejama.",
      results: []
    };
  }

  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${key}`
      },
      body: JSON.stringify({
        query,
        max_results: 5,
        search_depth: "advanced",
        include_domains: [domain],
        include_answer: false,
        include_raw_content: false
      })
    });
    if (!res.ok) throw new Error(`Tavily HTTP ${res.status}`);
    const data = await res.json();
    const results = Array.isArray(data.results) ? data.results.slice(0, 5).map(r => ({
      title: r.title || "",
      url: r.url || "",
      content: r.content || ""
    })) : [];
    return {
      status: results.length ? "ok" : "empty",
      message: results.length ? "" : "Šim auto šajā avotā nekas konkrēts netika atrasts.",
      results
    };
  } catch (e) {
    console.error("Source search error:", domain, e.message);
    return {
      status: "unavailable",
      message: "Papildu informācija pašlaik nav pieejama.",
      results: []
    };
  }
}

app.post("/api/listing", async (req, res) => {
  const url = String(req.body?.url || "").trim();
  if (!/^https?:\/\/([a-z0-9-]+\.)?ss\.(com|lv)\//i.test(url)) {
    return res.status(400).json({ error: "Ievadi derīgu SS.COM sludinājuma saiti." });
  }

  try {
    const html = await fetchText(url);
    const car = parseSSListing(html, url);
    const marketUrl = listingCategoryUrl(url);
    let market = null;

    if (marketUrl) {
      try {
        const marketHtml = await fetchText(marketUrl);
        let prices = uniqueSortedPrices(marketHtml);
        const current = parseMoney(car.price);
        if (current) prices = prices.filter(p => p !== current);
        prices = prices.slice(0, 40);
        market = summarizeMarket(prices, car.price);
        if (market) market.url = marketUrl;
      } catch (e) {
        console.error("Market fetch error:", e.message);
      }
    }

    res.json({ ok: true, car, market });
  } catch (e) {
    console.error("Listing error:", e.message);
    res.status(502).json({
      error: "Sludinājuma datus pašlaik neizdevās nolasīt. Pamēģini vēlreiz vai ievadi auto datus manuāli."
    });
  }
});

app.post("/api/sources", async (req, res) => {
  const car = req.body?.car || {};
  const core = [car.make, car.model, car.year, car.engine, car.fuel].filter(Boolean).join(" ");
  if (!core) return res.status(400).json({ error: "Trūkst auto datu." });

  const [autoabc, iauto, autodoc] = await Promise.all([
    tavilySearch(`${core} problēmas atsauksmes degvielas patēriņš`, "autoabc.lv"),
    tavilySearch(`${core} problēmas forums atsauksmes`, "iauto.lv"),
    tavilySearch(`${core} problēmas vājās vietas`, "autodoc.lv")
  ]);

  res.json({
    ok: true,
    sources: {
      autoabc: {
        name: "Auto ABC",
        home: "https://www.autoabc.lv/",
        ...autoabc
      },
      iauto: {
        name: "iAuto",
        home: "https://iauto.lv/",
        ...iauto
      },
      autodoc: {
        name: "AUTODOC.lv",
        home: "https://www.autodoc.lv/info/",
        ...autodoc
      }
    }
  });
});

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    version: "5.3",
    researchConfigured: Boolean(process.env.TAVILY_API_KEY)
  });
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Auto Pārbaudītājs V5.3 running on port ${PORT}`);
});
