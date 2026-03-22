export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const { videoId } = req.query
  if (!videoId) return res.status(400).json({ error: 'Missing videoId' })

  // Try YouTube's own timedtext API first (free, no auth needed, server-side so no CORS)
  const attempts = [
    `https://www.youtube.com/api/timedtext?v=${videoId}&lang=en&fmt=json3`,
    `https://www.youtube.com/api/timedtext?v=${videoId}&lang=en-US&fmt=json3`,
    `https://www.youtube.com/api/timedtext?v=${videoId}&lang=en&fmt=json3&kind=asr`, // auto-generated
    `https://video.google.com/timedtext?lang=en&v=${videoId}`, // fallback XML endpoint
  ]

  for (const url of attempts) {
    try {
      const ytRes = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json, text/xml, */*'
        }
      })

      if (!ytRes.ok) continue
      const contentType = ytRes.headers.get('content-type') || ''

      // Handle JSON3 format
      if (contentType.includes('json') || url.includes('fmt=json3')) {
        const text = await ytRes.text()
        if (!text || text.length < 20) continue
        try {
          const data = JSON.parse(text)
          const transcript = data.events
            ?.filter(e => e.segs)
            ?.map(e => e.segs.map(s => s.utf8 || '').join(''))
            ?.join(' ')
            ?.replace(/\s+/g, ' ')
            ?.trim()
          if (transcript && transcript.length > 50) {
            return res.status(200).json({ content: transcript })
          }
        } catch(e) { continue }
      }

      // Handle XML format
      if (contentType.includes('xml') || url.includes('timedtext?lang')) {
        const xml = await ytRes.text()
        if (!xml || xml.length < 50) continue
        const texts = xml.match(/<text[^>]*>([^<]*)<\/text>/g)
        if (texts && texts.length > 0) {
          const transcript = texts
            .map(t => t.replace(/<[^>]+>/g, '').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#39;/g,"'").replace(/&quot;/g,'"'))
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim()
          if (transcript.length > 50) {
            return res.status(200).json({ content: transcript })
          }
        }
      }
    } catch(e) { continue }
  }

  // Fallback to Supadata if YouTube's own API fails and key is configured
  if (process.env.SUPADATA_API_KEY) {
    try {
      const ytUrl = encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)
      const sRes = await fetch(
        `https://api.supadata.ai/v1/transcript?url=${ytUrl}&text=true&lang=en`,
        { headers: { 'x-api-key': process.env.SUPADATA_API_KEY } }
      )
      if (sRes.ok) {
        const data = await sRes.json()
        let text = typeof data.content === 'string' ? data.content :
          Array.isArray(data.content) ? data.content.map(s => s.text || '').join(' ') : ''
        if (text.length > 50) return res.status(200).json({ content: text })
      }
    } catch(e) {}
  }

  res.status(404).json({ error: 'No transcript available for this video' })
}
