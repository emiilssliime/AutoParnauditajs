
const express = require("express");
const cheerio = require("cheerio");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const VERSION = "5.2";

app.use(express.json({ limit: "1mb" }));

const UA = "Mozilla/5.0 (compatible; AutoParbauditajs/5.2; +https://autoparbauditajs.onrender.com/)";

function cleanText(value = "") {
  return String(value)
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeKey(value = "") {
  return cleanText(value).toLowerCase().replace(/[:：]+$/, "");
}

function parseDigits(value) {
  const n = Number(String(value || "").replace(/[^\d]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function parseYear(value) {
  const m = String(value || "").match(/\b(19|20)\d{2}\b/);
  return m ? Number(m[0]) : null;
}

function parseMileage(value) {
  const t = cleanText(value).toLowerCase().replace(",", ".");
  const thousand = t.match(/(\d+(?:\.\d+)?)\s*tūkst/);
  if (thousand) return Math.round(Number(thousand[1]) * 1000);
  return parseDigits(t);
}

function parsePrice(value) {
  return parseDigits(value);
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  })[c]);
}

function detectFuelFromEngine(engine = "") {
  // IMPORTANT V5.2 FIX:
  // Fuel is detected ONLY from the SS.COM "Motors" / engine field.
  // Never scan the whole page for words such as "electric", because equipment
  // or unrelated content can create false EV classifications.
  const s = cleanText(engine).toLowerCase();
  const hasDiesel = /\b(dīzel|dizel|diesel)\w*|\b\d(?:[.,]\d)?\s*d\b|\btdi\b|\bhdi\b|\bbluehdi\b|\bdci\b|\bcdi\b/.test(s);
  const hasPetrol = /\b(benz|petrol|gasoline)\w*|\btsi\b|\btfsi\b|\bfsi\b|\bgdi\b|\bmpfi\b/.test(s);
  const hasElectric = /\b(elektr|electric|bev|ev)\w*/.test(s);
  const explicitHybrid = /\b(hibr|hybrid|phev|plug[\s-]?in|mhev)\w*/.test(s);
  const hasGas = /\b(lpg|cng|gāze|gaze)\b/.test(s);

  if (explicitHybrid || (hasElectric && (hasDiesel || hasPetrol))) return "hybrid";
  if (hasDiesel) return "diesel";
  if (hasPetrol) return "petrol";
  if (hasElectric) return "electric";
  if (hasGas) return "gas";
  return "unknown";
}

function detectTransmission(gearbox = "") {
  const s = cleanText(gearbox).toLowerCase();
  if (/\b(dsg|autom|cvt|tiptronic|steptronic|s tronic|dct|edc|8hp|9g)\b/.test(s)) return "automatic";
  if (/\b(manu|mehān|manual)\w*/.test(s)) return "manual";
  return "unknown";
}

function makeModelFromMarka(value = "", listingUrl = "") {
  const text = cleanText(value);
  if (text) {
    const parts = text.split(" ");
    return { make: parts.shift() || "", model: parts.join(" ") || "" };
  }
  try {
    const u = new URL(listingUrl);
    const p = u.pathname.split("/").filter(Boolean);
    const carsIndex = p.indexOf("cars");
    if (carsIndex >= 0 && p.length > carsIndex + 2) {
      const make = decodeURIComponent(p[carsIndex + 1]).replace(/-/g, " ");
      const model = decodeURIComponent(p[carsIndex + 2]).replace(/-/g, " ");
      return {
        make: make.charAt(0).toUpperCase() + make.slice(1),
        model: model.toUpperCase() === "3-series" ? "3 Series" : model
      };
    }
  } catch {}
  return { make: "", model: "" };
}

function allowedSsUrl(raw) {
  try {
    const u = new URL(raw);
    const host = u.hostname.toLowerCase();
    if (!(host === "ss.com" || host === "www.ss.com" || host === "m.ss.com")) return null;
    if (!/^https?:$/.test(u.protocol)) return null;
    return u;
  } catch {
    return null;
  }
}

async function fetchHtml(url, timeoutMs = 12000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        "user-agent": UA,
        "accept-language": "lv-LV,lv;q=0.9,en;q=0.8"
      },
      redirect: "follow",
      signal: controller.signal
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timeout);
  }
}

