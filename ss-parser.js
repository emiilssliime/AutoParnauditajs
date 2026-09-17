const cheerio = require("cheerio");

const clean = s => String(s||"").replace(/\u00a0/g," ").replace(/\s+/g," ").trim();
const digits = s => clean(s).replace(/[^\d]/g,"");
const titleCase = s => clean(s).split(/[-_ ]+/).filter(Boolean).map(x=>x.charAt(0).toUpperCase()+x.slice(1)).join(" ");

function fromPath(url){
  try{
    const p=new URL(url).pathname.split("/").filter(Boolean);
    const i=p.findIndex(x=>x==="cars");
    if(i>=0) return {make:titleCase(p[i+1]||""),model:titleCase(p[i+2]||"")};
  }catch{}
  return {};
}

function pick(rows, labels){
  const key=Object.keys(rows).find(k=>labels.some(x=>k.includes(x)));
  return key?rows[key]:"";
}

function detectFuel(text){
  const t=clean(text).toLowerCase();
  // Explicit hybrid terms only. Roman numerals such as "IV" are NOT fuel indicators.
  if(/plug[\s-]?in|\bphev\b|\bmhev\b|\bhev\b|hibr[iī]d|hybrid|\bgte\b|e[\s-]?hybrid/.test(t)) return "hibrīds";
  if(/elektr|electric|\bbev\b|\bev\b/.test(t)) return "elektrisks";
  if(/d[iī]zel|diesel|\btdi\b|\bcdi\b|\bdci\b|\bhdi\b|\bbluehdi\b/.test(t)) return "dīzelis";
  if(/benz[iī]n|petrol|gasoline|\btsi\b|\btfsi\b|\btce\b|\bpuretech\b/.test(t)) return "benzīns";
  return "";
}

function detectPower(powerRaw, body){
  const explicit = clean(powerRaw).match(/(\d{2,4})\s*kW\b/i);
  if(explicit) return explicit[1];
  const bodyKw = String(body||"").match(/(\d{2,4})\s*kW\b/i);
  if(bodyKw) return bodyKw[1];
  const onlyNumber = clean(powerRaw).match(/^\s*(\d{2,4})\s*$/);
  return onlyNumber ? onlyNumber[1] : "";
}

async function parseSsListing(url){
  const r=await fetch(url,{
    headers:{
      "User-Agent":"Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
      "Accept-Language":"lv-LV,lv;q=0.9,en;q=0.7"
    },
    signal:AbortSignal.timeout(15000)
  });

  if(!r.ok) throw new Error(`SS HTTP ${r.status}`);
  const html=await r.text();
  const $=cheerio.load(html);
  const rows={};

  $("tr").each((_,tr)=>{
    const cells=$(tr).find("td").map((_,td)=>clean($(td).text())).get().filter(Boolean);
    if(cells.length>=2){
      const k=cells[0].toLowerCase().replace(/:$/,"").trim();
      const v=cells.slice(1).join(" ");
      if(k.length<80 && v.length<300) rows[k]=v;
    }
  });

  $("[class*='opt'],[id*='opt']").each((_,el)=>{
    const txt=clean($(el).text());
    const m=txt.match(/^([^:]{2,60}):\s*(.+)$/);
    if(m) rows[m[1].toLowerCase().trim()]=clean(m[2]);
  });

  let structured={};
  $("script[type='application/ld+json']").each((_,el)=>{
    try{
      const j=JSON.parse($(el).text());
      const list=Array.isArray(j)?j:[j];
      for(const x of list){
        if(x&&typeof x==="object"){
          if(x.name&&!structured.name) structured.name=clean(x.name);
          if(x.offers?.price&&!structured.price) structured.price=String(x.offers.price);
        }
      }
    }catch{}
  });

  const body=clean($("body").text());
  const pathInfo=fromPath(url);
  const yearRaw=pick(rows,["izlaiduma gads","gads","год выпуска","year"]) || (body.match(/\b(19|20)\d{2}\b/)||[])[0] || "";
  const volume=pick(rows,["motora tilpums","dzinēja tilpums","motors","dzinējs","объём двигателя","engine"]);
  const fuelRaw=pick(rows,["degviela","топливо","fuel"]);
  // Fuel type must come from the listing's actual engine/fuel fields.
  // Do not scan the whole page: words such as "electric windows/mirrors" are equipment, not powertrain.
  const primaryFuelText=clean(`${fuelRaw} ${volume}`);
  const fallbackFuelText=clean(`${structured.name||""} ${$("title").text()||""}`);
  const fuel=detectFuel(primaryFuelText) || (!fuelRaw ? detectFuel(fallbackFuelText) : "");
  const volumeLower=volume.toLowerCase();
  const engine=clean([volume,fuel && !volumeLower.includes(fuel)?fuel:""].filter(Boolean).join(" "));

  const powerRaw=pick(rows,["jauda","мощность","power"]);
  const power=detectPower(powerRaw,body);
  const gearbox=pick(rows,["ātrumkārba","kārba","коробка передач","кпп","transmission"]);
  const mileageRaw=pick(rows,["nobraukums","пробег","mileage"]);
  const mileage=digits(mileageRaw);

  let price=structured.price||clean($(".ads_price,.price,[class*='price']").first().text());
  if(!price){
    const pm=body.match(/(?:Cena|Цена|Price)\s*:?\s*([\d\s.]+)\s*€/i) || body.match(/([\d\s.]+)\s*€/);
    price=pm?pm[1]:"";
  }
  price=digits(price);

  let make=pathInfo.make||"";
  let model=pathInfo.model||"";
  if(!make||!model){
    const pageTitle=clean($("title").text()+" "+(structured.name||""));
    const mm=pageTitle.match(/(?:Pārdod|Продам|Sell)?\s*([A-ZĀČĒĢĪĶĻŅŠŪŽ][\wĀČĒĢĪĶĻŅŠŪŽāčēģīķļņšūž-]+)\s+([\w.-]+)/i);
    if(mm){make=make||mm[1];model=model||mm[2]}
  }

  return {make,model,year:digits(yearRaw).slice(0,4),engine:engine||fuelRaw,power,gearbox,mileage,price,fuel};
}

module.exports={parseSsListing};
