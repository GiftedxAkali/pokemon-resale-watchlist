const $ = s => document.querySelector(s);
const money = n => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(Number(n)||0);
const pct = n => `${Math.round((Number(n)||0)*100)}%`;
let DATA=[], STATE={price:'all'};
const IMAGE_CACHE_KEY='pokemonImageFallbackCacheV1';
const imageCache=JSON.parse(localStorage.getItem(IMAGE_CACHE_KEY)||'{}');

function parsePriceBand(s){ if(s==='all') return [0,Infinity]; return s.split('-').map(Number); }
function validImage(url){ return typeof url==='string' && /^https:\/\/.+/i.test(url); }
function localId(number){ return String(number||'').split('/')[0].trim(); }
function norm(s){ return String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,''); }
function imageKey(c){ return `${norm(c.card)}|${norm(c.set)}|${norm(localId(c.number))}`; }
function pokemonTcgSmall(url){ if(!validImage(url)) return ''; return url.replace(/_hires(?=\.png$)/i,''); }
function setScore(a,b){
  const x=norm(a), y=norm(b); if(!x||!y) return 0; if(x===y) return 100; if(x.includes(y)||y.includes(x)) return 60;
  const words=String(a).toLowerCase().split(/[^a-z0-9]+/).filter(w=>w.length>2);
  return words.reduce((s,w)=>s+(String(b).toLowerCase().includes(w)?10:0),0);
}

async function resolveTcgdexImage(c, force=false){
  const key=imageKey(c); if(!force && key in imageCache) return imageCache[key];
  try{
    const name=encodeURIComponent(`eq:${c.card}`), id=encodeURIComponent(`eq:${localId(c.number)}`);
    let r=await fetch(`https://api.tcgdex.net/v2/en/cards?name=${name}&localId=${id}${force?`&_=${Date.now()}`:''}`,{cache:force?'no-store':'default'});
    if(!r.ok) throw new Error(`TCGdex ${r.status}`); let list=await r.json();
    if(!Array.isArray(list)||!list.length){
      r=await fetch(`https://api.tcgdex.net/v2/en/cards?name=${encodeURIComponent(c.card)}&localId=${id}${force?`&_=${Date.now()}`:''}`,{cache:force?'no-store':'default'});
      if(!r.ok) throw new Error(`TCGdex ${r.status}`); list=await r.json();
    }
    if(!Array.isArray(list)||!list.length){ imageCache[key]=''; localStorage.setItem(IMAGE_CACHE_KEY,JSON.stringify(imageCache)); return ''; }
    let best=null,bestScore=-1;
    for(const brief of list.slice(0,12)){
      try{
        const dr=await fetch(`https://api.tcgdex.net/v2/en/cards/${encodeURIComponent(brief.id)}${force?`?_=${Date.now()}`:''}`,{cache:force?'no-store':'default'});
        if(!dr.ok) continue; const detail=await dr.json();
        const score=(norm(detail.name)===norm(c.card)?50:0)+(norm(detail.localId)===norm(localId(c.number))?50:0)+setScore(detail.set?.name,c.set);
        if(detail.image && score>bestScore){ bestScore=score; best=detail; }
      }catch{}
    }
    const out=best?.image ? `${best.image}/low.webp` : (list[0]?.image ? `${list[0].image}/low.webp` : '');
    imageCache[key]=out; localStorage.setItem(IMAGE_CACHE_KEY,JSON.stringify(imageCache)); return out;
  }catch(err){ console.debug('TCGdex image lookup failed',c.card,c.number,err); return ''; }
}

async function hydrateImage(img,ph,link,c,force=false){
  img.alt=`${c.card} ${c.number}`; const candidates=[]; const small=pokemonTcgSmall(c.image);
  if(validImage(small)) candidates.push(small); if(validImage(c.image) && c.image!==small) candidates.push(c.image);
  const cached=imageCache[imageKey(c)]; if(!force && validImage(cached)) candidates.push(cached);
  const tryCandidate=(url)=>new Promise(resolve=>{ const probe=new Image(); probe.decoding='async'; probe.onload=()=>resolve(url); probe.onerror=()=>resolve(''); probe.src=force?`${url}${url.includes('?')?'&':'?'}_=${Date.now()}`:url; });
  for(const url of [...new Set(candidates)]){ const ok=await tryCandidate(url); if(ok){ img.src=ok; img.style.display='block'; ph.classList.remove('visible'); link.href=url; link.style.display='inline'; return; } }
  const fallback=await resolveTcgdexImage(c,force);
  if(fallback){ const ok=await tryCandidate(fallback); if(ok){ img.src=ok; img.style.display='block'; ph.classList.remove('visible'); link.href=fallback; link.style.display='inline'; return; } }
  img.style.display='none'; ph.classList.add('visible'); link.style.display='none';
}

function showDataTimes(ts,cached=false,checkedNow=false){
  const d=ts?new Date(ts):null;
  $('#dataUpdated').textContent=(d&&!Number.isNaN(+d))?`Market data updated: ${d.toLocaleString()}${cached?' · cached copy':''}`:(cached?'Market data: cached copy':'Market data: latest available');
  if(checkedNow) $('#lastChecked').textContent=` · Last checked: ${new Date().toLocaleTimeString([], {hour:'numeric',minute:'2-digit',second:'2-digit'})}`;
}

