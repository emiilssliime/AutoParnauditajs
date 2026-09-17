const express = require("express");
const helmet = require("helmet");
const path = require("path");
const { parseSsListing } = require("./ss-parser");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet({
  contentSecurityPolicy: false
}));
app.use(express.json({ limit: "20kb" }));
app.use(express.static(__dirname, { index: "index.html" }));

function validateSsUrl(value) {
  let u;
  try {
    u = new URL(value);
  } catch (_) {
    return { ok: false, error: "Nederīga saite." };
  }

  if (!["https:", "http:"].includes(u.protocol)) {
    return { ok: false, error: "Atļauta tikai HTTP/HTTPS saite." };
  }

  const host = u.hostname.toLowerCase();
  const allowedHost =
    host === "ss.com" || host.endsWith(".ss.com") ||
    host === "ss.lv" || host.endsWith(".ss.lv");

  if (!allowedHost) {
    return { ok: false, error: "Šobrīd atbalstītas tikai SS.COM un SS.LV saites." };
  }

  if (!u.pathname.includes("/msg/") || !u.pathname.includes("/transport/cars/")) {
    return { ok: false, error: "Saitei jābūt vieglā auto sludinājumam SS.COM / SS.LV." };
  }

  u.hash = "";
  return { ok: true, url: u.toString() };
}

app.get("/api/health", (_, res) => {
  res.json({ ok: true, service: "Auto Pārbaudītājs", version: "4.0.0" });
});

app.post("/api/listing", async (req, res) => {
  const checked = validateSsUrl(req.body?.url);
  if (!checked.ok) {
    return res.status(400).json({ error: checked.error });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const upstream = await fetch(checked.url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; AutoParbauditajs/4.0; +https://localhost)",
        "accept": "text/html,application/xhtml+xml",
        "accept-language": "lv-LV,lv;q=0.9,en;q=0.7"
      }
    });

    if (!upstream.ok) {
      return res.status(502).json({
        error: `SS serveris atbildēja ar statusu ${upstream.status}.`
      });
    }

    const contentType = upstream.headers.get("content-type") || "";
    if (!contentType.includes("text/html")) {
      return res.status(502).json({ error: "SS neatgrieza HTML sludinājuma lapu." });
    }

    const html = await upstream.text();
    if (html.length < 500) {
      return res.status(502).json({ error: "Saņemta nepilnīga sludinājuma lapa." });
    }

    const { result, populated } = parseSsListing(html, upstream.url || checked.url);

    if (populated < 4) {
      return res.status(422).json({
        error: "Sludinājums tika atvērts, bet neizdevās droši atpazīt pietiekami daudz auto datu."
      });
    }

    res.json(result);
  } catch (err) {
    const message = err?.name === "AbortError"
      ? "SS sludinājuma nolasīšanai iestājās noildze."
      : "Neizdevās savienoties ar SS sludinājuma lapu.";
    res.status(502).json({ error: message });
  } finally {
    clearTimeout(timeout);
  }
});

// SPA fallback.
app.get("*", (_, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, () => {
  console.log(`Auto Pārbaudītājs V4.0: http://localhost:${PORT}`);
});
