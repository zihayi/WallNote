// Original vector masters. Detail stays at the edges so desktop cards remain legible.
const repeat=(count,draw)=>Array.from({length:count},(_,i)=>draw(i)).join('');
export function prints(shell,gradient) {
  return {
    headland:shell(gradient('sky','#9eb7bd','#f0d6b9')+gradient('water','#829e9f','#476b79'), `
      <rect width="1920" height="1080" fill="url(#sky)"/><circle cx="415" cy="350" r="89" fill="#f5dfbf"/>
      <path d="M0 572 Q190 544 330 566T698 570L852 591H0Z" fill="#9bacaa"/>
      <path d="M0 590H1920V1080H0Z" fill="url(#water)"/>
      <g stroke="#dfddc3" stroke-linecap="round" opacity=".58">${repeat(33,i=>`<path d="M${(i*197)%1450} ${610+(i*61)%390}h${30+(i*37)%115}" stroke-width="${i%3+1}"/>`)}</g>
      <path d="M895 780l112-36 135-15 91-72 163-21 69-61 146-23 91-47 218-7v583H895Z" fill="#8d7568"/>
      <path d="M898 782l231-42 132-62 154-18 81-65 130-17 76-41 218-18v78l-195 16-95 94-128 19-158 103-202 26Z" fill="#c39575"/>
      <path d="M853 810l265-61 120-60 160-21 101-69 138-13 85-45 198-15v-50l-236 21-93 53-139 16-67 64-155 18-106 71-135 21Z" fill="#667569"/>
      <g transform="translate(1595 403)"><path d="M-12 149l7-120h29l9 117Z" fill="#f5e6c8"/><path d="M-7 89l2-25h32l2 24Z" fill="#bd6755"/><path d="M-8 31V7h35v24Z" fill="#344d56"/><path d="M-16 8L10-8 35 8Z" fill="#aa574c"/><path d="M-3 13h22v12H-3Z" fill="#e5cb90"/></g>
      <path d="M1290 1080q173-157 305-167t325-97v264Z" fill="#405856"/>`),
    snowline:shell(gradient('sky','#889fb1','#e9e8da')+gradient('lake','#c0ced0','#829aa1'), `
      <rect width="1920" height="1080" fill="url(#sky)"/><circle cx="1370" cy="263" r="66" fill="#efeade"/>
      <path d="M0 672l255-224 172 85 295-248 184 154 189-203 306 283 236-132 283 226v467H0Z" fill="#8297a6"/>
      <path d="M444 530l278-245 184 154-126-64-21 63-47-52-84 97 12-72Z M921 420l174-184 224 210-151-91-29 54-40-87-51 80 3-42Z M1492 466l145-79 137 110-123-53-35 24 4-33Z" fill="#ecebe0"/>
      <path d="M0 658l190-129 163 46 235-70-67 97 174-58 171 97 173-153 67 111 159-72 182 63 135-71 338 152v409H0Z" fill="#526b7b"/>
      <path d="M0 715q226-66 473-39t420 4q240-59 458-18t569-15v433H0Z" fill="url(#lake)"/>
      <path d="M0 732q298-28 462-5t378-14q-170 60-442 36t-398 13Z" fill="#e2e6dc"/>
      <g fill="#344e59">${repeat(48,i=>{const x=1150+i*18,h=30+(i*29)%78,y=897-0.11*(x-1150)+18*Math.sin(i/6);return `<path d="M${x} ${y-h}l${-h*.22} ${h*.72}h${h*.13}l${-h*.2} ${h*.35}h${h*.58}l${-h*.2} ${-h*.35}h${h*.12}Z"/>`;})}<path d="M850 1002q244-95 411-120t352-38l307-62v298H850Z"/></g>`),
    bamboo:shell(gradient('night','#182f38','#607570'), `
      <rect width="1920" height="1080" fill="url(#night)"/><circle cx="1290" cy="305" r="134" fill="#e1d2ab"/>
      <path d="M0 894q233-183 507-122t468-31q215-108 463-45t482 1v383H0Z" fill="#576d67"/>
      <path d="M0 895q258-124 514-55t502-20q350-139 904 29v231H0Z" fill="#435b59"/>
      <defs><g id="sprig"><path d="M0 0Q102-26 208-125" stroke="currentColor" stroke-width="4" fill="none"/>
      <path d="M42-14q4-56 44-94-8 63-44 94m30-14q46 8 106-2-55-21-106 2m38-25q4-60 45-97-7 65-45 97m33-30q49 3 95-15-51-13-95 15m32-27q9-44 42-71-3 42-42 71" fill="currentColor"/></g></defs>
      <g color="#2d4748" opacity=".8" transform="translate(85 42)"><path d="M-50 1100Q57 585 16-120M45 1110Q110 626 183 400" fill="none" stroke="currentColor" stroke-width="12"/><use href="#sprig" transform="translate(32 365) scale(1.3)"/><use href="#sprig" transform="translate(18 162) rotate(15)"/><use href="#sprig" transform="translate(139 555) rotate(22)"/></g>
      <g color="#213c40" transform="translate(1780 0)"><path d="M120 1100Q-43 536 8-100M-112 1100Q-156 720-227 500" stroke="currentColor" stroke-width="16" fill="none"/>
      <use href="#sprig" transform="translate(1 387) scale(-1.5 1.5) rotate(-12)"/><use href="#sprig" transform="translate(28 684) scale(1.2)"/><use href="#sprig" transform="translate(-180 692) scale(-1 1) rotate(-14)"/><use href="#sprig" transform="translate(-4 166) scale(-.9 .9)"/></g>`),
    terraces:shell(gradient('sky','#c6cebb','#f1dfb5'), `
      <rect width="1920" height="1080" fill="url(#sky)"/><path d="M0 545q256-126 501-55t438-16q276-153 516-84t465 4v686H0Z" fill="#adb294"/>
      <path d="M0 617q319-92 563-52t531-55q392-125 826 15v555H0Z" fill="#979a71"/>
      ${repeat(10,i=>{const y=540+i*51;return `<path d="M-40 ${y+10} Q${260+i*18} ${y-35-i*8} ${625+i*12} ${y+32}T1200 ${y+12}Q1560 ${y-125+i*5} 1960 ${y-65+i*10}V1120H-40Z" fill="${['#c8bb84','#a7965e','#dcc58c','#bba169','#d9c190'][i%5]}" stroke="#8c8057" stroke-width="${2+i*.36}"/>`;})}
      <path d="M0 1080v-88q182-16 221-87 37-65 152-81-116 55-132 98-28 83-180 158Z" fill="#81764d"/>
      <g transform="translate(1462 461)"><path d="M0 19h58v27H0Z" fill="#e6d7b6"/><path d="M-9 20L17 0h40l16 20Z" fill="#695d4f"/><path d="M36 29h12v17H36Z" fill="#80735c"/></g>`),
    print:shell('<pattern id="hatch" width="15" height="15" patternUnits="userSpaceOnUse" patternTransform="rotate(32)"><path d="M0 0v15" stroke="#29424a" stroke-width="4"/></pattern>', `
      <rect width="1920" height="1080" fill="#eee3c9"/>
      <g transform="translate(1240 550)"><circle r="301" fill="#c05b44"/><path d="M-301 0h602A301 301 0 0 1-301 0Z" fill="#dd956e"/><path d="M-510-397h209V0h-209Z" fill="#2c434e"/><path d="M-510 0a209 209 0 0 0 209 209V0Z" fill="#73948d"/>
      <circle cx="301" cy="184" r="158" fill="url(#hatch)"/><path d="M-164 315h530v49h-530Z" fill="#2b414a"/></g>
      <g fill="#384e53"><rect x="206" y="833" width="138" height="7"/><circle cx="208" cy="804" r="10"/><circle cx="247" cy="804" r="10" fill="#c05b44"/></g>`),
    contours:shell(gradient('sea','#223650','#486a81',1,1), `
      <rect width="1920" height="1080" fill="url(#sea)"/>
      <g fill="none">${repeat(48,i=>{const x=30*i-530,y=i*13-55;return `<path d="M${x} -50 C${x+195} ${180+y},${x+590} ${140+y},${x+572} ${337+y} S${x+180} ${589+y},${x+455} ${755+y} S${x+955} ${926+y},${x+774} 1220" stroke="${i%6===0?'#c1d1c1':'#82a8ad'}" stroke-opacity="${i%6===0?.69:.62}" stroke-width="${i%6===0?2.6:1.35}"/>`;})}</g>
      <circle cx="1561" cy="251" r="51" fill="#cbb78e"/><circle cx="1561" cy="251" r="70" fill="none" stroke="#b9bfac" stroke-opacity=".53"/>`),
  };
}
