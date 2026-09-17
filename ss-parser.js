const cheerio = require("cheerio");

function clean(value = "") {
  return String(value)
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function key(value = "") {
  return clean(value).toLowerCase().replace(/:$/, "");
}

function findField($, aliases) {
  const wanted = new Set(aliases.map(key));
  let found = "";

  $("tr").each((_, tr) => {
    if (found) return;
    const cells = $(tr).find("td").toArray();
    for (let i = 0; i < cells.length && !found; i++) {
      if (!wanted.has(key($(cells[i]).text()))) continue;
      for (let j = i + 1; j < cells.length; j++) {
        const candidate = clean($(cells[j]).text());
        if (candidate && !wanted.has(key(candidate))) {
          found = candidate;
          break;
        }
      }
    }
  });

  if (found) return found;

  const cells = $("td").toArray();
  for (let i = 0; i < cells.length - 1; i++) {
    if (!wanted.has(key($(cells[i]).text()))) continue;
    const candidate = clean($(cells[i + 1]).text());
    if (candidate) return candidate;
  }

  return "";
}

function digits(value = "") {
  const n = String(value).replace(/[^\d]/g, "");
  return n ? Number(n) : null;
}

function slugToWords(slug = "") {
  return decodeURIComponent(slug)
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, ch => ch.toUpperCase());
}

function makeFromSlug(slug = "") {
  const special = {
    bmw: "BMW",
    vw: "Volkswagen",
    volkswagen: "Volkswagen",
    "mercedes-benz": "Mercedes-Benz",
    mercedes: "Mercedes-Benz",
    skoda: "Škoda",
    "alfa-romeo": "Alfa Romeo",
    "land-rover": "Land Rover",
    "mini": "MINI",
    "ds": "DS",
    "mg": "MG"
  };
  return special[slug.toLowerCase()] || slugToWords(slug);
}

function pathIdentity(sourceUrl) {
  try {
    const u = new URL(sourceUrl);
    const parts = u.pathname.split("/").filter(Boolean);
    const i = parts.indexOf("cars");
    if (i >= 0 && parts[i + 1]) {
      return {
        make: makeFromSlug(parts[i + 1]),
        model: parts[i + 2] ? slugToWords(parts[i + 2]) : ""
      };
    }
  } catch (_) {}
  return { make: "", model: "" };
}

function parseSsListing(html, sourceUrl) {
  const $ = cheerio.load(html);

  const identity = pathIdentity(sourceUrl);
  const rawMakeModel = findField($, ["Marka", "Марка"]);
  const yearText = findField($, ["Izlaiduma gads", "Gads", "Год выпуска"]);
  const engine = findField($, ["Motors", "Dzinējs", "Двигатель"]);
  const gearbox = findField($, ["Ātrumkārba", "КПП"]);
  const mileageText = findField($, ["Nobraukums, km", "Nobraukums", "Пробег, км"]);
  const priceText = findField($, ["Cena", "Цена"]);

  const description = clean(
    $("#msg_div_msg").first().text() ||
    $('[itemprop="description"]').first().text() ||
    $('meta[property="og:description"]').attr("content") ||
    ""
  );

  let make = identity.make;
  let model = identity.model;

  if (rawMakeModel) {
    if (make && rawMakeModel.toLowerCase().startsWith(make.toLowerCase())) {
      const remainder = clean(rawMakeModel.slice(make.length));
      if (remainder) model = remainder;
    } else if (!make) {
      const parts = rawMakeModel.split(" ");
      make = parts.shift() || "";
      model = parts.join(" ");
    }
  }

  const powerField = findField($, ["Jauda", "Jauda, kW", "Мощность"]);
  let power = digits(powerField);
  if (!power) {
    const powerMatch = (description + " " + engine).match(/(?:^|[^\d])(\d{2,3})\s*k\s*w\b/i);
    if (powerMatch) power = Number(powerMatch[1]);
  }

  let price = digits(priceText);
  if (!price) {
    const title = clean($("title").text()) + " " + clean($('meta[property="og:title"]').attr("content"));
    const m = title.match(/Cena\s*([\d\s.]+)\s*€/i);
    if (m) price = digits(m[1]);
  }

  const result = {
    make: make || null,
    model: model || null,
    year: digits(yearText),
    engine: engine || null,
    power: power || null,
    gearbox: gearbox || null,
    mileage: digits(mileageText),
    price: price || null,
    description: description || null,
    sourceUrl
  };

  const populated = ["make", "model", "year", "engine", "gearbox", "mileage", "price"]
    .filter(k => result[k] !== null && result[k] !== "").length;

  return { result, populated };
}

module.exports = { parseSsListing };
