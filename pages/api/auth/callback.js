export default async function handler(req, res) {
  const { code, error } = req.query

  if (error) {
    return res.redirect(`/?error=${encodeURIComponent(error)}`)
  }

  if (!code) {
    return res.redirect('/?error=no_code')
  }

  try {
    // Exchange code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: `${process.env.NEXTAUTH_URL}/api/auth/callback`,
        grant_type: 'authorization_code'
      })
    })

    const tokens = await tokenRes.json()

    if (!tokens.access_token) {
      return res.redirect(`/?error=${encodeURIComponent(tokens.error || 'token_exchange_failed')}`)
    }

    // Get user info
    const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` }
    })
    const user = await userRes.json()

    // Pass tokens to frontend via URL params (stored in sessionStorage by the app)
    const params = new URLSearchParams({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || '',
      name: user.name || '',
      email: user.email || '',
      picture: user.picture || ''
    })

    res.redirect(`/?${params}`)
  } catch (err) {
    res.redirect(`/?error=${encodeURIComponent(err.message)}`)
  }
}
