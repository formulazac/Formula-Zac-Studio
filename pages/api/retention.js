export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const { access_token, video_id, channel_id } = req.query
  if (!access_token || !video_id || !channel_id) {
    return res.status(400).json({ error: 'Missing params' })
  }

  try {
    const endDate = new Date().toISOString().split('T')[0]
    const startDate = '2020-01-01'

    // Fetch audience retention (elapsedVideoTimeRatio = 0 to 1, audienceWatchFraction = % remaining)
    const res1 = await fetch(
      `https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==${channel_id}&startDate=${startDate}&endDate=${endDate}&metrics=audienceWatchFraction&dimensions=elapsedVideoTimeRatio&filters=video==${video_id}&maxResults=100`,
      { headers: { Authorization: `Bearer ${access_token}` } }
    )

    const data = await res1.json()

    if (!res1.ok || !data.rows) {
      return res.status(200).json({ retention: null, error: data.error?.message || 'No retention data' })
    }

    // Convert to array of { time: 0-100%, retention: 0-100% }
    const retention = data.rows.map(row => ({
      timePercent: Math.round(row[0] * 100),
      retentionPercent: Math.round(row[1] * 100)
    }))

    // Calculate key signals
    const first30s = retention.filter(r => r.timePercent <= 10) // first 10% of video ≈ first 30s for avg 5min video
    const introDrop = first30s.length >= 2
      ? first30s[0].retentionPercent - first30s[first30s.length - 1].retentionPercent
      : null

    const avgRetention = Math.round(retention.reduce((s, r) => s + r.retentionPercent, 0) / retention.length)

    // Find biggest single drop
    let biggestDrop = { drop: 0, timePercent: 0 }
    for (let i = 1; i < retention.length; i++) {
      const drop = retention[i - 1].retentionPercent - retention[i].retentionPercent
      if (drop > biggestDrop.drop) {
        biggestDrop = { drop, timePercent: retention[i].timePercent }
      }
    }

    res.status(200).json({
      retention,
      introDrop,
      avgRetention,
      biggestDrop,
      startRetention: retention[0]?.retentionPercent || 100
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}
