const mongoose = require('mongoose');

const basesSchema = new mongoose.Schema({
  _airtableId: { type: String, required: true },
  name: { type: String, required: true }
});

module.exports = mongoose.models.Bases || mongoose.model('Bases', basesSchema, 'bases'); 