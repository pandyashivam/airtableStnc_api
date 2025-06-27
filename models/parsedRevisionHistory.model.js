const mongoose = require('mongoose');

const revisionItemSchema = new mongoose.Schema({
  uuid: {
    type: String,
    required: true
  },
  issueId: {
    type: String,
    required: true
  },
  columnType: {
    type: String
  },
  oldValue: mongoose.Schema.Types.Mixed,
  newValue: mongoose.Schema.Types.Mixed,
  createdDate: {
    type: Date,
    default: Date.now
  },
  authoredBy: {
    type: String
  }
});

const parsedRevisionHistorySchema = new mongoose.Schema({
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
  revisionData: [revisionItemSchema],
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

parsedRevisionHistorySchema.index({ recordId: 1, baseId: 1, tableId: 1 });

module.exports = mongoose.model('ParsedRevisionHistory', parsedRevisionHistorySchema); 