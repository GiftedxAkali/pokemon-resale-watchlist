const MANUAL_LIST_KEY='pokemonManualCardListV1';
let MANUAL_LIST=[];
let MANUAL_SEARCH=[];

function mlMoney(n){return new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(Number(n)||0)}
function mlLoad(){try{MANUAL_LIST=JSON.parse(localStorage.getItem(MANUAL_LIST_KEY)||'[]')||[]}catch{MANUAL_LIST=[]}}
function mlSave(){try{localStorage.setItem(MANUAL_LIST_KEY,JSON.stringify(MANUAL_LIST))}catch{}}
function mlBuyPct(m){m=Number(m)||0;if(m>=200)return .72;if(m>=75)return .70;if(m>=25)return .68;return .65}
function mlSalePct(){return .95}
function mlTcgPrice(detail){
  const p=detail?.pricing?.tcgplayer;if(!p)return null;
  const preferred=['holofoil','normal','unlimited-holofoil','unlimited','reverse-holofoil','reverse'];
  const vals=[];
  for(const k of preferred){const v=p[k],m=Number(v?.marketPrice);if(Number.isFinite(m)&&m>0)vals.push({variant:k,market:m})}
  if(!vals.length){for(const [k,v] of Object.entries(p)){const m=Number(v?.marketPrice);if(v&&typeof v==='object'&&Number.isFinite(m)&&m>0&&!/1st/i.test(k))vals.push({variant:k,market:m})}}
  vals.sort((a,b)=>a.market-b.market);return vals[0]||null;
}
async function mlList(q){const r=await fetch(`https://api.tcgdex.net/v2/en/cards?name=${encodeURIComponent(q)}`,{cache:'no-store'});if(!r.ok)throw new Error('Search failed');const j=await r.json();return Array.isArray(j)?j:[]}
async function mlDetail(id){const r=await fetch(`https://api.tcgdex.net/v2/en/cards/${encodeURIComponent(id)}`,{cache:'no-store'});if(!r.ok)throw new Error('Card lookup failed');return r.json()}
function mlScore(d,q){const nq=norm(q),nn=norm(d.name||''),raw=String(q).toLowerCase();let s=0;if(nq===nn)s+=150;else if(nq.includes(nn)||nn.includes(nq))s+=90;const num=(String(q).match(/\b([A-Z]{0,4}\d{1,3}|TG\d{1,3}|GG\d{1,3})\s*\/\s*\d{1,3}\b/i)||[])[1];if(num&&norm(num)===norm(d.localId))s+=180;for(const w of words(d.set?.name||'').filter(x=>x.length>3)){if(raw.includes(w))s+=12}return s}
async function mlSearch(){
  const q=$('#manualCardSearch')?.value?.trim(),status=$('#manualSearchStatus'),box=$('#manualSearchResults'),btn=$('#manualSearchBtn');if(!q)return;
  if(btn){btn.disabled=true;btn.textContent='Searching…'};if(status)status.textContent='Searching online card database…';if(box)box.innerHTML='';
  try{
    const list=await mlList(q),scored=[];
    for(const brief of list.slice(0,30)){const d=await mlDetail(brief.id);scored.push({detail:d,score:mlScore(d,q)})}
    scored.sort((a,b)=>b.score-a.score);MANUAL_SEARCH=scored.slice(0,16).map(x=>{const p=mlTcgPrice(x.detail);return {id:x.detail.id,name:x.detail.name,set:x.detail.set?.name||'',number:x.detail.localId||'',image:x.detail.image?`${x.detail.image}/low.webp`:'',market:Number(p?.market||0),variant:p?.variant||'',score:x.score}});
    if(status)status.textContent=MANUAL_SEARCH.length?`Select the exact card from ${MANUAL_SEARCH.length} result${MANUAL_SEARCH.length===1?'':'s'}.`:'No cards found.';
    if(box)box.innerHTML=MANUAL_SEARCH.map((c,i)=>`<button class="mlResult" data-i="${i}">${c.image?`<img src="${scannerEsc(c.image)}" alt="">`:'<span class="mlNoImg">?</span>'}<span><b>${scannerEsc(c.name)}</b><small>${scannerEsc(c.set)} · ${scannerEsc(c.number)}</small><small>${c.market?`Market ${mlMoney(c.market)}`:'Market unavailable'}</small></span><span class="mlAdd">Add</span></button>`).join('');
    box?.querySelectorAll('.mlResult').forEach(b=>b.onclick=()=>mlAdd(Number(b.dataset.i)));
  }catch(err){if(status)status.textContent=err.message||'Search failed.'}
  finally{if(btn){btn.disabled=false;btn.textContent='Search cards'}}
}
function mlAdd(i){const c=MANUAL_SEARCH[i];if(!c)return;const existing=MANUAL_LIST.find(x=>x.id===c.id);if(existing)existing.qty+=1;else MANUAL_LIST.push({...c,qty:1});mlSave();mlRender()}
function mlRemove(i){MANUAL_LIST.splice(i,1);mlSave();mlRender()}
function mlQty(i,v){const q=Math.max(1,Number(v)||1);MANUAL_LIST[i].qty=q;mlSave();mlRender()}
function mlRender(){
  const rows=$('#manualListRows'),summary=$('#manualListSummary');if(!rows||!summary)return;
  let tm=0,tb=0,ts=0;rows.innerHTML='';
  MANUAL_LIST.forEach((c,i)=>{const q=Number(c.qty)||1,market=Number(c.market)||0,buy=market*mlBuyPct(market),sale=market*mlSalePct();tm+=market*q;tb+=buy*q;ts+=sale*q;const div=document.createElement('div');div.className='mlRow';div.innerHTML=`${c.image?`<img src="${scannerEsc(c.image)}" alt="${scannerEsc(c.name)}">`:'<div class="mlNoImg"></div>'}<div class="mlInfo"><b>${scannerEsc(c.name)}</b><span>${scannerEsc(c.set)} · ${scannerEsc(c.number)}</span><small>${c.variant?`TCGplayer ${scannerEsc(c.variant)}`:'TCGplayer market'}</small></div><div class="mlVals"><span>Market <b>${market?mlMoney(market):'—'}</b></span><span>Recommended buy <b>${market?mlMoney(buy):'—'}</b></span><span>Recommended sale <b>${market?mlMoney(sale):'—'}</b></span></div><div class="mlQty"><label>Qty<input type="number" min="1" value="${q}" data-q="${i}"></label><button class="ghost mlRemove" data-r="${i}">Remove</button></div>`;rows.appendChild(div)});
  rows.querySelectorAll('[data-q]').forEach(x=>x.onchange=()=>mlQty(Number(x.dataset.q),x.value));rows.querySelectorAll('[data-r]').forEach(x=>x.onclick=()=>mlRemove(Number(x.dataset.r)));
  summary.innerHTML=`<div class="scanMetric"><span>Cards in list</span><b>${MANUAL_LIST.reduce((s,c)=>s+(Number(c.qty)||1),0)}</b></div><div class="scanMetric"><span>Total market value</span><b>${mlMoney(tm)}</b></div><div class="scanMetric"><span>Recommended purchase</span><b>${mlMoney(tb)}</b></div><div class="scanMetric"><span>Recommended sale</span><b>${mlMoney(ts)}</b></div>`;
}
function mlClear(){if(!MANUAL_LIST.length||confirm('Clear the entire card list?')){MANUAL_LIST=[];mlSave();mlRender()}}
function mlInit(){mlLoad();$('#manualSearchBtn')?.addEventListener('click',mlSearch);$('#manualCardSearch')?.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();mlSearch()}});$('#clearManualList')?.addEventListener('click',mlClear);mlRender()}
mlInit();
