export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const { access_token } = req.query
  if (!access_token) return res.status(401).json({ error: 'No access token' })

  try {
    // Get channel ID first
    const channelRes = await fetch(
      'https://www.googleapis.com/youtube/v3/channels?part=id,snippet&mine=true',
      { headers: { Authorization: `Bearer ${access_token}` } }
    )
    const channelData = await channelRes.json()
    const channelId = channelData.items?.[0]?.id

    if (!channelId) return res.status(400).json({ error: 'No channel found' })

    // Get videos list
    const videosRes = await fetch(
      `https://www.googleapis.com/youtube/v3/search?part=id,snippet&channelId=${channelId}&type=video&maxResults=50&order=date`,
      { headers: { Authorization: `Bearer ${access_token}` } }
    )
    const videosData = await videosRes.json()
    const videoIds = videosData.items?.map(v => v.id.videoId).join(',') || ''

    if (!videoIds) return res.status(200).json({ videos: [] })

    // Get video stats
    const statsRes = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=statistics,contentDetails,snippet&id=${videoIds}`,
      { headers: { Authorization: `Bearer ${access_token}` } }
    )
    const statsData = await statsRes.json()

    // Get analytics (CTR, impressions) for each video
    const endDate = new Date().toISOString().split('T')[0]
    const startDate = '2020-01-01'

    const analyticsRes = await fetch(
      `https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==${channelId}&startDate=${startDate}&endDate=${endDate}&metrics=views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,impressions,impressionClickThroughRate&dimensions=video&maxResults=50&sort=-views`,
      { headers: { Authorization: `Bearer ${access_token}` } }
    )
    const analyticsData = await analyticsRes.json()

    // Merge stats + analytics
    const statsMap = {}
    statsData.items?.forEach(v => {
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
        comments: parseInt(v.statistics?.commentCount || 0),
        isShort: seconds <= 60,
        thumbnailUrl: v.snippet?.thumbnails?.maxres?.url || v.snippet?.thumbnails?.high?.url || v.snippet?.thumbnails?.medium?.url || ''

      }
    })

    // Layer in analytics data
    const analyticsMap = {}
    if (analyticsData.rows) {
      const cols = analyticsData.columnHeaders?.map(h => h.name) || []
      analyticsData.rows.forEach(row => {
        const obj = {}
        cols.forEach((col, i) => obj[col] = row[i])
        analyticsMap[obj.video] = obj
      })
    }

    const videos = Object.entries(statsMap).map(([id, v]) => {
      const analytics = analyticsMap[id] || {}
      return {
        id,
        ...v,
        thumbnailUrl: v.thumbnailUrl || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
        impressions: analytics.impressions || 0,
        ctr: parseFloat(((analytics.impressionClickThroughRate || 0) * 100).toFixed(2)),
        avgPctViewed: parseFloat((analytics.averageViewPercentage || 0).toFixed(2)),
        avgViewDuration: analytics.averageViewDuration || 0,
        watchHours: parseFloat(((analytics.estimatedMinutesWatched || 0) / 60).toFixed(1)),
        subscribers: analytics.subscribersGained || 0,
        transcript: null
      }
    })

    res.status(200).json({ videos, channelId })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}
