export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const { access_token } = req.query
  if (!access_token) return res.status(401).json({ error: 'No access token' })

  try {
    // Get channel info
    const channelRes = await fetch(
      'https://www.googleapis.com/youtube/v3/channels?part=id,snippet&mine=true',
      { headers: { Authorization: `Bearer ${access_token}` } }
    )
    const channelData = await channelRes.json()
    const channelId = channelData.items?.[0]?.id
    if (!channelId) return res.status(400).json({ error: 'No channel found' })

    // Get videos with pagination
    let allVideoIds = []
    let pageToken = ''
    for (let page = 0; page < 4; page++) {
      const url = `https://www.googleapis.com/youtube/v3/search?part=id&channelId=${channelId}&type=video&maxResults=50&order=date${pageToken ? `&pageToken=${pageToken}` : ''}`
      const vRes = await fetch(url, { headers: { Authorization: `Bearer ${access_token}` } })
      const vData = await vRes.json()
      allVideoIds.push(...(vData.items?.map(v => v.id.videoId) || []))
      pageToken = vData.nextPageToken || ''
      if (!pageToken) break
    }

    if (!allVideoIds.length) return res.status(200).json({ videos: [], channelId })

    // Get video details in batches of 50
    const statsMap = {}
    for (let i = 0; i < allVideoIds.length; i += 50) {
      const batch = allVideoIds.slice(i, i + 50).join(',')
      const sRes = await fetch(
        `https://www.googleapis.com/youtube/v3/videos?part=statistics,contentDetails,snippet&id=${batch}`,
        { headers: { Authorization: `Bearer ${access_token}` } }
      )
      const sData = await sRes.json()
      sData.items?.forEach(v => {
        const duration = v.contentDetails?.duration || 'PT0S'
        const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/)
        const seconds = (parseInt(match?.[1] || 0) * 3600) +
                        (parseInt(match?.[2] || 0) * 60) +
                        parseInt(match?.[3] || 0)
        statsMap[v.id] = {
          title: v.snippet?.title,
          published: v.snippet?.publishedAt?.split('T')[0],
          duration: seconds,
          views: parseInt(v.statistics?.viewCount || 0),
          likes: parseInt(v.statistics?.likeCount || 0),
          commentCount: parseInt(v.statistics?.commentCount || 0),
          isShort: seconds > 0 && seconds <= 60,
          thumbnailUrl: v.snippet?.thumbnails?.maxres?.url ||
                        v.snippet?.thumbnails?.high?.url ||
                        v.snippet?.thumbnails?.medium?.url || ''
        }
      })
    }

    // Get analytics per video — fetch in batches of 200 video IDs
    const allIds = Object.keys(statsMap)
    const endDate = new Date().toISOString().split('T')[0]
    const analyticsMap = {}

    // Analytics API accepts comma-separated video IDs in the filters param
    // but has a limit — do it in chunks of 50
    for (let i = 0; i < allIds.length; i += 50) {
      const chunk = allIds.slice(i, i + 50)
      const filterStr = chunk.map(id => `video==${id}`).join(',')
      
      const aRes = await fetch(
        `https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==${channelId}&startDate=2020-01-01&endDate=${endDate}&metrics=views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,impressions,impressionClickThroughRate&dimensions=video&filters=${encodeURIComponent(filterStr)}&maxResults=50`,
        { headers: { Authorization: `Bearer ${access_token}` } }
      )
      const aData = await aRes.json()
      
      if (aData.rows && aData.columnHeaders) {
        const cols = aData.columnHeaders.map(h => h.name)
        const videoIdx = cols.indexOf('video')
        const viewsIdx = cols.indexOf('views')
        const minutesIdx = cols.indexOf('estimatedMinutesWatched')
        const avgDurIdx = cols.indexOf('averageViewDuration')
        const avgPctIdx = cols.indexOf('averageViewPercentage')
        const impressionsIdx = cols.indexOf('impressions')
        const ctrIdx = cols.indexOf('impressionClickThroughRate')

        aData.rows.forEach(row => {
          const vid = row[videoIdx]
          if (!vid) return
          analyticsMap[vid] = {
            views: row[viewsIdx] || 0,
            estimatedMinutesWatched: row[minutesIdx] || 0,
            averageViewDuration: row[avgDurIdx] || 0,
            averageViewPercentage: row[avgPctIdx] || 0,
            impressions: row[impressionsIdx] || 0,
            // CTR comes as ratio 0.0-1.0 from API, convert to percentage
            impressionClickThroughRate: row[ctrIdx] || 0
          }
        })
      }
    }

    // Merge everything
    const videos = Object.entries(statsMap).map(([id, v]) => {
      const a = analyticsMap[id] || {}
      const ctrRaw = parseFloat(a.impressionClickThroughRate || 0)
      // Sanity check: if > 1 it's already %, if <= 1 it's a ratio
      const ctr = parseFloat((ctrRaw > 1 ? ctrRaw : ctrRaw * 100).toFixed(2))
      const avgPct = parseFloat(parseFloat(a.averageViewPercentage || 0).toFixed(2))

      return {
        id,
        ...v,
        thumbnailUrl: v.thumbnailUrl || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
        impressions: parseInt(a.impressions || 0),
        ctr,
        avgPctViewed: avgPct,
        avgViewDuration: parseFloat(a.averageViewDuration || 0),
        watchHours: parseFloat(((parseFloat(a.estimatedMinutesWatched || 0)) / 60).toFixed(1)),
        subscribers: 0,
        revenue: 0,
        transcript: null,
        comments: []
      }
    })

    // Debug: log how many videos got analytics data
    const withAnalytics = videos.filter(v => v.ctr > 0 || v.avgPctViewed > 0).length
    console.log(`Total videos: ${videos.length}, with analytics: ${withAnalytics}, analyticsMap keys: ${Object.keys(analyticsMap).length}`)

    res.status(200).json({ videos, channelId, debug: { totalVideos: videos.length, withAnalytics, analyticsKeys: Object.keys(analyticsMap).length } })
  } catch (err) {
    console.error('youtube-data error:', err)
    res.status(500).json({ error: err.message })
  }
}
