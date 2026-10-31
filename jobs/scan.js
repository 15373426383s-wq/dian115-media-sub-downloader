// 媒体订阅分下载器 · 后台扫描（v1.1 自动判断版）
// 流程：读取“电影下载器 / 剧集下载器”配置与两组订阅 →
//   电影订阅 → 自动用电影下载器、media_type='movie' 提交；
//   剧集订阅 → 自动用剧集下载器、media_type='tv' 提交。
// 仅提交 link_type==='magnet' 的候选（qBittorrent / Transmission 支持磁力）；ED2K 跳过。
// 增量基线（since/cursor）按订阅独立持久化，完整空结果也推进；错误/未读完保留原基线。
// 超时或不确定结果不证明未提交：recover 返回 attention，由人工核对，禁止自动重发。
export async function run(ctx, input) {
  const dlMovie = (await ctx.storage.get('dl_movie')) || ''
  const dlTv = (await ctx.storage.get('dl_tv')) || ''
  const movieSubs = (await ctx.storage.get('movie_subs')) || []
  const tvSubs = (await ctx.storage.get('tv_subs')) || []
  const movieEnabled = movieSubs.filter(s => s.enabled && s.keyword)
  const tvEnabled = tvSubs.filter(s => s.enabled && s.keyword)
  const total = movieEnabled.length + tvEnabled.length
  if (!total) { await ctx.task.update({ message: '没有启用的订阅' }); return { done: 0, skipped: true } }
  if (!dlMovie && movieEnabled.length) { await ctx.task.update({ message: '有电影订阅但未配置电影下载器' }) }
  if (!dlTv && tvEnabled.length) { await ctx.task.update({ message: '有剧集订阅但未配置剧集下载器' }) }

  let done = 0, failed = 0, movieSubmitted = 0, tvSubmitted = 0
  const summary = []
  await ctx.task.update({ stage: 'scan', total, done: 0, failed: 0, message: `共 ${total} 个订阅（电影 ${movieEnabled.length} / 剧集 ${tvEnabled.length}）` })

  // 电影订阅：自动用电影下载器
  for (const sub of movieEnabled) {
    if (!dlMovie) { failed++; summary.push(`跳过 ${sub.keyword}（电影）：未配置电影下载器`); await ctx.task.update({ done, failed }); continue }
    try {
      const r = await processSubscription(ctx, sub, dlMovie, 'movie')
      movieSubmitted += r.count; done++
      summary.push(`${sub.keyword}（电影→${dlMovie}）：提交 ${r.count}`)
    } catch (e) { failed++; summary.push(`${sub.keyword}（电影）错误：${e.message}`) }
    await ctx.task.update({ done, failed, message: summary[summary.length - 1] })
  }

  // 剧集订阅：自动用剧集下载器
  for (const sub of tvEnabled) {
    if (!dlTv) { failed++; summary.push(`跳过 ${sub.keyword}（剧集）：未配置剧集下载器`); await ctx.task.update({ done, failed }); continue }
    try {
      const r = await processSubscription(ctx, sub, dlTv, 'tv')
      tvSubmitted += r.count; done++
      summary.push(`${sub.keyword}（剧集→${dlTv}）：提交 ${r.count}`)
    } catch (e) { failed++; summary.push(`${sub.keyword}（剧集）错误：${e.message}`) }
    await ctx.task.update({ done, failed, message: summary[summary.length - 1] })
  }

  const runRecord = { at: new Date().toISOString(), movie_submitted: movieSubmitted, tv_submitted: tvSubmitted, done, failed, summary }
  await ctx.storage.set('last-run', runRecord)
  if (summary.length) {
    try { await ctx.notify({ title: '媒体订阅扫描完成', body: summary.slice(-25).join('\n'), dedupe_key: 'media-sub-downloader:last-run' }) } catch (_) {}
  }
  return runRecord
}

async function processSubscription(ctx, sub, downloader, mediaType) {
  const key = 'baseline:' + sub.id
  let base = (await ctx.storage.get(key)) || { since: '1970-01-01T00:00:00Z' }
  let since = base.since, cursor_time = base.cursor_time, cursor_id = base.cursor_id
  let count = 0
  const seen = new Set()
  for (let page = 0; page < 25; page++) {
    let url = `/api/cache/magnet/changes?keyword=${encodeURIComponent(sub.keyword)}&since=${encodeURIComponent(since)}&limit=100`
    if (cursor_time && cursor_id) url += `&cursor_time=${encodeURIComponent(cursor_time)}&cursor_id=${encodeURIComponent(cursor_id)}`
    const res = await ctx.api.get(url)
    const items = res.items || []
    for (const item of items) {
      if (item.link_type && item.link_type !== 'magnet') continue // 仅 magnet 交给 qBittorrent / Transmission
      const idKey = item.info_hash || item.id
      if (seen.has(idKey)) continue
      seen.add(idKey)
      try {
        await ctx.api.post('/api/pt/download', {
          download_url: item.magnet_link,
          downloader,
          media_type: mediaType,
          title: item.title || item.file_name || sub.keyword,
        })
        count++
      } catch (e) {
        await ctx.task.log(`${sub.keyword} 提交失败 ${idKey}: ${e.message}`)
      }
    }
    if (res.complete) { since = res.until; cursor_time = undefined; cursor_id = undefined; break }
    if (!res.cursor_time || !res.cursor_id) { since = res.until; break }
    cursor_time = res.cursor_time; cursor_id = res.cursor_id; since = res.until
  }
  await ctx.storage.set(key, { since, cursor_time, cursor_id })
  return { count }
}

export async function recover(ctx, checkpoint) {
  // 超时/中断不能证明外部动作未发生；交回人工核对，不自动重发。
  return { action: 'attention' }
}
