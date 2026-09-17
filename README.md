# Auto Pārbaudītājs V4.0

Šī versija saglabā V3.9 interfeisu un pievieno funkcionālu backend pamatu SS.COM / SS.LV sludinājumu automātiskai nolasīšanai.

## Kas jau ir izdarīts

- `POST /api/listing` pieņem `{ "url": "SS sludinājuma saite" }`
- serveris pārbauda, ka saite ir SS.COM / SS.LV vieglā auto sludinājums
- serveris nolasa publisko sludinājuma HTML
- parseris mēģina iegūt:
  - marku
  - modeli
  - izlaiduma gadu
  - dzinēju
  - jaudu kW, ja tā ir norādīta
  - ātrumkārbu
  - nobraukumu
  - cenu
- frontend automātiski aizpilda V3.9 laukus un palaiž esošo analīzi
- manuālā ievade paliek kā rezerves variants

## Palaist lokāli

Nepieciešams Node.js 20+.

```bash
npm install
npm start
```

Pēc tam atver:

`http://localhost:3000`

Veselības pārbaude:

`http://localhost:3000/api/health`

## Izvietošana internetā

Projektu var izvietot jebkurā Node.js hostā, kas:
- izpilda `npm install`
- startē ar `npm start`
- nodod `PORT` vides mainīgo

Frontend un backend tiek servēti no viena domēna, tāpēc nav nepieciešama atsevišķa CORS konfigurācija.

## Svarīgi

SS lapas struktūra var mainīties. Parseris tāpēc izmanto lauku nosaukumus un vairākus fallback variantus, nevis vienu trauslu CSS selektoru. Ja SS bloķē automatizētus servera pieprasījumus vai maina HTML, endpoint atgriezīs saprotamu kļūdu, nevis mēģinās apiet vietnes aizsardzību.

## Nākamais tehniskais slānis pēc V4.0

1. specifisku dzinēju / kārbu / modeļu riska datubāze;
2. gudrāks sludinājuma teksta parseris;
3. tirgus cenas salīdzināšana pret līdzīgiem SS sludinājumiem;
4. VIN/CSDD datu integrācija, ja ir pieejams atbilstošs legāls datu avots/API;
5. pilna pirkuma riska atskaite un PDF.
