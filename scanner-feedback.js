// Marketplace Scanner v13: persistent device-local learning dataset using IndexedDB.
// Data stays in this browser profile/device unless the user clears site data or exports/imports it manually.

const SCANNER_DB_NAME='PokemonMarketplaceScannerFeedback';
const SCANNER_DB_VERSION=1;
const SCANNER_EVENTS_STORE='events';
const SCANNER_MAPPINGS_STORE='mappings';
const SCANNER_STATS_STORE='stats';
let SCANNER_DB=null;
let SCANNER_FEEDBACK={mappings:new Map(),confirmCounts:new Map(),eventCount:0};
let SCANNER_FEEDBACK_READY=null;

function fbOpenDb(){
  if(!('indexedDB' in window))return Promise.resolve(null);
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(SCANNER_DB_NAME,SCANNER_DB_VERSION);
    req.onupgradeneeded=()=>{
      const db=req.result;
      if(!db.objectStoreNames.contains(SCANNER_EVENTS_STORE)){
        const s=db.createObjectStore(SCANNER_EVENTS_STORE,{keyPath:'id',autoIncrement:true});
        s.createIndex('createdAt','createdAt');s.createIndex('action','action');
      }
      if(!db.objectStoreNames.contains(SCANNER_MAPPINGS_STORE))db.createObjectStore(SCANNER_MAPPINGS_STORE,{keyPath:'fromId'});
      if(!db.objectStoreNames.contains(SCANNER_STATS_STORE))db.createObjectStore(SCANNER_STATS_STORE,{keyPath:'key'});
    };
    req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
  });
}
function fbTx(store,mode='readonly'){return SCANNER_DB?.transaction(store,mode).objectStore(store)||null}
function fbReq(req){return new Promise((resolve,reject)=>{if(!req)return resolve(null);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)})}
function fbCandidateSnapshot(c){if(!c)return null;return {type:c.type||'external',id:c.id||'',name:c.name||'',set:c.set||'',number:c.number||'',image:c.image||'',market:Number(c.market||0),resale:Number(c.resale||0),baseBuy:Number(c.baseBuy||0),source:c.source||'',pricingAvailable:c.pricingAvailable!==false,variant:c.variant||'',score:Number(c.score||0)}}
function fbContext(){
  const text=document.querySelector('#listingText')?.value||'';
  return {listingText:text.slice(0,5000),listingUrl:document.querySelector('#listingUrl')?.value||'',askingPrice:Number(document.querySelector('#askingPrice')?.value)||null,condition:Number(document.querySelector('#condition')?.value)||null};
}
async function fbAddEvent(action,payload={}){
  if(!SCANNER_DB)return;
  const event={action,createdAt:Date.now(),...fbContext(),...payload};
  await fbReq(fbTx(SCANNER_EVENTS_STORE,'readwrite')?.add(event));
  SCANNER_FEEDBACK.eventCount++;fbUpdateIndicator();
}
async function fbSaveMapping(fromId,toCandidate,reason='correction'){
  if(!SCANNER_DB||!fromId||!toCandidate?.id)return;
  const existing=await fbReq(fbTx(SCANNER_MAPPINGS_STORE)?.get(fromId));
  const rec={fromId,toId:toCandidate.id,candidate:fbCandidateSnapshot(toCandidate),count:Number(existing?.count||0)+1,lastUsed:Date.now(),reason};
  await fbReq(fbTx(SCANNER_MAPPINGS_STORE,'readwrite')?.put(rec));
  SCANNER_FEEDBACK.mappings.set(fromId,rec);
}
async function fbBumpConfirmation(candidate){
  if(!SCANNER_DB||!candidate?.id)return;
  const key=`confirm:${candidate.id}`,old=await fbReq(fbTx(SCANNER_STATS_STORE)?.get(key));
  const rec={key,count:Number(old?.count||0)+1,candidate:fbCandidateSnapshot(candidate),updatedAt:Date.now()};
  await fbReq(fbTx(SCANNER_STATS_STORE,'readwrite')?.put(rec));SCANNER_FEEDBACK.confirmCounts.set(candidate.id,rec.count);
}
async function fbLoadCache(){
  if(!SCANNER_DB)return;
  const mappings=await fbReq(fbTx(SCANNER_MAPPINGS_STORE)?.getAll())||[];
  const stats=await fbReq(fbTx(SCANNER_STATS_STORE)?.getAll())||[];
  const events=await fbReq(fbTx(SCANNER_EVENTS_STORE)?.count())||0;
  SCANNER_FEEDBACK.mappings=new Map(mappings.map(x=>[x.fromId,x]));
  SCANNER_FEEDBACK.confirmCounts=new Map(stats.filter(x=>String(x.key).startsWith('confirm:')).map(x=>[x.key.slice(8),Number(x.count||0)]));
  SCANNER_FEEDBACK.eventCount=events;
}
async function fbMigrateLegacy(){
  if(!SCANNER_DB)return;
  let old={};try{old=JSON.parse(localStorage.getItem('pokemonMarketplaceScannerCorrectionsV1')||'{}')||{}}catch{}
  for(const [fromId,rec] of Object.entries(old)){
    if(!fromId||!rec?.id||SCANNER_FEEDBACK.mappings.has(fromId))continue;
    const candidate={...rec,baseBuy:Number(rec.baseBuy||0)};
    await fbSaveMapping(fromId,candidate,'legacy-migration');
    await fbAddEvent('legacy-migration',{fromId,toCandidate:fbCandidateSnapshot(candidate)});
  }
}
function fbLearnedCandidate(rec){const c=rec?.candidate;if(!c?.id)return null;return {...c,score:999,source:c.source||'Device feedback'}}
function fbApplyLearning(rows){
  for(const row of rows){
    const original=row.selected?.id;row.feedbackOriginalId=original;
    const learned=SCANNER_FEEDBACK.mappings.get(original);
    if(learned?.candidate){
      const c=fbLearnedCandidate(learned);row.alternatives=[row.selected,...(row.alternatives||[])].filter((x,i,a)=>x&&a.findIndex(y=>y.id===x.id)===i);row.selected=c;row.confirmed=true;row.rejected=false;row.confidence=Math.min(100,96+Math.min(4,Number(learned.count||1)-1));row.learned=true;row.learnedCount=learned.count||1;
      continue;
    }
    const all=[row.selected,...(row.alternatives||[])];
    all.sort((a,b)=>(SCANNER_FEEDBACK.confirmCounts.get(b?.id)||0)-(SCANNER_FEEDBACK.confirmCounts.get(a?.id)||0));
    if(all[0]?.id&&all[0].id!==row.selected?.id&&(SCANNER_FEEDBACK.confirmCounts.get(all[0].id)||0)>=3){
      row.alternatives=all.slice(1);row.selected=all[0];row.confidence=Math.max(row.confidence||0,92);row.feedbackBoosted=true;
    }
  }
  return rows;
}

