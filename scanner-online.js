// External card lookup extension for Marketplace Scanner.
// Uses TCGdex for card identity, images, and TCGPlayer USD market pricing.

const ONLINE_LOOKUP_VERSION='v1';
const onlineLookupCache=new Map();

function scannerEsc(s){return String(s??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]))}
function scannerNum(v){const n=Number(v);return Number.isFinite(n)?n:null}
function scannerLocalId(s){const m=String(s||'').match(/\b([A-Z]{0,4}\d{1,3}|TG\d{1,3}|GG\d{1,3})\s*\/\s*\d{1,3}\b/i);return m?m[1]:''}
function scannerCleanLine(line){return String(line||'').replace(/https?:\/\/\S+/g,' ').replace(/\$\s*[\d,.]+/g,' ').replace(/\b(?:nm|lp|mp|hp|dmg|mint|near mint|lightly played|moderately played|heavily played|pokemon|pokémon|tcg|card|cards|lot|obo|firm|each)\b/gi,' ').replace(/\b\d{1,4}\s*\/\s*\d{1,4}\b/g,' ').replace(/[^A-Za-z0-9'&.\- ]+/g,' ').replace(/\s+/g,' ').trim()}
function scannerLikelyLines(text){
  const lines=String(text||'').split(/\n+/).map(x=>x.trim()).filter(Boolean);
  const out=[];
  for(const line of lines){
    if(line.length<3||line.length>100)continue;
    const cleaned=scannerCleanLine(line);
    if(cleaned.length<3)continue;
    const hasLetters=/[A-Za-z]{3}/.test(cleaned),hasCardish=/\b(?:ex|gx|vmax|vstar|v\b|mega|mew|charizard|pikachu|gengar|umbreon|eevee|rayquaza|lugia|greninja|mewtwo|dragonite|gardevoir|lucario)\b/i.test(cleaned),hasNum=/\d+\s*\/\s*\d+/.test(line);
    if(hasLetters&&(hasCardish||hasNum||cleaned.split(/\s+/).length<=5))out.push({raw:line,query:cleaned,localId:scannerLocalId(line)});
  }
  return [...new Map(out.map(x=>[x.query.toLowerCase(),x])).values()].slice(0,18);
}
function scannerAlreadyCovered(line,matches){
  const n=norm(line);
  return matches.some(m=>{const c=m.card||m;return n.includes(norm(c.card))||norm(c.card).includes(n)});
}
function scannerWatchlistNameSet(){return new Set((DATA||[]).map(c=>norm(c.card)))}

async function tcgdexList(query,localIdHint=''){
  const key=`${query}|${localIdHint}`.toLowerCase();
  if(onlineLookupCache.has(key))return onlineLookupCache.get(key);
  const bases=[];
  if(localIdHint)bases.push(`https://api.tcgdex.net/v2/en/cards?name=${encodeURIComponent(query)}&localId=${encodeURIComponent(localIdHint)}`);
  bases.push(`https://api.tcgdex.net/v2/en/cards?name=${encodeURIComponent(query)}`);
  const tokens=query.split(/\s+/).filter(t=>t.length>1);
  if(tokens.length>1)bases.push(`https://api.tcgdex.net/v2/en/cards?name=${encodeURIComponent(tokens.slice(0,Math.min(3,tokens.length)).join(' '))}`);
  if(tokens.length)bases.push(`https://api.tcgdex.net/v2/en/cards?name=${encodeURIComponent(tokens[0])}`);
  let list=[];
  for(const url of bases){
    try{const r=await fetch(url,{cache:'no-store'});if(!r.ok)continue;const j=await r.json();if(Array.isArray(j)&&j.length){list=j;break}}catch{}
  }
  onlineLookupCache.set(key,list);
  return list;
}
async function tcgdexDetail(id){
  const key=`detail:${id}`;if(onlineLookupCache.has(key))return onlineLookupCache.get(key);
  try{const r=await fetch(`https://api.tcgdex.net/v2/en/cards/${encodeURIComponent(id)}`,{cache:'no-store'});if(!r.ok)return null;const j=await r.json();onlineLookupCache.set(key,j);return j}catch{return null}
}
function onlineNameScore(card,lineObj){
  const q=norm(lineObj.query),name=norm(card.name||''),setName=norm(card.set?.name||'');let s=0;
  if(q===name)s+=180;else if(q.includes(name)&&name.length>=4)s+=130;else if(name.includes(q)&&q.length>=4)s+=110;
  const qw=words(lineObj.query).filter(w=>w.length>=3),nw=new Set(words(card.name));s+=qw.filter(w=>nw.has(w)).length*22;
  if(lineObj.localId&&norm(card.localId)===norm(lineObj.localId))s+=180;
  const raw=String(lineObj.raw).toLowerCase();for(const w of words(card.set?.name||'').filter(w=>w.length>3)){if(raw.includes(w))s+=12}
  if(setName&&q.includes(setName))s+=30;
  return s;
}
function tcgplayerMarket(detail){
  const p=detail?.pricing?.tcgplayer;if(!p)return null;
  const preferred=['holofoil','normal','unlimited-holofoil','unlimited','reverse-holofoil','reverse'];
  const candidates=[];
  for(const k of preferred){const v=p[k];const m=scannerNum(v?.marketPrice);if(m&&m>0)candidates.push({variant:k,market:m,low:scannerNum(v?.lowPrice),mid:scannerNum(v?.midPrice)})}
  if(!candidates.length){for(const [k,v] of Object.entries(p)){if(!v||typeof v!=='object')continue;const m=scannerNum(v.marketPrice);if(m&&m>0&&!/1st/i.test(k))candidates.push({variant:k,market:m,low:scannerNum(v.lowPrice),mid:scannerNum(v.midPrice)})}}
  if(!candidates.length)return null;
  // Conservative: use the lowest credible non-1st-edition market price when several finishes are present.
  candidates.sort((a,b)=>a.market-b.market);return candidates[0];
}
function externalBuyPercent(market){if(market>=200)return .72;if(market>=75)return .70;if(market>=25)return .68;return .65}
async function lookupExternalLine(lineObj){
  const list=await tcgdexList(lineObj.query,lineObj.localId);if(!list.length)return null;
  const details=[];
  for(const brief of list.slice(0,16)){const d=await tcgdexDetail(brief.id);if(d)details.push({detail:d,score:onlineNameScore(d,lineObj)})}
  details.sort((a,b)=>b.score-a.score);const best=details[0];if(!best||best.score<60)return null;
  const second=details[1];const ambiguous=!!second&&(best.score-second.score<28);
  const price=tcgplayerMarket(best.detail);
  const image=best.detail.image?`${best.detail.image}/low.webp`:'';
  return {source:'TCGdex / TCGPlayer',detail:best.detail,score:best.score,ambiguous,price,image,line:lineObj.raw};
}
async function findExternalCards(text,watchlistMatches,statusEl){
  const watchNames=scannerWatchlistNameSet();const lines=scannerLikelyLines(text).filter(x=>!scannerAlreadyCovered(x.query,watchlistMatches));const found=[];const seen=new Set();
  for(let i=0;i<lines.length;i++){
    if(statusEl)statusEl.textContent=`Looking up off-watchlist cards ${i+1}/${lines.length}…`;
    const hit=await lookupExternalLine(lines[i]);if(!hit)continue;
    const d=hit.detail,key=`${d.id}`;if(seen.has(key))continue;
    // If this exact Pokémon name is already represented by a watchlist match, don't duplicate it unless collector number is explicit.
    if(watchNames.has(norm(d.name))&&!lines[i].localId)continue;
    seen.add(key);found.push(hit);
  }
  return found.slice(0,12);
}
function externalRows(ext,conditionMultiplier){
  return ext.map(x=>{const market=x.price?.market||0;const buyPct=externalBuyPercent(market);const maxBuy=Math.round(market*buyPct*conditionMultiplier);const resale=Math.round(market);return {...x,market,buyPct,maxBuy,resale}})
}
function renderCombinedScanResults(watchMatches,external,ask,conditionMultiplier){
  const results=$('#scanResults'),summary=$('#scanSummary');if(!results||!summary)return;
  const wrows=watchMatches.map(m=>{const c=m.card;return {type:'watch',name:c.card,set:c.set,number:c.number,image:c.image,market:Number(c.market||0),resale:Number(c.resale||0),maxBuy:Math.round(Number(c.buy||0)*conditionMultiplier),ambiguous:m.ambiguous,confidence:m.confidence,source:'Watchlist'}});
  const erows=externalRows(external,conditionMultiplier).map(x=>({type:'external',name:x.detail.name,set:x.detail.set?.name||'',number:x.detail.localId||'',image:x.image,market:x.market,resale:x.resale,maxBuy:x.maxBuy,ambiguous:x.ambiguous,confidence:x.ambiguous?'Medium':'High',source:x.source,variant:x.price?.variant||'',pricingAvailable:!!x.price}));
  const all=[...wrows,...erows];results.innerHTML='';
  if(!all.length){summary.hidden=true;results.innerHTML='<div class="empty">No cards were confidently identified. Try clearer screenshots, paste the seller description, or include card/set numbers.</div>';return}
  const totalMax=all.reduce((s,r)=>s+(r.maxBuy||0),0),totalMarket=all.reduce((s,r)=>s+(r.market||0),0),totalResale=all.reduce((s,r)=>s+(r.resale||0),0);const deal=getDeal(ask,totalMax);const profit=Number.isFinite(ask)&&ask>0?totalResale-ask:null;const roc=profit!==null&&ask>0?profit/ask:null;
  summary.hidden=false;summary.innerHTML=`<div class="scanMetric"><span>Cards identified</span><b>${all.length}</b><small>${erows.length} online lookup${erows.length===1?'':'s'}</small></div><div class="scanMetric"><span>Est. market value</span><b>${money(totalMarket)}</b></div><div class="scanMetric"><span>Maximum offer</span><b>${money(totalMax)}</b></div><div class="scanMetric"><span>Ask / est. profit</span><b>${Number.isFinite(ask)&&ask>0?`${money(ask)} / ${money(profit)}`:'No ask found'}</b></div><div class="scanMetric"><span>Recommendation</span><b><span class="dealBadge ${deal.cls}">${deal.label}</span></b>${roc!==null?`<small>${Math.round(roc*100)}% est. return</small>`:''}</div>`;
  for(const r of all){const article=document.createElement('article');article.className='scanCard';const img=validImage(r.image)?r.image:'';const sourceBadge=r.type==='external'?'<span class="externalBadge">ONLINE LOOKUP</span>':'';const pricingNote=r.type==='external'&&!r.pricingAvailable?' · pricing unavailable':'';article.innerHTML=`${img?`<img class="scanThumb" src="${scannerEsc(img)}" alt="${scannerEsc(r.name)}">`:'<div class="scanThumb"></div>'}<div><h3>${scannerEsc(r.name)} ${sourceBadge}</h3><div class="scanMeta">${scannerEsc(r.set)} · ${scannerEsc(r.number)}${r.ambiguous?' <span class="ambiguous">· verify variant</span>':''}${pricingNote}</div><div class="scanNumbers"><span>Market <b>${r.market?money(r.market):'—'}</b></span><span>Target resale <b>${r.resale?money(r.resale):'—'}</b></span><span>Source <b>${scannerEsc(r.source)}</b></span></div></div><div class="scanRight"><div>Adjusted max buy</div><div class="maxBuy">${r.maxBuy?money(r.maxBuy):'Manual review'}</div><div class="confidence">Match confidence: ${scannerEsc(r.confidence)}${r.variant?` · ${scannerEsc(r.variant)}`:''}</div></div>`;results.appendChild(article)}
}

async function enhancedScanListing(){
  const btn=$('#scanBtn'),status=$('#scanStatus');if(!btn)return;btn.disabled=true;btn.textContent='Scanning…';if(status)status.textContent='Preparing listing…';
  try{
    const pasted=$('#listingText')?.value||'';const ocr=await ocrFiles(SCAN_FILES);const combined=`${pasted}\n${ocr}`.trim();
    if(!combined){if(status)status.textContent='Add listing text or screenshots first.';return}
    if(ocr&&$('#listingText')&&!pasted)$('#listingText').value=ocr.trim();
    const watchMatches=detectCards(combined);let ask=Number($('#askingPrice')?.value);if(!Number.isFinite(ask)||ask<=0){ask=extractPrice(combined)||NaN;if(Number.isFinite(ask)&&$('#askingPrice'))$('#askingPrice').value=ask}
    const cond=Number($('#condition')?.value)||.85;const external=await findExternalCards(combined,watchMatches,status);
    renderCombinedScanResults(watchMatches,external,ask,cond);
    const url=$('#listingUrl')?.value?.trim();const open=$('#openListing');if(open){if(url){open.href=url;open.hidden=false}else open.hidden=true}
    if(status)status.textContent=`Scan complete: ${watchMatches.length} watchlist match${watchMatches.length===1?'':'es'} + ${external.length} online lookup${external.length===1?'':'s'}. Verify card variant and condition before buying.`;
  }catch(err){console.error(err);if(status)status.textContent=`Scan failed: ${err.message||'Unable to analyze listing.'}`}
  finally{btn.disabled=false;btn.textContent='Scan listing'}
}

function installEnhancedScanner(){
  const old=$('#scanBtn');if(!old)return;const fresh=old.cloneNode(true);old.replaceWith(fresh);fresh.addEventListener('click',enhancedScanListing);
  const policy=document.querySelector('.policyPanel');if(policy&&!policy.querySelector('.onlineLookupNote')){const p=document.createElement('p');p.className='finePrint onlineLookupNote';p.innerHTML='<b>Online lookup:</b> cards not in the watchlist are searched in TCGdex. TCGPlayer USD market pricing is used when available; ambiguous variants or missing prices are flagged for manual review.';policy.appendChild(p)}
}

installEnhancedScanner();
