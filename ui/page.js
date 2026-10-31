// 媒体订阅分下载器 · 页面（v1.1 自动判断版）
// 作用：分别选择“电影下载器”和“剧集下载器”，并维护两组订阅：电影订阅 / 剧集订阅。
// 自动判断：电影订阅 → 电影下载器；剧集订阅 → 剧集下载器。订阅不再单独选类型。
// 配置仅保存在本插件存储（ctx.storage），不写入源码、不出现任何凭据。
export async function mount(root, ctx) {
  const doc = root.ownerDocument
  const wrap = doc.createElement('section')
  wrap.className = 'msd'
  const style = doc.createElement('style')
  style.textContent = `.msd{background:var(--app-surface);color:var(--app-text);padding:20px;border-radius:12px;max-width:960px;margin:0 auto}.msd h2{margin:0 0 4px}.msd p.note{opacity:.7;margin:0 0 16px;font-size:13px}.msd fieldset{border:1px solid var(--app-border);border-radius:10px;padding:14px;margin:0 0 16px}.msd legend{padding:0 6px}.msd label{display:grid;gap:6px;margin:10px 0}.msd select,.msd input,.msd button{font:inherit;color:inherit;background:var(--app-bg);border:1px solid var(--app-border);border-radius:6px;padding:9px;box-sizing:border-box}.msd button{min-height:40px;cursor:pointer}.msd button.primary{background:var(--app-accent);color:#fff;border-color:transparent}.msd table{width:100%;border-collapse:collapse;margin:8px 0}.msd th,.msd td{text-align:left;padding:6px;border-bottom:1px solid var(--app-border)}.msd .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:16px 0}.msd .row>*{flex:1 1 160px}.msd pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:40vh;overflow:auto;background:var(--app-bg);padding:10px;border-radius:8px;font-size:13px}`
  wrap.append(style)

  const h = doc.createElement('h2'); h.textContent = '媒体订阅 · 电影/剧集分下载器'; wrap.append(h)
  const note = doc.createElement('p'); note.className = 'note'; note.textContent = '电影订阅自动走电影下载器，剧集订阅自动走剧集下载器（如 qBittorrent / Transmission）。配置仅存于本插件，不写入源码。'; wrap.append(note)

  const fs = doc.createElement('fieldset')
  const lg = doc.createElement('legend'); lg.textContent = '下载器（来自宿主 GET /api/pt/downloaders）'; fs.append(lg)
  const status = doc.createElement('p'); status.className = 'note'; fs.append(status)
  const selMovie = await makeDownloaderSelect('movie'); fs.append(selMovie)
  const selTv = await makeDownloaderSelect('tv'); fs.append(selTv)
  wrap.append(fs)

  // 电影订阅分组
  const fsMovie = doc.createElement('fieldset')
  const lgMovie = doc.createElement('legend'); lgMovie.textContent = '电影订阅（自动用电影下载器）'; fsMovie.append(lgMovie)
  fsMovie.append(makeSubTable(ctx, 'movie'))
  fsMovie.append(makeAddBtn('movie', ctx))
  wrap.append(fsMovie)

  // 剧集订阅分组
  const fsTv = doc.createElement('fieldset')
  const lgTv = doc.createElement('legend'); lgTv.textContent = '剧集订阅（自动用剧集下载器）'; fsTv.append(lgTv)
  fsTv.append(makeSubTable(ctx, 'tv'))
  fsTv.append(makeAddBtn('tv', ctx))
  wrap.append(fsTv)

  const actions = doc.createElement('div'); actions.className = 'row'
  const saveBtn = doc.createElement('button'); saveBtn.className = 'primary'; saveBtn.textContent = '保存配置'
  const runBtn = doc.createElement('button'); runBtn.textContent = '立即运行扫描'
  actions.append(saveBtn, runBtn); wrap.append(actions)

  const out = doc.createElement('pre'); out.setAttribute('aria-live', 'polite'); wrap.append(out)

  // 状态
  let movieSubs = (await ctx.storage.get('movie_subs')) || []
  let tvSubs = (await ctx.storage.get('tv_subs')) || []
  let dlMovie = (await ctx.storage.get('dl_movie')) || ''
  let dlTv = (await ctx.storage.get('dl_tv')) || ''
  const lastRun = (await ctx.storage.get('last-run')) || null
  if (lastRun) out.textContent = `上次运行 ${lastRun.at}：电影提交 ${lastRun.movie_submitted || 0}，剧集提交 ${lastRun.tv_submitted || 0}，失败 ${lastRun.failed}`

  saveBtn.addEventListener('click', async () => {
    await ctx.storage.set('movie_subs', movieSubs)
    await ctx.storage.set('tv_subs', tvSubs)
    await ctx.storage.set('dl_movie', dlMovie)
    await ctx.storage.set('dl_tv', dlTv)
    out.textContent = `已保存：电影订阅 ${movieSubs.length} 个（下载器 ${dlMovie || '未选'}），剧集订阅 ${tvSubs.length} 个（下载器 ${dlTv || '未选'}）。`
  })
  runBtn.addEventListener('click', async () => {
    out.textContent = '正在启动扫描任务…'
    try { const r = await ctx.tasks.run('scan', 'manual', { manual: true }); out.textContent = '已入队：' + JSON.stringify(r) } catch (e) { out.textContent = '启动失败：' + e.message }
  })

  async function makeDownloaderSelect(kind) {
    const label = doc.createElement('label')
    label.textContent = kind === 'movie' ? '电影下载器' : '剧集下载器'
    const sel = doc.createElement('select')
    sel.addEventListener('change', () => { if (kind === 'movie') dlMovie = sel.value; else dlTv = sel.value })
    try {
      const r = await ctx.api.get('/api/pt/downloaders')
      // 宿主返回的下载器未必带 enabled 字段；缺省/未显式 false 均视为可用
      const list = (r.data || []).filter(d => d.enabled !== false)
      for (const d of list) {
        // 宿主按“名称”匹配下载器：优先 downloader 字段，否则用 name（实测 id 字符串无效）
        const val = d.downloader || d.name || String(d.id)
        const txt = d.name || d.downloader || String(d.id)
        const o = doc.createElement('option'); o.value = val; o.textContent = txt
        if ((kind === 'movie' ? dlMovie : dlTv) === val) o.selected = true
        sel.append(o)
      }
      if (!list.length) status.textContent = '未读取到启用下载器，请在宿主配置 qBittorrent / Transmission 等下载器。'
    } catch (e) { status.textContent = '读取下载器失败：' + e.message }
    label.append(sel)
    return label
  }

  // 生成一个订阅分组的表格（仅 关键词 + 启用 + 删除）
  function makeSubTable(ctx, kind) {
    const table = doc.createElement('table')
    table.innerHTML = '<thead><tr><th>关键词</th><th>启用</th><th></th></tr></thead>'
    const tbody = doc.createElement('tbody')
    const list = kind === 'movie' ? movieSubs : tvSubs
    for (const s of list) {
      const tr = doc.createElement('tr')
      const kw = doc.createElement('input'); kw.value = s.keyword; kw.placeholder = '番号/关键词'; kw.addEventListener('input', () => s.keyword = kw.value)
      const en = doc.createElement('input'); en.type = 'checkbox'; en.checked = s.enabled; en.addEventListener('change', () => s.enabled = en.checked)
      const del = doc.createElement('button'); del.textContent = '删除'; del.addEventListener('click', () => { const arr = kind === 'movie' ? movieSubs : tvSubs; arr.splice(arr.indexOf(s), 1); tbody.removeChild(tr) })
      const td1 = doc.createElement('td'); td1.append(kw)
      const td2 = doc.createElement('td'); td2.append(en)
      const td3 = doc.createElement('td'); td3.append(del)
      tr.append(td1, td2, td3); tbody.append(tr)
    }
    table.append(tbody)
    return table
  }

  function makeAddBtn(kind, ctx) {
    const btn = doc.createElement('button')
    btn.textContent = kind === 'movie' ? '+ 添加电影订阅' : '+ 添加剧集订阅'
    btn.addEventListener('click', () => {
      const arr = kind === 'movie' ? movieSubs : tvSubs
      arr.push({ id: ctx.crypto.randomUUID(), keyword: '', enabled: true })
      const table = btn.previousSibling
      const tbody = table.querySelector('tbody')
      const s = arr[arr.length - 1]
      const tr = doc.createElement('tr')
      const kw = doc.createElement('input'); kw.value = s.keyword; kw.placeholder = '番号/关键词'; kw.addEventListener('input', () => s.keyword = kw.value)
      const en = doc.createElement('input'); en.type = 'checkbox'; en.checked = s.enabled; en.addEventListener('change', () => s.enabled = en.checked)
      const del = doc.createElement('button'); del.textContent = '删除'; del.addEventListener('click', () => { arr.splice(arr.indexOf(s), 1); tbody.removeChild(tr) })
      const td1 = doc.createElement('td'); td1.append(kw)
      const td2 = doc.createElement('td'); td2.append(en)
      const td3 = doc.createElement('td'); td3.append(del)
      tr.append(td1, td2, td3); tbody.append(tr)
    })
    return btn
  }

  root.append(wrap)
  return () => wrap.remove()
}
