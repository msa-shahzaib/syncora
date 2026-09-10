'use strict';

const axios = require('axios');

let _accessToken = null;
let _expiresAt = 0;

async function getAccessToken() {
  const fiveMinutes = 5 * 60 * 1000;
  const now = Date.now();

  if (_accessToken && now < _expiresAt - fiveMinutes) {
    return _accessToken;
  }

  const params = new URLSearchParams({
    client_id: process.env.ZOHO_CLIENT_ID,
    client_secret: process.env.ZOHO_CLIENT_SECRET,
    refresh_token: process.env.ZOHO_REFRESH_TOKEN,
    grant_type: 'refresh_token',
  });

  const response = await axios.post(
    `${process.env.ZOHO_ACCOUNTS_URL}/oauth/v2/token`,
    params.toString(),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );

  const { access_token, expires_in, error } = response.data;

  if (error || !access_token) {
    throw new Error(`Zoho token refresh failed: ${error || 'no access_token in response'}`);
  }

  _accessToken = access_token;
  _expiresAt = now + expires_in * 1000;

  console.log('[zoho/auth] Access token refreshed, expires in', expires_in, 'seconds');
  return _accessToken;
}

module.exports = { getAccessToken };
