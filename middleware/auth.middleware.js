const jwt = require('jsonwebtoken');
const SystemUser = require('../models/systemUser.model');

exports.protect = async (req, res, next) => {
  try {
    let token;

    if (
      req.headers.authorization &&
      req.headers.authorization.startsWith('Bearer')
    ) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return res.status(401).json({
        status: 'error',
        message: 'You are not logged in. Please log in to get access.'
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await SystemUser.findById(decoded.id);
    if (!user) {
      return res.status(401).json({
        status: 'error',
        message: 'The user belonging to this token no longer exists.'
      });
    }

    req.user = {
      id: user._id
    };
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        status: 'error',
        message: 'Invalid token. Please log in again.'
      });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        status: 'error',
        message: 'Your token has expired. Please log in again.'
      });
    }
    next(error);
  }
};

exports.requireAirtableAuth = async (req, res, next) => {
  try {
    const user = await SystemUser.findById(req.user.id);
    
    if (!user || !user.airtableOAuth || !user.airtableOAuth.accessToken) {
      return res.status(403).json({
        status: 'error',
        message: 'Airtable authentication required'
      });
    }

    const now = new Date();
    if (user.airtableOAuth.expiresAt && user.airtableOAuth.expiresAt < now) {
      return res.status(401).json({
        status: 'error',
        message: 'Airtable token expired',
        code: 'TOKEN_EXPIRED'
      });
    }

    next();
  } catch (error) {
    next(error);
  }
}; 