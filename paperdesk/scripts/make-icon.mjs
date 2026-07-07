import { app, BrowserWindow } from 'electron'
import { writeFileSync, mkdirSync } from 'node:fs'

const OUT = '/Users/zhangyixuan06/work/paperdesk/build/icon-1024.png'

const svg = String.raw`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="80" y1="30" x2="960" y2="1010" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#1652E6"/>
      <stop offset="0.52" stop-color="#2C7BF2"/>
      <stop offset="1" stop-color="#1EB5EC"/>
    </linearGradient>
    <radialGradient id="glass" cx="0.36" cy="0.28" r="0.9">
      <stop offset="0" stop-color="#FFFFFF" stop-opacity="0.60"/>
      <stop offset="0.45" stop-color="#FFFFFF" stop-opacity="0.20"/>
      <stop offset="1" stop-color="#CDEBFF" stop-opacity="0.10"/>
    </radialGradient>
    <linearGradient id="ring" x1="672" y1="478" x2="672" y2="826" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#FFFFFF"/>
      <stop offset="1" stop-color="#CFE7FF"/>
    </linearGradient>
    <linearGradient id="handle" x1="792" y1="772" x2="918" y2="898" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#FFFFFF"/>
      <stop offset="1" stop-color="#BFDCFF"/>
    </linearGradient>
    <filter id="ds" x="-25%" y="-25%" width="150%" height="150%">
      <feDropShadow dx="0" dy="16" stdDeviation="24" flood-color="#0B2A6B" flood-opacity="0.40"/>
    </filter>
    <filter id="soft" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="9"/>
    </filter>
    <clipPath id="sq"><rect x="0" y="0" width="1024" height="1024" rx="229" ry="229"/></clipPath>
  </defs>

  <!-- squircle background -->
  <rect x="0" y="0" width="1024" height="1024" rx="229" ry="229" fill="url(#bg)"/>

  <!-- glossy top sheen + lower shade (glassmorphism depth) -->
  <g clip-path="url(#sq)">
    <ellipse cx="412" cy="70" rx="640" ry="360" fill="#FFFFFF" opacity="0.18" filter="url(#soft)"/>
    <ellipse cx="800" cy="980" rx="420" ry="300" fill="#0A3FB0" opacity="0.18" filter="url(#soft)"/>
  </g>
  <!-- glass card edge -->
  <rect x="6" y="6" width="1012" height="1012" rx="225" ry="225" fill="none" stroke="#FFFFFF" stroke-opacity="0.30" stroke-width="3"/>

  <!-- document -->
  <g transform="rotate(-7 465 470)" filter="url(#ds)">
    <rect x="235" y="170" width="460" height="600" rx="38" fill="#FFFFFF"/>
    <rect x="300" y="250" width="300" height="42" rx="21" fill="#F4A52B"/>
    <rect x="300" y="328" width="336" height="26" rx="13" fill="#C7D2E0"/>
    <rect x="300" y="382" width="336" height="26" rx="13" fill="#C7D2E0"/>
    <rect x="300" y="436" width="250" height="26" rx="13" fill="#C7D2E0"/>
    <rect x="300" y="516" width="336" height="26" rx="13" fill="#DCE3EC"/>
    <rect x="300" y="570" width="300" height="26" rx="13" fill="#DCE3EC"/>
    <rect x="300" y="624" width="176" height="26" rx="13" fill="#DCE3EC"/>
  </g>

  <!-- magnifier handle -->
  <g filter="url(#ds)">
    <line x1="792" y1="772" x2="918" y2="898" stroke="url(#handle)" stroke-width="92" stroke-linecap="round"/>
  </g>

  <!-- glass body -->
  <circle cx="672" cy="652" r="170" fill="url(#glass)"/>
  <!-- magnified lines inside lens -->
  <clipPath id="lens"><circle cx="672" cy="652" r="146"/></clipPath>
  <g clip-path="url(#lens)">
    <rect x="560" y="612" width="236" height="30" rx="15" fill="#2C7BF2" opacity="0.55"/>
    <rect x="560" y="668" width="150" height="30" rx="15" fill="#2C7BF2" opacity="0.38"/>
    <!-- bottom rim ambient light -->
    <path d="M540 760 A150 150 0 0 0 804 760" fill="none" stroke="#EAF6FF" stroke-width="14" opacity="0.45" filter="url(#soft)"/>
  </g>

  <!-- ring -->
  <g filter="url(#ds)">
    <circle cx="672" cy="652" r="170" fill="none" stroke="url(#ring)" stroke-width="48"/>
  </g>
  <circle cx="672" cy="652" r="146" fill="none" stroke="#FFFFFF" stroke-opacity="0.5" stroke-width="3"/>

  <!-- specular highlights (glass shine) -->
  <path d="M566 614 A150 150 0 0 1 694 516" fill="none" stroke="#FFFFFF" stroke-width="30" stroke-linecap="round" opacity="0.85" filter="url(#soft)"/>
  <path d="M584 600 A132 132 0 0 1 672 536" fill="none" stroke="#FFFFFF" stroke-width="14" stroke-linecap="round" opacity="0.9"/>
  <ellipse cx="612" cy="566" rx="26" ry="18" fill="#FFFFFF" opacity="0.9" transform="rotate(-38 612 566)"/>
</svg>`

app.whenReady().then(async () => {
  mkdirSync('/Users/zhangyixuan06/work/paperdesk/build', { recursive: true })
  const win = new BrowserWindow({ width: 1024, height: 1024, show: false })
  const page = `<!doctype html><html><head><meta charset="utf-8">
    <style>html,body{margin:0;padding:0;background:transparent}</style></head>
    <body><canvas id="c" width="1024" height="1024"></canvas>
    <script>
      const svg = ${JSON.stringify(svg)};
      const img = new Image();
      img.onload = () => {
        const ctx = document.getElementById('c').getContext('2d');
        ctx.clearRect(0,0,1024,1024);
        ctx.drawImage(img,0,0,1024,1024);
        window.__png = document.getElementById('c').toDataURL('image/png');
      };
      img.onerror = () => { window.__png = 'ERR'; };
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    </script></body></html>`
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(page))
  let dataUrl = null
  for (let i = 0; i < 120; i++) {
    dataUrl = await win.webContents.executeJavaScript('window.__png || null').catch(() => null)
    if (dataUrl) break
    await new Promise(r => setTimeout(r, 100))
  }
  if (!dataUrl || dataUrl === 'ERR') { console.log('ICON FAIL'); app.exit(1); return }
  const buf = Buffer.from(dataUrl.split(',')[1], 'base64')
  writeFileSync(OUT, buf)
  console.log('ICON OK', buf.length, 'bytes ->', OUT)
  app.exit(0)
})