function fbPatchReviewBuilder(){
  if(typeof buildReviewRows!=='function'||buildReviewRows.__feedbackPatched)return;
  const prior=buildReviewRows;
  const wrapped=function(...args){return fbApplyLearning(prior(...args))};wrapped.__feedbackPatched=true;buildReviewRows=wrapped;
}
function fbPatchRenderer(){
  if(typeof renderReviewResults!=='function'||renderReviewResults.__feedbackPatched)return;
  const prior=renderReviewResults;
  const wrapped=function(){prior();document.querySelectorAll('.reviewCard').forEach((el,i)=>{const row=REVIEW_ROWS?.[i];if(!row)return;const h=el.querySelector('h3');if(row.learned&&h&&!h.querySelector('.deviceLearnedBadge')){const b=document.createElement('span');b.className='deviceLearnedBadge';b.textContent=`DEVICE LEARNED ×${row.learnedCount||1}`;h.appendChild(b)}else if(row.feedbackBoosted&&h&&!h.querySelector('.deviceLearnedBadge')){const b=document.createElement('span');b.className='deviceLearnedBadge';b.textContent='FEEDBACK BOOST';h.appendChild(b)}});fbEnsureControls()};wrapped.__feedbackPatched=true;renderReviewResults=wrapped;
}

function fbInstallCapture(){
  document.addEventListener('click',e=>{
    const candidate=e.target.closest?.('.candidate');
    if(candidate){const i=Number(candidate.dataset.row),row=REVIEW_ROWS?.[i],before=fbCandidateSnapshot(row?.selected),fromId=row?.feedbackOriginalId||row?.selected?.id;setTimeout(async()=>{const after=REVIEW_ROWS?.[i]?.selected;if(after?.id&&after.id!==before?.id){await fbSaveMapping(fromId,after,'candidate-selection');await fbBumpConfirmation(after);await fbAddEvent('correction',{fromId,fromCandidate:before,toCandidate:fbCandidateSnapshot(after),confidenceBefore:row?.confidence||null});}},20);return}
    const confirm=e.target.closest?.('.confirmBtn');
    if(confirm){const i=Number(confirm.dataset.row),row=REVIEW_ROWS?.[i];setTimeout(async()=>{const c=REVIEW_ROWS?.[i]?.selected;if(c){await fbBumpConfirmation(c);await fbAddEvent('confirm',{candidate:fbCandidateSnapshot(c),wasLearned:!!row?.learned})}},20);return}
    const wrong=e.target.closest?.('.wrongBtn');
    if(wrong){const i=Number(wrong.dataset.row),row=REVIEW_ROWS?.[i];if(row?.selected)fbAddEvent('reject',{candidate:fbCandidateSnapshot(row.selected),confidence:row.confidence||null});return}
    const manual=e.target.closest?.('.manualAddCandidate');
    if(manual){const idx=Number(manual.dataset.addIndex),c=window.MANUAL_SEARCH_RESULTS?.[idx]||MANUAL_SEARCH_RESULTS?.[idx];setTimeout(async()=>{const added=[...(REVIEW_ROWS||[])].reverse().find(r=>r.manual&&r.selected?.id===c?.id);if(added?.selected){await fbBumpConfirmation(added.selected);await fbAddEvent('manual-add',{candidate:fbCandidateSnapshot(added.selected),query:document.querySelector('#manualAddQuery')?.value||''})}},20)}
  },true);
}