async function loadData(force=false){
  const base=(window.APP_CONFIG?.liveDataUrl||'./data.json');
  const url=base+(force?`${base.includes('?')?'&':'?'}t=${Date.now()}`:'');
  const r=await fetch(url,{cache:force?'no-store':'default'});
  if(!r.ok) throw new Error(`HTTP ${r.status}`);
  const json=await r.json();
  if(!Array.isArray(json.cards)) throw new Error('Invalid cards dataset');
  DATA=json.cards;
  localStorage.setItem('pokemonWatchlistCache',JSON.stringify(json));
  showDataTimes(json.updatedAt,false,force);
  render(force);
  return json;
}

function filtered(){
  const q=$('#search').value.trim().toLowerCase(), top=Number($('#topN').value)||100, [lo,hi]=parsePriceBand(STATE.price);
  let arr=DATA.filter(c=>Number(c.rank)<=top&&Number(c.market)>=lo&&Number(c.market)<=(hi===500?500:hi)&&(!q||`${c.card} ${c.set} ${c.number} ${c.rank}`.toLowerCase().includes(q)));
  const sort=$('#sort').value;
  arr.sort((a,b)=>sort==='roc'?Number(b.returnOnCost)-Number(a.returnOnCost):sort==='margin'?Number(b.margin)-Number(a.margin):sort==='marketAsc'?Number(a.market)-Number(b.market):sort==='marketDesc'?Number(b.market)-Number(a.market):Number(a.rank)-Number(b.rank));
  return arr;
}
function renderSummary(arr){
  const avg=arr.length?arr.reduce((s,c)=>s+Number(c.returnOnCost||0),0)/arr.length:0,buy=arr.reduce((s,c)=>s+Number(c.buy||0),0),resale=arr.reduce((s,c)=>s+Number(c.resale||0),0);
  $('#summary').innerHTML=`<div class="stat"><span>Cards shown</span><b>${arr.length}</b></div><div class="stat"><span>Total target buy</span><b>${money(buy)}</b></div><div class="stat"><span>Total target resale</span><b>${money(resale)}</b></div><div class="stat"><span>Avg. return on cost</span><b>${pct(avg)}</b></div>`;
}
function render(forceImages=false){
  const arr=filtered(),grid=$('#grid'),tpl=$('#cardTemplate');
  grid.innerHTML=''; renderSummary(arr); $('#empty').hidden=arr.length>0;
  const frag=document.createDocumentFragment(),pending=[];
  for(const c of arr){
    const node=tpl.content.firstElementChild.cloneNode(true);
    node.querySelector('.rank').textContent=`#${c.rank}`; node.querySelector('h2').textContent=c.card; node.querySelector('.meta').textContent=`${c.set} · ${c.number}`; node.querySelector('.rocBadge').textContent=`${pct(c.returnOnCost)} ROC`; node.querySelector('.market').textContent=money(c.market); node.querySelector('.buy').textContent=money(c.buy); node.querySelector('.resale').textContent=money(c.resale); node.querySelector('.margin').textContent=`Margin ${money(c.margin)}`;
    const img=node.querySelector('.cardimg'),ph=node.querySelector('.placeholder'),link=node.querySelector('.imageLink'); img.style.display='none'; ph.classList.add('visible'); link.style.display='none'; pending.push([img,ph,link,c,forceImages]); frag.appendChild(node);
  }
  grid.appendChild(frag);
  let i=0; const workers=Math.min(6,pending.length); const run=async()=>{while(i<pending.length){await hydrateImage(...pending[i++]);}}; for(let w=0;w<workers;w++) run();
}

async function refreshAll(){
  const btn=$('#refreshBtn'),oldText='Check for updates'; btn.disabled=true; btn.textContent='Checking…'; $('#lastChecked').textContent=' · Checking now…';
  try{
    localStorage.removeItem(IMAGE_CACHE_KEY); Object.keys(imageCache).forEach(k=>delete imageCache[k]); await loadData(true);
    btn.textContent='Checked ✓'; setTimeout(()=>{btn.textContent=oldText;btn.disabled=false;},1200);
  }catch(err){
    console.error(err); const cached=localStorage.getItem('pokemonWatchlistCache');
    if(cached){ const json=JSON.parse(cached); DATA=Array.isArray(json.cards)?json.cards:[]; showDataTimes(json.updatedAt,true,true); render(); }
    else { $('#dataUpdated').textContent='Market data unavailable'; $('#lastChecked').textContent=` · Last checked: ${new Date().toLocaleTimeString()}`; }
    btn.textContent='Retry'; btn.disabled=false;
  }
}

$('#search').addEventListener('input',()=>render()); $('#topN').addEventListener('change',()=>render()); $('#sort').addEventListener('change',()=>render());
document.querySelectorAll('.chip').forEach(btn=>btn.addEventListener('click',()=>{document.querySelectorAll('.chip').forEach(b=>b.classList.remove('active'));btn.classList.add('active');STATE.price=btn.dataset.price;render();}));
$('#refreshBtn').addEventListener('click',refreshAll);

(async()=>{
  try{
    if('serviceWorker' in navigator){
      const regs=await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r=>r.unregister()));
    }
    if('caches' in window){
      const keys=await caches.keys();
      await Promise.all(keys.filter(k=>k.startsWith('pokemon-watchlist-')).map(k=>caches.delete(k)));
    }
  }catch{}
  loadData().catch(err=>{
    const cached=localStorage.getItem('pokemonWatchlistCache');
    if(cached){ const json=JSON.parse(cached); DATA=Array.isArray(json.cards)?json.cards:[]; showDataTimes(json.updatedAt,true,false); render(); }
    else { $('#dataUpdated').textContent='Could not load market data'; console.error(err); }
  });
})();
