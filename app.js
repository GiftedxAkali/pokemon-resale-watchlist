const $=s=>document.querySelector(s);
const money=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(Number(n)||0);
const pct=n=>`${Math.round((Number(n)||0)*100)}%`;
let DATA=[];
let STATE={price:'all'};
let imageCache={};
let SCAN_FILES=[];
let imageRenderGeneration=0;
const displayedImageUrls=new Map();
const IMAGE_CACHE_KEY='pokemonImageFallbackCacheV2';

function safeGet(k){try{return localStorage.getItem(k)}catch{return null}}
function safeSet(k,v){try{localStorage.setItem(k,v)}catch{}}
function safeRemove(k){try{localStorage.removeItem(k)}catch{}}
try{imageCache=JSON.parse(safeGet(IMAGE_CACHE_KEY)||'{}')||{}}catch{imageCache={};safeRemove(IMAGE_CACHE_KEY)}


const IMAGE_OVERRIDE_DB='pokemon-watchlist-images-v1';
let overrideDBPromise=null;
function overrideDB(){
  if(!('indexedDB' in window))return Promise.reject(new Error('This browser cannot save image files.'));
  if(!overrideDBPromise)overrideDBPromise=new Promise((resolve,reject)=>{
    const r=indexedDB.open(IMAGE_OVERRIDE_DB,1);
    r.onupgradeneeded=()=>r.result.createObjectStore('images');
    r.onsuccess=()=>resolve(r.result);
    r.onerror=()=>reject(r.error);
  });
  return overrideDBPromise;
}
async function getOverride(key){
  const db=await overrideDB();
  return new Promise((resolve,reject)=>{const t=db.transaction('images','readonly'),r=t.objectStore('images').get(key);r.onsuccess=()=>resolve(r.result||null);r.onerror=()=>reject(r.error)});
}
async function putOverride(key,file){
  const db=await overrideDB();
  return new Promise((resolve,reject)=>{const t=db.transaction('images','readwrite');t.objectStore('images').put(file,key);t.oncomplete=resolve;t.onerror=()=>reject(t.error)});
}
async function removeOverride(key){
  const db=await overrideDB();
  return new Promise((resolve,reject)=>{const t=db.transaction('images','readwrite');t.objectStore('images').delete(key);t.oncomplete=resolve;t.onerror=()=>reject(t.error)});
}
async function showOverride(img,ph,link,c){
  try{
    const file=await getOverride(imageKey(c));if(!file)return false;
    const url=URL.createObjectURL(file);
    img.onload=()=>{};img.src=url;img.style.display='block';ph.classList.remove('visible');
    link.href=url;link.style.display='inline';link.textContent='Open uploaded image';
    return true;
  }catch(e){console.warn('Could not read saved card image',e);return false}
}
async function uploadCardImage(file,c,img,ph,link,status){
  if(!file)return;
  if(!['image/png','image/jpeg','image/webp','image/gif'].includes(file.type)){status.textContent='Choose a PNG, JPG, WEBP or GIF image.';return}
  if(file.size>8*1024*1024){status.textContent='Image must be 8 MB or smaller.';return}
  try{await putOverride(imageKey(c),file);await showOverride(img,ph,link,c);status.textContent='Image saved on this device.'}
  catch(e){status.textContent='Could not save the image. Check browser storage permissions.';console.error(e)}
}

