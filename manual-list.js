const MANUAL_LIST_KEY='pokemonManualCardListV1';
const MANUAL_HIDDEN_KEY='pokemonManualHiddenRecommendationsV1';
let MANUAL_LIST=[];
let MANUAL_SEARCH=[];
let MANUAL_HIDDEN=new Set();
let LAST_QUERY='';
let RESEARCH_LEVEL=0;

function mlEsc(s){return String(s??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]))}
function mlMoney(n){return new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(Number(n)||0)}
function mlLoad(){
  try{MANUAL_LIST=JSON.parse(localStorage.getItem(MANUAL_LIST_KEY)||'[]')||[]}catch{MANUAL_LIST=[]}
  try{MANUAL_HIDDEN=new Set(JSON.parse(localStorage.getItem(MANUAL_HIDDEN_KEY)||'[]')||[])}catch{MANUAL_HIDDEN=new Set()}
}
function mlSave(){try{localStorage.setItem(MANUAL_LIST_KEY,JSON.stringify(MANUAL_LIST))}catch{}}
function mlSaveHidden(){try{localStorage.setItem(MANUAL_HIDDEN_KEY,JSON.stringify([...MANUAL_HIDDEN]))}catch{}}
function mlBuyPct(m){m=Number(m)||0;if(m>=200)return .72;if(m>=75)return .70;if(m>=25)return .68;return .65}
function mlDemandTier(card){
  const n=String(card?.name||'').toLowerCase();
  const high=['charizard','pikachu','umbreon','gengar','mew','mewtwo','rayquaza','lugia','greninja','eevee','sylveon','dragonite','giratina'];
  const medium=['gardevoir','lucario','espeon','leafeon','glaceon','vaporeon','jolteon','flareon','blastoise','venusaur','snorlax','gyarados','magikarp','garchomp','darkrai'];
  if(high.some(x=>n.includes(x)))return 'high';
  if(medium.some(x=>n.includes(x)))return 'medium';
  return 'standard';
}
function mlSaleTargets(card){
  const market=Number(card?.market)||0,tier=mlDemandTier(card);
  let fastPct=tier==='high'?.95:tier==='medium'?.93:.90;
  let listPct=tier==='high'?1.02:tier==='medium'?1.00:.98;
  if(market>=200){fastPct-=.01;listPct-=.02}else if(market>=75){fastPct-=.005;listPct-=.01}else if(market>0&&market<25&&tier==='high'){listPct+=.01}
  fastPct=Math.max(.88,Math.min(.96,fastPct));
  listPct=Math.max(.96,Math.min(1.03,listPct));
  const fast=market*fastPct,list=market*listPct,net=list*.87;
  return {tier,fastPct,listPct,fast,list,net};
}
window.cardSaleTargets=mlSaleTargets;
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
function mlParseQuery(q){
  const raw=String(q||'').trim();
  const match=raw.match(/\\b([A-Z]{0,4}\\d{1,4})\\s*\\/\\s*(\\d{1,4})\\b/i);
  const name=raw.replace(/\\b[A-Z]{0,4}\\d{1,4}\\s*\\/\\s*\\d{1,4}\\b/ig,' ').replace(/\\s+/g,' ').trim();
  return {name:name||raw,number:match?match[1].toUpperCase():'',total:match?Number(match[2]):null};
}
function mlScore(d,q){
  const parsed=mlParseQuery(q),nq=norm(parsed.name),nn=norm(d.name||'');
  let score=0;
  if(nq===nn)score+=200;
  else if(nn.includes(nq)||nq.includes(nn))score+=80;
  else score-=150;
  if(parsed.number){
    if(norm(parsed.number)===norm(d.localId||''))score+=350;
    else score-=350;
    const total=Number(d.set?.cardCount?.official);
    if(Number.isFinite(total)&&total>0){
      if(total===parsed.total)score+=500;
      else score-=500;
    }
  }
  for(const w of words(d.set?.name||'').filter(x=>x.length>3)){
    if(parsed.name.toLowerCase().includes(w))score+=12;
  }
  return score;
}
function mlQueries(q,level=0){
  const parsed=mlParseQuery(q);
  const out=[parsed.name];
  if(level>0){
    const tokens=parsed.name.split(/\\s+/).filter(Boolean);
    if(tokens.length>1)out.push(tokens.slice(0,Math.min(3,tokens.length)).join(' '));
    if(tokens.length)out.push(tokens[0]);
  }
  return [...new Set(out.filter(Boolean))];
}
async function mlCollect(q,level=0){
  const ids=new Set(),briefs=[];
  for(const query of mlQueries(q,level)){
    try{
      const list=await mlList(query);
      for(const b of list){if(!b?.id||ids.has(b.id))continue;ids.add(b.id);briefs.push(b)}
    }catch{}
  }
  const parsed=mlParseQuery(q);
  // Narrow by printed card number before detail requests, without guessing set IDs.
  const candidates=parsed.number
    ?briefs.filter(b=>norm(b.localId||'')===norm(parsed.number))
    :briefs;
  const limit=level>0?120:80,scored=[];
  for(const brief of candidates.slice(0,limit)){
    try{
      const d=await mlDetail(brief.id);
      if(parsed.number){
        const total=Number(d.set?.cardCount?.official);
        if(norm(d.localId||'')!==norm(parsed.number))continue;
        if(total>0&&total!==parsed.total)continue;
      }
      scored.push({detail:d,score:mlScore(d,q)});
    }catch{}
  }
  scored.sort((a,b)=>b.score-a.score);
  return scored;
}
function mlCardFromScored(x){const p=mlTcgPrice(x.detail);return {id:x.detail.id,name:x.detail.name,set:x.detail.set?.name||'',number:x.detail.localId||'',image:x.detail.image?`${x.detail.image}/low.webp`:'',market:Number(p?.market||0),variant:p?.variant||'',score:x.score}}
function mlRenderSearch(){
  const box=$('#manualSearchResults'),status=$('#manualSearchStatus');if(!box)return;
  const visible=MANUAL_SEARCH.filter(c=>!MANUAL_HIDDEN.has(c.id));
  if(status)status.textContent=visible.length?`Showing ${visible.length} version${visible.length===1?'':'s'}${RESEARCH_LEVEL?' after broader research':''}. Remove any versions you do not want to see again.`:'No visible recommendations. Use Research more versions to broaden the search.';
  box.innerHTML=visible.map(c=>`<div class="mlResult" data-id="${mlEsc(c.id)}">${c.image?`<img src="${mlEsc(c.image)}" alt="">`:'<span class="mlNoImg">?</span>'}<span><b>${mlEsc(c.name)}</b><small>${mlEsc(c.set)} · ${mlEsc(c.number)}</small><small>${c.market?`Market ${mlMoney(c.market)}`:'Market unavailable'}</small></span><span class="mlResultActions"><button class="mlAddBtn" data-add-id="${mlEsc(c.id)}">Add</button><button class="mlHideBtn" data-hide-id="${mlEsc(c.id)}">Remove recommendation</button></span></div>`).join('');
  box.querySelectorAll('[data-add-id]').forEach(b=>b.onclick=e=>{e.stopPropagation();mlAddById(b.dataset.addId)});
  box.querySelectorAll('[data-hide-id]').forEach(b=>b.onclick=e=>{e.stopPropagation();mlHideRecommendation(b.dataset.hideId)});
}
async function mlSearch(research=false){
  const q=$('#manualCardSearch')?.value?.trim(),btn=$('#manualSearchBtn'),more=$('#researchMoreBtn'),status=$('#manualSearchStatus');if(!q)return;
  if(!research||q!==LAST_QUERY){LAST_QUERY=q;RESEARCH_LEVEL=0;MANUAL_SEARCH=[]}else RESEARCH_LEVEL+=1;
  const active=research?more:btn;if(active){active.disabled=true;active.textContent=research?'Researching…':'Searching…'};if(status)status.textContent=research?'Researching additional printings and versions…':'Searching online card database…';
  try{
    const scored=await mlCollect(q,RESEARCH_LEVEL);
    const merged=new Map(MANUAL_SEARCH.map(c=>[c.id,c]));
    for(const x of scored){const c=mlCardFromScored(x);if(!merged.has(c.id)||c.score>(merged.get(c.id).score||0))merged.set(c.id,c)}
    MANUAL_SEARCH=[...merged.values()].sort((a,b)=>(b.score||0)-(a.score||0)).slice(0,RESEARCH_LEVEL?60:16);
    mlRenderSearch();
  }catch(err){if(status)status.textContent=err.message||'Search failed.'}
  finally{if(btn){btn.disabled=false;btn.textContent='Search cards'}if(more){more.disabled=false;more.textContent='Research more versions'}}
}
function mlHideRecommendation(id){if(!id)return;MANUAL_HIDDEN.add(id);mlSaveHidden();mlRenderSearch()}
function mlRestoreHidden(){MANUAL_HIDDEN.clear();mlSaveHidden();mlRenderSearch()}
function mlAddById(id){const c=MANUAL_SEARCH.find(x=>x.id===id);if(!c)return;const existing=MANUAL_LIST.find(x=>x.id===c.id);if(existing)existing.qty+=1;else MANUAL_LIST.push({...c,qty:1});mlSave();mlRender()}
function mlRemove(i){MANUAL_LIST.splice(i,1);mlSave();mlRender()}
function mlQty(i,v){const q=Math.max(1,Number(v)||1);MANUAL_LIST[i].qty=q;mlSave();mlRender()}
function mlAddInventory(i){const c=MANUAL_LIST[i];if(!c)return;if(typeof window.inventoryAddCard==='function')window.inventoryAddCard(c,Number(c.qty)||1)}
function mlRender(){
  const rows=$('#manualListRows'),summary=$('#manualListSummary');if(!rows||!summary)return;
  let tm=0,tb=0,tf=0,tl=0,tn=0;rows.innerHTML='';
  MANUAL_LIST.forEach((c,i)=>{const q=Number(c.qty)||1,market=Number(c.market)||0,buy=market*mlBuyPct(market),t=mlSaleTargets(c);tm+=market*q;tb+=buy*q;tf+=t.fast*q;tl+=t.list*q;tn+=t.net*q;const div=document.createElement('div');div.className='mlRow';div.innerHTML=`${c.image?`<img src="${mlEsc(c.image)}" alt="${mlEsc(c.name)}">`:'<div class="mlNoImg"></div>'}<div class="mlInfo"><b>${mlEsc(c.name)}</b><span>${mlEsc(c.set)} · ${mlEsc(c.number)}</span><small>${c.variant?`TCGplayer ${mlEsc(c.variant)}`:'TCGplayer market'} · ${mlEsc(t.tier)} demand heuristic</small></div><div class="mlVals"><span>Market <b>${market?mlMoney(market):'—'}</b></span><span>Recommended buy <b>${market?mlMoney(buy):'—'}</b></span><span>Fast sale <b>${market?mlMoney(t.fast):'—'}</b></span><span>Recommended list <b>${market?mlMoney(t.list):'—'}</b></span><span>Est. online net <b>${market?mlMoney(t.net):'—'}</b></span></div><div class="mlQty"><label>Qty<input type="number" min="1" value="${q}" data-q="${i}"></label><button class="primary mlInventory" data-inv="${i}">Add to inventory</button><button class="ghost mlRemove" data-r="${i}">Remove</button></div>`;rows.appendChild(div)});
  rows.querySelectorAll('[data-q]').forEach(x=>x.onchange=()=>mlQty(Number(x.dataset.q),x.value));
  rows.querySelectorAll('[data-inv]').forEach(x=>x.onclick=()=>mlAddInventory(Number(x.dataset.inv)));
  rows.querySelectorAll('[data-r]').forEach(x=>x.onclick=()=>mlRemove(Number(x.dataset.r)));
  summary.innerHTML=`<div class="scanMetric"><span>Cards in list</span><b>${MANUAL_LIST.reduce((s,c)=>s+(Number(c.qty)||1),0)}</b></div><div class="scanMetric"><span>Total market value</span><b>${mlMoney(tm)}</b></div><div class="scanMetric"><span>Recommended purchase</span><b>${mlMoney(tb)}</b></div><div class="scanMetric"><span>Fast sale total</span><b>${mlMoney(tf)}</b></div><div class="scanMetric"><span>Recommended list total</span><b>${mlMoney(tl)}</b></div><div class="scanMetric"><span>Est. online net</span><b>${mlMoney(tn)}</b></div>`;
}
function mlClear(){if(!MANUAL_LIST.length||confirm('Clear the entire card list?')){MANUAL_LIST=[];mlSave();mlRender()}}
function mlInit(){
  mlLoad();
  $('#manualSearchBtn')?.addEventListener('click',()=>mlSearch(false));
  $('#researchMoreBtn')?.addEventListener('click',()=>mlSearch(true));
  $('#restoreHiddenBtn')?.addEventListener('click',mlRestoreHidden);
  $('#manualCardSearch')?.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();mlSearch(false)}});
  $('#clearManualList')?.addEventListener('click',mlClear);
  mlRender();
}
mlInit();
