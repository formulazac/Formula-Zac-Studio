export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  const { access_token } = req.query
  if (!access_token) return res.status(401).json({ error: 'No access token' })

  try {
    const channelRes = await fetch(
      'https://www.googleapis.com/youtube/v3/channels?part=id&mine=true',
      { headers: { Authorization: `Bearer ${access_token}` } }
    )
    const channelData = await channelRes.json()
    const channelId = channelData.items?.[0]?.id
    if (!channelId) return res.status(400).json({ error: 'No channel' })

    const endDate = new Date().toISOString().split('T')[0]

    // Test 1: basic analytics without video dimension
    const r1 = await fetch(
      `https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==${channelId}&startDate=2024-01-01&endDate=${endDate}&metrics=views,impressions,impressionClickThroughRate,averageViewPercentage`,
      { headers: { Authorization: `Bearer ${access_token}` } }
    )
    const d1 = await r1.json()

    // Test 2: with video dimension on one known video
    const vRes = await fetch(
      `https://www.googleapis.com/youtube/v3/search?part=id&channelId=${channelId}&type=video&maxResults=3&order=viewCount`,
      { headers: { Authorization: `Bearer ${access_token}` } }
    )
    const vData = await vRes.json()
    const testIds = vData.items?.map(v => v.id.videoId) || []
    
    let d2 = null
    if (testIds.length) {
      const filterStr = testIds.map(id => `video==${id}`).join(',')
      const r2 = await fetch(
        `https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==${channelId}&startDate=2020-01-01&endDate=${endDate}&metrics=views,impressions,impressionClickThroughRate,averageViewPercentage&dimensions=video&filters=${encodeURIComponent(filterStr)}`,
        { headers: { Authorization: `Bearer ${access_token}` } }
      )
      d2 = await r2.json()
    }

    res.status(200).json({
      channelId,
      testVideoIds: testIds,
      overallAnalytics: { status: r1.status, columnHeaders: d1.columnHeaders, firstRow: d1.rows?.[0], error: d1.error },
      perVideoAnalytics: { columnHeaders: d2?.columnHeaders, rows: d2?.rows?.slice(0,3), error: d2?.error }
    })
  } catch(err) {
    res.status(500).json({ error: err.message })
  }
}
