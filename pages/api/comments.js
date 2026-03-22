export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const { access_token, video_id } = req.query
  if (!access_token || !video_id) return res.status(400).json({ error: 'Missing params' })

  try {
    const commentsRes = await fetch(
      `https://www.googleapis.com/youtube/v3/commentThreads?part=snippet&videoId=${video_id}&maxResults=100&order=relevance`,
      { headers: { Authorization: `Bearer ${access_token}` } }
    )
    const data = await commentsRes.json()

    if (!commentsRes.ok) {
      return res.status(commentsRes.status).json({ error: data.error?.message || 'Failed to fetch comments' })
    }

    const comments = data.items?.map(item => ({
      text: item.snippet?.topLevelComment?.snippet?.textDisplay || '',
      likes: item.snippet?.topLevelComment?.snippet?.likeCount || 0,
      author: item.snippet?.topLevelComment?.snippet?.authorDisplayName || ''
    })) || []

    res.status(200).json({ comments })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}