function fbEnsureControls(){
  const policy=document.querySelector('.policyPanel');if(!policy)return;
  let box=document.querySelector('#feedbackDatasetBox');
  if(!box){box=document.createElement('div');box.id='feedbackDatasetBox';box.className='feedbackDatasetBox';box.innerHTML=`<div><b>Device learning dataset</b><span id="feedbackDatasetCount">0 verifications saved</span></div><div class="feedbackActions"><button id="exportFeedbackBtn" class="ghost">Export</button><button id="clearFeedbackBtn" class="ghost dangerGhost">Reset learning</button></div>`;policy.appendChild(box);document.querySelector('#exportFeedbackBtn').onclick=fbExport;document.querySelector('#clearFeedbackBtn').onclick=fbClear}
  fbUpdateIndicator();
}
function fbUpdateIndicator(){const el=document.querySelector('#feedbackDatasetCount');if(el)el.textContent=`${SCANNER_FEEDBACK.eventCount} feedback event${SCANNER_FEEDBACK.eventCount===1?'':'s'} saved on this device`}
async function fbExport(){
  if(!SCANNER_DB)return;const events=await fbReq(fbTx(SCANNER_EVENTS_STORE)?.getAll())||[],mappings=await fbReq(fbTx(SCANNER_MAPPINGS_STORE)?.getAll())||[],stats=await fbReq(fbTx(SCANNER_STATS_STORE)?.getAll())||[];const blob=new Blob([JSON.stringify({version:1,exportedAt:new Date().toISOString(),events,mappings,stats},null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='pokemon-scanner-feedback.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)
}
async function fbClear(){
  if(!SCANNER_DB||!confirm('Reset all learned scanner feedback stored on this device?'))return;
  for(const store of [SCANNER_EVENTS_STORE,SCANNER_MAPPINGS_STORE,SCANNER_STATS_STORE])await fbReq(fbTx(store,'readwrite')?.clear());SCANNER_FEEDBACK={mappings:new Map(),confirmCounts:new Map(),eventCount:0};try{localStorage.removeItem('pokemonMarketplaceScannerCorrectionsV1')}catch{}fbUpdateIndicator();if(typeof renderReviewResults==='function'&&Array.isArray(REVIEW_ROWS)&&REVIEW_ROWS.length)renderReviewResults();
}

async function fbInit(){
  try{SCANNER_DB=await fbOpenDb();if(!SCANNER_DB)return;await fbLoadCache();await fbMigrateLegacy();await fbLoadCache();fbPatchReviewBuilder();fbPatchRenderer();fbInstallCapture();fbEnsureControls()}catch(err){console.warn('Scanner feedback database unavailable',err)}
}
SCANNER_FEEDBACK_READY=fbInit();
