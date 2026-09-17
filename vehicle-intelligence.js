const cache=new Map();
const TTL=24*60*60*1000;

function norm(s){return String(s||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"")}
function domainOf(url){try{return new URL(url).hostname.replace(/^www\./,"")}catch{return""}}
function num(s){return Number(String(s||"").replace(/[^\d]/g,""))||0}

function detect(v){
  const t=norm(`${v.engine||""} ${v.fuel||""}`);
  // Explicit hybrid wording only. Do not treat model/generation "IV" as hybrid.
  if(/plug.?in|phev|\bmhev\b|\bhev\b|hibrid|hybrid|\bgte\b|e-?hybrid/.test(t))return"hybrid";
  if(/elektr|electric|\bbev\b|\bev\b/.test(t))return"electric";
  if(/dizel|diesel|\btdi\b|\bcdi\b|\bdci\b|\bhdi\b|\bbluehdi\b/.test(t))return"diesel";
  if(/benzin|petrol|gasoline|\btsi\b|\btfsi\b|\btce\b|\bpuretech\b/.test(t))return"petrol";
  return"unknown";
}

function fingerprint(v){
  return [v.make,v.model,v.year,v.engine,v.power?`${v.power} kW`:"",v.gearbox].filter(Boolean).join(" • ");
}

function forumDomains(make){
  const m=norm(make);
  const common=["reddit.com","whatcar.com","honestjohn.co.uk","parkers.co.uk"];
  const map={
    bmw:["bimmerpost.com","bimmerfest.com"],
    volkswagen:["vwvortex.com","golfmk7.com"],
    vw:["vwvortex.com","golfmk7.com"],
    skoda:["briskoda.net"],
    audi:["audizine.com","audiworld.com"],
    mercedes:["mbworld.org","forums.mercedesclub.org.uk"],
    volvo:["swedespeed.com","volvoforums.org.uk"],
    toyota:["toyotanation.com"],
    lexus:["clublexus.com"],
    ford:["fordownersclub.com"],
    mazda:["mazda3revolution.com"],
    honda:["civinfo.com","hondakarma.com"],
    peugeot:["peugeotforums.com"],
    renault:["renaultforums.co.uk"],
    opel:["vauxhallownersnetwork.co.uk"],
    vauxhall:["vauxhallownersnetwork.co.uk"]
  };
  const key=Object.keys(map).find(k=>m.includes(k));
  return [...new Set([...(key?map[key]:[]),...common])];
}

async function tavily(query,include_domains=[]){
  const key=process.env.TAVILY_API_KEY;
  if(!key)return null;
  const r=await fetch("https://api.tavily.com/search",{
    method:"POST",
    headers:{"Content-Type":"application/json","Authorization":`Bearer ${key}`},
    body:JSON.stringify({
      query,topic:"general",search_depth:"basic",max_results:8,
      include_answer:"basic",include_raw_content:false,include_images:false,
      include_domains
    }),
    signal:AbortSignal.timeout(20000)
  });
  if(!r.ok)throw new Error(`Tavily ${r.status}`);
  return r.json();
}

