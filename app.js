const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const airtableService = require('./services/airtable.service');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

app.get('/', (req, res) => {
  res.json({ message: 'Welcome to the API' });
});

const authRoutes = require('./routes/auth.routes');
const airtableRoutes = require('./routes/airtable.routes');

app.use('/api/auth', authRoutes);
app.use('/api/airtable', airtableRoutes);

app.use((err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({
    status: 'error',
    statusCode,
    message: err.message || 'Internal Server Error',
  });
});

process.on('SIGINT', async () => {
  console.log('Shutting down...');
  await airtableService.closeBrowser();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('Shutting down...');
  await airtableService.closeBrowser();
  process.exit(0);
});

module.exports = app;
