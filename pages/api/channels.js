export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const { access_token } = req.query
  if (!access_token) return res.status(401).json({ error: 'No access token' })

  try {
    const channelRes = await fetch(
      'https://www.googleapis.com/youtube/v3/channels?part=id,snippet,statistics&mine=true&maxResults=50',
      { headers: { Authorization: `Bearer ${access_token}` } }
    )
    const channelData = await channelRes.json()

    if (!channelRes.ok) {
      return res.status(channelRes.status).json({ error: channelData.error?.message || 'Failed to fetch channels' })
    }

    const channels = channelData.items?.map(c => ({
      id: c.id,
      title: c.snippet?.title,
      description: c.snippet?.description?.slice(0, 100),
      thumbnail: c.snippet?.thumbnails?.default?.url || c.snippet?.thumbnails?.medium?.url,
      subscriberCount: parseInt(c.statistics?.subscriberCount || 0),
      videoCount: parseInt(c.statistics?.videoCount || 0)
    })) || []

    res.status(200).json({ channels })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}
