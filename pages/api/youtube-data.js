export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const { access_token } = req.query
  if (!access_token) return res.status(401).json({ error: 'No access token' })

  try {
    // Debug: check what the token gives us
    const channelRes = await fetch(
      'https://www.googleapis.com/youtube/v3/channels?part=id,snippet&mine=true',
      { headers: { Authorization: `Bearer ${access_token}` } }
    )
    const channelData = await channelRes.json()
    
    console.log('Channel API status:', channelRes.status)
    console.log('Channel data:', JSON.stringify(channelData).slice(0, 500))

    // Try alternative channel lookup
    if (!channelData.items?.length) {
      // Try getting channel via search
      const searchRes = await fetch(
        'https://www.googleapis.com/youtube/v3/channels?part=id,snippet&managedByMe=true&mine=true',
        { headers: { Authorization: `Bearer ${access_token}` } }
      )
      const searchData = await searchRes.json()
      console.log('Alt channel lookup:', JSON.stringify(searchData).slice(0, 300))
      
      // Try userinfo to confirm token works at all
      const userRes = await fetch(
        'https://www.googleapis.com/oauth2/v2/userinfo',
        { headers: { Authorization: `Bearer ${access_token}` } }
      )
      const userData = await userRes.json()
      console.log('User info:', JSON.stringify(userData).slice(0, 200))
      
      return res.status(400).json({ 
        error: 'No channel found',
        channelApiStatus: channelRes.status,
        channelError: channelData.error,
        channelItemCount: channelData.items?.length || 0,
        userEmail: userData.email || 'unknown',
        tokenValid: !!userData.email
      })
    }

    const channelId = channelData.items[0].id

    // Get video list with pagination
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

    // Get video details
    const statsMap = {}
    for (let i = 0; i < allVideoIds.length; i += 50) {
      const batch = allVideoIds.slice(i, i + 50).join(',')
      const sRes = await fetch(
        `https://www.googleapis.com/youtube/v3/videos?part=statistics,contentDetails,snippet&id=${batch}`,
        { headers: { Authorization: `Bearer ${access_token}` } }
      )
      const sData = await sRes.json()
      sData.items?.forEach(v => {
        const dur = v.contentDetails?.duration || 'PT0S'
        const m = dur.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/)
        const seconds = (parseInt(m?.[1]||0)*3600) + (parseInt(m?.[2]||0)*60) + parseInt(m?.[3]||0)
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

    // Get analytics
    const endDate = new Date().toISOString().split('T')[0]
    const analyticsRes = await fetch(
      `https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==${channelId}&startDate=2020-01-01&endDate=${endDate}&metrics=views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,impressions,impressionClickThroughRate&dimensions=video&maxResults=200&sort=-views`,
      { headers: { Authorization: `Bearer ${access_token}` } }
    )
    const analyticsData = await analyticsRes.json()

    console.log('Analytics status:', analyticsRes.status)
    console.log('Analytics error:', JSON.stringify(analyticsData.error))
    console.log('Analytics rows:', analyticsData.rows?.length || 0)
    console.log('Analytics columns:', JSON.stringify(analyticsData.columnHeaders?.map(h => h.name)))
    console.log('First row:', JSON.stringify(analyticsData.rows?.[0]))

    const analyticsMap = {}
    if (analyticsData.rows?.length && analyticsData.columnHeaders) {
      const cols = analyticsData.columnHeaders.map(h => h.name)
      analyticsData.rows.forEach(row => {
        const videoId = row[0]
        if (!videoId) return
        const obj = {}
        cols.forEach((col, i) => { obj[col] = row[i] })
        analyticsMap[videoId] = obj
      })
    }

    const videos = Object.entries(statsMap).map(([id, v]) => {
      const a = analyticsMap[id] || {}
      const ctrRaw = parseFloat(a.impressionClickThroughRate || 0)
      const ctr = parseFloat((ctrRaw > 1 ? ctrRaw : ctrRaw * 100).toFixed(2))

      return {
        id,
        ...v,
        thumbnailUrl: v.thumbnailUrl || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
        impressions: parseInt(a.impressions || 0),
        ctr,
        avgPctViewed: parseFloat(parseFloat(a.averageViewPercentage || 0).toFixed(2)),
        avgViewDuration: parseFloat(a.averageViewDuration || 0),
        watchHours: parseFloat(((parseFloat(a.estimatedMinutesWatched || 0)) / 60).toFixed(1)),
        subscribers: 0,
        revenue: 0,
        transcript: null,
        comments: []
      }
    })

    res.status(200).json({ 
      videos, 
      channelId,
      _debug: {
        analyticsStatus: analyticsRes.status,
        analyticsError: analyticsData.error || null,
        analyticsRows: analyticsData.rows?.length || 0,
        analyticsColumns: analyticsData.columnHeaders?.map(h => h.name) || [],
        firstRow: analyticsData.rows?.[0] || null
      }
    })
  } catch (err) {
    console.error('youtube-data error:', err)
    res.status(500).json({ error: err.message })
  }
}
