import { createHash } from "crypto";
const BASE="ae9c2c8f6b6388c5a2f4a6c5304d32bc"; const t0=Date.now();
const el=()=>Math.round((Date.now()-t0)/1000)+"s";
for (let i=0;i<40;i++){
  try{
    const html=await (await fetch("https://consl.ai",{redirect:"follow",signal:AbortSignal.timeout(15000)})).text();
    const chunks=[...new Set(html.match(/\/_next\/static\/chunks\/[a-zA-Z0-9._-]*\.js/g)??[])].sort().join("\n")+"\n";
    const fp=createHash("md5").update(chunks).digest("hex");
    if(fp!==BASE){console.log(`[${el()}] ✅ new build live on consl.ai (fp ${fp})`);process.exit(0);}
    console.log(`[${el()}] still old build`);
  }catch(e){console.log(`[${el()}] ${e.message}`);}
  await new Promise(r=>setTimeout(r,15000));
}
console.log("⚠ timeout waiting for new build"); process.exit(2);
