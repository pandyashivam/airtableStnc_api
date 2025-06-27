const mongoose = require('mongoose');

const rawRevisionHistorySchema = new mongoose.Schema({
  recordId: {
    type: String,
    required: true,
    index: true
  },
  baseId: {
    type: String,
    required: true
  },
  tableId: {
    type: String,
    required: true
  },
  tableName: {
    type: String,
    required: true
  },
  revisionData: {
    type: mongoose.Schema.Types.Mixed
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  strict: false
});

rawRevisionHistorySchema.index({ recordId: 1, baseId: 1, tableId: 1 });

module.exports = mongoose.model('RawRevisionHistory', rawRevisionHistorySchema); 