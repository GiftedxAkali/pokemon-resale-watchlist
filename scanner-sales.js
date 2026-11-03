// Marketplace Scanner v14: Near Mint TCGplayer 3-sale valuation overrides.
// TCGplayer's recent-sales API requires authenticated API access, so exact recent NM sales
// can be entered here and are persisted on this device in the existing IndexedDB stats store.

const NM_SALES_PREFIX='sales:';
const NM_SALES_CACHE=new Map();

function salesRound(n){return Math.round((Number(n)||0)*100)/100}
function salesAverage(values){const nums=values.map(Number).filter(n=>Number.isFinite(n)&&n>0);return nums.length===3?salesRound(nums.reduce((a,b)=>a+b,0)/3):null}
function salesBuyPct(market){if(typeof externalBuyPercent==='function')return externalBuyPercent(market);if(market>=200)return .72;if(market>=75)return .70;if(market>=25)return .68;return .65}
function salesSnapshotKey(candidate){return candidate?.id?`${NM_SALES_PREFIX}${candidate.id}`:''}

async function salesLoadCache(){
  try{
    if(!SCANNER_DB||typeof fbTx!=='function'||typeof fbReq!=='function')return;
    const stats=await fbReq(fbTx(SCANNER_STATS_STORE)?.getAll())||[];
    for(const rec of stats){
      if(String(rec?.key||'').startsWith(NM_SALES_PREFIX)&&Array.isArray(rec.prices)&&rec.prices.length===3)NM_SALES_CACHE.set(rec.key.slice(NM_SALES_PREFIX.length),rec);
    }
  }catch(err){console.warn('NM sales cache unavailable',err)}
}

async function salesSave(candidate,prices){
  const avg=salesAverage(prices);if(!candidate?.id||avg===null)return null;
  const rec={key:salesSnapshotKey(candidate),candidateId:candidate.id,name:candidate.name||'',set:candidate.set||'',number:candidate.number||'',condition:'Near Mint',prices:prices.map(v=>salesRound(Number(v))),average:avg,updatedAt:Date.now(),source:'TCGplayer - 3 recent Near Mint sales'};
  NM_SALES_CACHE.set(candidate.id,rec);
  try{if(SCANNER_DB&&typeof fbTx==='function'&&typeof fbReq==='function')await fbReq(fbTx(SCANNER_STATS_STORE,'readwrite')?.put(rec))}catch(err){console.warn('Could not persist NM sales',err)}
  try{if(typeof fbAddEvent==='function')await fbAddEvent('nm-sales-update',{candidate:typeof fbCandidateSnapshot==='function'?fbCandidateSnapshot(candidate):null,prices:rec.prices,average:avg})}catch{}
  return rec;
}

async function salesClear(candidate){
  if(!candidate?.id)return;NM_SALES_CACHE.delete(candidate.id);
  try{if(SCANNER_DB&&typeof fbTx==='function'&&typeof fbReq==='function')await fbReq(fbTx(SCANNER_STATS_STORE,'readwrite')?.delete(salesSnapshotKey(candidate)))}catch{}
}

function salesApplyToCandidate(candidate){
  if(!candidate?.id)return candidate;const rec=NM_SALES_CACHE.get(candidate.id);if(!rec)return candidate;
  candidate.market=Number(rec.average||0);candidate.resale=Number(rec.average||0);candidate.baseBuy=Math.round(Number(rec.average||0)*salesBuyPct(Number(rec.average||0)));candidate.salesValuation={...rec};candidate.marketSource='3 recent NM TCGplayer sales';return candidate;
}
function salesApplyAllRows(){for(const row of REVIEW_ROWS||[])salesApplyToCandidate(row?.selected)}

