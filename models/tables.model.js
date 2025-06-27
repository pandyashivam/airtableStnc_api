const mongoose = require('mongoose');

const tablesSchema = new mongoose.Schema({
  _airtableId: { type: String, required: true },
  name: { type: String, required: true },
  fields: { type: Object },
  baseId: { type: String, required: true }
});

module.exports = mongoose.models.Tables || mongoose.model('Tables', tablesSchema, 'tables'); 