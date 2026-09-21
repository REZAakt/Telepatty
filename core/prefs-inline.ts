/**
 * The pre-paint boot script injected into `<head>` by nuxt.config.ts.
 *
 * It MUST be a standalone ES5 string (it runs before any bundle is loaded) and
 * it MUST stay in sync with `applyPrefsToDocument()` in core/prefs.ts —
 * core/prefs.test.ts executes both against the same seeded document and fails
 * when they disagree.
 *
 * It reads the versioned snapshot (`tp.prefs.v1`), falls back to the 0.1.x
 * mirrors (`tp.lang` / `tp.appearance`) for installs that have not migrated
 * yet, and applies lang / dir / theme before the first paint — no flash, no
 * wrong-direction frame, even while the async IndexedDB read is still pending.
 * Everything is try/catch-wrapped: unavailable storage must never break boot.
 */
export const PREFS_BOOT_SCRIPT = [
  'try{(function(){',
  'var e=document.documentElement,s=e.style,j=null,lang=null,ac=null,fs=null,rd=null,mo=null,bu=null,tx=null,rm=false,pd=null,de=null;',
  "try{j=JSON.parse(localStorage.getItem('tp.prefs.v1')||'null')}catch(_){j=null}",
  "if(!j||typeof j!=='object'){j=null;",
  "try{var l=localStorage.getItem('tp.lang');if(l==='fa'||l==='en')lang=l;",
  "var a=JSON.parse(localStorage.getItem('tp.appearance')||'null');",
  "if(a&&typeof a==='object'){ac=a.accent;fs=a.fontSize;rd=a.radius;mo=a.colorMode;bu=a.bubbleStyle;tx=a.texture;rm=a.reducedMotion===true;pd=a.presetId;de=a.density}}catch(_){}}",
  'else{var p=j.appearance||{};lang=j.language;ac=p.accent;fs=p.fontSize;rd=p.radius;mo=p.colorMode;bu=p.bubbleStyle;tx=p.texture;rm=p.reducedMotion===true;pd=p.presetId;de=p.density}',
  "if(lang==='fa'){e.setAttribute('lang','fa-IR');e.setAttribute('dir','rtl')}else{e.setAttribute('lang','en');e.setAttribute('dir','ltr')}",
  "var mq=true;try{mq=window.matchMedia('(prefers-color-scheme: dark)').matches}catch(_){}",
  "var dark=mo==='dark'||(mo!=='light'&&(!mo||mq));",
  "e.style.colorScheme=dark?'dark':'light';",
  "var P={matrix:'#00ff9d',cyber:'#22d3ee',amber:'#fbbf24',stealth:'#818cf8'};",
  "e.style.setProperty('--tp-accent',(typeof ac==='string'&&/^#[0-9a-fA-F]{3,8}$/.test(ac))?ac:(P[pd]||P.matrix));",
  "e.style.setProperty('--tp-font-size',(typeof fs==='number'&&isFinite(fs)?Math.min(22,Math.max(12,Math.round(fs))):15)+'px');",
  "var r=(typeof rd==='number'&&isFinite(rd))?Math.min(1.5,Math.max(0,rd)):0.5;",
  "e.style.setProperty('--tp-radius',r+'rem');e.style.setProperty('--ui-radius',r+'rem');",
  "e.style.setProperty('--tp-density',de==='compact'?'0.42rem':'0.75rem');",
  "e.classList.toggle('tp-reduced-motion',rm);e.classList.toggle('tp-bubble-flat',bu==='flat');e.classList.toggle('no-texture',tx===false);",
  '})()}catch(_){}',
].join('')