function buildSpecMap($) {
  const map = {};
  // SS.COM currently uses ads_opt_name / ads_opt on listing pages.
  $(".ads_opt_name").each((_, el) => {
    const key = normalizeKey($(el).text());
    const next = $(el).next();
    const value = cleanText(next.text());
    if (key && value) map[key] = value;
  });

  // Robust fallback: scan table rows, but only accept known field labels.
  const known = [
    /marka/, /izlaiduma gads/, /год выпуска/, /motors/, /двигатель/,
    /ātrumkārba/, /коробка передач/, /nobraukums/, /пробег/,
    /virsbūves tips/, /тип кузова/, /tehniskā apskate/, /техосмотр/,
    /vin kods/, /номерной знак/, /cena/, /цена/
  ];
  $("tr").each((_, tr) => {
    const cells = $(tr).find("td,th").map((__, td) => cleanText($(td).text())).get().filter(Boolean);
    if (cells.length < 2) return;
    const key = normalizeKey(cells[0]);
    if (!known.some((rx) => rx.test(key))) return;
    const value = cleanText(cells.slice(1).join(" "));
    if (key && value && !map[key]) map[key] = value;
  });
  return map;
}

function pickSpec(map, patterns) {
  for (const [key, value] of Object.entries(map)) {
    if (patterns.some((rx) => rx.test(key))) return value;
  }
  return "";
}

function extractDescription($) {
  const selectors = ["#msg_div_msg", ".msg", "[id*='msg_div_msg']"];
  for (const sel of selectors) {
    const t = cleanText($(sel).first().text());
    if (t && t.length > 20) return t.slice(0, 5000);
  }
  return "";
}

function extractPower(description = "", engine = "") {
  const text = `${engine} ${description}`;
  let m = text.match(/\b(\d{2,3})\s*kW\b/i);
  if (m) return Number(m[1]);
  m = text.match(/\b(\d{2,3})\s*(?:z\.?\s*s\.?|zs|hp|ps)\b/i);
  if (m) return Math.round(Number(m[1]) * 0.7355);
  return null;
}

async function parseSsListing(listingUrl) {
  const safe = allowedSsUrl(listingUrl);
  if (!safe) throw new Error("Ievadi derīgu SS.COM sludinājuma saiti.");

  const html = await fetchHtml(safe.href);
  const $ = cheerio.load(html);
  const map = buildSpecMap($);
  const bodyText = cleanText($("body").text());
  const description = extractDescription($);

  const markaField = pickSpec(map, [/^marka$/, /^марка$/]);
  const mm = makeModelFromMarka(markaField, safe.href);
  const yearText = pickSpec(map, [/izlaiduma gads/, /год выпуска/]);
  const engine = pickSpec(map, [/^motors$/, /двигатель/]);
  const gearbox = pickSpec(map, [/ātrumkārba/, /коробка передач/]);
  const mileageText = pickSpec(map, [/nobraukums/, /пробег/]);
  let priceText = pickSpec(map, [/^cena$/, /^цена$/]);
  if (!priceText) {
    const priceMatch = bodyText.match(/(?:Cena|Цена)\s*:?\s*([\d\s.,]+)\s*€/i);
    if (priceMatch) priceText = priceMatch[1] + " €";
  }

  const bodyType = pickSpec(map, [/virsbūves tips/, /тип кузова/]);
  const inspection = pickSpec(map, [/tehniskā apskate/, /техосмотр/]);

  // Fuel classification comes from engine ONLY — this is the diesel/electric fix.
  const fuelType = detectFuelFromEngine(engine);

  if (!mm.make && !engine && !priceText) {
    throw new Error("SS.COM lapā neizdevās atrast auto laukus. Pārbaudi, vai sludinājums vēl ir aktīvs.");
  }

  return {
    make: mm.make,
    model: mm.model,
    year: parseYear(yearText),
    engine: cleanText(engine),
    fuelType,
    powerKw: extractPower(description, engine),
    gearbox: cleanText(gearbox),
    transmissionType: detectTransmission(gearbox),
    mileageKm: parseMileage(mileageText),
    priceEur: parsePrice(priceText),
    bodyType: cleanText(bodyType),
    inspection: cleanText(inspection),
    description,
    sourceUrl: safe.href
  };
}