function salesPanel(row,index){
  const c=row?.selected;if(!c?.id)return '';
  const rec=NM_SALES_CACHE.get(c.id);const vals=rec?.prices||['','',''];const avg=rec?.average;
  const fallback=rec?`<span class="salesSource active">ACTIVE: 3 NM sales avg ${money(avg)}</span>`:`<span class="salesSource fallback">Fallback: TCGplayer Market Price</span>`;
  return `<div class="nmSalesPanel"><div class="nmSalesHeader"><b>TCGplayer recent sales — Near Mint only</b>${fallback}</div><div class="nmSalesInputs"><input inputmode="decimal" type="number" min="0" step="0.01" placeholder="Sale 1" value="${vals[0]??''}" data-sales-row="${index}" data-sales-slot="0"><input inputmode="decimal" type="number" min="0" step="0.01" placeholder="Sale 2" value="${vals[1]??''}" data-sales-row="${index}" data-sales-slot="1"><input inputmode="decimal" type="number" min="0" step="0.01" placeholder="Sale 3" value="${vals[2]??''}" data-sales-row="${index}" data-sales-slot="2"><button class="ghost applyNmSales" data-row="${index}">Use average</button>${rec?`<button class="ghost clearNmSales" data-row="${index}">Clear</button>`:''}</div><small>Enter the 3 most recent TCGplayer sales for this exact card/printing, all in Near Mint condition. The scanner uses their arithmetic mean as market value.</small></div>`;
}

function salesBindControls(){
  document.querySelectorAll('.applyNmSales').forEach(btn=>btn.onclick=async()=>{
    const i=Number(btn.dataset.row),row=REVIEW_ROWS?.[i],c=row?.selected;if(!c)return;
    const prices=[0,1,2].map(slot=>Number(document.querySelector(`[data-sales-row="${i}"][data-sales-slot="${slot}"]`)?.value));
    if(prices.some(v=>!Number.isFinite(v)||v<=0)){alert('Enter all three Near Mint sale prices first.');return}
    await salesSave(c,prices);salesApplyToCandidate(c);if(typeof renderReviewResults==='function')renderReviewResults();
  });
  document.querySelectorAll('.clearNmSales').forEach(btn=>btn.onclick=async()=>{
    const i=Number(btn.dataset.row),row=REVIEW_ROWS?.[i],c=row?.selected;if(!c)return;await salesClear(c);
    // Restore the candidate's source pricing from its base candidate data when possible by rescanning is safest.
    // For the current view, mark the source as fallback and preserve the last known TCGplayer market until next scan.
    delete c.salesValuation;c.marketSource='TCGplayer Market Price fallback';if(typeof renderReviewResults==='function')renderReviewResults();
  });
}

function salesPatchRenderer(){
  if(typeof renderReviewResults!=='function'||renderReviewResults.__salesPatched)return;
  const prior=renderReviewResults;
  const wrapped=function(){
    salesApplyAllRows();prior();
    document.querySelectorAll('.reviewCard').forEach((el,i)=>{
      const row=REVIEW_ROWS?.[i];if(!row)return;const right=el.querySelector('.scanRight');if(right&&!el.querySelector('.nmSalesPanel'))right.insertAdjacentHTML('afterend',salesPanel(row,i));
      const meta=el.querySelector('.scanMeta');const rec=NM_SALES_CACHE.get(row.selected?.id);if(meta&&rec&&!meta.querySelector('.nmPriceBadge')){const b=document.createElement('span');b.className='nmPriceBadge';b.textContent=' · 3 NM SALES AVG';meta.appendChild(b)}
    });
    salesBindControls();
  };wrapped.__salesPatched=true;renderReviewResults=wrapped;
}

async function salesInit(){
  try{if(typeof SCANNER_FEEDBACK_READY?.then==='function')await SCANNER_FEEDBACK_READY;await salesLoadCache();salesPatchRenderer();if(Array.isArray(REVIEW_ROWS)&&REVIEW_ROWS.length)renderReviewResults();
    const policy=document.querySelector('.policyPanel');if(policy&&!policy.querySelector('.salesPolicyNote')){const p=document.createElement('p');p.className='finePrint salesPolicyNote';p.innerHTML='<b>Valuation:</b> preferred market value is the average of the 3 most recent TCGplayer Near Mint sales for the exact card. Because TCGplayer recent-sales API access requires credentials, enter those 3 sales when available; otherwise TCGplayer Market Price is shown as a fallback.';policy.appendChild(p)}
  }catch(err){console.warn('NM sales valuation unavailable',err)}
}
salesInit();