function parsePriceBand(s){return s==='all'?[0,Infinity]:s.split('-').map(Number)}
function validImage(u){return typeof u==='string'&&/^https:\/\/.+/i.test(u)}
function localId(n){return String(n||'').split('/')[0].trim()}
function norm(s){return String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,'')}
function words(s){return String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().split(/\s+/).filter(Boolean)}
function imageKey(c){return `${norm(c.card)}|${norm(c.set)}|${norm(localId(c.number))}`}
function pokemonTcgSmall(u){return validImage(u)?u.replace(/_hires(?=\.png$)/i,''):''}
function setScore(a,b){
  const x=norm(a),y=norm(b);if(!x||!y)return 0;if(x===y)return 120;if(x.includes(y)||y.includes(x))return 80;
  const aw=words(a).filter(w=>w.length>2);return aw.reduce((s,w)=>s+(String(b).toLowerCase().includes(w)?12:0),0);
}
function showFatal(msg){const s=$('#dataUpdated');if(s)s.textContent=msg;const g=$('#grid');if(g)g.innerHTML='<div class="empty" style="display:block;grid-column:1/-1">The watchlist could not load. Use “Check for updates” to retry.</div>'}
async function fetchJson(url,force=false){const r=await fetch(url,{cache:force?'no-store':'default'});if(!r.ok)throw new Error(`HTTP ${r.status}`);return r.json()}

async function resolveTcgdexImage(c,force=false){
  const key=imageKey(c);if(!force&&validImage(imageCache[key]))return imageCache[key];
  try{
    const queries=[`https://api.tcgdex.net/v2/en/cards?name=${encodeURIComponent(c.card)}&localId=${encodeURIComponent(localId(c.number))}`,`https://api.tcgdex.net/v2/en/cards?name=${encodeURIComponent(c.card)}`];
    let candidates=[];
    for(const base of queries){const url=base+(force?`${base.includes('?')?'&':'?'}_=${Date.now()}`:'');try{const list=await fetchJson(url,force);if(Array.isArray(list)&&list.length){candidates=list.slice(0,30);break}}catch{}}
    if(!candidates.length)return '';
    let best=null,bestScore=-1;
    for(const brief of candidates){try{const base=`https://api.tcgdex.net/v2/en/cards/${encodeURIComponent(brief.id)}`;const detail=await fetchJson(base+(force?`?_=${Date.now()}`:''),force);if(!detail||!detail.image)continue;let score=0;if(norm(detail.name)===norm(c.card))score+=100;if(norm(detail.localId)===norm(localId(c.number)))score+=80;score+=setScore(detail.set&&detail.set.name,c.set);if(score>bestScore){bestScore=score;best=detail}}catch{}}
    if(!best||!best.image)return '';const out=`${best.image}/low.webp`;imageCache[key]=out;safeSet(IMAGE_CACHE_KEY,JSON.stringify(imageCache));return out;
  }catch{return ''}
}

async function hydrateImage(img,ph,link,c,force=false){
  img.alt=`${c.card} ${c.number}`;if(await showOverride(img,ph,link,c))return;const urls=[];const small=pokemonTcgSmall(c.image);if(validImage(small))urls.push(small);if(validImage(c.image)&&c.image!==small)urls.push(c.image);if(validImage(displayedImageUrls.get(imageKey(c))))urls.unshift(displayedImageUrls.get(imageKey(c)));if(validImage(imageCache[imageKey(c)]))urls.push(imageCache[imageKey(c)]);
  const probe=url=>new Promise(resolve=>{const im=new Image();im.onload=()=>resolve(url);im.onerror=()=>resolve('');im.src=force?`${url}${url.includes('?')?'&':'?'}_=${Date.now()}`:url});
  for(const url of [...new Set(urls)]){const ok=await probe(url);if(ok){img.src=ok;img.style.display='block';ph.classList.remove('visible');link.href=url;link.style.display='inline';displayedImageUrls.set(imageKey(c),url);imageCache[imageKey(c)]=url;safeSet(IMAGE_CACHE_KEY,JSON.stringify(imageCache));return}}
  const fallback=await resolveTcgdexImage(c,false);if(fallback){const ok=await probe(fallback);if(ok){img.src=ok;img.style.display='block';ph.classList.remove('visible');link.href=fallback;link.style.display='inline';displayedImageUrls.set(imageKey(c),fallback);return}}
  img.style.display='none';ph.classList.add('visible');link.style.display='none';
}

