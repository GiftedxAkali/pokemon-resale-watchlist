const $ = s => document.querySelector(s);
const money = n => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(Number(n)||0);
const pct = n => `${Math.round((Number(n)||0)*100)}%`;
let DATA=[], STATE={price:'all'};

function parsePriceBand(s){
  if(s==='all') return [0,Infinity];
  return s.split('-').map(Number);
}
function validImage(url){ return typeof url==='string' && /^https:\/\/.+/i.test(url); }

async function loadData(force=false){
  const url=(window.APP_CONFIG?.liveDataUrl||'./data.json') + (force?`?t=${Date.now()}`:'');
  try{
    const r=await fetch(url,{cache:force?'no-store':'default'});
    if(!r.ok) throw new Error(`HTTP ${r.status}`);
    const json=await r.json();
    DATA=json.cards||[];
    localStorage.setItem('pokemonWatchlistCache',JSON.stringify(json));
    renderUpdated(json.updatedAt,false);
  }catch(err){
    const cached=localStorage.getItem('pokemonWatchlistCache');
    if(cached){
      const json=JSON.parse(cached); DATA=json.cards||[]; renderUpdated(json.updatedAt,true);
    }else throw err;
  }
  render();
}
function renderUpdated(ts,cached){
  const d=ts?new Date(ts):null;
  $('#updated').textContent = d && !Number.isNaN(+d)
    ? `Updated ${d.toLocaleString()}${cached?' · cached copy':''}`
    : (cached?'Cached copy':'Latest dataset');
}
function filtered(){
  const q=$('#search').value.trim().toLowerCase();
  const top=Number($('#topN').value)||100;
  const [lo,hi]=parsePriceBand(STATE.price);
  let arr=DATA.filter(c=>c.rank<=top && c.market>=lo && c.market<=(hi===500?500:hi) &&
    (!q || `${c.card} ${c.set} ${c.number} ${c.rank}`.toLowerCase().includes(q)));
  const sort=$('#sort').value;
  arr.sort((a,b)=>{
    if(sort==='roc') return b.returnOnCost-a.returnOnCost;
    if(sort==='margin') return b.margin-a.margin;
    if(sort==='marketAsc') return a.market-b.market;
    if(sort==='marketDesc') return b.market-a.market;
    return a.rank-b.rank;
  });
  return arr;
}
function renderSummary(arr){
  const avg=arr.length?arr.reduce((s,c)=>s+c.returnOnCost,0)/arr.length:0;
  const buy=arr.reduce((s,c)=>s+c.buy,0);
  const resale=arr.reduce((s,c)=>s+c.resale,0);
  $('#summary').innerHTML=`
    <div class="stat"><span>Cards shown</span><b>${arr.length}</b></div>
    <div class="stat"><span>Total target buy</span><b>${money(buy)}</b></div>
    <div class="stat"><span>Total target resale</span><b>${money(resale)}</b></div>
    <div class="stat"><span>Avg. return on cost</span><b>${pct(avg)}</b></div>`;
}
function render(){
  const arr=filtered(), grid=$('#grid'), tpl=$('#cardTemplate');
  grid.innerHTML=''; renderSummary(arr); $('#empty').hidden=arr.length>0;
  const frag=document.createDocumentFragment();
  for(const c of arr){
    const node=tpl.content.firstElementChild.cloneNode(true);
    node.querySelector('.rank').textContent=`#${c.rank}`;
    node.querySelector('h2').textContent=c.card;
    node.querySelector('.meta').textContent=`${c.set} · ${c.number}`;
    node.querySelector('.rocBadge').textContent=`${pct(c.returnOnCost)} ROC`;
    node.querySelector('.market').textContent=money(c.market);
    node.querySelector('.buy').textContent=money(c.buy);
    node.querySelector('.resale').textContent=money(c.resale);
    node.querySelector('.margin').textContent=`Margin ${money(c.margin)}`;
    const img=node.querySelector('.cardimg'), ph=node.querySelector('.placeholder'), link=node.querySelector('.imageLink');
    if(validImage(c.image)){
      img.src=c.image; img.alt=`${c.card} ${c.number}`;
      img.onerror=()=>{img.style.display='none';ph.classList.add('visible');link.style.display='none'};
      link.href=c.image;
    }else{
      img.style.display='none'; ph.classList.add('visible'); link.style.display='none';
    }
    frag.appendChild(node);
  }
  grid.appendChild(frag);
}
$('#search').addEventListener('input',render);
$('#topN').addEventListener('change',render);
$('#sort').addEventListener('change',render);
document.querySelectorAll('.chip').forEach(btn=>btn.addEventListener('click',()=>{
  document.querySelectorAll('.chip').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active'); STATE.price=btn.dataset.price; render();
}));
$('#refreshBtn').addEventListener('click',()=>loadData(true));
loadData().catch(err=>{$('#updated').textContent='Could not load data';console.error(err)});
if('serviceWorker' in navigator) navigator.serviceWorker.register('./service-worker.js').catch(()=>{});