function vehicleLabel(v) {
  return [v.make, v.model, v.year].filter(Boolean).join(" ");
}

function inspectionPlan(v) {
  const fuel = v.fuelType || detectFuelFromEngine(v.engine || "");
  const transmission = v.transmissionType || detectTransmission(v.gearbox || "");
  const km = Number(v.mileageKm || 0);

  const risks = [];
  const mileage = [];
  const seller = [
    { title: "Servisa vēsture", text: "Rēķini, ieraksti un pēdējās apkopes." },
    { title: "Auksts starts", text: "Lūgt auto neiedarbināt pirms apskates." },
    { title: "Diagnostika", text: "Vai pārdevējs piekrīt neatkarīgai diagnostikai pirms pirkuma." },
    { title: "Bojājumi", text: "Kas pēdējo 2 gadu laikā ir remontēts vai mainīts." }
  ];

  if (fuel === "diesel") {
    risks.push({
      title: "DPF / EGR / turbīna",
      importance: "Svarīgi",
      check: "Auksts starts, dūmi, vilkme, kļūdu kodi, DPF slodze un EGR darbība.",
      signs: "Nevienmērīga darbība, jaudas zudums, biežas reģenerācijas vai brīdinājumi."
    });
    if (km >= 140000) {
      risks.push({
        title: "Sprauslas un degvielas sistēma",
        importance: "Pārbaudīt",
        check: "Korekcijas diagnostikā, auksta/silta iedarbināšana un noplūdes.",
        signs: "Grūta iedarbināšana, vibrācija, dūmi vai nevienmērīga tukšgaita."
      });
    }
  } else if (fuel === "petrol") {
    risks.push({
      title: "Benzīna dzinējs",
      importance: "Svarīgi",
      check: "Auksts starts, eļļas līmenis, noplūdes, aizdedzes kļūdas un vienmērīga darbība.",
      signs: "Ķēdes/graboņas skaņas, misfire, eļļas patēriņš vai jaudas zudums."
    });
  } else if (fuel === "electric") {
    risks.push({
      title: "Augstsprieguma akumulators / elektriskā piedziņa",
      importance: "Svarīgi",
      check: "SOH, uzlāde, HV kļūdas, termovadība un testa brauciens ar dažādu slodzi.",
      signs: "Būtiski samazināts nobraukums, uzlādes kļūdas vai piedziņas brīdinājumi."
    });
  } else if (fuel === "hybrid") {
    risks.push({
      title: "Hibrīda akumulators un piedziņa",
      importance: "Svarīgi",
      check: "HV akumulatora SOH, EV režīms, uzlāde (ja PHEV), dzesēšana un kļūdu kodi.",
      signs: "Neparasta benzīna/EV pārslēgšanās, uzlādes kļūdas vai brīdinājumi."
    });
    risks.push({
      title: "Iekšdedzes dzinējs",
      importance: "Pārbaudīt",
      check: "Auksts starts, šķidrumi, noplūdes un apkopes intervāli.",
      signs: "Nevienmērīga darbība, trokšņi vai eļļas/dzeses šķidruma zudums."
    });
  } else {
    risks.push({
      title: "Dzinējs",
      importance: "Svarīgi",
      check: "Auksts starts, šķidrumi, noplūdes, diagnostikas kļūdas un testa brauciens.",
      signs: "Trokšņi, vibrācija, dūmi vai jaudas zudums."
    });
  }

  if (transmission === "automatic") {
    risks.push({
      title: "Automātiskā ātrumkārba",
      importance: "Svarīgi",
      check: "Auksta un silta pārslēgšanās, R/D ieslēgšana, vibrācijas un apkopes vēsture.",
      signs: "Sitieni, aizture, slīdēšana, vibrācija vai kļūdas."
    });
  } else if (transmission === "manual") {
    risks.push({
      title: "Sajūgs / divmasu spararats",
      importance: "Pārbaudīt",
      check: "Sajūga tvēriena punkts, slīdēšana, vibrācijas un skaņas pie iedarbināšanas/izslēgšanas.",
      signs: "Grabēšana, vibrācija vai apgriezieni ceļas bez atbilstoša paātrinājuma."
    });
  }

  risks.push({
    title: "Piekare, bremzes un virsbūve",
    importance: "Pārbaudīt",
    check: "Pacēlājs, bukses, amortizatori, bremzes, riepas, korozija un krāsas biezums.",
    signs: "Klauvējieni, nevienmērīgs riepu nodilums, vibrācija vai atšķirīgs krāsojums."
  });

  if (km >= 250000) {
    mileage.push({ title: "250 000+ km", text: "Prioritāte ir pierādāma apkopes/remontu vēsture, noplūdes, piekare un agregātu diagnostika." });
  } else if (km >= 180000) {
    mileage.push({ title: "180 000+ km", text: "Pārbaudīt lielās apkopes, zobsiksnu/ķēdi pēc konkrētā motora prasībām, transmisiju un piekari." });
  } else if (km >= 100000) {
    mileage.push({ title: "100 000+ km", text: "Pārbaudīt lielās apkopes, šķidrumus, filtrus, bremzes, riepas un dokumentus." });
  } else if (km > 0) {
    mileage.push({ title: "Līdz 100 000 km", text: "Nobraukums ir zemāks, bet joprojām jāpārbauda servisa vēsture, avāriju pēdas un diagnostika." });
  }

  if (fuel === "electric") {
    mileage.push({ title: "Elektroauto", text: "Akumulatora SOH, AC/DC uzlāde, termovadība un HV kļūdu kodi." });
  } else if (fuel === "hybrid") {
    mileage.push({ title: "Hibrīds", text: "HV akumulators, dzesēšana, EV režīms un iekšdedzes dzinēja apkopes vēsture." });
  }

  return { risks, mileage, seller };
}

