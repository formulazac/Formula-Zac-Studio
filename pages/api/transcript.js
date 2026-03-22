export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const { videoId, access_token } = req.query
  if (!videoId) return res.status(400).json({ error: 'Missing videoId' })

  // Try YouTube Captions API first (if user is logged in with OAuth)
  if (access_token) {
    try {
      const transcript = await getTranscriptViaAPI(videoId, access_token)
      if (transcript) return res.status(200).json({ content: transcript })
    } catch(e) {
      console.log('Captions API failed:', e.message)
    }
  }

  // Fallback to Supadata
  if (process.env.SUPADATA_API_KEY) {
    try {
      const ytUrl = encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)
      const sRes = await fetch(
        `https://api.supadata.ai/v1/transcript?url=${ytUrl}&text=true&lang=en`,
        { headers: { 'x-api-key': process.env.SUPADATA_API_KEY } }
      )
      if (sRes.ok) {
        const data = await sRes.json()
        const text = typeof data.content === 'string' ? data.content :
          Array.isArray(data.content) ? data.content.map(s => s.text || '').join(' ') : ''
        if (text.length > 50) return res.status(200).json({ content: text.trim() })
      }
    } catch(e) {
      console.log('Supadata failed:', e.message)
    }
  }

  res.status(404).json({ error: 'No transcript available' })
}

async function getTranscriptViaAPI(videoId, accessToken) {
  // Step 1: List available caption tracks
  const listRes = await fetch(
    `https://www.googleapis.com/youtube/v3/captions?part=snippet&videoId=${videoId}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )

  if (!listRes.ok) throw new Error(`Caption list failed: ${listRes.status}`)
  const listData = await listRes.json()

  if (!listData.items || listData.items.length === 0) {
    throw new Error('No caption tracks found')
  }

  // Prefer: manual English > auto-generated English > any English > first available
  const tracks = listData.items
  const preferred =
    tracks.find(t => t.snippet.language === 'en' && t.snippet.trackKind === 'standard') ||
    tracks.find(t => t.snippet.language === 'en' && t.snippet.trackKind === 'asr') ||
    tracks.find(t => t.snippet.language?.startsWith('en')) ||
    tracks[0]

  if (!preferred) throw new Error('No suitable caption track')

  // Step 2: Download the caption file
  const dlRes = await fetch(
    `https://www.googleapis.com/youtube/v3/captions/${preferred.id}?tfmt=srt`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )

  if (!dlRes.ok) throw new Error(`Caption download failed: ${dlRes.status}`)

  const srtText = await dlRes.text()
  if (!srtText || srtText.length < 20) throw new Error('Empty caption file')

  // Parse SRT format to plain text
  const plainText = srtText
    .replace(/\d+\n\d{2}:\d{2}:\d{2},\d{3} --> \d{2}:\d{2}:\d{2},\d{3}\n/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return plainText
}
