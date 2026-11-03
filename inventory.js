const INVENTORY_KEY='pokemonActiveInventoryV1';
let ACTIVE_INVENTORY=[];

function invEsc(s){return String(s??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]))}
function invMoney(n){return new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(Number(n)||0)}
function invLoad(){try{ACTIVE_INVENTORY=JSON.parse(localStorage.getItem(INVENTORY_KEY)||'[]')||[]}catch{ACTIVE_INVENTORY=[]}}
function invSave(){try{localStorage.setItem(INVENTORY_KEY,JSON.stringify(ACTIVE_INVENTORY))}catch{}}
function invBuyPct(m){m=Number(m)||0;if(m>=200)return .72;if(m>=75)return .70;if(m>=25)return .68;return .65}
function invSalePct(){return .95}

window.inventoryAddCard=function(card,qty=1){
  if(!card?.id)return;
  const market=Number(card.market)||0,q=Math.max(1,Number(qty)||1);
  const existing=ACTIVE_INVENTORY.find(x=>x.id===card.id);
  if(existing){existing.qty=(Number(existing.qty)||1)+q}
  else ACTIVE_INVENTORY.push({
    id:card.id,name:card.name||'',set:card.set||'',number:card.number||'',image:card.image||'',variant:card.variant||'',
    market,qty:q,cost:market?Number((market*invBuyPct(market)).toFixed(2)):0,salePrice:market?Number((market*invSalePct()).toFixed(2)):0,addedAt:Date.now()
  });
  invSave();invRender();
  const status=document.querySelector('#inventoryStatus');if(status)status.textContent=`Added ${card.name} to active inventory.`;
};
function invRemove(i){ACTIVE_INVENTORY.splice(i,1);invSave();invRender()}
function invChange(i,key,value){if(!ACTIVE_INVENTORY[i])return;ACTIVE_INVENTORY[i][key]=key==='qty'?Math.max(1,Number(value)||1):Math.max(0,Number(value)||0);invSave();invRender()}
function invClear(){if(!ACTIVE_INVENTORY.length||confirm('Clear all active inventory?')){ACTIVE_INVENTORY=[];invSave();invRender()}}

function invRender(){
  const rows=document.querySelector('#inventoryRows'),summary=document.querySelector('#inventorySummary');if(!rows||!summary)return;
  let units=0,marketTotal=0,costTotal=0,saleTotal=0;rows.innerHTML='';
  ACTIVE_INVENTORY.forEach((c,i)=>{
    const q=Math.max(1,Number(c.qty)||1),market=Number(c.market)||0,cost=Number(c.cost)||0,sale=Number(c.salePrice)||0;
    units+=q;marketTotal+=market*q;costTotal+=cost*q;saleTotal+=sale*q;
    const profit=(sale-cost)*q;
    const div=document.createElement('div');div.className='invRow';
    div.innerHTML=`${c.image?`<img src="${invEsc(c.image)}" alt="${invEsc(c.name)}">`:'<div class="invNoImg"></div>'}<div class="invInfo"><b>${invEsc(c.name)}</b><span>${invEsc(c.set)} · ${invEsc(c.number)}</span><small>${c.variant?`TCGplayer ${invEsc(c.variant)}`:'TCGplayer market'}</small></div><div class="invMarket"><span>Market</span><b>${market?invMoney(market):'—'}</b></div><div class="invEdit"><label>Qty<input type="number" min="1" value="${q}" data-inv-qty="${i}"></label><label>Purchase cost<input type="number" min="0" step="0.01" value="${cost.toFixed(2)}" data-inv-cost="${i}"></label><label>Sale price<input type="number" min="0" step="0.01" value="${sale.toFixed(2)}" data-inv-sale="${i}"></label></div><div class="invProfit"><span>Projected profit</span><b>${invMoney(profit)}</b><small>${q>1?`${invMoney(profit/q)} each`:''}</small><button class="ghost" data-inv-remove="${i}">Remove</button></div>`;
    rows.appendChild(div);
  });
  rows.querySelectorAll('[data-inv-qty]').forEach(x=>x.onchange=()=>invChange(Number(x.dataset.invQty),'qty',x.value));
  rows.querySelectorAll('[data-inv-cost]').forEach(x=>x.onchange=()=>invChange(Number(x.dataset.invCost),'cost',x.value));
  rows.querySelectorAll('[data-inv-sale]').forEach(x=>x.onchange=()=>invChange(Number(x.dataset.invSale),'salePrice',x.value));
  rows.querySelectorAll('[data-inv-remove]').forEach(x=>x.onclick=()=>invRemove(Number(x.dataset.invRemove)));
  summary.innerHTML=`<div class="scanMetric"><span>Inventory units</span><b>${units}</b></div><div class="scanMetric"><span>Market value</span><b>${invMoney(marketTotal)}</b></div><div class="scanMetric"><span>Cost basis</span><b>${invMoney(costTotal)}</b></div><div class="scanMetric"><span>Expected revenue</span><b>${invMoney(saleTotal)}</b></div><div class="scanMetric"><span>Projected profit</span><b>${invMoney(saleTotal-costTotal)}</b></div>`;
  if(!ACTIVE_INVENTORY.length)rows.innerHTML='<div class="empty">No active inventory yet. Add cards from the Card List Builder.</div>';
}

// Handle all three top-level views, including the new inventory tab.
document.querySelectorAll('.tab').forEach(btn=>btn.addEventListener('click',()=>{
  const name=btn.dataset.tab;
  document.querySelectorAll('.tab').forEach(b=>b.classList.toggle('active',b.dataset.tab===name));
  document.querySelector('#watchlistView')?.classList.toggle('active',name==='watchlist');
  document.querySelector('#scannerView')?.classList.toggle('active',name==='scanner');
  document.querySelector('#inventoryView')?.classList.toggle('active',name==='inventory');
}));

function invInit(){invLoad();document.querySelector('#clearInventoryBtn')?.addEventListener('click',invClear);invRender()}
invInit();
