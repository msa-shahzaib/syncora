'use strict';

const express = require('express');
const multer = require('multer');
const router = express.Router();

const { parseAllFromUploads } = require('../services/csvParser');
const { runImport } = require('../services/zohoImport');
const { createSession, getSession, deleteSession } = require('../services/importSession');
const { findEmailConflicts } = require('../services/zohoImport');

const MAX_FILES = 10;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE, files: MAX_FILES },
});

const uploadFields = upload.fields([
  { name: 'contactsFiles', maxCount: MAX_FILES },
  { name: 'contractsFiles', maxCount: MAX_FILES },
]);

router.post('/preview', uploadFields, async (req, res) => {
  try {
    const contactFiles = (req.files?.contactsFiles || []).map((f) => ({
      content: f.buffer.toString('utf-8'),
      source: f.originalname,
    }));
    const contractFiles = (req.files?.contractsFiles || []).map((f) => ({
      content: f.buffer.toString('utf-8'),
      source: f.originalname,
    }));

    if (contactFiles.length === 0 && contractFiles.length === 0) {
      return res.status(400).json({ ok: false, error: 'Please upload at least one CSV file.' });
    }
    if (contactFiles.length + contractFiles.length > MAX_FILES) {
      return res.status(400).json({ ok: false, error: `You can upload at most ${MAX_FILES} files.` });
    }

    const { contacts, contracts, fileSummaries, issues, duplicates, summary } = parseAllFromUploads({
      contactFiles,
      contractFiles,
    });

    const emailConflicts = await findEmailConflicts(contacts);
    const zohoConflicts = emailConflicts.map((c) => ({
      id: `zoho-email__${c.kundennummer}`,
      type: 'existingZohoEmail',
      kundennummer: c.kundennummer,
      email: c.email,
      existingZohoId: c.existingZohoId,
    }));

    const importId = createSession({ contacts, contracts, duplicates, zohoConflicts });

    res.json({
      ok: true,
      importId,
      fileSummaries,
      counts: { contacts: contacts.length, contracts: contracts.length },
      issues,
      duplicates,
      zohoConflicts,
      summary,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/confirm', async (req, res) => {
  try {
    const { importId, resolutions = {} } = req.body || {};
    if (!importId) {
      return res.status(400).json({ ok: false, error: 'Missing importId — please run Load & Preview again.' });
    }

    const session = getSession(importId);
    if (!session) {
      return res.status(400).json({ ok: false, error: 'This preview has expired. Please run Load & Preview again.' });
    }

    const { contacts, contracts, duplicates, zohoConflicts } = session;

    const unresolvedDup = duplicates.filter((d) => !resolutions[d.id]);
    const unresolvedConflict = zohoConflicts.filter((c) => !resolutions[c.id]);
    if (unresolvedDup.length > 0 || unresolvedConflict.length > 0) {
      return res.status(400).json({
        ok: false,
        error: `Please choose an action for all ${duplicates.length + zohoConflicts.length} flagged item(s) before importing.`,
      });
    }

    const excludeContactIds = new Set();
    const excludeContractIds = new Set();

    for (const group of duplicates) {
      const action = resolutions[group.id];
      const idA = group.recordA.id;
      const idB = group.recordB.id;
      const targetSet = group.module === 'contacts' ? excludeContactIds : excludeContractIds;

      if (action === 'omitA') targetSet.add(idA);
      else if (action === 'omitB') targetSet.add(idB);
      else if (action === 'skipBoth') { targetSet.add(idA); targetSet.add(idB); }
    }

    for (const conflict of zohoConflicts) {
      if (resolutions[conflict.id] === 'omit') {
        excludeContactIds.add(conflict.kundennummer);
      }
    }

    const finalContacts = contacts.filter((c) => !excludeContactIds.has(c.Kundennummer));
    const finalContracts = contracts.filter(
      (c) => !excludeContractIds.has(c.Vertragsnummer) && !excludeContactIds.has(c.Kundennummer)
    );

    const emailMergeMap = new Map();
    for (const conflict of zohoConflicts) {
      if (resolutions[conflict.id] === 'merge') {
        emailMergeMap.set(conflict.kundennummer, conflict.existingZohoId);
      }
    }
    const results = await runImport(finalContacts, finalContracts, emailMergeMap);

    deleteSession(importId);

    res.json({ ok: true, results });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;