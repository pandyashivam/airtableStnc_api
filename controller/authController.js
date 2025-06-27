const SystemUser = require('../models/systemUser.model');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const querystring = require('querystring');
const crypto = require('crypto');

const AIRTABLE_CLIENT_ID = process.env.AIRTABLE_CLIENT_ID;
const AIRTABLE_CLIENT_SECRET = process.env.AIRTABLE_CLIENT_SECRET;
const AIRTABLE_REDIRECT_URI = process.env.AIRTABLE_REDIRECT_URI;
const AIRTABLE_AUTH_URL = 'https://airtable.com/oauth2/v1/authorize';
const AIRTABLE_TOKEN_URL = 'https://airtable.com/oauth2/v1/token';
const state = crypto.randomBytes(16).toString('hex'); 

function generatePKCE() {
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  
  const codeChallenge = crypto
    .createHash('sha256')
    .update(codeVerifier)
    .digest('base64url');
  
  return { codeVerifier, codeChallenge };
}

const pkceStore = new Map();

exports.getAirtableAuthUrl = (req, res) => {
  if (!AIRTABLE_CLIENT_ID) {
    return res.status(500).json({
      status: 'error',
      message: 'Airtable client ID is not configured'
    });
  }

  const { codeVerifier, codeChallenge } = generatePKCE();
  
  pkceStore.set(state, codeVerifier);
  
  setTimeout(() => pkceStore.delete(state), 10 * 60 * 1000);

  const authUrl = `${AIRTABLE_AUTH_URL}?${querystring.stringify({
    client_id: AIRTABLE_CLIENT_ID,
    redirect_uri: AIRTABLE_REDIRECT_URI,
    scope: 'data.records:read data.records:write schema.bases:read',
    response_type: 'code',
    state: state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256'
  })}`;

  res.status(200).json({
    status: 'success',
    authUrl
  });
};

exports.handleAirtableCallback = async (req, res, next) => {
  try {
    const { code, state: returnedState } = req.body;

    if (!code) {
      return res.status(400).json({
        status: 'error',
        message: 'Authorization code is required'
      });
    }
    
    const codeVerifier = pkceStore.get(returnedState);
    if (!returnedState || !codeVerifier) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid or expired state parameter'
      });
    }
    
    pkceStore.delete(returnedState);

    const basicAuth = Buffer.from(`${AIRTABLE_CLIENT_ID}:${AIRTABLE_CLIENT_SECRET}`).toString('base64');

    const tokenResponse = await axios.post(
      AIRTABLE_TOKEN_URL,
      querystring.stringify({
        code,
        grant_type: 'authorization_code',
        redirect_uri: AIRTABLE_REDIRECT_URI,
        code_verifier: codeVerifier
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Basic ${basicAuth}`
        }
      }
    );

    const {
      access_token,
      refresh_token,
      expires_in
    } = tokenResponse.data;

    const expiresAt = new Date();
    expiresAt.setSeconds(expiresAt.getSeconds() + expires_in);

    let airtableUserInfo;
    let airtableUserId;
    let workspaceId;
    try {
      const userInfoResponse = await axios.get('https://api.airtable.com/v0/meta/whoami', {
        headers: {
          'Authorization': `Bearer ${access_token}`
        }
      });
      airtableUserInfo = userInfoResponse.data;
      airtableUserId = airtableUserInfo?.id;
      workspaceId = airtableUserInfo?.workspaceId;
    } catch (error) {
      console.error('Error fetching Airtable user info:', error.response?.data || error.message);
    }

    let user = await SystemUser.findOne({ 'airtableOAuth.airtableUserId': airtableUserId });
    
    if (!user) {
      user = new SystemUser({
        name:  `Airtable User ${airtableUserId}`,
        airtableOAuth: {
          accessToken: access_token,
          refreshToken: refresh_token,
          expiresAt,
          airtableUserId: airtableUserId,
          workspaceId: workspaceId
        }
      });
    } else {
      user.airtableOAuth = {
        accessToken: access_token,
        refreshToken: refresh_token,
        expiresAt,
        airtableUserId: airtableUserId,
        workspaceId: workspaceId
      };
    }

    await user.save();

    const token = jwt.sign(
      { id: user._id },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.status(200).json({
      status: 'success',
      message: 'Airtable OAuth authentication successful',
      token,
      user: {
        id: user._id,
        name: user.name,
        hasAirtableOAuth: true
      }
    });
  } catch (error) {
    console.error('Airtable OAuth error:', error.response?.data || error.message);
    next(error);
  }
};

exports.getCurrentUser = async (req, res, next) => {
  try {
    const user = await SystemUser.findById(req.user.id);
    
    if (!user) {
      return res.status(404).json({
        status: 'error',
        message: 'User not found'
      });
    }

    res.status(200).json({
      status: 'success',
      user: {
        id: user._id,
        name: user.name,
        hasAirtableOAuth: !!user.airtableOAuth?.accessToken
      }
    });
  } catch (error) {
    next(error);
  }
};

// Disconnect Airtable
exports.disconnectAirtable = async (req, res, next) => {
  try {
    const userId = req.user.id;
    
    await SystemUser.findByIdAndUpdate(userId, {
      $unset: { airtableOAuth: 1 }
    });

    res.status(200).json({
      status: 'success',
      message: 'Airtable disconnected successfully'
    });
  } catch (error) {
    next(error);
  }
};