function showDataTimes(ts,cached=false,checkedNow=false){const d=ts?new Date(ts):null,du=$('#dataUpdated'),lc=$('#lastChecked');if(du)du.textContent=(d&&!Number.isNaN(+d))?`Market data updated: ${d.toLocaleString()}${cached?' · cached copy':''}`:(cached?'Market data: cached copy':'Market data: latest available');if(checkedNow&&lc)lc.textContent=` · Last checked: ${new Date().toLocaleTimeString([], {hour:'numeric',minute:'2-digit',second:'2-digit'})}`}
async function loadData(force=false){const base=(window.APP_CONFIG&&window.APP_CONFIG.liveDataUrl)||'./data.json';const url=base+(force?`${base.includes('?')?'&':'?'}t=${Date.now()}`:'');const json=await fetchJson(url,force);if(!Array.isArray(json.cards)||!json.cards.length)throw new Error('Invalid cards dataset');DATA=json.cards;safeSet('pokemonWatchlistCache',JSON.stringify(json));showDataTimes(json.updatedAt,false,force);if(!force){render(false)}else{const currentKeys=[...document.querySelectorAll('#grid .card')].map(n=>n.dataset.imageKey);const next=filtered();if(currentKeys.length===next.length&&next.every((c,i)=>currentKeys[i]===imageKey(c))){updateVisibleCardPrices(next)}else{render(false)}}return json}

function filtered(){const q=(($('#search')&&$('#search').value)||'').trim().toLowerCase();const top=Number($('#topN')&&$('#topN').value)||100,[lo,hi]=parsePriceBand(STATE.price);let arr=DATA.filter(c=>Number(c.rank)<=top&&Number(c.market)>=lo&&Number(c.market)<=(hi===500?500:hi)&&(!q||`${c.card} ${c.set} ${c.number} ${c.rank}`.toLowerCase().includes(q)));const sort=$('#sort')&&$('#sort').value;arr.sort((a,b)=>sort==='roc'?Number(b.returnOnCost)-Number(a.returnOnCost):sort==='margin'?Number(b.margin)-Number(a.margin):sort==='marketAsc'?Number(a.market)-Number(b.market):sort==='marketDesc'?Number(b.market)-Number(a.market):Number(a.rank)-Number(b.rank));return arr}
function renderSummary(arr){const avg=arr.length?arr.reduce((s,c)=>s+Number(c.returnOnCost||0),0)/arr.length:0;const buy=arr.reduce((s,c)=>s+Number(c.buy||0),0),resale=arr.reduce((s,c)=>s+Number(c.resale||0),0);const el=$('#summary');if(el)el.innerHTML=`<div class="stat"><span>Cards shown</span><b>${arr.length}</b></div><div class="stat"><span>Total target buy</span><b>${money(buy)}</b></div><div class="stat"><span>Total target resale</span><b>${money(resale)}</b></div><div class="stat"><span>Avg. return on cost</span><b>${pct(avg)}</b></div>`}
function updateVisibleCardPrices(cards){
  const nodes=document.querySelectorAll('#grid .card');
  renderSummary(cards);
  cards.forEach((c,i)=>{
    const n=nodes[i];if(!n)return;
    n.querySelector('.rank').textContent='#'+c.rank;
    n.querySelector('.rocBadge').textContent=pct(c.returnOnCost)+' ROC';
    n.querySelector('.market').textContent=money(c.market);
    n.querySelector('.buy').textContent=money(c.buy);
    n.querySelector('.resale').textContent=money(c.resale);
    n.querySelector('.margin').textContent='Margin '+money(c.margin);
  });
}
function render(forceImages=false){const generation=++imageRenderGeneration;const arr=filtered(),grid=$('#grid'),tpl=$('#cardTemplate');if(!grid||!tpl)throw new Error('Page template unavailable');grid.innerHTML='';renderSummary(arr);const empty=$('#empty');if(empty)empty.hidden=arr.length>0;const frag=document.createDocumentFragment(),pending=[];for(const c of arr){const node=tpl.content.firstElementChild.cloneNode(true);node.dataset.imageKey=imageKey(c);node.querySelector('.rank').textContent=`#${c.rank}`;node.querySelector('h2').textContent=c.card;node.querySelector('.meta').textContent=`${c.set} · ${c.number}`;node.querySelector('.rocBadge').textContent=`${pct(c.returnOnCost)} ROC`;node.querySelector('.market').textContent=money(c.market);node.querySelector('.buy').textContent=money(c.buy);node.querySelector('.resale').textContent=money(c.resale);node.querySelector('.margin').textContent=`Margin ${money(c.margin)}`;const img=node.querySelector('.cardimg'),ph=node.querySelector('.placeholder'),link=node.querySelector('.imageLink');img.style.display='none';ph.classList.add('visible');link.style.display='none';const upload=node.querySelector('.imageUpload'),fileInput=node.querySelector('.imageFile'),status=node.querySelector('.imageStatus');upload.addEventListener('click',()=>fileInput.click());fileInput.addEventListener('change',async()=>{await uploadCardImage(fileInput.files?.[0],c,img,ph,link,status);fileInput.value=''});pending.push([img,ph,link,c,forceImages]);frag.appendChild(node)}grid.appendChild(frag);let i=0;const run=async()=>{while(i<pending.length){if(generation!==imageRenderGeneration)return;await hydrateImage(...pending[i++])}};for(let w=0;w<Math.min(6,pending.length);w++)run()}