const CATS=[
 {id:"transmission",title:"Ātrumkārba / transmisija",re:/\b(dsg|mechatronic|gearbox|transmission|clutch|dual clutch|shift|shifting|pārslēg|kārba)\b/i,severity:"high",check:"Aukstā un siltā režīmā pārbaudi D/R ieslēgšanos, lēnu kustību, pārslēgšanos, vibrācijas un servisa pierādījumus.",symptoms:"Raustīšanās, sitieni, aizture, slīdēšana, vibrācija, kļūdu paziņojumi."},
 {id:"hybrid",title:"Hibrīda / augstsprieguma sistēma",re:/\b(hybrid|phev|battery|charging|charger|inverter|electric drive|high voltage|hv battery)\b/i,severity:"high",check:"Pārbaudi uzlādi, EV režīmu, kļūdas, akumulatora diagnostiku un hibrīda dzesēšanas sistēmu.",symptoms:"Samazināts EV nobraukums, uzlādes kļūdas, brīdinājumi, neparasta motora/EV pārslēgšanās."},
 {id:"emissions",title:"Emisiju sistēma",re:/\b(dpf|egr|adblue|scr|nox|particulate|emission)\b/i,severity:"high",check:"Ar diagnostiku pārbaudi DPF/EGR/SCR/NOx stāvokli, kļūdu vēsturi un gatavības statusus.",symptoms:"Check-engine, biežas reģenerācijas, jaudas zudums, AdBlue/NOx brīdinājumi."},
 {id:"timing",title:"Dzinēja piedziņa / ķēde / siksna",re:/\b(timing chain|timing belt|cam belt|chain tensioner|tensioner)\b/i,severity:"high",check:"Noskaidro maiņas intervālu un pierādījumus; aukstā startā klausies grabēšanu un veic diagnostiku.",symptoms:"Grabēšana aukstā startā, sinhronizācijas kļūdas, nevienmērīga darbība."},
 {id:"cooling",title:"Dzesēšanas sistēma",re:/\b(water pump|coolant|thermostat|cooling|radiator)\b/i,severity:"med",check:"Pārbaudi dzesēšanas šķidruma līmeni, noplūdes, ūdenssūkni/termostatu un darba temperatūru.",symptoms:"Šķidruma zudums, pārkaršana, nestabila temperatūra, saldens aromāts."},
 {id:"oil",title:"Eļļas patēriņš / noplūdes",re:/\b(oil consumption|burning oil|oil leak|oil pressure)\b/i,severity:"high",check:"Apskati noplūdes, izplūdes dūmus, eļļas līmeni un servisa intervālus.",symptoms:"Eļļas papildināšana starp apkopēm, zili dūmi, slapjš motors, spiediena brīdinājumi."},
 {id:"turbo",title:"Turbo / ieplūdes sistēma",re:/\b(turbo|turbocharger|boost|wastegate)\b/i,severity:"high",check:"Testa braucienā pārbaudi vienmērīgu jaudu, spiediena kļūdas, svilpšanu un eļļas noplūdes.",symptoms:"Jaudas zudums, svilpšana, limp mode, boost kļūdas."},
 {id:"electronics",title:"Elektronika / infotainment",re:/\b(infotainment|electrical|electronics|sensor|camera|screen|software|12v battery)\b/i,severity:"med",check:"Izmēģini visas ekrāna, kameras, sensoru, Bluetooth, apsildes un vadības funkcijas; nolasi kļūdas.",symptoms:"Restarti, melns ekrāns, sensora kļūdas, periodiski brīdinājumi."},
 {id:"suspension",title:"Piekare / stūre",re:/\b(suspension|bushing|bushes|control arm|wheel bearing|steering|shock absorber)\b/i,severity:"med",check:"Brauc pa nelīdzenu ceļu, klausies klaboņu, pārbaudi bukses, gultņus, amortizatorus un riepu nodilumu.",symptoms:"Klaboņa, vibrācija, nevienmērīgs riepu nodilums, nestabila stūrēšana."},
 {id:"climate",title:"Klimata sistēma",re:/\b(air conditioning|air-con|a\/c|climate|compressor)\b/i,severity:"low",check:"Pārbaudi aukstu/siltu gaisu visos režīmos, kompresora darbību un zonu regulāciju.",symptoms:"Vāja dzesēšana, trokšņi, nevienāda temperatūra."},
 {id:"corrosion",title:"Korozija / virsbūve",re:/\b(rust|corrosion|corrode)\b/i,severity:"med",check:"Pārbaudi sliekšņus, arkas, apakšu, durvju malas, pacelšanas punktus un remonta pēdas.",symptoms:"Burbuļi krāsā, rūsas plankumi, svaigs pārklājums apakšā."}
];

function sourceType(domain){
  if(/reddit|forum|briskoda|bimmer|vwvortex|audizine|swedespeed|toyotanation|clublexus|owners/.test(domain))return"Īpašnieku forums";
  if(/whatcar|honestjohn|parkers/.test(domain))return"Lietota auto / uzticamības avots";
  if(/europa\.eu|gov\.uk|skoda-auto|volkswagen|bmw|mercedes|audi\.com/.test(domain))return"Oficiāls / atsaukumu avots";
  return"Web avots";
}

function rankIssues(results,powertrain){
  const map=new Map();
  for(const r of results){
    const text=`${r.title||""} ${r.content||""}`;
    const d=domainOf(r.url);
    for(const c of CATS){
      if(c.id==="hybrid" && powertrain!=="hybrid" && powertrain!=="electric") continue;
      if(c.id==="emissions" && powertrain!=="diesel") continue;
      if(c.re.test(text)){
        let x=map.get(c.id)||{...c,domains:new Set(),score:0,mentions:0};
        x.domains.add(d); x.score+=Number(r.score||0.4); x.mentions++; map.set(c.id,x);
      }
    }
  }
  return [...map.values()].sort((a,b)=>(b.domains.size*2+b.score)-(a.domains.size*2+a.score)).slice(0,7).map(x=>({
    id:x.id,title:x.title,severity:x.severity,
    confidence:x.domains.size>=3?"high":x.domains.size>=2?"med":"low",
    sourceCount:x.domains.size,
    reason:x.domains.size>=2?`Minēts ${x.domains.size} neatkarīgos avotos.`:"Minēts vienā avotā — izmanto kā papildu pārbaudes punktu.",
    check:x.check,symptoms:x.symptoms
  }));
}

