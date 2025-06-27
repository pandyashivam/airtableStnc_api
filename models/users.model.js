const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  _airtableId: {
    type: String,
    required: true,
    unique: true
  },
  Name: {
    type: String
  },
  Email: {
    type: String
  },
  Tickets: [{
    type: String,
    ref: 'Tickets'
  }],
  createdTime: {
    type: Date
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Users', userSchema); 