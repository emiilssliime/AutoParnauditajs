const express = require("express");
const path = require("path");

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;

function cleanText(html = "") {
  return String(html)
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
    .replace(/\bimage\b/g, " ")
    .replace(/[：:]+$/g, "")
    .replace(/\s+/g, " ")
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
    const key = normalize(row[0]);
    // Strict matching prevents large/nested SS.COM rows from being mistaken for a field.
    if (wanted.some(x => key === x || key.startsWith(x + " "))) {
      const value = row.slice(1).join(" ").replace(/\s+/g, " ").trim();
      if (value) return value;
    }
  }
  return "";
}

function firstMatch(text, regexes) {
  for (const re of regexes) {
    const m = String(text).match(re);
    if (m) return (m[1] || m[0]).trim();
  }
  return "";
}

function parseNumber(v = "") {
  const n = Number(String(v).replace(/[^\d]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function parseMoney(v = "") {
  const text = String(v).replace(/\u00a0/g, " ");
  const euro = text.match(/(\d[\d\s.,]*?)\s*€/);
  const source = euro ? euro[1] : text;
  const n = Number(source.replace(/[^\d]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function euro(n) {
  if (!Number.isFinite(Number(n)) || Number(n) <= 0) return "";
  return `${Number(n).toLocaleString("lv-LV")} €`;
}

function cleanYear(v = "") {
  const m = String(v).match(/\b(19\d{2}|20[0-3]\d)\b/);
  return m ? m[1] : String(v).trim();
}

function cleanPrice(v = "") {
  const n = parseMoney(v);
  return n ? euro(n) : "";
}

function cleanMileage(v = "") {
  const n = parseNumber(v);
  return n ? n.toLocaleString("lv-LV") : String(v).trim();
}

function detectFuel(explicitFuel = "", engine = "") {
  const source = `${normalize(explicitFuel)} ${normalize(engine)}`;
  if (/\b(plug[- ]?in|phev)\b/.test(source) || /hibrid|hybrid/.test(source)) return "Hibrīds";
  if (/(elektr|electric|\bev\b)/.test(source)) return "Elektrisks";
  if (/(dizel|diesel)/.test(source)) return "Dīzelis";
  if (/(benzin|petrol|gasoline)/.test(source)) return "Benzīns";
  if (/(lpg|gaze|gāze)/.test(source)) return "Gāze";
  return "";
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
      const rawMake = p[carsIdx + 1] || "";
      const rawModel = p[carsIdx + 2] || "";
      const title = s => decodeURIComponent(s)
        .replace(/-/g, " ")
        .replace(/\b\w/g, c => c.toUpperCase());
      return { make: title(rawMake), model: title(rawModel) };
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

function mobileListingUrl(url) {
  try {
    const u = new URL(url);
    if (/^(www\.)?ss\.(com|lv)$/i.test(u.hostname)) {
      u.hostname = "m.ss.com";
      return u.toString();
    }
  } catch {}
  return url;
}

async function fetchText(url, timeoutMs = 14000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; AutoParbauditajs/5.4; +https://autoparbauditajs.onrender.com/)",
        "Accept-Language": "lv-LV,lv;q=0.9,en;q=0.8"
      }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function splitMakeModel(rawMarka, urlInfo) {
  // SS.COM usually exposes "Marka: Peugeot 308". URL segments are more reliable
  // for separating make/model and avoid "Peugeot 308 308".
  if (urlInfo.make && urlInfo.model) return urlInfo;

  const raw = String(rawMarka || "").replace(/\s+/g, " ").trim();
  if (!raw) return { make: urlInfo.make || "", model: urlInfo.model || "" };
  const parts = raw.split(" ");
  return {
    make: urlInfo.make || parts[0] || "",
    model: urlInfo.model || parts.slice(1).join(" ")
  };
}

function parseSSListing(html, url) {
  const rows = extractRows(html);
  const text = cleanText(html);
  const urlInfo = inferMakeModelFromUrl(url);

  const markaRaw = findValue(rows, ["marka"]);
  const identity = splitMakeModel(markaRaw, urlInfo);

  const yearRaw = findValue(rows, ["izlaiduma gads", "gads"]);
  const year = cleanYear(yearRaw || firstMatch(text, [/\b(19\d{2}|20[0-3]\d)\b/]));

  let engine = findValue(rows, ["motors", "dzinējs", "dzinēja tilpums"]);
  // Reject accidental identity text.
  if (normalize(engine) === normalize(markaRaw) ||
      normalize(engine) === normalize(`${identity.make} ${identity.model}`)) {
    engine = "";
  }
  if (!engine) {
    engine = firstMatch(text, [
      /\b(\d(?:[.,]\d)?\s*(?:bluehdi|hdi|tdi|dci|dīzelis|dizelis|diesel|puretech|benzīns|benzins|petrol|hybrid|hibrīds|hibrids))\b/i,
      /\b(\d{3,4}\s*cm3)\b/i
    ]);
  }

  const explicitFuel = findValue(rows, ["degvielas tips", "degviela"]);
  const fuel = detectFuel(explicitFuel, engine);

  let power = findValue(rows, ["jauda", "motora jauda"]);
  if (!power) power = firstMatch(text, [/\b(\d{2,3})\s*kW\b/i]);
  if (power) {
    const p = firstMatch(power, [/(\d{2,3})\s*kW/i, /^(\d{2,3})$/]);
    power = p ? `${parseNumber(p)} kW` : power;
  }

  const gearbox = findValue(rows, ["ātrumkārba", "atrumkarba", "kārba", "transmisija"]);
  const mileageRaw = findValue(rows, ["nobraukums, km", "nobraukums km", "nobraukums"]);
  const mileage = cleanMileage(mileageRaw);

  let priceRaw = findValue(rows, ["cena"]);
  if (!priceRaw) {
    priceRaw = firstMatch(text, [
      /Cena[:\s|]*([\d\s.,]+\s*€)/i,
      /([\d\s.,]{3,}\s*€)/
    ]);
  }
  const priceValue = parseMoney(priceRaw);
  const price = priceValue ? euro(priceValue) : "";

  return {
    make: identity.make,
    model: identity.model,
    year,
    engine: String(engine || "").replace(/\s+/g, " ").trim(),
    fuel,
    power,
    gearbox: String(gearbox || "").replace(/\s+/g, " ").trim(),
    mileage,
    price,
    priceValue: priceValue || null,
    classification: classificationFromFuel(fuel)
  };
}

function parseMarketRow(cells) {
  if (!Array.isArray(cells) || cells.length < 3) return null;

  let price = 0;
  let priceIndex = -1;
  for (let i = cells.length - 1; i >= 0; i--) {
    const c = String(cells[i]).replace(/\u00a0/g, " ").trim();
    if (/^\d[\d\s.,]*\s*€$/.test(c)) {
      price = parseMoney(c);
      priceIndex = i;
      break;
    }
  }
  if (!price || price < 700 || price > 200000) return null;

  let year = 0;
  let engine = "";
  let mileage = 0;

  for (let i = 0; i < priceIndex; i++) {
    const c = String(cells[i]).replace(/\u00a0/g, " ").trim();
    if (!year && /^(19\d{2}|20[0-3]\d)$/.test(c)) year = Number(c);
    if (!engine && /^\d(?:[.,]\d)?\s*[A-Za-zĀ-ž]*D?$/i.test(c) && /\d/.test(c)) engine = c;
    if (!mileage && /(tūkst|km)/i.test(c)) {
      const n = parseNumber(c);
      mileage = /tūkst/i.test(c) ? n * 1000 : n;
    }
  }

  return { price, year, engine, mileage };
}

function extractMarketListings(html) {
  return extractRows(html).map(parseMarketRow).filter(Boolean);
}

function fuelMatchesMarket(car, listing) {
  const f = car?.classification || {};
  const e = normalize(listing.engine || "");
  if (f.isDiesel) return /\bd\b|dizel|diesel|hdi|tdi|dci/.test(e);
  if (f.isPetrol) return !(/\bd\b|dizel|diesel|hdi|tdi|dci/.test(e));
  return true;
}

function filterMarketListings(listings, car) {
  const carYear = parseNumber(car?.year);
  const current = car?.priceValue || parseMoney(car?.price);

  const withoutCurrent = [...listings];
  if (current) {
    const idx = withoutCurrent.findIndex(x => x.price === current);
    if (idx >= 0) withoutCurrent.splice(idx, 1); // remove only the current ad once
  }

  const byYearFuel = withoutCurrent.filter(x =>
    (!carYear || !x.year || Math.abs(x.year - carYear) <= 4) && fuelMatchesMarket(car, x)
  );
  const byYear = withoutCurrent.filter(x =>
    !carYear || !x.year || Math.abs(x.year - carYear) <= 4
  );

  let chosen = byYearFuel.length >= 4 ? byYearFuel :
               byYear.length >= 4 ? byYear :
               withoutCurrent;

  // Remove obvious outliers with the IQR rule. This prevents filter/UI values
  // such as 500 € or 163 910 € from distorting model-market statistics.
  const prices = chosen.map(x => x.price).sort((a, b) => a - b);
  if (prices.length >= 6) {
    const q = p => {
      const pos = (prices.length - 1) * p;
      const base = Math.floor(pos);
      const rest = pos - base;
      return prices[base + 1] !== undefined
        ? prices[base] + rest * (prices[base + 1] - prices[base])
        : prices[base];
    };
    const q1 = q(0.25);
    const q3 = q(0.75);
    const iqr = q3 - q1;
    const low = Math.max(700, q1 - 1.5 * iqr);
    const high = q3 + 1.5 * iqr;
    const trimmed = chosen.filter(x => x.price >= low && x.price <= high);
    if (trimmed.length >= 4) chosen = trimmed;
  }

  return chosen.slice(0, 40);
}

function summarizeMarket(listings, car) {
  if (!listings.length) return null;
  const sorted = listings.map(x => x.price).sort((a, b) => a - b);
  const avg = Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  const current = car?.priceValue || parseMoney(car?.price);
  const diffPct = current && median ? Math.round(((current - median) / median) * 100) : null;

  const years = listings.map(x => x.year).filter(Boolean);
  return {
    count: sorted.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    median,
    average: avg,
    listingPrice: current || null,
    differencePercent: diffPct,
    yearMin: years.length ? Math.min(...years) : null,
    yearMax: years.length ? Math.max(...years) : null
  };
}

function compactSnippet(text = "", max = 360) {
  const s = String(text)
    .replace(/\s+/g, " ")
    .replace(/^\s*[-–—•]+\s*/, "")
    .trim();
  if (!s) return "";
  return s.length <= max ? s : s.slice(0, max - 1).replace(/\s+\S*$/, "") + "…";
}

async function tavilySearch(query, domain) {
  const key = process.env.TAVILY_API_KEY;
  if (!key) {
    return {
      status: "unavailable",
      message: "Pētījuma savienojums nav konfigurēts.",
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

    const results = Array.isArray(data.results)
      ? data.results
          .filter(r => r && r.url)
          .slice(0, 5)
          .map(r => ({
            title: compactSnippet(r.title || "Atvērt rezultātu", 140),
            url: r.url || "",
            content: compactSnippet(r.content || "", 420)
          }))
      : [];

    return {
      status: results.length ? "ok" : "empty",
      message: results.length ? "" : "Šim modelim šajā avotā konkrēti rezultāti netika atrasti.",
      results
    };
  } catch (e) {
    console.error("Source search error:", domain, e.message);
    return {
      status: "unavailable",
      message: "Avota meklēšana pašlaik neizdevās.",
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
    // Mobile SS.COM has a simpler details table and is less prone to nested-table parsing errors.
    let html;
    try {
      html = await fetchText(mobileListingUrl(url));
    } catch {
      html = await fetchText(url);
    }

    const car = parseSSListing(html, url);
    const marketUrl = listingCategoryUrl(url);
    let market = null;

    if (marketUrl) {
      try {
        const marketHtml = await fetchText(marketUrl);
        const rawListings = extractMarketListings(marketHtml);
        const comparable = filterMarketListings(rawListings, car);
        market = summarizeMarket(comparable, car);
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
  const core = [car.make, car.model].filter(Boolean).join(" ").trim();
  const year = cleanYear(car.year || "");
  if (!core) return res.status(400).json({ error: "Trūkst auto datu." });

  const [autoabc, iauto, autodoc] = await Promise.all([
    // Correct domain is auto-abc.lv (with a hyphen).
    tavilySearch(`${core} ${year} atsauksmes tehniskie dati uzticamība degvielas patēriņš`, "auto-abc.lv"),
    tavilySearch(`${core} ${year} forums atsauksmes problēmas pieredze`, "iauto.lv"),
    tavilySearch(`${core} ${year} problēmas vājās vietas biežākie defekti`, "autodoc.lv")
  ]);

  res.json({
    ok: true,
    sources: {
      autoabc: {
        name: "Auto ABC",
        home: "https://www.auto-abc.lv/",
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
    version: "5.4",
    researchConfigured: Boolean(process.env.TAVILY_API_KEY)
  });
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Auto Pārbaudītājs V5.4 running on port ${PORT}`);
});
