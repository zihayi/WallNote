import sharp from 'sharp';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { prints } from './wallpaper-prints.mjs';

await mkdir('public/wallpapers', { recursive: true });
const shell = (defs, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080"><defs>${defs}<filter id="grain"><feTurbulence type="fractalNoise" baseFrequency=".7" numOctaves="3" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="linear" slope=".055"/></feComponentTransfer><feBlend in="SourceGraphic" mode="soft-light"/></filter></defs><g filter="url(#grain)">${body}</g></svg>`;
const gradient = (id, a, b, x = 0, y = 1) => `<linearGradient id="${id}" x2="${x}" y2="${y}"><stop stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`;
const landscapes = {
  mist: shell(
    gradient('sky', '#b9c9bf', '#eef0d9') + gradient('back', '#94b0a5', '#b8c5ad') + gradient('mid', '#6b8c7a', '#8fa184') + gradient('front', '#365d50', '#638066') + '<radialGradient id="light"><stop stop-color="#fffde3" stop-opacity=".7"/><stop offset="1" stop-color="#fffde3" stop-opacity="0"/></radialGradient>',
    '<path fill="url(#sky)" d="M0 0h1920v1080H0z"/><ellipse cx="1380" cy="220" rx="680" ry="450" fill="url(#light)"/><circle cx="1390" cy="230" r="62" fill="#f3f1d4" opacity=".6"/><path d="M0 540Q170 440 310 480T600 430Q790 290 990 405T1320 380Q1560 270 1920 400V1080H0Z" fill="#aec1b3"/><path d="M0 590Q240 620 420 535T840 490Q1040 540 1230 450T1650 510L1920 470V1080H0Z" fill="url(#back)"/><path d="M0 700Q180 560 390 605T820 660Q1050 680 1220 570T1580 580Q1760 660 1920 570V1080H0Z" fill="url(#mid)"/><path d="M0 740Q200 700 390 790T830 760Q1190 570 1460 710T1920 700V1080H0Z" fill="#547967"/><path d="M0 820Q310 680 590 840T1140 850Q1490 760 1920 870V1080H0Z" fill="url(#front)"/><path d="M0 1040Q310 860 610 940T1170 930Q1530 820 1920 1020V1080H0Z" fill="#304f44"/><path d="M1080 1080Q890 1020 1030 970T1060 910Q1015 890 1120 852" stroke="#c4bd8f" stroke-width="7" opacity=".45" fill="none"/>'
  ),
  coast: shell(gradient('sky', '#a9d0d5', '#e6ebdf') + gradient('sea', '#72a8b8', '#b1d5cc') + gradient('sand', '#e3cfa9', '#f1e6ca'), '<path fill="url(#sky)" d="M0 0h1920v1080H0z"/><circle cx="1430" cy="230" r="70" fill="#fcf4dc"/><path d="M0 480Q650 460 1920 480V1080H0Z" fill="url(#sea)"/><path d="M0 1010Q460 650 1000 745T1920 590V1080H0Z" fill="#e5ece0"/><path d="M0 1050Q480 700 1010 792T1920 635V1080H0Z" fill="url(#sand)"/><path d="M0 924Q460 610 1000 706T1920 550" fill="none" stroke="#ebf3e9" stroke-width="4" opacity=".6"/><path d="M0 480l270-78 250 78" fill="#83a6a5"/><path d="M1340 384q16-12 32 0 16-12 32 0M1430 350q12-10 24 0 12-10 24 0" stroke="#55747b" stroke-width="3" fill="none"/>'),
  dusk: shell(gradient('sky', '#9994b5', '#f0c4a7') + gradient('front', '#6b6482', '#3e435e'), '<path fill="url(#sky)" d="M0 0h1920v1080H0z"/><circle cx="960" cy="460" r="125" fill="#f9d7ab"/><path d="M0 650L210 530 380 580 650 400 910 645 1200 490 1430 610 1680 460 1920 600V1080H0Z" fill="#bb9ca8"/><path d="M0 700l300-80 260 100 380-150 350 160 300-150 330 90v410H0Z" fill="#95849e"/><path d="M0 830Q340 680 620 800T1170 750Q1500 660 1920 820V1080H0Z" fill="url(#front)"/><path d="M0 1010Q310 880 700 950T1410 920Q1740 830 1920 950V1080H0Z" fill="#41465f"/>'),
  dunes: shell(gradient('sky', '#dfd3bf', '#f5e9cd') + gradient('dune1', '#e4c6a0', '#bf8b66') + gradient('dune2', '#d7aa80', '#a46e51'), '<path fill="url(#sky)" d="M0 0h1920v1080H0z"/><circle cx="1380" cy="270" r="75" fill="#fff2cf"/><path d="M0 710Q400 370 900 680T1920 490V1080H0Z" fill="#e7cda8"/><path d="M0 710Q400 370 900 680Q500 530 350 1080H0Z" fill="url(#dune1)"/><path d="M0 1080Q700 450 1220 720T1920 770V1080Z" fill="#e1b58b"/><path d="M0 1080Q700 450 1220 720Q870 740 800 1080Z" fill="url(#dune2)"/><path d="M1090 1080Q1470 760 1920 840V1080Z" fill="#b98260"/>'),
  bloom: shell('<radialGradient id="base"><stop stop-color="#e8c3cb"/><stop offset="1" stop-color="#c0bedb"/></radialGradient><filter id="blur"><feGaussianBlur stdDeviation="100"/></filter>', '<path fill="url(#base)" d="M0 0h1920v1080H0z"/><g filter="url(#blur)"><ellipse cx="300" cy="800" rx="600" ry="380" fill="#97b6c7"/><ellipse cx="1400" cy="800" rx="550" ry="350" fill="#eebfbc"/><ellipse cx="1000" cy="300" rx="520" ry="260" fill="#f3dfc8"/><ellipse cx="1700" cy="80" rx="480" ry="320" fill="#b5a6ce"/></g><path d="M0 980Q680 450 1920 700" fill="none" stroke="#fff" stroke-opacity=".18" stroke-width="2"/>'),
  sage: shell(gradient('bg', '#e6e7d4', '#b8c5a9') + gradient('leaf', '#839e81', '#476d5d'), '<path fill="url(#bg)" d="M0 0h1920v1080H0z"/><circle cx="960" cy="540" r="340" fill="#edf0de" opacity=".5"/><g fill="url(#leaf)"><path d="M950 1080Q300 670 420 290Q880 360 950 1080"/><path d="M950 1080Q920 360 1320 160Q1510 620 950 1080"/><path d="M950 1080Q1290 630 1750 740Q1510 1150 950 1080"/></g><g fill="none" stroke="#e1e8cc" stroke-width="3" opacity=".4"><path d="M950 1080Q580 650 420 290M950 1080Q1160 550 1320 160M950 1080Q1360 830 1750 740"/></g>'),
  ...prints(shell,gradient),
};

// One large raster at a time. Reuse it for the gallery and glass backgrounds.
const inputs=await Promise.all([import.meta.url,new URL('./wallpaper-prints.mjs',import.meta.url)].map(url=>stat(new URL(url))));
const modified=Math.max(...inputs.map(s=>s.mtimeMs));
for(const [name,svg] of Object.entries(landscapes)) {
  const [full,thumb,blur]=['','-thumb','-blur'].map(s=>`public/wallpapers/${name}${s}.jpg`);
  if((await Promise.all([full,thumb,blur].map(f=>stat(f).catch(()=>null)))).every(s=>s?.size && s.mtimeMs>=modified))continue;
  const image=await sharp(Buffer.from(svg)).jpeg({quality:92,mozjpeg:true}).toBuffer();
  await writeFile(full,image);
  await sharp(image).resize(480).jpeg({quality:82,mozjpeg:true}).toFile(thumb);
  await sharp(image).resize(640).blur(8).jpeg({quality:86,mozjpeg:true}).toFile(blur);
}
const icon = '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" rx="64" fill="#427964"/><rect x="53" y="57" width="64" height="142" rx="12" fill="#fff"/><rect x="130" y="57" width="73" height="66" rx="12" fill="#d7e9b9"/><rect x="130" y="136" width="73" height="63" rx="12" fill="#fff"/></svg>';
await sharp(Buffer.from(icon)).png().toFile('public/icon.png');
console.log(`Ready: ${Object.keys(landscapes).length} offline wallpapers, thumbnails, glass backgrounds and app icon.`);
