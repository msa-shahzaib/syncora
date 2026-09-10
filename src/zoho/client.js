'use strict';

const axios = require('axios');
const { getAccessToken } = require('./auth');

async function zohoRequest(method, path, { data, params } = {}) {
  const token = await getAccessToken();
  const url = `${process.env.ZOHO_API_BASE}${path}`;

  try {
    const response = await axios({
      method,
      url,
      data,
      params,
      headers: {
        Authorization: `Zoho-oauthtoken ${token}`,
        'Content-Type': 'application/json',
      },
    });
    return response.data;
  } catch (err) {
    const zohoError = err.response?.data;
    const message = zohoError
      ? JSON.stringify(zohoError)
      : err.message;
    throw new Error(`Zoho API error [${method.toUpperCase()} ${path}]: ${message}`);
  }
}

module.exports = { zohoRequest };
