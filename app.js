const $=s=>document.querySelector(s);
const money=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(Number(n)||0);
const pct=n=>`${Math.round((Number(n)||0)*100)}%`;
let DATA=[];
let STATE={price:'all'};
let imageCache={};
const IMAGE_CACHE_KEY='pokemonImageFallbackCacheV2';

function safeGet(k){try{return localStorage.getItem(k)}catch{return null}}
function safeSet(k,v){try{localStorage.setItem(k,v)}catch{}}
function safeRemove(k){try{localStorage.removeItem(k)}catch{}}
try{imageCache=JSON.parse(safeGet(IMAGE_CACHE_KEY)||'{}')||{}}catch{imageCache={};safeRemove(IMAGE_CACHE_KEY)}

function parsePriceBand(s){return s==='all'?[0,Infinity]:s.split('-').map(Number)}
function validImage(u){return typeof u==='string'&&/^https:\/\/.+/i.test(u)}
function localId(n){return String(n||'').split('/')[0].trim()}
function norm(s){return String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,'')}
function imageKey(c){return `${norm(c.card)}|${norm(c.set)}|${norm(localId(c.number))}`}
function pokemonTcgSmall(u){return validImage(u)?u.replace(/_hires(?=\.png$)/i,''):''}
function setScore(a,b){
  const x=norm(a),y=norm(b);if(!x||!y)return 0;if(x===y)return 120;if(x.includes(y)||y.includes(x))return 80;
  const aw=String(a).toLowerCase().split(/[^a-z0-9]+/).filter(w=>w.length>2);
  return aw.reduce((s,w)=>s+(String(b).toLowerCase().includes(w)?12:0),0);
}
function showFatal(msg){const s=$('#dataUpdated');if(s)s.textContent=msg;const g=$('#grid');if(g)g.innerHTML='<div class="empty" style="display:block;grid-column:1/-1">The watchlist could not load. Use “Check for updates” to retry.</div>'}

async function fetchJson(url,force=false){const r=await fetch(url,{cache:force?'no-store':'default'});if(!r.ok)throw new Error(`HTTP ${r.status}`);return r.json()}

async function resolveTcgdexImage(c,force=false){
  const key=imageKey(c);
  if(!force&&validImage(imageCache[key]))return imageCache[key];
  try{
    const queries=[
      `https://api.tcgdex.net/v2/en/cards?name=${encodeURIComponent(c.card)}&localId=${encodeURIComponent(localId(c.number))}`,
      `https://api.tcgdex.net/v2/en/cards?name=${encodeURIComponent(c.card)}`
    ];
    let candidates=[];
    for(const base of queries){
      const url=base+(force?`${base.includes('?')?'&':'?'}_=${Date.now()}`:'');
      try{
        const list=await fetchJson(url,force);
        if(Array.isArray(list)&&list.length){candidates=list.slice(0,30);break}
      }catch{}
    }
    if(!candidates.length)return '';

    let best=null,bestScore=-1;
    for(const brief of candidates){
      try{
        const base=`https://api.tcgdex.net/v2/en/cards/${encodeURIComponent(brief.id)}`;
        const detail=await fetchJson(base+(force?`?_=${Date.now()}`:''),force);
        if(!detail||!detail.image)continue;
        let score=0;
        if(norm(detail.name)===norm(c.card))score+=100;
        if(norm(detail.localId)===norm(localId(c.number)))score+=80;
        score+=setScore(detail.set&&detail.set.name,c.set);
        if(score>bestScore){bestScore=score;best=detail}
      }catch{}
    }
    if(!best||!best.image)return '';
    const out=`${best.image}/low.webp`;
    imageCache[key]=out;
    safeSet(IMAGE_CACHE_KEY,JSON.stringify(imageCache));
    return out;
  }catch{return ''}
}

async function hydrateImage(img,ph,link,c,force=false){
  img.alt=`${c.card} ${c.number}`;
  const urls=[];
  const small=pokemonTcgSmall(c.image);
  if(validImage(small))urls.push(small);
  if(validImage(c.image)&&c.image!==small)urls.push(c.image);
  if(!force&&validImage(imageCache[imageKey(c)]))urls.push(imageCache[imageKey(c)]);

  const probe=url=>new Promise(resolve=>{const im=new Image();im.onload=()=>resolve(url);im.onerror=()=>resolve('');im.src=force?`${url}${url.includes('?')?'&':'?'}_=${Date.now()}`:url});
  for(const url of [...new Set(urls)]){
    const ok=await probe(url);
    if(ok){img.src=ok;img.style.display='block';ph.classList.remove('visible');link.href=url;link.style.display='inline';return}
  }
  const fallback=await resolveTcgdexImage(c,force);
  if(fallback){const ok=await probe(fallback);if(ok){img.src=ok;img.style.display='block';ph.classList.remove('visible');link.href=fallback;link.style.display='inline';return}}
  img.style.display='none';ph.classList.add('visible');link.style.display='none';
}

function showDataTimes(ts,cached=false,checkedNow=false){
  const d=ts?new Date(ts):null,du=$('#dataUpdated'),lc=$('#lastChecked');
  if(du)du.textContent=(d&&!Number.isNaN(+d))?`Market data updated: ${d.toLocaleString()}${cached?' · cached copy':''}`:(cached?'Market data: cached copy':'Market data: latest available');
  if(checkedNow&&lc)lc.textContent=` · Last checked: ${new Date().toLocaleTimeString([], {hour:'numeric',minute:'2-digit',second:'2-digit'})}`;
}

