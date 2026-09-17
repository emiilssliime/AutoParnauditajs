# Auto Pārbaudītājs V4.5.9

## Kas jauns
- SS.COM / SS.LV auto datu imports.
- Degvielas tipam pielāgota loģika: hibrīdam vairs netiek rādīts dīzeļa DPF/EGR punkts.
- Vehicle Intelligence: modelim/dzinējam/kārbai pielāgoti pārbaudes punkti.
- Nobraukumam pielāgoti pārbaudes punkti.
- Tiešsaistes web/forum/reliability/recall izpēte ar avotiem.
- Pārliecības līmenis balstīts uz neatkarīgo domēnu skaitu.
- Automātiski ģenerēti jautājumi pārdevējam.
- Avotu saites ir redzamas pašā pārskatā.

## Ātrākais atjauninājums no iPad
1. Atarhivē ZIP.
2. GitHub repozitorijā augšupielādē VISUS failus no šīs mapes repo saknē.
3. Apstiprini Commit changes.
4. Render ar Auto-Deploy pats pārdeployos servisu.

## Lai ieslēgtu dzīvo web izpēti
V4.5.9 izmanto Tavily Search API. API atslēga glabājas TIKAI Render servera vidē, nevis HTML.

Render:
Environment -> Add Environment Variable
Key: TAVILY_API_KEY
Value: tava Tavily API atslēga
Save -> Redeploy latest commit

Bez šīs atslēgas SS.COM imports un degvielas/nobraukuma loģika strādā, bet ārējo forumu/web avotu meklēšana ir izslēgta.

## Render iestatījumi, ja tie jāievada manuāli
Language: Node
Build Command: npm install
Start Command: npm start
Root Directory: tukšs