async function refreshAll(){const btn=$('#refreshBtn');if(!btn)return;btn.disabled=true;btn.textContent='Checking…';const lc=$('#lastChecked');if(lc)lc.textContent=' · Checking now…';try{await loadData(true);btn.textContent='Checked ✓';setTimeout(()=>{btn.textContent='Check for updates';btn.disabled=false},1200)}catch{btn.textContent='Retry';btn.disabled=false}}

function switchTab(name){document.querySelectorAll('.tab').forEach(b=>b.classList.toggle('active',b.dataset.tab===name));$('#watchlistView')?.classList.toggle('active',name==='watchlist');$('#scannerView')?.classList.toggle('active',name==='scanner')}

function extractPrice(text){const matches=[...String(text||'').matchAll(/\$\s*([0-9]{1,5}(?:,[0-9]{3})*(?:\.\d{1,2})?)/g)].map(m=>Number(m[1].replace(/,/g,''))).filter(n=>Number.isFinite(n)&&n>0);return matches.length?matches[0]:null}
function cardNameDetected(name,text){const raw=String(text||'').toLowerCase();const compact=norm(text);const n=norm(name);if(n.length>=4&&compact.includes(n))return true;const toks=words(name).filter(w=>w.length>=4&&!['mega','star','promo'].includes(w));return toks.length>0&&toks.every(t=>raw.includes(t))}
function candidateScore(c,text){const raw=String(text||'').toLowerCase(),compact=norm(text);let score=0;if(cardNameDetected(c.card,text))score+=100;const id=norm(localId(c.number));if(id&&id.length>=2&&compact.includes(id))score+=120;const setTokens=words(c.set).filter(w=>w.length>=4&&!['black','star','promos','scarlet','violet'].includes(w));const hits=setTokens.filter(t=>raw.includes(t)).length;score+=hits*18;score+=Math.max(0,20-Number(c.rank||100)/5);return score}
function detectCards(text){
  const groups=new Map();for(const c of DATA){const k=norm(c.card);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(c)}
  const found=[];
  for(const group of groups.values()){
    const name=group[0].card;if(!cardNameDetected(name,text))continue;
    const scored=group.map(c=>({c,score:candidateScore(c,text)})).sort((a,b)=>b.score-a.score);
    const top=scored[0],second=scored[1];const differentiated=top&&top.score>=150;let chosen=top.c;let ambiguous=false;
    if(group.length>1&&!differentiated){ambiguous=true;chosen=[...group].sort((a,b)=>Number(a.buy)-Number(b.buy))[0]}
    found.push({card:chosen,ambiguous,confidence:ambiguous?'Low':(second&&top.score-second.score<25?'Medium':'High'),score:top.score,variants:group.length});
  }
  return found.sort((a,b)=>Number(a.card.rank)-Number(b.card.rank));
}

