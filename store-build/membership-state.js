(() => {
'use strict';
const KEY='zovo_tab_membership_v1',PRIOR='zovo_tab_prior_member_v1',LICENSE_KEYS=['isPro','licenseKey','verifiedAt','serverSignature'],campaign='founder-membership-2026-09';let observed=false;
async function read(){const d=await chrome.storage.local.get([KEY,PRIOR,...LICENSE_KEYS,'focusModeActive']);const n=d[KEY];observed=observed||d[PRIOR]===true||Boolean(d.isPro)||Boolean(d.licenseKey)||Boolean(d.verifiedAt)||Boolean(d.serverSignature);if(observed&&d[PRIOR]!==true)await chrome.storage.local.set({[PRIOR]:true});if(observed)return{kind:'protected',notice:n};if(d.isPro!==undefined&&typeof d.isPro!=='boolean'||d.licenseKey!=null&&typeof d.licenseKey!=='string'||d.verifiedAt!==undefined&&(typeof d.verifiedAt!=='number'||!Number.isFinite(d.verifiedAt)||d.verifiedAt<0)||n!==undefined&&(typeof n!=='object'||n===null||Array.isArray(n)))return{kind:'unknown'};return{kind:'free',notice:n,focusActive:d.focusModeActive===true}}
async function dismiss(){const d=await chrome.storage.local.get(KEY);await chrome.storage.local.set({[KEY]:{...d[KEY],dismissedCampaign:campaign,shownAt:Date.now()}})}
// Start the raw snapshot before popup.js can reverify an existing license.
const initial=read().catch(()=>({kind:'unknown'}));
globalThis.ZovoTabMembership={KEY,LICENSE_KEYS,campaign,read,dismiss,initial};
})();
