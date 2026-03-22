export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { retention, transcript, title, views, avgChannelRetention } = req.body
  if (!retention || !transcript) return res.status(400).json({ error: 'Missing data' })

  try {
    // Find the intro section — first ~15% of transcript by word count
    const words = transcript.split(' ')
    const introWordCount = Math.round(words.length * 0.15)
    const introText = words.slice(0, introWordCount).join(' ')
    const restText = words.slice(introWordCount, introWordCount + 300).join(' ') // next section for context

    // Get retention at key points
    const at5 = retention.find(r => r.timePercent >= 5)?.retentionPercent || 100
    const at10 = retention.find(r => r.timePercent >= 10)?.retentionPercent || 100
    const at20 = retention.find(r => r.timePercent >= 20)?.retentionPercent || 100
    const at50 = retention.find(r => r.timePercent >= 50)?.retentionPercent || 100
    const introDrop = retention[0]?.retentionPercent - at10

    const prompt = `You are analysing audience retention for a YouTube video by Formula Zac — grassroots motorsport creator.

VIDEO: "${title}"
VIEWS: ${views.toLocaleString()}
CHANNEL AVG RETENTION: ${avgChannelRetention}%

RETENTION DATA:
- Start (0%): 100%
- At 5%: ${at5}%
- At 10%: ${at10}%
- At 20%: ${at20}%
- At 50%: ${at50}%
- Intro drop (first 10%): ${introDrop}% lost

INTRO SCRIPT (first ~15% of video):
"${introText}..."

NEXT SECTION:
"${restText}..."

Diagnose this video's retention. Focus primarily on the intro.

Return ONLY valid JSON:
{
  "introGrade": "A|B|C|D|F",
  "introVerdict": "one punchy sentence verdict on the intro — was it good or did it leak viewers",
  "introDiagnosis": "2-3 sentences: what specifically in the intro script caused the retention shape. Quote actual words from the script.",
  "hookPromiseCheck": "did the opening deliver on what the title promised? One sentence.",
  "midVideoShape": "one sentence describing the retention shape after the intro — slow bleed, stable, spike, etc",
  "biggestFix": "the single most impactful change to make to this script's opening to improve retention",
  "whatWorked": "one thing the script did well that likely kept people watching"
}`

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }]
      })
    })

    const claudeData = await claudeRes.json()
    const text = claudeData.content?.map(i => i.text || '').join('') || ''
    const clean = text.replace(/```json|```/g, '').trim()
    const analysis = JSON.parse(clean)

    res.status(200).json({ analysis })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}
