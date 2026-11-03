// Marketplace Scanner v12 enhancements: persistent correction memory + manual add-card flow.
const SCANNER_LEARNING_KEY='pokemonMarketplaceScannerCorrectionsV1';
let MANUAL_SEARCH_RESULTS=[];

function loadScannerLearning(){
  try{return JSON.parse(localStorage.getItem(SCANNER_LEARNING_KEY)||'{}')||{}}catch{return {}}
}
function saveScannerLearning(map){try{localStorage.setItem(SCANNER_LEARNING_KEY,JSON.stringify(map))}catch{}}
function rememberScannerCorrection(fromId,toCandidate){
  if(!fromId||!toCandidate?.id)return;
  const m=loadScannerLearning();
  m[fromId]={id:toCandidate.id,name:toCandidate.name,set:toCandidate.set,number:toCandidate.number,image:toCandidate.image,market:toCandidate.market,resale:toCandidate.resale,baseBuy:toCandidate.baseBuy,source:toCandidate.source,type:toCandidate.type,pricingAvailable:toCandidate.pricingAvailable,variant:toCandidate.variant||'',savedAt:Date.now()};
  saveScannerLearning(m);
}
function learnedCandidateFromRecord(rec){
  if(!rec?.id)return null;
  return {type:rec.type||'external',id:rec.id,name:rec.name||'',set:rec.set||'',number:rec.number||'',image:rec.image||'',market:Number(rec.market||0),resale:Number(rec.resale||0),baseBuy:Number(rec.baseBuy||0),source:rec.source||'Saved correction',pricingAvailable:rec.pricingAvailable!==false,variant:rec.variant||'',score:999};
}

// Apply saved wrong→right corrections whenever a new scan constructs review rows.
if(typeof buildReviewRows==='function'){
  const _buildReviewRows=buildReviewRows;
  buildReviewRows=function(watchMatches,externalHits,text){
    const rows=_buildReviewRows(watchMatches,externalHits,text),learned=loadScannerLearning();
    for(const row of rows){
      const rec=learned[row.selected?.id];
      if(!rec)continue;
      const candidate=learnedCandidateFromRecord(rec);
      row.alternatives=[row.selected,...(row.alternatives||[])].filter((x,i,a)=>x&&a.findIndex(y=>y.id===x.id)===i);
      row.selected=candidate;row.confirmed=true;row.rejected=false;row.confidence=100;row.learned=true;
    }
    return rows;
  };
}

function installLearningCapture(){
  document.addEventListener('click',e=>{
    const candidateBtn=e.target.closest?.('.candidate');
    if(candidateBtn){
      const i=Number(candidateBtn.dataset.row),row=REVIEW_ROWS?.[i];
      if(row){
        const originalId=row.selected?.id;
        setTimeout(()=>{const updated=REVIEW_ROWS?.[i];if(updated?.selected?.id&&updated.selected.id!==originalId)rememberScannerCorrection(originalId,updated.selected)},0);
      }
      return;
    }
    const confirmBtn=e.target.closest?.('.confirmBtn');
    if(confirmBtn){
      const i=Number(confirmBtn.dataset.row),row=REVIEW_ROWS?.[i];
      if(row?.selected?.id){const m=loadScannerLearning();if(!m[row.selected.id])m[row.selected.id]={...row.selected,savedAt:Date.now()};saveScannerLearning(m)}
    }
    const manualBtn=e.target.closest?.('.manualSearchBtn');
    if(manualBtn){
      const i=Number(manualBtn.dataset.row),row=REVIEW_ROWS?.[i],originalId=row?.selected?.id;
      if(row&&originalId)setTimeout(()=>{const updated=REVIEW_ROWS?.[i];if(updated?.selected?.id&&updated.selected.id!==originalId)rememberScannerCorrection(originalId,updated.selected)},1200);
    }
  },true);
}