function renderPreviews(){const box=$('#imagePreviews');if(!box)return;box.innerHTML='';SCAN_FILES.forEach(file=>{const div=document.createElement('div');div.className='imagePreview';const img=document.createElement('img');img.alt=file.name;img.src=URL.createObjectURL(file);div.appendChild(img);box.appendChild(div)})}
async function ocrFiles(files){
  if(!files.length)return '';
  if(!window.Tesseract)throw new Error('OCR library did not load. Paste listing text instead.');
  let text='';
  for(let i=0;i<files.length;i++){
    const status=$('#scanStatus');if(status)status.textContent=`Reading screenshot ${i+1} of ${files.length}…`;
    const result=await Tesseract.recognize(files[i],'eng',{logger:m=>{if(status&&m.status==='recognizing text')status.textContent=`Reading screenshot ${i+1}/${files.length}: ${Math.round((m.progress||0)*100)}%`}});
    text+='\n'+(result?.data?.text||'');
  }
  return text;
}
function dealClass(label){return label==='BUY'?'deal-buy':label==='NEGOTIATE'?'deal-negotiate':'deal-pass'}
function getDeal(ask,maxBuy){if(!Number.isFinite(ask)||ask<=0)return {label:'NO PRICE',cls:'deal-negotiate'};if(maxBuy<=0)return {label:'PASS',cls:'deal-pass'};if(ask<=maxBuy*.9)return {label:'BUY',cls:'deal-buy'};if(ask<=maxBuy*1.1)return {label:'NEGOTIATE',cls:'deal-negotiate'};return {label:'PASS',cls:'deal-pass'}}
function renderScanResults(matches,ask,conditionMultiplier){
  const results=$('#scanResults'),summary=$('#scanSummary');if(!results||!summary)return;
  results.innerHTML='';
  if(!matches.length){summary.hidden=true;results.innerHTML='<div class="empty">No watchlist cards were confidently detected. Try clearer screenshots, paste the seller description, or include card/set numbers in the text.</div>';return}
  const rows=matches.map(m=>{const c=m.card;const adjBuy=Math.round(Number(c.buy||0)*conditionMultiplier);return {...m,adjBuy,market:Number(c.market||0),resale:Number(c.resale||0)}});
  const totalMax=rows.reduce((s,r)=>s+r.adjBuy,0),totalMarket=rows.reduce((s,r)=>s+r.market,0),totalResale=rows.reduce((s,r)=>s+r.resale,0);const deal=getDeal(ask,totalMax);const profit=Number.isFinite(ask)&&ask>0?totalResale-ask:null;const roc=profit!==null&&ask>0?profit/ask:null;
  summary.hidden=false;summary.innerHTML=`<div class="scanMetric"><span>Cards detected</span><b>${rows.length}</b></div><div class="scanMetric"><span>Est. market value</span><b>${money(totalMarket)}</b></div><div class="scanMetric"><span>Maximum offer</span><b>${money(totalMax)}</b></div><div class="scanMetric"><span>Ask / est. profit</span><b>${Number.isFinite(ask)&&ask>0?`${money(ask)} / ${money(profit)}`:'No ask found'}</b></div><div class="scanMetric"><span>Recommendation</span><b><span class="dealBadge ${deal.cls}">${deal.label}</span></b>${roc!==null?`<small>${Math.round(roc*100)}% est. return</small>`:''}</div>`;
  for(const r of rows){const c=r.card;const article=document.createElement('article');article.className='scanCard';const image=validImage(c.image)?pokemonTcgSmall(c.image):'';article.innerHTML=`${image?`<img class="scanThumb" src="${image}" alt="${c.card}">`:'<div class="scanThumb"></div>'}<div><h3>${c.card}</h3><div class="scanMeta">${c.set} · ${c.number}${r.ambiguous?' <span class="ambiguous">· variant uncertain</span>':''}</div><div class="scanNumbers"><span>Market <b>${money(c.market)}</b></span><span>Target resale <b>${money(c.resale)}</b></span><span>Base max buy <b>${money(c.buy)}</b></span></div></div><div class="scanRight"><div>Adjusted max buy</div><div class="maxBuy">${money(r.adjBuy)}</div><div class="confidence">Match confidence: ${r.confidence}</div></div>`;results.appendChild(article)}
}

