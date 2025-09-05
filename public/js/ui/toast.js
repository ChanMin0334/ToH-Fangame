// /public/js/ui/toast.js
let wrap = null;
function ensureWrap(){
  if(wrap) return wrap;
  wrap = document.createElement('div');
  wrap.className = 'toast-wrap'; // z-index 높게
  document.body.appendChild(wrap);
  return wrap;
}
export function showToast(msg, ms=1800){
  const w = ensureWrap();
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  w.appendChild(el);
  setTimeout(()=>{ el.classList.add('show'); }, 10);
  setTimeout(()=>{ el.classList.remove('show'); setTimeout(()=>el.remove(), 300); }, ms);
}
