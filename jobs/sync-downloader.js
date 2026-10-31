// 媒体订阅分下载器 · 同步订阅下载器（v1.2）
// 作用：读取 DIAN115 原生订阅（GET /api/subscribe/pool/intents），
// 按 media_type 把每个订阅的 pt_downloader 设为对应下载器名称：
//   电影（movie）→ dl_movie；剧集（tv）→ dl_tv。
// 写入的是订阅自带的 pt_downloader 字段，由 DIAN115 原生流程扫描 PT 站点并派发到该下载器；
// 插件不再自行搜索磁力/提交下载，避免与原生流程重复提交导致重复下载。
// 已等于目标值的跳过（幂等）；定时运行即可让新增订阅自动按类型分配。
export async function run(ctx, input) {
  const dlMovie = (await ctx.storage.get('dl_movie')) || ''
  const dlTv = (await ctx.storage.get('dl_tv')) || ''
  if (!dlMovie && !dlTv) {
    await ctx.task.update({ message: '未配置电影/剧集下载器，请先在插件页面选择' })
    return { ok: 0, fail: 0, skip: 0, configured: false }
  }

  const intents = await fetchIntents(ctx)
  let ok = 0, fail = 0, skip = 0
  const summary = []
  await ctx.task.update({ stage: 'sync', total: intents.length, done: 0, failed: 0, message: `共 ${intents.length} 个订阅` })

  for (const it of intents) {
    const mt = it.media_type
    const want = mt === 'tv' ? dlTv : (mt === 'movie' ? dlMovie : '')
    if (!want) {
      skip++; summary.push(`跳过 ${it.title}（${mt}）：未配置对应下载器`)
      await ctx.task.update({ done: ok, failed: fail, skip, message: summary[summary.length - 1] }); continue
    }
    const current = it.pt_downloader || ''
    if (current === want) {
      skip++; summary.push(`保持 ${it.title}（${mt}）→ ${want}`)
      await ctx.task.update({ done: ok, failed: fail, skip, message: summary[summary.length - 1] }); continue
    }
    try {
      // 实测：PATCH preferences 接受 {downloader: <下载器名称>} 写入 pt_downloader
      await ctx.api.patch(`/api/subscribe/pool/intents/${it.id}/preferences`, { downloader: want })
      ok++; summary.push(`已分配 ${it.title}（${mt}）${current ? current + '→' : ''}${want}`)
    } catch (e) {
      fail++; summary.push(`分配失败 ${it.title}（${mt}）：${e.message}`)
    }
    await ctx.task.update({ done: ok, failed: fail, skip, message: summary[summary.length - 1] })
  }

  const rec = { at: new Date().toISOString(), total: intents.length, ok, fail, skip, summary }
  await ctx.storage.set('last-sync', rec)
  if (summary.length) {
    try {
      await ctx.notify({ title: '订阅下载器同步完成', body: summary.slice(-25).join('\n'), dedupe_key: 'media-sub-downloader:last-sync' })
    } catch (_) {}
  }
  return rec
}

async function fetchIntents(ctx) {
  const r = await ctx.api.get('/api/subscribe/pool/intents?limit=200')
  return (r && (r.data || r.items)) || []
}

export async function recover(ctx, checkpoint) {
  // 超时/中断不能证明外部动作未发生；交回人工核对，不自动重发。
  return { action: 'attention' }
}
