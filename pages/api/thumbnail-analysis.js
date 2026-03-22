export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { videos } = req.body
  if (!videos || !videos.length) return res.status(400).json({ error: 'No videos provided' })

  try {
    // Take top 8 and bottom 4 long form by views for comparison
    const longs = videos.filter(v => !v.isShort && v.thumbnailUrl)
    const top = longs.sort((a, b) => b.views - a.views).slice(0, 8)
    const bottom = longs.slice(-4).filter(v => v.views < 10000)
    const toAnalyse = [...top, ...bottom].slice(0, 10) // cap at 10 to control cost

    // Fetch and encode each thumbnail
    const thumbnailData = []
    for (const vid of toAnalyse) {
      try {
        const imgRes = await fetch(vid.thumbnailUrl)
        if (!imgRes.ok) continue
        const buffer = await imgRes.arrayBuffer()
        const base64 = Buffer.from(buffer).toString('base64')
        const contentType = imgRes.headers.get('content-type') || 'image/jpeg'
        thumbnailData.push({
          id: vid.id,
          title: vid.title,
          views: vid.views,
          ctr: vid.ctr,
          base64,
          contentType,
          isTop: top.some(t => t.id === vid.id)
        })
      } catch (e) {
        console.log(`Failed to fetch thumbnail for ${vid.id}:`, e.message)
      }
    }

    if (!thumbnailData.length) {
      return res.status(200).json({ analysis: null, error: 'Could not fetch any thumbnails' })
    }

    // Build vision prompt with all thumbnails
    const imageBlocks = thumbnailData.map(t => ([
      {
        type: 'image',
        source: { type: 'base64', media_type: t.contentType, data: t.base64 }
      },
      {
        type: 'text',
        text: `"${t.title}" — ${t.views.toLocaleString()} views, ${t.ctr}% CTR (${t.isTop ? 'TOP PERFORMER' : 'UNDERPERFORMER'})`
      }
    ])).flat()

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1500,
        messages: [{
          role: 'user',
          content: [
            ...imageBlocks,
            {
              type: 'text',
              text: `You are analysing YouTube thumbnails for Formula Zac — a grassroots motorsport creator. Above are thumbnails labelled as TOP PERFORMER or UNDERPERFORMER with their view counts and CTR.

Analyse the visual patterns and return ONLY valid JSON, no markdown:
{
  "whatWorks": ["3-4 specific visual patterns present in top performers — be specific about composition, text, expression, colours"],
  "whatDoesntWork": ["2-3 specific visual patterns present in underperformers"],
  "faceInsight": "one sentence on how face/expression affects performance on this channel",
  "textInsight": "one sentence on how text overlays affect performance — size, style, content",
  "compositionInsight": "one sentence on composition patterns — car vs person, close vs wide, action vs static",
  "topThumbnail": "title of the single strongest thumbnail and one sentence on exactly why it works",
  "recommendation": "one specific actionable recommendation for the next thumbnail based on what the data shows"
}`
            }
          ]
        }]
      })
    })

    const claudeData = await claudeRes.json()
    const text = claudeData.content?.map(i => i.text || '').join('') || ''
    const clean = text.replace(/```json|```/g, '').trim()
    const analysis = JSON.parse(clean)

    res.status(200).json({ analysis, analysedCount: thumbnailData.length })
  } catch (err) {
    console.error('Thumbnail analysis error:', err)
    res.status(500).json({ error: err.message })
  }
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb'
    }
  }
}