function ensureManualAddUI(){
  const results=document.querySelector('#scanResults');if(!results)return;
  if(document.querySelector('#manualAddCardPanel'))return;
  const panel=document.createElement('section');panel.id='manualAddCardPanel';panel.className='manualAddPanel';
  panel.innerHTML=`<div class="manualAddHeader"><div><h3>Add a missed card</h3><p>If the scanner skipped a card, search by Pokémon/card name and preferably collector number (example: "Umbreon ex 161/131").</p></div><button id="toggleManualAdd" class="primary">+ Add card manually</button></div><div id="manualAddBody" class="manualAddBody" hidden><div class="manualAddSearch"><input id="manualAddQuery" type="text" placeholder="Card name, set, or collector number"><button id="manualAddSearchBtn" class="ghost">Search cards</button></div><div id="manualAddStatus" class="scanStatus"></div><div id="manualAddCandidates" class="manualAddCandidates"></div></div>`;
  results.parentNode.insertBefore(panel,results);
  document.querySelector('#toggleManualAdd').onclick=()=>{const body=document.querySelector('#manualAddBody');body.hidden=!body.hidden;if(!body.hidden)document.querySelector('#manualAddQuery')?.focus()};
  document.querySelector('#manualAddSearchBtn').onclick=manualAddSearch;
  document.querySelector('#manualAddQuery').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();manualAddSearch()}});
}

async function manualAddSearch(){
  const q=document.querySelector('#manualAddQuery')?.value?.trim(),status=document.querySelector('#manualAddStatus'),box=document.querySelector('#manualAddCandidates'),btn=document.querySelector('#manualAddSearchBtn');
  if(!q)return;if(status)status.textContent='Searching TCGdex…';if(btn){btn.disabled=true;btn.textContent='Searching…'};if(box)box.innerHTML='';
  try{
    const lineObj={raw:q,query:q,localId:scannerLocalId(q)};
    const list=await tcgdexList(q,lineObj.localId);const scored=[];
    for(const brief of list.slice(0,24)){const d=await tcgdexDetail(brief.id);if(d)scored.push({detail:d,score:onlineNameScore(d,lineObj)})}
    scored.sort((a,b)=>b.score-a.score);MANUAL_SEARCH_RESULTS=[];
    for(const s of scored.slice(0,12))MANUAL_SEARCH_RESULTS.push(await externalCandidate(s.detail,s.score,lineObj));
    if(!MANUAL_SEARCH_RESULTS.length){if(status)status.textContent='No matching cards found. Try the exact card name or collector number.';return}
    if(status)status.textContent=`Found ${MANUAL_SEARCH_RESULTS.length} possible cards. Select the exact card.`;
    box.innerHTML=MANUAL_SEARCH_RESULTS.map((c,i)=>`<button class="manualAddCandidate" data-add-index="${i}">${validImage(c.image)?`<img src="${scannerEsc(c.image)}" alt="">`:'<span class="candidateImg">?</span>'}<span><b>${scannerEsc(c.name)}</b><small>${scannerEsc(c.set)} · ${scannerEsc(c.number)}</small><small>${c.market?`Market ${money(c.market)}`:'Pricing unavailable'}</small></span><span class="addPlus">Add</span></button>`).join('');
    box.querySelectorAll('.manualAddCandidate').forEach(b=>b.onclick=()=>addManualCard(Number(b.dataset.addIndex)));
  }catch(err){if(status)status.textContent=`Search failed: ${err.message||'Unable to search.'}`}
  finally{if(btn){btn.disabled=false;btn.textContent='Search cards'}}
}

function addManualCard(index){
  const c=MANUAL_SEARCH_RESULTS[index];if(!c)return;
  const dup=REVIEW_ROWS.some(r=>!r.rejected&&r.selected?.id===c.id);
  if(dup){const status=document.querySelector('#manualAddStatus');if(status)status.textContent='That exact card is already included in this listing.';return}
  REVIEW_ROWS.push({key:`manual:${Date.now()}:${index}`,selected:c,alternatives:[],confidence:100,confirmed:true,rejected:false,origin:'manual',manual:true});
  if(typeof renderReviewResults==='function')renderReviewResults();
  ensureManualAddUI();
  const status=document.querySelector('#manualAddStatus');if(status)status.textContent=`Added ${c.name} ${c.number||''}. Lot valuation updated.`;
}

// Keep the manual-add panel present after each results rerender.
if(typeof renderReviewResults==='function'){
  const _renderReviewResults=renderReviewResults;
  renderReviewResults=function(){_renderReviewResults();ensureManualAddUI();document.querySelectorAll('.reviewCard').forEach((el,i)=>{const row=REVIEW_ROWS?.[i];if(row?.learned){const note=document.createElement('span');note.className='learnedBadge';note.textContent='LEARNED CORRECTION';el.querySelector('h3')?.appendChild(note)}})};
}

installLearningCapture();
ensureManualAddUI();
