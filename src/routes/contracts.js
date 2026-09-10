'use strict';

const express = require('express');
const router = express.Router();
const { getAllContracts, createFollowup, bulkFollowup, updateContract } = require('../services/zohoContracts');

router.get('/', async (req, res) => {
  try {
    const contracts = await getAllContracts();
    res.json({ ok: true, contracts });
  } catch (err) {
    console.error('[contracts] fetch error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/:id/followup', async (req, res) => {
  try {
    const result = await createFollowup(req.params.id);
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[contracts] followup error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/bulk-followup', async (req, res) => {
  try {
    const result = await bulkFollowup();
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[contracts] bulk-followup error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const result = await updateContract(req.params.id, req.body || {});
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[contracts] update error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
