import { app, BrowserWindow } from 'electron'
import { writeFileSync, mkdirSync } from 'node:fs'

const OUT = '/Users/zhangyixuan06/work/paperlens/build/icon-1024.png'

const svg = String.raw`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="60" y1="40" x2="980" y2="1010" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#5145E6"/>
      <stop offset="0.52" stop-color="#7B3FE4"/>
      <stop offset="1" stop-color="#A23BD6"/>
    </linearGradient>
    <radialGradient id="sheen" cx="0.30" cy="0.18" r="0.95">
      <stop offset="0" stop-color="#FFFFFF" stop-opacity="0.30"/>
      <stop offset="0.55" stop-color="#FFFFFF" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="glass" x1="540" y1="500" x2="804" y2="804" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#FFFFFF" stop-opacity="0.42"/>
      <stop offset="1" stop-color="#FFFFFF" stop-opacity="0.10"/>
    </linearGradient>
    <filter id="ds" x="-25%" y="-25%" width="150%" height="150%">
      <feDropShadow dx="0" dy="16" stdDeviation="24" flood-color="#241A52" flood-opacity="0.38"/>
    </filter>
    <clipPath id="lens"><circle cx="672" cy="652" r="146"/></clipPath>
  </defs>

  <!-- squircle background -->
  <rect x="0" y="0" width="1024" height="1024" rx="229" ry="229" fill="url(#bg)"/>
  <rect x="0" y="0" width="1024" height="1024" rx="229" ry="229" fill="url(#sheen)"/>

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

  <!-- magnifier handle + ring (white, shadowed) -->
  <g filter="url(#ds)">
    <line x1="792" y1="772" x2="918" y2="898" stroke="#FFFFFF" stroke-width="92" stroke-linecap="round"/>
  </g>

  <!-- glass fill + magnified lines -->
  <circle cx="672" cy="652" r="170" fill="url(#glass)"/>
  <g clip-path="url(#lens)">
    <rect x="560" y="610" width="236" height="30" rx="15" fill="#6D3FE6" opacity="0.50"/>
    <rect x="560" y="666" width="150" height="30" rx="15" fill="#6D3FE6" opacity="0.34"/>
  </g>

  <!-- ring on top -->
  <g filter="url(#ds)">
    <circle cx="672" cy="652" r="170" fill="none" stroke="#FFFFFF" stroke-width="48"/>
  </g>
  <!-- glass shine -->
  <path d="M574 583 A120 120 0 0 1 651 534" fill="none" stroke="#FFFFFF" stroke-width="16" stroke-linecap="round" opacity="0.55"/>
</svg>`

app.whenReady().then(async () => {
  mkdirSync('/Users/zhangyixuan06/work/paperlens/build', { recursive: true })
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
