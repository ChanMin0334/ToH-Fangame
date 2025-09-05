export const routes = {
  home:      { path: /^#\/home$/,            tab: 'home' },
  adventure: { path: /^#\/adventure$/,       tab: 'adventure' },
  rankings:  { path: /^#\/rankings$/,        tab: 'rankings' },
  char:      { path: /^#\/char\/(.+)$/,      tab: 'char' },
  create:    { path: /^#\/create$/,          tab: 'create' }
};

export function highlightTab(){
  const hash = location.hash || '#/home';
  const tab = hash.split('/')[1];
  document.querySelectorAll('.bottombar a').forEach(a=>{
    a.classList.toggle('active', a.dataset.tab===tab);
  });
}


export function router(){
  const hash = location.hash || '#/home';
  const [_, path, id] = hash.split('/');
  const event = new CustomEvent('route', { detail: { path, id } });
  window.dispatchEvent(event);
}
