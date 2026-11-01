(() => {
'use strict';
const M=ZovoTabMembership, id='zovo-membership-entry';let invalidated=false;
const timeout=p=>Promise.race([p,new Promise((_,reject)=>setTimeout(()=>reject(Error('timeout')),2500))]);
chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&[...M.LICENSE_KEYS,'focusModeActive'].some(k=>k in changes)){invalidated=true;document.getElementById(id)?.remove()}});
async function mount(){try {
 const snapshot=await timeout(M.initial);if(snapshot.kind!=='free')return;const first=await timeout(M.read());if(first.kind!=='free'||first.focusActive||invalidated)return;
 const n=first.notice;if(n?.dismissedCampaign===M.campaign||typeof n?.shownAt==='number'&&Date.now()-n.shownAt<30*864e5)return;
 const latest=await timeout(M.read());if(latest.kind!=='free'||latest.focusActive||invalidated)return;
 await timeout(chrome.storage.local.set({[M.KEY]:{...latest.notice,campaign:M.campaign,shownAt:Date.now()}}));if(invalidated)return;
 const card=document.createElement('section');card.id=id;card.setAttribute('aria-labelledby',id+'-title');
 const title=document.createElement('h2');title.id=id+'-title';title.textContent='A note from Michael';
 const copy=document.createElement('p');copy.textContent='Keep more sites awake, choose your own timer, and use Focus Mode with Pro. See the options and the developer behind them.';
 const link=document.createElement('a');link.href=chrome.runtime.getURL('membership/index.html');link.target='_blank';link.rel='noopener noreferrer';link.textContent='Explore membership';
 const dismiss=document.createElement('button');dismiss.type='button';dismiss.textContent='Not now';dismiss.setAttribute('aria-label','Dismiss membership note');dismiss.onclick=()=>{card.remove();M.dismiss().catch(()=>{})};
 const actions=document.createElement('div');actions.append(link,dismiss);card.append(title,copy,actions);document.body.append(card);
 }catch{}}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
})();
