// Interactive Marketplace Scanner extension.
// Uses TCGdex for off-watchlist identity/images/TCGPlayer USD market pricing.

const ONLINE_LOOKUP_VERSION='v2';
const onlineLookupCache=new Map();
let REVIEW_ROWS=[];
let REVIEW_ASK=NaN;
let REVIEW_CONDITION=.85;

function scannerEsc(s){return String(s??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]))}
function scannerNum(v){const n=Number(v);return Number.isFinite(n)?n:null}
function scannerLocalId(s){const m=String(s||'').match(/\b([A-Z]{0,4}\d{1,3}|TG\d{1,3}|GG\d{1,3})\s*\/\s*\d{1,3}\b/i);return m?m[1]:''}
function scannerCleanLine(line){return String(line||'').replace(/https?:\/\/\S+/g,' ').replace(/\$\s*[\d,.]+/g,' ').replace(/\b(?:nm|lp|mp|hp|dmg|mint|near mint|lightly played|moderately played|heavily played|pokemon|pokémon|tcg|card|cards|lot|obo|firm|each)\b/gi,' ').replace(/\b\d{1,4}\s*\/\s*\d{1,4}\b/g,' ').replace(/[^A-Za-z0-9'&.\- ]+/g,' ').replace(/\s+/g,' ').trim()}
function scannerLikelyLines(text){
  const lines=String(text||'').split(/\n+/).map(x=>x.trim()).filter(Boolean),out=[];
  for(const line of lines){
    if(line.length<3||line.length>100)continue;
    const cleaned=scannerCleanLine(line);if(cleaned.length<3)continue;
    const hasLetters=/[A-Za-z]{3}/.test(cleaned),hasCardish=/\b(?:ex|gx|vmax|vstar|v\b|mega|mew|charizard|pikachu|gengar|umbreon|eevee|rayquaza|lugia|greninja|mewtwo|dragonite|gardevoir|lucario)\b/i.test(cleaned),hasNum=/\d+\s*\/\s*\d+/.test(line);
    if(hasLetters&&(hasCardish||hasNum||cleaned.split(/\s+/).length<=5))out.push({raw:line,query:cleaned,localId:scannerLocalId(line)});
  }
  return [...new Map(out.map(x=>[x.query.toLowerCase(),x])).values()].slice(0,18);
}
function scannerAlreadyCovered(line,matches){const n=norm(line);return matches.some(m=>{const c=m.card||m;return n.includes(norm(c.card))||norm(c.card).includes(n)})}

async function tcgdexList(query,localIdHint=''){
  const key=`${query}|${localIdHint}`.toLowerCase();if(onlineLookupCache.has(key))return onlineLookupCache.get(key);
  const bases=[];if(localIdHint)bases.push(`https://api.tcgdex.net/v2/en/cards?name=${encodeURIComponent(query)}&localId=${encodeURIComponent(localIdHint)}`);bases.push(`https://api.tcgdex.net/v2/en/cards?name=${encodeURIComponent(query)}`);
  const tokens=query.split(/\s+/).filter(t=>t.length>1);if(tokens.length>1)bases.push(`https://api.tcgdex.net/v2/en/cards?name=${encodeURIComponent(tokens.slice(0,3).join(' '))}`);if(tokens.length)bases.push(`https://api.tcgdex.net/v2/en/cards?name=${encodeURIComponent(tokens[0])}`);
  let list=[];for(const url of bases){try{const r=await fetch(url,{cache:'no-store'});if(!r.ok)continue;const j=await r.json();if(Array.isArray(j)&&j.length){list=j;break}}catch{}}
  onlineLookupCache.set(key,list);return list;
}
async function tcgdexDetail(id){const key=`detail:${id}`;if(onlineLookupCache.has(key))return onlineLookupCache.get(key);try{const r=await fetch(`https://api.tcgdex.net/v2/en/cards/${encodeURIComponent(id)}`,{cache:'no-store'});if(!r.ok)return null;const j=await r.json();onlineLookupCache.set(key,j);return j}catch{return null}}
function onlineNameScore(card,lineObj){
  const q=norm(lineObj.query),name=norm(card.name||''),setName=norm(card.set?.name||'');let s=0;
  if(q===name)s+=180;else if(q.includes(name)&&name.length>=4)s+=130;else if(name.includes(q)&&q.length>=4)s+=110;
  const qw=words(lineObj.query).filter(w=>w.length>=3),nw=new Set(words(card.name));s+=qw.filter(w=>nw.has(w)).length*22;
  if(lineObj.localId&&norm(card.localId)===norm(lineObj.localId))s+=180;
  const raw=String(lineObj.raw).toLowerCase();for(const w of words(card.set?.name||'').filter(w=>w.length>3)){if(raw.includes(w))s+=12}if(setName&&q.includes(setName))s+=30;return s;
}
function scoreToConfidence(best,second,explicitNumber=false){
  if(!best)return 0;const gap=Math.max(0,best-(second||0));
  if(explicitNumber&&best>=250)return 99;if(best>=220&&gap>=70)return 97;if(best>=180&&gap>=50)return 94;if(best>=140&&gap>=35)return 89;if(best>=100)return 82;return 68;
}
function tcgplayerMarket(detail){
  const p=detail?.pricing?.tcgplayer;if(!p)return null;const preferred=['holofoil','normal','unlimited-holofoil','unlimited','reverse-holofoil','reverse'],c=[];
  for(const k of preferred){const v=p[k],m=scannerNum(v?.marketPrice);if(m&&m>0)c.push({variant:k,market:m,low:scannerNum(v?.lowPrice),mid:scannerNum(v?.midPrice)})}
  if(!c.length){for(const [k,v] of Object.entries(p)){if(!v||typeof v!=='object')continue;const m=scannerNum(v.marketPrice);if(m&&m>0&&!/1st/i.test(k))c.push({variant:k,market:m,low:scannerNum(v.lowPrice),mid:scannerNum(v.midPrice)})}}
  if(!c.length)return null;c.sort((a,b)=>a.market-b.market);return c[0];
}
function externalBuyPercent(market){if(market>=200)return .72;if(market>=75)return .70;if(market>=25)return .68;return .65}
async function externalCandidate(detail,score,lineObj){const price=tcgplayerMarket(detail),market=price?.market||0;return {type:'external',id:detail.id,name:detail.name,set:detail.set?.name||'',number:detail.localId||'',image:detail.image?`${detail.image}/low.webp`:'',market,resale:market?Math.round(market):0,baseBuy:market?Math.round(market*externalBuyPercent(market)):0,variant:price?.variant||'',source:'TCGdex / TCGPlayer',pricingAvailable:!!price,score,line:lineObj.raw}}
async function lookupExternalLine(lineObj){
  const list=await tcgdexList(lineObj.query,lineObj.localId);if(!list.length)return null;const scored=[];
  for(const brief of list.slice(0,20)){const d=await tcgdexDetail(brief.id);if(d)scored.push({detail:d,score:onlineNameScore(d,lineObj)})}
  scored.sort((a,b)=>b.score-a.score);if(!scored[0]||scored[0].score<60)return null;
  const candidates=[];for(const s of scored.slice(0,6))candidates.push(await externalCandidate(s.detail,s.score,lineObj));
  const confidence=scoreToConfidence(scored[0].score,scored[1]?.score,lineObj.localId!=='');return {primary:candidates[0],alternatives:candidates.slice(1),confidence,line:lineObj};
}
async function findExternalCards(text,watchlistMatches,statusEl){
  const lines=scannerLikelyLines(text).filter(x=>!scannerAlreadyCovered(x.query,watchlistMatches)),found=[],seen=new Set();
  for(let i=0;i<lines.length;i++){
    if(statusEl)statusEl.textContent=`Looking up off-watchlist cards ${i+1}/${lines.length}…`;
    const hit=await lookupExternalLine(lines[i]);if(!hit)continue;const key=hit.primary.id;if(seen.has(key))continue;seen.add(key);found.push(hit);
  }
  return found.slice(0,12);
}
function watchCandidate(c,score=0){return {type:'watch',id:`watch:${c.rank}:${c.number}`,name:c.card,set:c.set,number:c.number,image:c.image||'',market:Number(c.market||0),resale:Number(c.resale||0),baseBuy:Number(c.buy||0),source:'Watchlist',pricingAvailable:true,variant:'',score}}
function watchAlternatives(match,text){
  const ranked=DATA.map(c=>({c,score:candidateScore(c,text)})).sort((a,b)=>b.score-a.score).filter(x=>x.c!==match.card).slice(0,6);return ranked.map(x=>watchCandidate(x.c,x.score));
}
function buildReviewRows(watchMatches,externalHits,text){
  const rows=[];
  for(const m of watchMatches){
    const primary=watchCandidate(m.card,m.score||0),alts=watchAlternatives(m,text);const second=alts[0]?.score||0;const confidence=m.ambiguous?Math.min(89,scoreToConfidence(m.score||100,second,false)):scoreToConfidence(m.score||180,second,norm(text).includes(norm(localId(m.card.number))));
    rows.push({key:`w:${rows.length}`,selected:primary,alternatives:alts,confidence:Math.min(99,Math.max(55,confidence)),confirmed:false,rejected:false,origin:'watch'});
  }
  for(const h of externalHits)rows.push({key:`e:${rows.length}`,selected:h.primary,alternatives:h.alternatives,confidence:h.confidence,confirmed:false,rejected:false,origin:'external'});
  return rows;
}
function adjustedBuy(row){return row.rejected?0:Math.round(Number(row.selected.baseBuy||0)*REVIEW_CONDITION)}
function reviewTotals(){const active=REVIEW_ROWS.filter(r=>!r.rejected);return {active,totalMarket:active.reduce((s,r)=>s+Number(r.selected.market||0),0),totalResale:active.reduce((s,r)=>s+Number(r.selected.resale||0),0),totalMax:active.reduce((s,r)=>s+adjustedBuy(r),0)}}
function renderAlternativePicker(row,index){
  if(row.confidence>=95&&row.confirmed)return '';
  const options=[row.selected,...row.alternatives].filter((x,i,a)=>a.findIndex(y=>y.id===x.id)===i).slice(0,7);
  if(row.confidence>=95&&!row.rejected)return '';
  return `<div class="candidatePanel"><div class="candidateTitle">${row.rejected?'Choose the correct card':'Confidence below 95% — choose the correct card if needed'}</div><div class="candidateGrid">${options.map((o,j)=>`<button class="candidate ${o.id===row.selected.id&&!row.rejected?'selected':''}" data-row="${index}" data-candidate="${scannerEsc(o.id)}"><span class="candidateImg">${validImage(o.image)?`<img src="${scannerEsc(o.image)}" alt="">`:'?'}</span><span><b>${scannerEsc(o.name)}</b><small>${scannerEsc(o.set)} · ${scannerEsc(o.number)}</small><small>${o.market?money(o.market):'Price unavailable'}</small></span></button>`).join('')}</div><div class="manualSearch"><input type="text" data-manual-row="${index}" placeholder="Search another card by name or collector number"><button class="ghost manualSearchBtn" data-row="${index}">Search online</button></div></div>`;
}
function renderReviewResults(){
  const results=$('#scanResults'),summary=$('#scanSummary');if(!results||!summary)return;const {active,totalMarket,totalResale,totalMax}=reviewTotals();const deal=getDeal(REVIEW_ASK,totalMax),profit=Number.isFinite(REVIEW_ASK)&&REVIEW_ASK>0?totalResale-REVIEW_ASK:null,roc=profit!==null&&REVIEW_ASK>0?profit/REVIEW_ASK:null;
  summary.hidden=false;summary.innerHTML=`<div class="scanMetric"><span>Cards accepted</span><b>${active.length}</b></div><div class="scanMetric"><span>Est. market value</span><b>${money(totalMarket)}</b></div><div class="scanMetric"><span>Maximum offer</span><b>${money(totalMax)}</b></div><div class="scanMetric"><span>Ask / est. profit</span><b>${Number.isFinite(REVIEW_ASK)&&REVIEW_ASK>0?`${money(REVIEW_ASK)} / ${money(profit)}`:'No ask found'}</b></div><div class="scanMetric"><span>Recommendation</span><b><span class="dealBadge ${deal.cls}">${deal.label}</span></b>${roc!==null?`<small>${Math.round(roc*100)}% est. return</small>`:''}</div>`;
  results.innerHTML='';
  REVIEW_ROWS.forEach((row,index)=>{
    const r=row.selected,article=document.createElement('article');article.className=`scanCard reviewCard${row.rejected?' rejected':''}`;const badge=r.type==='external'?'<span class="externalBadge">ONLINE LOOKUP</span>':'<span class="watchBadge">WATCHLIST</span>';const confidenceClass=row.confidence>=95?'confHigh':row.confidence>=80?'confMed':'confLow';
    article.innerHTML=`${validImage(r.image)?`<img class="scanThumb" src="${scannerEsc(r.image)}" alt="${scannerEsc(r.name)}">`:'<div class="scanThumb"></div>'}<div><h3>${scannerEsc(r.name)} ${badge}</h3><div class="scanMeta">${scannerEsc(r.set)} · ${scannerEsc(r.number)}</div><div class="scanNumbers"><span>Market <b>${r.market?money(r.market):'—'}</b></span><span>Target resale <b>${r.resale?money(r.resale):'—'}</b></span><span>Source <b>${scannerEsc(r.source)}</b></span></div><div class="matchControls"><button class="confirmBtn ${row.confirmed?'active':''}" data-row="${index}">✓ Correct</button><button class="wrongBtn ${row.rejected?'active':''}" data-row="${index}">✕ Wrong card</button><span class="confidencePct ${confidenceClass}">${row.confidence}% confidence</span></div>${renderAlternativePicker(row,index)}</div><div class="scanRight"><div>Adjusted max buy</div><div class="maxBuy">${row.rejected?'Excluded':(adjustedBuy(row)?money(adjustedBuy(row)):'Manual review')}</div><div class="confidence">${row.confirmed?'Confirmed by you':row.rejected?'Needs replacement':'Review match before buying'}</div></div>`;results.appendChild(article);
  });
  bindReviewControls();
}
function findCandidate(row,id){return [row.selected,...row.alternatives].find(c=>c.id===id)}
function bindReviewControls(){
  document.querySelectorAll('.confirmBtn').forEach(b=>b.onclick=()=>{const r=REVIEW_ROWS[Number(b.dataset.row)];r.confirmed=true;r.rejected=false;r.confidence=100;renderReviewResults()});
  document.querySelectorAll('.wrongBtn').forEach(b=>b.onclick=()=>{const r=REVIEW_ROWS[Number(b.dataset.row)];r.confirmed=false;r.rejected=true;r.confidence=Math.min(r.confidence,70);renderReviewResults()});
  document.querySelectorAll('.candidate').forEach(b=>b.onclick=()=>{const i=Number(b.dataset.row),row=REVIEW_ROWS[i],c=findCandidate(row,b.dataset.candidate);if(!c)return;row.selected=c;row.rejected=false;row.confirmed=true;row.confidence=100;renderReviewResults()});
  document.querySelectorAll('.manualSearchBtn').forEach(b=>b.onclick=async()=>{const i=Number(b.dataset.row),input=document.querySelector(`[data-manual-row="${i}"]`),q=input?.value?.trim();if(!q)return;b.disabled=true;b.textContent='Searching…';try{const hit=await lookupExternalLine({raw:q,query:q,localId:scannerLocalId(q)});if(hit){const row=REVIEW_ROWS[i];row.alternatives=[hit.primary,...hit.alternatives,...row.alternatives].filter((x,j,a)=>a.findIndex(y=>y.id===x.id)===j);row.rejected=true;row.confirmed=false;row.confidence=Math.min(85,hit.confidence);renderReviewResults()}}finally{b.disabled=false;b.textContent='Search online'}});
}

async function enhancedScanListing(){
  const btn=$('#scanBtn'),status=$('#scanStatus');if(!btn)return;btn.disabled=true;btn.textContent='Scanning…';if(status)status.textContent='Preparing listing…';
  try{
    const pasted=$('#listingText')?.value||'',ocr=await ocrFiles(SCAN_FILES),combined=`${pasted}\n${ocr}`.trim();if(!combined){if(status)status.textContent='Add listing text or screenshots first.';return}
    if(ocr&&$('#listingText')&&!pasted)$('#listingText').value=ocr.trim();const watchMatches=detectCards(combined);let ask=Number($('#askingPrice')?.value);if(!Number.isFinite(ask)||ask<=0){ask=extractPrice(combined)||NaN;if(Number.isFinite(ask)&&$('#askingPrice'))$('#askingPrice').value=ask}
    REVIEW_ASK=ask;REVIEW_CONDITION=Number($('#condition')?.value)||.85;const external=await findExternalCards(combined,watchMatches,status);REVIEW_ROWS=buildReviewRows(watchMatches,external,combined);renderReviewResults();
    const url=$('#listingUrl')?.value?.trim(),open=$('#openListing');if(open){if(url){open.href=url;open.hidden=false}else open.hidden=true}
    const low=REVIEW_ROWS.filter(r=>r.confidence<95).length;if(status)status.textContent=`Scan complete: ${REVIEW_ROWS.length} candidate card${REVIEW_ROWS.length===1?'':'s'}. ${low} need${low===1?'s':''} confirmation below 95% confidence.`;
  }catch(err){console.error(err);if(status)status.textContent=`Scan failed: ${err.message||'Unable to analyze listing.'}`}
  finally{btn.disabled=false;btn.textContent='Scan listing'}
}
function installEnhancedScanner(){
  const old=$('#scanBtn');if(!old)return;const fresh=old.cloneNode(true);old.replaceWith(fresh);fresh.addEventListener('click',enhancedScanListing);
  const policy=document.querySelector('.policyPanel');if(policy&&!policy.querySelector('.onlineLookupNote')){const p=document.createElement('p');p.className='finePrint onlineLookupNote';p.innerHTML='<b>Interactive verification:</b> every match can be marked correct or wrong. Matches below 95% confidence automatically show alternative cards; choosing one immediately recalculates the lot offer.';policy.appendChild(p)}
}
installEnhancedScanner();