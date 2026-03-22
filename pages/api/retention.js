export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const { access_token, video_id, channel_id } = req.query
  if (!access_token || !video_id || !channel_id) {
    return res.status(400).json({ error: 'Missing params' })
  }

  try {
    const endDate = new Date().toISOString().split('T')[0]
    const startDate = '2020-01-01'

    // Correct metric: audienceWatchRatio (not audienceWatchFraction)
    // elapsedVideoTimeRatio is the dimension (0.0 to 1.0)
    const url = `https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==${channel_id}&startDate=${startDate}&endDate=${endDate}&metrics=audienceWatchRatio&dimensions=elapsedVideoTimeRatio&filters=video==${video_id}&maxResults=100`

    const res1 = await fetch(url, {
      headers: { Authorization: `Bearer ${access_token}` }
    })

    const data = await res1.json()

    if (!res1.ok) {
      return res.status(200).json({ retention: null, error: data.error?.message || `API error ${res1.status}` })
    }

    if (!data.rows || data.rows.length === 0) {
      return res.status(200).json({ retention: null, error: 'No retention data available for this video yet' })
    }

    // Convert to percentage points
    const retention = data.rows.map(row => ({
      timePercent: Math.round(parseFloat(row[0]) * 100),
      retentionPercent: Math.round(parseFloat(row[1]) * 100)
    })).sort((a, b) => a.timePercent - b.timePercent)

    // Calculate key signals
    const introPoints = retention.filter(r => r.timePercent <= 15)
    const introDrop = introPoints.length >= 2
      ? introPoints[0].retentionPercent - introPoints[introPoints.length - 1].retentionPercent
      : null

    const avgRetention = Math.round(
      retention.reduce((s, r) => s + r.retentionPercent, 0) / retention.length
    )

    // Find biggest single drop point
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