function baselineIssues(v,powertrain){
  const out=[];
  const auto=/auto|dsg|tronic|cvt|geartronic|steptronic|dct|edc|powershift/i.test(v.gearbox||"");
  if(auto)out.push({...CATS.find(x=>x.id==="transmission"),confidence:"med",sourceCount:0,reason:"Pārbaudi darbību aukstā un siltā režīmā un pieprasi apkopes pierādījumus."});
  if(powertrain==="hybrid")out.push({...CATS.find(x=>x.id==="hybrid"),confidence:"med",sourceCount:0,reason:"Pārbaudi gan iekšdedzes motoru, gan augstsprieguma sistēmu."});
  if(powertrain==="diesel")out.push({...CATS.find(x=>x.id==="emissions"),confidence:"med",sourceCount:0,reason:"Dīzelim īpaši pārbaudi DPF/EGR un emisiju sistēmas stāvokli."});
  if(powertrain==="petrol")out.push({id:"petrol",title:"Benzīna dzinējs",severity:"med",confidence:"med",sourceCount:0,reason:"Benzīna motoram pārbaudi auksto startu, aizdedzi, noplūdes un turbīnu, ja tāda ir.",check:"Auksts starts, misfire, eļļas un dzesēšanas noplūdes, turbīnas darbība (ja ir), servisa intervāli.",symptoms:"Nevienmērīga darbība, dūmi, ķēdes/siksnas trokšņi, jaudas zudums."});
  if(powertrain==="electric")out.push({...CATS.find(x=>x.id==="hybrid"),title:"Augstsprieguma akumulators / elektriskā piedziņa",confidence:"med",sourceCount:0,reason:"Galvenais pārbaudes punkts ir augstsprieguma baterijas stāvoklis un uzlāde."});
  return out;
}

function mileageChecks(v,powertrain){
  const km=num(v.mileage), a=[];
  if(km>=100000)a.push("100 000+ km — lielās apkopes, šķidrumi un filtri; pārbaudīt dokumentus.");
  if(km>=150000)a.push("150 000+ km — bukses, gultņi, amortizatori, dzesēšana un agregātu noplūdes.");
  if(km>=200000)a.push("200 000+ km — transmisija, piedziņas mezgli, diagnostikas vēsture un motora stāvokļa pazīmes.");
  if(powertrain==="hybrid")a.push("Hibrīds — HV akumulatora diagnostika / SOH, uzlāde un veiktie remonti.");
  if(powertrain==="electric")a.push("Elektroauto — baterijas SOH, AC/DC uzlāde, termovadība un HV kļūdu kodi.");
  return a;
}

function sellerQuestions(v,powertrain,issues){
  const q=[
    "Servisa vēsture — rēķini, ieraksti un pēdējās apkopes.",
    "Auksts starts — lūgt auto neiedarbināt pirms apskates.",
    "Neatkarīga pārbaude — serviss un diagnostika pirms pirkuma."
  ];

  if(/auto|dsg|tronic|cvt|geartronic|steptronic|dct|edc|powershift/i.test(v.gearbox||"")){
    q.push("Ātrumkārbas apkope — datums, nobraukums, serviss un rēķins.");
  }
  if(powertrain==="hybrid"){
    q.push("Hibrīda baterija — diagnostika, uzlādes kļūdas un HV remonti.");
  }
  if(powertrain==="diesel"){
    q.push("DPF / EGR / AdBlue / NOx — bijušas kļūdas vai remonti?");
  }

  for(const i of issues.slice(0,3)){
    if(i.id==="timing")q.push("Zobsiksna / ķēde — kad mainīta un vai ir dokumenti?");
    if(i.id==="cooling")q.push("Dzesēšana — ūdenssūknis, termostats un noplūžu remonti.");
    if(i.id==="electronics")q.push("Elektronika — ekrāns, kameras, sensori; bijuši remonti?");
  }

  return [...new Set(q)].slice(0,8);
}

async function buildVehicleIntelligence(v){
  const powertrain=detect(v), fp=fingerprint(v), ck=norm(fp);
  const c=cache.get(ck);
  if(c&&Date.now()-c.time<TTL)return c.data;

  let webResults=[], researchStatus=process.env.TAVILY_API_KEY?"live":"offline";

  if(process.env.TAVILY_API_KEY){
    try{
      const q1=`${fp} common problems reliability known issues owner forum used car buying guide`;
      const q2=`${v.make||""} ${v.model||""} ${v.year||""} ${v.engine||""} recall safety campaign Europe`;
      const [a,b]=await Promise.all([
        tavily(q1,forumDomains(v.make)),
        tavily(q2,["car-recalls.eu","ec.europa.eu","gov.uk"])
      ]);
      for(const x of [a,b]){
        for(const r of x?.results||[])webResults.push(r);
      }
    }catch(e){
      console.error("research provider",e.message);
      researchStatus="offline";
    }
  }

  const seen=new Set();
  const sources=webResults.filter(r=>{
    if(!r.url||seen.has(r.url))return false;
    seen.add(r.url);
    return true;
  }).slice(0,12).map(r=>({
    title:r.title,url:r.url,domain:domainOf(r.url),score:r.score,type:sourceType(domainOf(r.url))
  }));

  let issues=rankIssues(webResults,powertrain);
  const baseline=baselineIssues(v,powertrain);
  for(const b of baseline)if(!issues.some(i=>i.id===b.id))issues.push(b);
  issues=issues.slice(0,8);

  const data={
    version:"4.6.2",
    fingerprint:fp,
    powertrain,
    researchStatus,
    webSummary:"",
    issues,
    mileageChecks:mileageChecks(v,powertrain),
    sellerQuestions:sellerQuestions(v,powertrain,issues),
    sources
  };

  cache.set(ck,{time:Date.now(),data});
  return data;
}

module.exports={buildVehicleIntelligence};
