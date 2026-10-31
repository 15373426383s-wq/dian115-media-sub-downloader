// 媒体订阅分下载器 · 页面（v1.2 同步版）
// 作用：选择“电影下载器 / 剧集下载器”（来自宿主 GET /api/pt/downloaders），
// 读取 DIAN115 原生订阅并展示每个订阅当前/期望下载器，一键“同步订阅下载器”
// 把订阅的 pt_downloader 按类型设为对应下载器（电影→电影下载器，剧集→剧集下载器）。
// 由 DIAN115 原生流程扫描 PT 站点并派发到该下载器，插件不自行提交下载。
// 配置仅保存在本插件存储（ctx.storage），不写入源码、不含任何凭据。
export async function mount(root, ctx) {
  const doc = root.ownerDocument
  const wrap = doc.createElement('section')
  wrap.className = 'msd'
  const style = doc.createElement('style')
  style.textContent = `.msd{background:var(--app-surface);color:var(--app-text);padding:20px;border-radius:12px;max-width:960px;margin:0 auto}.msd h2{margin:0 0 4px}.msd p.note{opacity:.7;margin:0 0 16px;font-size:13px}.msd fieldset{border:1px solid var(--app-border);border-radius:10px;padding:14px;margin:0 0 16px}.msd legend{padding:0 6px}.msd label{display:grid;gap:6px;margin:10px 0}.msd select,.msd input,.msd button{font:inherit;color:inherit;background:var(--app-bg);border:1px solid var(--app-border);border-radius:6px;padding:9px;box-sizing:border-box}.msd button{min-height:40px;cursor:pointer}.msd button.primary{background:var(--app-accent);color:#fff;border-color:transparent}.msd table{width:100%;border-collapse:collapse;margin:8px 0}.msd th,.msd td{text-align:left;padding:6px;border-bottom:1px solid var(--app-border)}.msd .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:16px 0}.msd .row>*{flex:1 1 160px}.msd pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:40vh;overflow:auto;background:var(--app-bg);padding:10px;border-radius:8px;font-size:13px}`
  wrap.append(style)

  const h = doc.createElement('h2'); h.textContent = '媒体订阅 · 电影/剧集分下载器'; wrap.append(h)
  const note = doc.createElement('p'); note.className = 'note'
  note.textContent = '选择电影/剧集下载器后，点“同步订阅下载器”会按订阅类型把 DIAN115 原生订阅的 pt_downloader 设为对应下载器（电影→电影下载器，剧集→剧集下载器）。由 DIAN115 原生流程扫描 PT 站点并派发到该下载器，插件不自行提交下载。定时任务每 30 分钟自动同步，新增订阅会自动按类型分配。'
  wrap.append(note)

  const fs = doc.createElement('fieldset')
  const lg = doc.createElement('legend'); lg.textContent = '下载器（来自宿主 GET /api/pt/downloaders）'; fs.append(lg)
  const status = doc.createElement('p'); status.className = 'note'; fs.append(status)
  const selMovie = await makeDownloaderSelect('movie'); fs.append(selMovie)
  const selTv = await makeDownloaderSelect('tv'); fs.append(selTv)
  wrap.append(fs)

  // DIAN115 原生订阅表
  const fsSubs = doc.createElement('fieldset')
  const lgSubs = doc.createElement('legend'); lgSubs.textContent = 'DIAN115 原生订阅（来自 GET /api/subscribe/pool/intents）'; fsSubs.append(lgSubs)
  const subStatus = doc.createElement('p'); subStatus.className = 'note'; fsSubs.append(subStatus)
  const subTable = doc.createElement('table')
  subTable.innerHTML = '<thead><tr><th>标题</th><th>类型</th><th>当前下载器</th><th>期望下载器</th><th>状态</th></tr></thead>'
  const subBody = doc.createElement('tbody'); subTable.append(subBody)
  fsSubs.append(subTable)
  const rowBtns = doc.createElement('div'); rowBtns.className = 'row'
  const refreshBtn = doc.createElement('button'); refreshBtn.textContent = '刷新订阅'
  const syncBtn = doc.createElement('button'); syncBtn.className = 'primary'; syncBtn.textContent = '同步订阅下载器'
  rowBtns.append(refreshBtn, syncBtn); fsSubs.append(rowBtns)
  wrap.append(fsSubs)

  const actions = doc.createElement('div'); actions.className = 'row'
  const saveBtn = doc.createElement('button'); saveBtn.className = 'primary'; saveBtn.textContent = '保存下载器配置'
  actions.append(saveBtn); wrap.append(actions)

  const out = doc.createElement('pre'); out.setAttribute('aria-live', 'polite'); wrap.append(out)

  // 状态
  let dlMovie = (await ctx.storage.get('dl_movie')) || ''
  let dlTv = (await ctx.storage.get('dl_tv')) || ''
  const lastSync = (await ctx.storage.get('last-sync')) || null
  if (lastSync) out.textContent = `上次同步 ${lastSync.at}：分配 ${lastSync.ok}，保持 ${lastSync.skip}，失败 ${lastSync.fail}`

  saveBtn.addEventListener('click', async () => {
    await ctx.storage.set('dl_movie', dlMovie)
    await ctx.storage.set('dl_tv', dlTv)
    out.textContent = `已保存：电影下载器 ${dlMovie || '未选'}，剧集下载器 ${dlTv || '未选'}。`
  })

  function expectedFor(mediaType) {
    if (mediaType === 'tv') return dlTv
    if (mediaType === 'movie') return dlMovie
    return ''
  }
  function typeLabel(mt) {
    if (mt === 'tv') return '剧集'
    if (mt === 'movie') return '电影'
    return mt || '?'
  }
  function statusOf(current, want) {
    if (!want) return '未配置对应下载器'
    if (current === want) return '已分配'
    return '待分配'
  }

  async function renderSubs() {
    subStatus.textContent = '读取订阅中…'
    try {
      const r = await ctx.api.get('/api/subscribe/pool/intents?limit=200')
      const items = (r && (r.data || r.items)) || []
      subBody.innerHTML = ''
      if (!items.length) { subStatus.textContent = '当前没有订阅。'; return }
      let pending = 0
      for (const it of items) {
        const want = expectedFor(it.media_type)
        const cur = it.pt_downloader || ''
        const st = statusOf(cur, want)
        if (st === '待分配') pending++
        const tr = doc.createElement('tr')
        const td1 = doc.createElement('td'); td1.textContent = it.title || ('#' + it.id)
        const td2 = doc.createElement('td'); td2.textContent = typeLabel(it.media_type)
        const td3 = doc.createElement('td'); td3.textContent = cur || '（空）'
        const td4 = doc.createElement('td'); td4.textContent = want || '（未配置）'
        const td5 = doc.createElement('td'); td5.textContent = st
        tr.append(td1, td2, td3, td4, td5); subBody.append(tr)
      }
      subStatus.textContent = `共 ${items.length} 个订阅，其中 ${pending} 个待分配。点“同步订阅下载器”按类型写入下载器。`
    } catch (e) { subStatus.textContent = '读取订阅失败：' + e.message }
  }

  refreshBtn.addEventListener('click', () => renderSubs())
  syncBtn.addEventListener('click', async () => {
    out.textContent = '正在启动同步任务…'
    try {
      const res = await ctx.tasks.run('sync-downloader', 'manual', { manual: true })
      out.textContent = '已入队：' + JSON.stringify(res)
      setTimeout(() => renderSubs(), 1500)
    } catch (e) { out.textContent = '启动失败：' + e.message }
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

  // 初始渲染
  renderSubs()

  root.append(wrap)
  return () => wrap.remove()
}
