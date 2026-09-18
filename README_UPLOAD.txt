AUTO PĀRBAUDĪTĀJS — V5.2 UPLOAD

KAS JAUNS V5.2
1) Auto ABC, iAuto un AUTODOC.lv tiek meklēti kā TRĪS atsevišķi avoti.
2) Latvijas tirgus cenas modulis lasa aktuālos SS.COM tā paša modeļa sludinājumus,
   filtrē pēc līdzīga gada un degvielas tipa un rāda diapazonu, mediānu, vidējo cenu
   un šī sludinājuma novirzi no mediānas.
3) Salabota dīzelis → elektrisks kļūda:
   degvielas tips tiek noteikts TIKAI no SS.COM "Motors" lauka.
   Visa lapas teksta meklēšana EV noteikšanai vairs netiek izmantota.
4) EV/Hibrīda pārbaudes parādās tikai tad, ja pats dzinēja/degvielas lauks to tieši norāda.
5) Redzama versijas birka V5.2.

AUGŠUPIELĀDE GITHUB / RENDER
- Izpako ZIP.
- Repo saknē aizstāj:
  index.html
  server.js
  package.json
  render.yaml
- Commit / push uz main.
- Render pārdeployos servisu.

SVARĪGI PAR TAVILY
Render servisā jābūt Environment mainīgajam:
TAVILY_API_KEY = tavs Tavily API key

Atslēga NAV un nedrīkst būt iekļauta HTML vai ZIP failos.
Ja TAVILY_API_KEY nav iestatīts, Auto ABC / iAuto / AUTODOC kartītes joprojām parādīsies,
bet parādīs statusu, ka avotu meklēšana nav konfigurēta.

ĀTRA PĀRBAUDE PĒC DEPLOY
1) Atver https://autoparbauditajs.onrender.com/
2) Augšā jāredz "V5.2 • AUTO PĀRBAUDE".
3) Ielīmē Peugeot 308 2016 1.6 dīzeļa SS.COM saiti.
4) "Dzinējs" nedrīkst saturēt "elektrisks", ja SS.COM Motors laukā tā nav.
5) Nedrīkst parādīties augstsprieguma baterijas/EV pārbaudes parastam dīzelim.
6) Zem analīzes jāparādās:
   - Latvijas tirgus cena
   - Auto ABC
   - iAuto
   - AUTODOC.lv

API
GET  /api/health
POST /api/listing  {"url":"https://www.ss.com/msg/..."}
POST /api/analyze  {"vehicle":{...}}
