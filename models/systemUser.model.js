const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    trim: true
  },
  airtableOAuth: {
    accessToken: String,
    refreshToken: String,
    expiresAt: Date,
    airtableUserId: String
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});


userSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

const SystemUser = mongoose.model('SystemUser', userSchema);

module.exports = SystemUser; 