async function loadData(force=false){
  const base=(window.APP_CONFIG&&window.APP_CONFIG.liveDataUrl)||'./data.json';
  const url=base+(force?`${base.includes('?')?'&':'?'}t=${Date.now()}`:'');
  const json=await fetchJson(url,force);
  if(!Array.isArray(json.cards)||!json.cards.length)throw new Error('Invalid cards dataset');
  DATA=json.cards;safeSet('pokemonWatchlistCache',JSON.stringify(json));showDataTimes(json.updatedAt,false,force);render(force);return json;
}

function filtered(){
  const q=(($('#search')&&$('#search').value)||'').trim().toLowerCase();
  const top=Number($('#topN')&&$('#topN').value)||100,[lo,hi]=parsePriceBand(STATE.price);
  let arr=DATA.filter(c=>Number(c.rank)<=top&&Number(c.market)>=lo&&Number(c.market)<=(hi===500?500:hi)&&(!q||`${c.card} ${c.set} ${c.number} ${c.rank}`.toLowerCase().includes(q)));
  const sort=$('#sort')&&$('#sort').value;
  arr.sort((a,b)=>sort==='roc'?Number(b.returnOnCost)-Number(a.returnOnCost):sort==='margin'?Number(b.margin)-Number(a.margin):sort==='marketAsc'?Number(a.market)-Number(b.market):sort==='marketDesc'?Number(b.market)-Number(a.market):Number(a.rank)-Number(b.rank));
  return arr;
}

function renderSummary(arr){
  const avg=arr.length?arr.reduce((s,c)=>s+Number(c.returnOnCost||0),0)/arr.length:0;
  const buy=arr.reduce((s,c)=>s+Number(c.buy||0),0),resale=arr.reduce((s,c)=>s+Number(c.resale||0),0);
  const el=$('#summary');if(el)el.innerHTML=`<div class="stat"><span>Cards shown</span><b>${arr.length}</b></div><div class="stat"><span>Total target buy</span><b>${money(buy)}</b></div><div class="stat"><span>Total target resale</span><b>${money(resale)}</b></div><div class="stat"><span>Avg. return on cost</span><b>${pct(avg)}</b></div>`;
}

function render(forceImages=false){
  const arr=filtered(),grid=$('#grid'),tpl=$('#cardTemplate');if(!grid||!tpl)throw new Error('Page template unavailable');
  grid.innerHTML='';renderSummary(arr);const empty=$('#empty');if(empty)empty.hidden=arr.length>0;
  const frag=document.createDocumentFragment(),pending=[];
  for(const c of arr){
    const node=tpl.content.firstElementChild.cloneNode(true);
    node.querySelector('.rank').textContent=`#${c.rank}`;node.querySelector('h2').textContent=c.card;node.querySelector('.meta').textContent=`${c.set} · ${c.number}`;node.querySelector('.rocBadge').textContent=`${pct(c.returnOnCost)} ROC`;node.querySelector('.market').textContent=money(c.market);node.querySelector('.buy').textContent=money(c.buy);node.querySelector('.resale').textContent=money(c.resale);node.querySelector('.margin').textContent=`Margin ${money(c.margin)}`;
    const img=node.querySelector('.cardimg'),ph=node.querySelector('.placeholder'),link=node.querySelector('.imageLink');img.style.display='none';ph.classList.add('visible');link.style.display='none';pending.push([img,ph,link,c,forceImages]);frag.appendChild(node);
  }
  grid.appendChild(frag);let i=0;const run=async()=>{while(i<pending.length){await hydrateImage(...pending[i++])}};for(let w=0;w<Math.min(6,pending.length);w++)run();
}

async function refreshAll(){
  const btn=$('#refreshBtn');if(!btn)return;btn.disabled=true;btn.textContent='Checking…';const lc=$('#lastChecked');if(lc)lc.textContent=' · Checking now…';
  try{imageCache={};safeRemove(IMAGE_CACHE_KEY);await loadData(true);btn.textContent='Checked ✓';setTimeout(()=>{btn.textContent='Check for updates';btn.disabled=false},1200)}
  catch{btn.textContent='Retry';btn.disabled=false}
}

function bindEvents(){
  $('#search')&&$('#search').addEventListener('input',()=>render());$('#topN')&&$('#topN').addEventListener('change',()=>render());$('#sort')&&$('#sort').addEventListener('change',()=>render());
  document.querySelectorAll('.chip').forEach(btn=>btn.addEventListener('click',()=>{document.querySelectorAll('.chip').forEach(b=>b.classList.remove('active'));btn.classList.add('active');STATE.price=btn.dataset.price;render()}));
  $('#refreshBtn')&&$('#refreshBtn').addEventListener('click',refreshAll);
}

async function start(){bindEvents();try{await loadData(false)}catch(err){const cached=safeGet('pokemonWatchlistCache');if(cached){try{const json=JSON.parse(cached);DATA=Array.isArray(json.cards)?json.cards:[];showDataTimes(json.updatedAt,true,false);render();return}catch{}}showFatal('Could not load market data');console.error(err)}}
window.addEventListener('error',()=>showFatal('The watchlist encountered an error while loading'));
start();
