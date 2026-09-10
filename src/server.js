'use strict';

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');

const importRoutes = require('./routes/import');
const contractsRoutes = require('./routes/contracts');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(express.static(path.join(__dirname, '..', 'public')));

app.use('/api/import', importRoutes);
app.use('/api/contracts', contractsRoutes);

app.get('/{*splat}', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.use((err, req, res, _next) => {
  console.error('[server] Unhandled error:', err.message);
  res.status(500).json({ error: err.message });
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
