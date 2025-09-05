export const $=sel=>document.querySelector(sel);
export const $$=sel=>Array.from(document.querySelectorAll(sel));
export const el=(tag,props={},...children)=>{ const n=document.createElement(tag); Object.assign(n,props); for(const c of children){ if(typeof c==='string') n.appendChild(document.createTextNode(c)); else if(c) n.appendChild(c);} return n; };
export const sentCount=(txt)=>!txt?0: txt.trim().split(/[.!?\n]+/).filter(Boolean).length;
export const CHAR_LIMITS={ name:20, info:500, abilityName:20, abilityDesc:100, narrative:1000, summary:200, episode:500, abilitySentMax:4, narrativeSentMax:20, summarySentMax:8, episodeSentMax:25 };