async function scanListing(){
  const btn=$('#scanBtn'),status=$('#scanStatus');if(!btn)return;btn.disabled=true;btn.textContent='Scanning…';if(status)status.textContent='Preparing listing…';
  try{
    const pasted=$('#listingText')?.value||'';let ocr='';if(SCAN_FILES.length)ocr=await ocrFiles(SCAN_FILES);const combined=`${pasted}\n${ocr}`;
    if(!combined.trim())throw new Error('Add listing text or at least one screenshot.');
    const priceEl=$('#askingPrice');let ask=Number(priceEl?.value);if(!Number.isFinite(ask)||ask<=0){const detected=extractPrice(combined);if(detected){ask=detected;if(priceEl)priceEl.value=String(detected)}}
    const matches=detectCards(combined);const mult=Number($('#condition')?.value||.85);renderScanResults(matches,ask,mult);if(status)status.textContent=`Scan complete. ${matches.length} watchlist card${matches.length===1?'':'s'} detected.${SCAN_FILES.length?' OCR text was processed locally in your browser.':''}`;
  }catch(err){if(status)status.textContent=err.message||'Scan failed.'}finally{btn.disabled=false;btn.textContent='Scan listing'}
}
function clearScanner(){SCAN_FILES=[];['listingUrl','askingPrice','listingText'].forEach(id=>{const el=$('#'+id);if(el)el.value=''});const ss=$('#screenshots');if(ss)ss.value='';$('#imagePreviews').innerHTML='';$('#scanResults').innerHTML='';$('#scanSummary').hidden=true;$('#scanStatus').textContent='';$('#openListing').hidden=true}
function updateListingLink(){const value=$('#listingUrl')?.value.trim();const a=$('#openListing');if(!a)return;if(/^https?:\/\//i.test(value)){a.href=value;a.hidden=false}else a.hidden=true}

function bindEvents(){
  $('#search')&&$('#search').addEventListener('input',()=>render());$('#topN')&&$('#topN').addEventListener('change',()=>render());$('#sort')&&$('#sort').addEventListener('change',()=>render());
  document.querySelectorAll('.chip').forEach(btn=>btn.addEventListener('click',()=>{document.querySelectorAll('.chip').forEach(b=>b.classList.remove('active'));btn.classList.add('active');STATE.price=btn.dataset.price;render()}));
  $('#refreshBtn')&&$('#refreshBtn').addEventListener('click',refreshAll);document.querySelectorAll('.tab').forEach(btn=>btn.addEventListener('click',()=>switchTab(btn.dataset.tab)));
  $('#screenshots')&&$('#screenshots').addEventListener('change',e=>{SCAN_FILES=[...e.target.files];renderPreviews()});$('#scanBtn')&&$('#scanBtn').addEventListener('click',scanListing);$('#clearScanBtn')&&$('#clearScanBtn').addEventListener('click',clearScanner);$('#listingUrl')&&$('#listingUrl').addEventListener('input',updateListingLink);
}

async function start(){bindEvents();try{await loadData(false)}catch(err){const cached=safeGet('pokemonWatchlistCache');if(cached){try{const json=JSON.parse(cached);DATA=Array.isArray(json.cards)?json.cards:[];showDataTimes(json.updatedAt,true,false);render();return}catch{}}showFatal('Could not load market data');console.error(err)}}
window.addEventListener('error',()=>showFatal('The watchlist encountered an error while loading'));
start();