async function tavilySearch(query, domain) {
  const key = process.env.TAVILY_API_KEY;
  if (!key) {
    return {
      available: false,
      reason: "Render vidē nav iestatīts TAVILY_API_KEY.",
      results: []
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${key}`
      },
      body: JSON.stringify({
        query,
        search_depth: "basic",
        max_results: 4,
        include_answer: false,
        include_raw_content: false,
        include_domains: [domain]
      }),
      signal: controller.signal
    });
    if (!res.ok) throw new Error(`Tavily HTTP ${res.status}`);
    const data = await res.json();
    const results = Array.isArray(data.results) ? data.results : [];
    return {
      available: true,
      results: results.slice(0, 4).map((r) => ({
        title: cleanText(r.title || ""),
        url: r.url || "",
        snippet: cleanText(r.content || "").slice(0, 520),
        score: typeof r.score === "number" ? r.score : null
      }))
    };
  } catch (e) {
    return { available: false, reason: e.message || "Meklēšana neizdevās.", results: [] };
  } finally {
    clearTimeout(timeout);
  }
}

async function researchSources(v) {
  const label = `${v.make || ""} ${v.model || ""}`.trim();
  const details = [v.year, v.engine].filter(Boolean).join(" ");
  const jobs = [
    {
      id: "autoabc",
      name: "Auto ABC",
      domain: "auto-abc.lv",
      note: "Latvijas tehniskie dati, cenas, lietotāju atsauksmes un reālais patēriņš.",
      home: "https://www.auto-abc.lv/",
      query: `"${label}" ${details} atsauksmes reālais degvielas patēriņš uzticamība cena`
    },
    {
      id: "iauto",
      name: "iAuto",
      domain: "iauto.lv",
      note: "Latvijas autovadītāju foruma pieredze un konkrētu problēmu diskusijas.",
      home: "https://iauto.lv/forums/",
      query: `"${label}" ${details} problēmas atsauksmes patēriņš forums`
    },
    {
      id: "autodoc",
      name: "AUTODOC.lv",
      domain: "autodoc.lv",
      note: "Modeļu problēmu un vājo vietu raksti.",
      home: "https://www.autodoc.lv/info",
      query: `"${label}" ${details} problēmas vājās vietas`
    }
  ];

  const out = await Promise.all(jobs.map(async (src) => {
    const search = await tavilySearch(src.query, src.domain);
    return { ...src, ...search };
  }));
  return out;
}

function ssCategoryUrl(listingUrl) {
  try {
    const u = new URL(listingUrl);
    const p = u.pathname.split("/").filter(Boolean);
    const carsIndex = p.indexOf("cars");
    if (carsIndex < 0 || p.length < carsIndex + 3) return null;
    const makeSlug = p[carsIndex + 1];
    const modelSlug = p[carsIndex + 2];
    return `https://www.ss.com/lv/transport/cars/${makeSlug}/${modelSlug}/`;
  } catch {
    return null;
  }
}

function compactFuel(value = "") {
  const s = cleanText(value).toLowerCase();
  if (/\b\d(?:[.,]\d)?\s*d\b|\bdīzel|diesel|hdi|tdi|dci|cdi/.test(s)) return "diesel";
  if (/elektr|electric|bev|\bev\b/.test(s)) return "electric";
  if (/hibr|hybrid|phev/.test(s)) return "hybrid";
  if (/\bbenz|petrol|tsi|tfsi|gdi|fsi/.test(s)) return "petrol";
  return "unknown";
}

function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

async function marketSnapshot(v, listingUrl) {
  const category = ssCategoryUrl(listingUrl || v.sourceUrl);
  if (!category) {
    return { available: false, reason: "Nav SS.COM modeļa kategorijas saites.", listings: [] };
  }

  try {
    const html = await fetchHtml(category, 12000);
    const $ = cheerio.load(html);
    const candidates = [];
    const seen = new Set();

    $("tr").each((_, tr) => {
      const linkEl = $(tr).find('a[href*="/msg/"]').first();
      const href = linkEl.attr("href");
      if (!href) return;
      const key = href;
      if (seen.has(key)) return;
      seen.add(key);

      const cells = $(tr).find("td").map((__, td) => cleanText($(td).text())).get().filter(Boolean);
      if (!cells.length) return;

      const rowText = cleanText($(tr).text());
      const priceText = [...cells].reverse().find((c) => /€/.test(c)) || "";
      const price = parsePrice(priceText);
      const yearCell = cells.find((c) => /\b(19|20)\d{2}\b/.test(c)) || rowText;
      const year = parseYear(yearCell);

      // In SS category rows engine is typically a compact cell such as 1.6D / 1.2.
      const engineCell = cells.find((c) =>
        /^\d(?:[.,]\d)?\s*[a-zA-Z]{0,4}$/.test(c) ||
        /^\d(?:[.,]\d)?\s*(?:D|B|H)$/i.test(c)
      ) || "";
      const fuel = compactFuel(engineCell);

      const mileageCell = cells.find((c) => /tūkst|km/i.test(c)) || "";
      const mileageKm = parseMileage(mileageCell);

      if (!price || !year) return;
      candidates.push({
        year,
        engine: engineCell,
        fuel,
        mileageKm,
        priceEur: price,
        url: href.startsWith("http") ? href : `https://www.ss.com${href}`,
        text: cleanText(linkEl.text() || rowText).slice(0, 180)
      });
    });

    const targetYear = Number(v.year || 0);
    const targetKm = Number(v.mileageKm || 0);
    const targetFuel = v.fuelType || compactFuel(v.engine);
    let filtered = candidates.filter((x) => {
      if (targetYear && Math.abs(x.year - targetYear) > 2) return false;
      if (targetFuel !== "unknown" && x.fuel !== "unknown" && x.fuel !== targetFuel) return false;
      if (targetKm && x.mileageKm && Math.abs(x.mileageKm - targetKm) > 160000) return false;
      return true;
    });

    if (filtered.length < 3) {
      filtered = candidates.filter((x) => {
        if (targetYear && Math.abs(x.year - targetYear) > 3) return false;
        if (targetFuel !== "unknown" && x.fuel !== "unknown" && x.fuel !== targetFuel) return false;
        return true;
      });
    }

    filtered = filtered.slice(0, 30);
    const prices = filtered.map((x) => x.priceEur).filter(Boolean);
    if (!prices.length) {
      return { available: false, reason: "Neizdevās atrast salīdzināmus aktīvus sludinājumus.", categoryUrl: category, listings: [] };
    }

    const avg = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);
    const med = median(prices);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const asking = Number(v.priceEur || 0);
    const diffPct = asking && med ? Math.round(((asking - med) / med) * 100) : null;
    let position = null;
    if (diffPct !== null) {
      if (diffPct <= -8) position = "zem tirgus mediānas";
      else if (diffPct >= 8) position = "virs tirgus mediānas";
      else position = "tuvu tirgus mediānai";
    }

    return {
      available: true,
      categoryUrl: category,
      count: prices.length,
      averageEur: avg,
      medianEur: med,
      minEur: min,
      maxEur: max,
      askingPriceEur: asking || null,
      diffPct,
      position,
      note: prices.length < 5
        ? "Paraugs ir mazs — cenu uztver kā orientieri, nevis precīzu vērtējumu."
        : "Salīdzinājums veidots no aktuālajiem SS.COM tā paša modeļa sludinājumiem ar līdzīgu gadu un degvielas tipu.",
      listings: filtered.slice(0, 8)
    };
  } catch (e) {
    return { available: false, reason: `SS.COM tirgus dati nav pieejami: ${e.message}`, categoryUrl: category, listings: [] };
  }
}

