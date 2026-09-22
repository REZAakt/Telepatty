/* Minimal CDP probe (recreated after cleanup). */
const { spawn } = require('child_process')
const fs = require('fs')
const CHROMES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
]
const CHROME = CHROMES.find((p) => fs.existsSync(p))
const url = process.argv[2] || 'http://localhost:3100/onboarding'
const waitMs = Number(process.argv[3] || 20000)
const PORT = 9334
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

;(async () => {
  if (!CHROME) {
    console.log('NO_BROWSER'); process.exit(1)
  }
  const chrome = spawn(CHROME, ['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port='+PORT,'--user-data-dir='+process.env.TEMP+'/tp-final-'+(Date.now()%100000),'about:blank'], {stdio:'ignore'})
  let targets = null
  for (let i = 0; i < 40 && !targets; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/json/list`); targets = await r.json() } catch { await sleep(500) }
  }
  if (!targets) { console.log('NO_CDP_ENDPOINT'); chrome.kill(); process.exit(1) }
  const page = targets.find((t) => t.type === 'page')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej) })
  const logs = []
  const pending = new Map()
  let id = 0
  const send = (method, params = {}) => new Promise((res) => { const mi = ++id; pending.set(mi, res); ws.send(JSON.stringify({ id: mi, method, params })) })
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); return }
    if (m.method === 'Runtime.consoleAPICalled') logs.push(`CONSOLE.${m.params.type}: `+String((m.params.args||[]).map(a=>a.value??a.description).join(' ')).slice(0,300))
    else if (m.method === 'Runtime.exceptionThrown') logs.push('EXCEPTION: '+(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text||'').slice(0,500))
    else if (m.method === 'Log.entryAdded' && (m.params.entry.level==='error'||m.params.entry.level==='warning')) logs.push(`LOG.${m.params.entry.level}: ${String(m.params.entry.text).slice(0,300)}`)
  })
  await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable')
  await send('Page.navigate', { url })
  await sleep(waitMs)
  const probe = await send('Runtime.evaluate', { expression: `JSON.stringify({href:location.href, nuxtKids:(document.getElementById('__nuxt')||{}).childElementCount??-1, hasApp:!!document.querySelector('[data-v-app]'), text:(document.body?document.body.innerText:'NO_BODY').replace(/\\s+/g,' ').slice(0,600)})`, returnByValue: true })
  console.log('URL:', url)
  console.log('PROBE:', probe?.result?.value ?? '(none)')
  console.log('--- logs ('+logs.length+') ---')
  for (const l of logs.slice(0,15)) console.log(l)
  ws.close(); chrome.kill(); process.exit(0)
})()
