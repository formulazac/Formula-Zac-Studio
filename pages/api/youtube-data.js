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

    // Get videos — fetch up to 200 with pagination
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

    // Get analytics — CTR, impressions, retention in one call
    // Split into long form and shorts separately for accuracy
    const videoIdList = Object.keys(statsMap).join(',')
    const endDate = new Date().toISOString().split('T')[0]

    const analyticsRes = await fetch(
      `https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==${channelId}&startDate=2020-01-01&endDate=${endDate}&metrics=views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,impressions,impressionClickThroughRate&dimensions=video&maxResults=200&sort=-views`,
      { headers: { Authorization: `Bearer ${access_token}` } }
    )
    const analyticsData = await analyticsRes.json()

    // Build analytics lookup by video ID
    const analyticsMap = {}
    if (analyticsData.rows) {
      // Column headers tell us the order: video, views, estimatedMinutesWatched, etc
      const cols = analyticsData.columnHeaders?.map(h => h.name) || []
      analyticsData.rows.forEach(row => {
        const obj = {}
        cols.forEach((col, i) => { obj[col] = row[i] })
        // The video dimension column is named 'video'
        if (obj.video) analyticsMap[obj.video] = obj
      })
    }

    // Merge stats + analytics
    const videos = Object.entries(statsMap).map(([id, v]) => {
      const a = analyticsMap[id] || {}
      // CTR comes as ratio 0-1 from Analytics API, convert to percentage
      const ctrRaw = parseFloat(a.impressionClickThroughRate || 0)
      const ctr = ctrRaw > 1 ? parseFloat(ctrRaw.toFixed(2)) : parseFloat((ctrRaw * 100).toFixed(2))

      return {
        id,
        ...v,
        thumbnailUrl: v.thumbnailUrl || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
        impressions: parseInt(a.impressions || 0),
        ctr,
        avgPctViewed: parseFloat(parseFloat(a.averageViewPercentage || 0).toFixed(2)),
        avgViewDuration: parseFloat(a.averageViewDuration || 0),
        watchHours: parseFloat(((parseFloat(a.estimatedMinutesWatched || 0)) / 60).toFixed(1)),
        subscribers: parseInt(a.subscribersGained || 0),
        revenue: 0,
        transcript: null,
        comments: []
      }
    })

    res.status(200).json({ videos, channelId })
  } catch (err) {
    console.error('youtube-data error:', err)
    res.status(500).json({ error: err.message })
  }
}
