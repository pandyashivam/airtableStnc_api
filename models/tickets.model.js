const mongoose = require('mongoose');

const ticketSchema = new mongoose.Schema({
  _airtableId: {
    type: String,
    required: true,
    unique: true
  },
  'Ticket ID': {
    type: String
  },
  Title: {
    type: String
  },
  Description: {
    type: String
  },
  Status: {
    type: String
  },
  'Assigned To': [{
    type: String,
    ref: 'Users'
  }],
  createdTime: {
    type: Date
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Tickets', ticketSchema); 