app.get("/api/health", (_, res) => {
  res.json({ ok: true, version: VERSION, tavilyConfigured: Boolean(process.env.TAVILY_API_KEY) });
});

app.post("/api/listing", async (req, res) => {
  try {
    const vehicle = await parseSsListing(req.body?.url || "");
    res.json({ ok: true, version: VERSION, vehicle });
  } catch (e) {
    res.status(400).json({ ok: false, version: VERSION, error: e.message || "Sludinājuma nolasīšana neizdevās." });
  }
});

app.post("/api/analyze", async (req, res) => {
  try {
    const raw = req.body?.vehicle || {};
    const vehicle = {
      make: cleanText(raw.make),
      model: cleanText(raw.model),
      year: Number(raw.year || 0) || null,
      engine: cleanText(raw.engine),
      fuelType: raw.fuelType && raw.fuelType !== "unknown" ? raw.fuelType : detectFuelFromEngine(raw.engine),
      powerKw: Number(raw.powerKw || 0) || null,
      gearbox: cleanText(raw.gearbox),
      transmissionType: raw.transmissionType && raw.transmissionType !== "unknown"
        ? raw.transmissionType : detectTransmission(raw.gearbox),
      mileageKm: Number(raw.mileageKm || 0) || null,
      priceEur: Number(raw.priceEur || 0) || null,
      bodyType: cleanText(raw.bodyType),
      sourceUrl: cleanText(raw.sourceUrl)
    };

    const plan = inspectionPlan(vehicle);
    const [sources, market] = await Promise.all([
      researchSources(vehicle),
      marketSnapshot(vehicle, vehicle.sourceUrl)
    ]);

    res.json({
      ok: true,
      version: VERSION,
      vehicle,
      plan,
      sources,
      market,
      generatedAt: new Date().toISOString()
    });
  } catch (e) {
    res.status(500).json({ ok: false, version: VERSION, error: e.message || "Analīze neizdevās." });
  }
});

app.get("/", (_, res) => res.sendFile(path.join(__dirname, "index.html")));
app.use(express.static(__dirname, { extensions: ["html"] }));

app.listen(PORT, () => {
  console.log(`Auto Parbauditajs V${VERSION} listening on ${PORT}`);
});
