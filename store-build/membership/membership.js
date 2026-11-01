'use strict';
// Entitlement and notice eligibility belong to the extension adapter, not this page.
// Dismissal is synchronous so the adapter can persist it before the tab closes.
function dismissNote() {
  const useDefaultClose = document.dispatchEvent(new CustomEvent('zovo-membership-dismiss', {cancelable: true}));
  document.getElementById('letter').hidden = true;
  document.getElementById('closed').hidden = false;
  document.getElementById('closedTitle').focus();
  if (useDefaultClose) window.close();
}
document.querySelectorAll('[data-dismiss]').forEach(button => button.addEventListener('click', dismissNote));
document.querySelector('.offer-jump').addEventListener('click', event => {
  event.preventDefault();
  document.getElementById('purchaseTitle').focus();
  document.getElementById('membership').scrollIntoView({block: 'start'});
});
