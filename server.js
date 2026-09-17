const express = require("express");
const path = require("path");
const { parseSsListing } = require("./ss-parser");
const { buildVehicleIntelligence } = require("./vehicle-intelligence");

const app = express();
const PORT = process.env.PORT || 3000;
app.set("trust proxy", 1);
app.use(express.json({ limit: "50kb" }));
app.use(express.static(__dirname, { extensions: ["html"] }));

const buckets = new Map();
function rateLimit(max=20, windowMs=10*60*1000){
  return (req,res,next)=>{
    const key=req.ip||"unknown", now=Date.now();
    let b=buckets.get(key);
    if(!b||now-b.start>windowMs)b={start:now,count:0};
    b.count++; buckets.set(key,b);
    if(b.count>max)return res.status(429).json({error:"Par daudz pieprasījumu. Pamēģini vēlāk."});
    next();
  };
}

function validSsUrl(raw){
  try{
    const u=new URL(raw);
    return u.protocol==="https:" && /(^|\.)ss\.(com|lv)$/i.test(u.hostname);
  }catch{return false}
}

app.get("/health",(req,res)=>res.json({ok:true,version:"4.6.1",liveResearch:Boolean(process.env.TAVILY_API_KEY)}));

app.post("/api/listing", rateLimit(30), async (req,res)=>{
  const url=String(req.body?.url||"").trim();
  if(!validSsUrl(url)) return res.status(400).json({error:"Nepareiza SS.COM / SS.LV saite."});
  try{
    const data=await parseSsListing(url);
    res.json({...data,sourceUrl:url,version:"4.6.1"});
  }catch(err){
    console.error("listing error",err);
    res.status(502).json({error:"SS.COM sludinājumu neizdevās nolasīt. Iespējams, lapa īslaicīgi bloķē automātisku piekļuvi."});
  }
});

app.post("/api/intelligence", rateLimit(15), async (req,res)=>{
  try{
    const data=await buildVehicleIntelligence(req.body||{});
    res.json(data);
  }catch(err){
    console.error("intelligence error",err);
    res.status(500).json({error:"Neizdevās sagatavot auto izpēti."});
  }
});

app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"index.html")));
app.listen(PORT,()=>console.log(`Auto Parbauditajs V4.6.1 listening on ${PORT}`));
