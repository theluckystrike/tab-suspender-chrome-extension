(() => {
'use strict';
const M=ZovoTabMembership,letter=document.getElementById('letter'),closed=document.getElementById('closed'),title=document.getElementById('closedTitle');let generation=0,dismissed=false;letter.hidden=true;
const timeout=p=>Promise.race([p,new Promise((_,reject)=>setTimeout(()=>reject(Error('timeout')),2500))]);
function recovery(){letter.hidden=true;closed.hidden=false;title.textContent='Your membership comes first.';closed.querySelector('p').textContent='You do not need to buy again. Open Tab Suspender settings to check or restore your existing license.';if(!closed.querySelector('[data-account]')){const a=document.createElement('a');a.dataset.account='true';a.href='../settings.html';a.textContent='Open license settings';closed.append(a)}}
async function check(){if(dismissed)return;const request=++generation;letter.hidden=true;try{const snapshot=await timeout(M.initial);if(request!==generation||dismissed)return;if(snapshot.kind!=='free')return recovery();const status=await timeout(M.read());if(request!==generation||dismissed)return;if(status.kind!=='free')return recovery();const latest=await timeout(M.read());if(request!==generation||dismissed)return;if(latest.kind!=='free')return recovery();closed.hidden=true;letter.hidden=false}catch{if(request===generation&&!dismissed)recovery()}}
document.addEventListener('zovo-membership-dismiss',event=>{event.preventDefault();dismissed=true;++generation;M.dismiss().then(()=>window.close()).catch(()=>{})});
chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&M.LICENSE_KEYS.some(k=>k in changes))check()});window.addEventListener('focus',check);check();
})();
