(() => {
'use strict';
const $=s=>document.querySelector(s), KEY='pokemonBuyingOpportunitiesV1',SET='pokemonBuyingRulesV1',FEED='pokemonBuyingFeedUrlV1';
let cards=[],listings=[],lastFeed='';
const f=(n)=>'$'+(Number(n)||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const norm=x=>String(x||'').toLowerCase().replace(/[^a-z0-9]/g,'');
const key=c=>[c.card||c.name,c.set,c.number].map(norm).join('|');
const num=(v,def=0)=>Number.isFinite(Number(v))?Number(v):def;
const ruleIds=['feeRate','fixedFee','shipCost','minProfit','minROI','riskRate'];
const rules=()=>Object.fromEntries(ruleIds.map(id=>[id,num($('#'+id).value)]));
const safeRead=(k,d)=>{try{return JSON.parse(localStorage.getItem(k))??d}catch{return d}};
const save=()=>localStorage.setItem(KEY,JSON.stringify(listings));
function matches(l){return cards.find(c=>key(c)===key(l))}
function evaluate(l,r){
 const c=matches(l),ask=num(l.ask,NaN),inbound=num(l.shipping),buy=ask+inbound;
 if(!c||!Number.isFinite(ask)||ask<=0)return {...l,cardRef:c,eligible:false,warning:'Exact card not found in watchlist',profit:NaN,roi:NaN};
 const resale=num(c.resale)||num(c.market),market=num(c.market);
 const fees=resale*r.feeRate/100+r.fixedFee,risks=resale*r.riskRate/100,profit=resale-fees-r.shipCost-risks-buy,roi=buy>0?profit/buy*100:0;
 const isGrade=/PSA|BGS|CGC/i.test(l.condition||''),isRisky=isGrade||!['Near Mint','NM'].includes(l.condition||'');
 const stale=!c.priceAsOf || Date.now()-new Date(c.priceAsOf+'T12:00:00').getTime()>14*864e5;
 const warning=isGrade?'Grade-matched market comp required':isRisky?'Condition-adjusted sold comps required':stale?'Market benchmark older than 14 days':'Confirm authenticity, availability & exact printing';
 return {...l,cardRef:c,market,resale,buy,profit,roi,maxOffer:resale-fees-r.shipCost-risks-r.minProfit-inbound,eligible:!isRisky&&profit>=r.minProfit&&roi>=r.minROI,review:isRisky||stale,warning};
}
function render(){
 const r=rules(),q=norm($('#oppSearch').value),filter=$('#oppFilter').value,sort=$('#oppSort').value;
 let ev=listings.map(l=>evaluate(l,r));
 const qualified=ev.filter(x=>x.eligible).length;
 $('#oppStats').innerHTML=[['Tracked listings',ev.length],['Meets profit targets',qualified],['Requires condition review',ev.filter(x=>x.review).length],['Estimated qualifying profit',f(ev.filter(x=>x.eligible).reduce((s,x)=>s+x.profit,0))]].map(([a,b])=>'<div class="opp-stat"><span>'+a+'</span><b>'+b+'</b></div>').join('');
 ev=ev.filter(x=>(filter==='all'||(filter==='qualified'&&x.eligible)||(filter==='review'&&x.review)||(filter==='rejected'&&!x.eligible&&!x.review))&&(!q||norm([x.card,x.set,x.number,x.source].join(' ')).includes(q)));
 ev.sort((a,b)=>sort==='roi'?(b.roi||-999)-(a.roi||-999):sort==='new'?String(b.observedAt||'').localeCompare(String(a.observedAt||'')):(b.profit||-999)-(a.profit||-999));
 $('#oppCount').textContent=ev.length+' shown';
 $('#oppRows').innerHTML=ev.length?ev.map(l=>{
 const cls=l.eligible?'good':l.review?'warn':'bad',status=l.eligible?'Meets thresholds · verify':l.review?'Review needed':'Below thresholds';
 const url=/^https:\/\//i.test(l.url||'')?l.url:'';
 return '<article class="opp-row"><div><h4>'+esc(l.card)+' · '+esc(l.number)+'</h4><p>'+esc(l.set)+' · '+esc(l.source)+' · '+esc(l.condition||'Unverified')+'</p><p>'+esc(l.notes||'')+'</p><span class="opp-badge '+cls+'">'+status+'</span></div><div class="opp-num"><span>All-in purchase</span><b>'+f(l.buy||0)+'</b><span>Market: '+f(l.market||0)+'</span></div><div class="opp-num"><span>Est. contribution</span><b>'+ (Number.isFinite(l.profit)?f(l.profit):'N/A')+'</b><span>ROI: '+(Number.isFinite(l.roi)?l.roi.toFixed(1)+'%':'N/A')+'</span></div><div class="opp-num"><span>Max offer for min profit</span><b>'+(Number.isFinite(l.maxOffer)?f(Math.max(0,l.maxOffer)):'N/A')+'</b><span>Resale: '+f(l.resale||0)+'</span></div><div class="opp-last"><span class="opp-help">'+esc(l.warning||'')+' · Observed: '+esc(l.observedAt||'not provided')+'</span><div>'+(url?'<a class="opp-link" href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">Check seller listing ↗</a>':'')+'<button class="ghost" data-delete="'+esc(l.id)+'">Remove</button></div></div></article>';
 }).join(''):'<div class="opp-empty">No listings yet. Import a feed or add a direct offer above. Watchlist market targets alone are not live sale listings.</div>';
}
function normalize(raw){
 if(!raw||typeof raw!=='object')return null;
 const l={card:String(raw.card||raw.name||'').trim(),set:String(raw.set||'').trim(),number:String(raw.number||'').trim(),ask:num(raw.ask??raw.price,NaN),shipping:num(raw.shipping??raw.inbound,0),condition:String(raw.condition||'Unverified'),source:String(raw.source||'Other'),url:String(raw.url||''),notes:String(raw.notes||''),observedAt:String(raw.observedAt||raw.observed_at||new Date().toISOString())};
 if(!l.card||!l.set||!l.number||!Number.isFinite(l.ask)||l.ask<=0||!/^https:\/\//.test(l.url))return null;
 l.id=[key(l),l.source,l.url].join(':');return l;
}
function ingest(rows,where){
 const arr=Array.isArray(rows)?rows:Array.isArray(rows?.listings)?rows.listings:[];
 let count=0,ignored=0;const map=new Map(listings.map(l=>[l.id,l]));
 for(const raw of arr){const l=normalize(raw);if(!l){ignored++;continue}map.set(l.id,l);count++}
 listings=[...map.values()];save();render();return where+': '+count+' accepted, '+ignored+' invalid; '+listings.length+' total.';
}
function parseCsv(s){
 const rows=[];let row=[],field='',quoted=false;
 for(let i=0;i<s.length;i++){const c=s[i];if(c==='"'){if(quoted&&s[i+1]==='"'){field+='"';i++}else quoted=!quoted}else if(c===','&&!quoted){row.push(field);field=''}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&s[i+1]==='\n')i++;row.push(field);if(row.some(x=>x.trim()))rows.push(row);row=[];field=''}else field+=c}
 row.push(field);if(row.some(x=>x.trim()))rows.push(row);
 const head=(rows.shift()||[]).map(x=>x.trim());return rows.map(c=>Object.fromEntries(head.map((h,i)=>[h,c[i]||''])));
}
async function loadFeed(){
 const url=$('#oppFeedUrl').value.trim(),out=$('#oppFeedStatus');if(!url){out.textContent='Enter a HTTPS JSON feed URL.';return}
 if(!/^https:\/\//.test(url)){out.textContent='Feed URL must use HTTPS.';return}
 localStorage.setItem(FEED,url);
 try{out.textContent='Loading feed…';const res=await fetch(url,{cache:'no-store'});if(!res.ok)throw Error('HTTP '+res.status);const data=await res.json();out.textContent=ingest(data,'Feed updated')+' Check listing links for current availability.';lastFeed=new Date().toISOString()}catch(e){out.textContent='Could not load feed: '+e.message+'. Check CORS permissions, endpoint availability, and JSON structure.'}
}
function csvExport(){
 const head=['card','set','number','ask','shipping','condition','source','url','notes','observedAt'];
 const quote=v=>'"'+String(v??'').replace(/"/g,'""')+'"';
 const csv=[head.join(','),...listings.map(l=>head.map(h=>quote(l[h])).join(','))].join('\r\n');
 const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));a.download='pokemon-buying-opportunities.csv';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),3000);
}
async function init(){
 listings=safeRead(KEY,[]);if(!Array.isArray(listings))listings=[];
 const old=safeRead(SET,{});for(const id of ruleIds){if(old[id]!==undefined)$('#'+id).value=old[id];$('#'+id).addEventListener('input',()=>{localStorage.setItem(SET,JSON.stringify(rules()));render()})}
 $('#oppFeedUrl').value=localStorage.getItem(FEED)||new URL('./ebay-listings.json',window.location.href).href;
 try{const res=await fetch('./data.json',{cache:'no-store'});if(!res.ok)throw Error('HTTP '+res.status);const d=await res.json();cards=Array.isArray(d.cards)?d.cards:[];$('#oppCard').innerHTML='<option value="">Select exact card…</option>'+cards.map((c,i)=>'<option value="'+i+'">#'+esc(c.rank)+' '+esc(c.card)+' — '+esc(c.set)+' '+esc(c.number)+'</option>').join('');$('#oppStatus').textContent='Loaded '+cards.length+' watchlist cards. Market data as of '+(d.updatedAt||'unknown')+'.';}catch(e){$('#oppStatus').textContent='Could not load watchlist data: '+e.message}
 $('#oppAdd').addEventListener('submit',e=>{e.preventDefault();const c=cards[Number($('#oppCard').value)];if(!c)return;const l=normalize({card:c.card,set:c.set,number:c.number,ask:$('#oppAsk').value,shipping:$('#oppInbound').value,condition:$('#oppCondition').value,source:$('#oppSource').value,url:$('#oppUrl').value,notes:$('#oppNotes').value});if(!l){$('#oppStatus').textContent='Please provide a valid price and HTTPS direct URL.';return}listings=[l,...listings.filter(x=>x.id!==l.id)];save();render();$('#oppStatus').textContent='Listing added. Verify the original seller page before purchasing.';e.target.reset()});
 $('#oppRows').addEventListener('click',e=>{const b=e.target.closest('[data-delete]');if(!b)return;listings=listings.filter(l=>l.id!==b.dataset.delete);save();render()});
 for(const id of ['oppSearch','oppFilter','oppSort'])$('#'+id).addEventListener('input',render);
 $('#oppLoadFeed').addEventListener('click',loadFeed);$('#refreshOpportunities').addEventListener('click',async()=>{try{const r=await fetch('./data.json',{cache:'no-store'}),d=await r.json();cards=d.cards||cards;if($('#oppFeedUrl').value.trim())await loadFeed();render();$('#oppStatus').textContent='Watchlist benchmarks refreshed. Existing listing availability has not been independently verified.'}catch(e){$('#oppStatus').textContent='Refresh failed: '+e.message}});
 $('#oppImport').addEventListener('change',async e=>{const file=e.target.files?.[0];if(!file)return;try{const s=await file.text(),arr=file.name.toLowerCase().endsWith('.json')?JSON.parse(s):parseCsv(s);$('#oppFeedStatus').textContent=ingest(arr,'File imported')}catch(err){$('#oppFeedStatus').textContent='Import failed: '+err.message}});
 $('#oppExport').addEventListener('click',csvExport);
 $('#oppClear').addEventListener('click',()=>{if(confirm('Clear all saved buying listings on this device?')){listings=[];save();render()}});
 render();if($('#oppFeedUrl').value.trim())loadFeed();
 setInterval(()=>{if(document.visibilityState==='visible'&&$('#oppFeedUrl').value.trim())loadFeed()},30*60*1000);
}
init();
})();