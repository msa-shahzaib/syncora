'use strict';

const {
  findPotentialDuplicates,
  CONTACT_ID_FIELD,
  CONTACT_COMPARE_FIELDS,
  CONTRACT_ID_FIELD,
  CONTRACT_COMPARE_FIELDS,
} = require('./duplicateDetector');

function parseCsv(raw, source) {
  const lines = raw
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim()
    .split('\n');

  if (lines.length < 2) return [];

  const headers = lines[0].split(';').map((h) => h.trim());

  return lines.slice(1).map((line, i) => {
    const values = line.split(';').map((v) => v.trim());
    const row = {};
    headers.forEach((h, idx) => {
      row[h] = values[idx] ?? '';
    });
    row.__line = i + 2;
    row.__source = source;
    return row;
  });
}

function normaliseDate(raw) {
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const match = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (match) return `${match[3]}-${match[2]}-${match[1]}`;
  return null;
}

function normaliseAmount(raw) {
  if (!raw) return null;
  const num = parseFloat(raw.replace(',', '.'));
  return isNaN(num) ? null : num;
}

function parseContactsContent(raw, source) {
  const rows = parseCsv(raw, source);
  const issues = [];
  const parsed = [];
  const seenKundennummer = new Set();
  const emailToKunden = {};

  for (const row of rows) {
    const id = row['Kundennummer'];
    const warnings = [];

    if (seenKundennummer.has(id)) {
      issues.push({ row: row.__line, source, kundennummer: id, severity: 'error', message: `Duplicate Kundennummer in "${source}" — skipping` });
      continue;
    }
    seenKundennummer.add(id);

    if (!row['Email']) {
      warnings.push('Missing email address');
      issues.push({ row: row.__line, source, kundennummer: id, severity: 'warning', message: 'Missing email — importing row without it' });
    }

    if (row['Email']) {
      if (emailToKunden[row['Email']]) {
        issues.push({
          row: row.__line,
          source,
          kundennummer: id,
          severity: 'error',
          message: `Same email address (${row['Email']}) as ${emailToKunden[row['Email']]} — possible duplicate person, action required`,
        });
      }
      emailToKunden[row['Email']] = id;
    }

    const rawDob = row['Geburtsdatum'];
    const dob = normaliseDate(rawDob);
    if (!dob) {
      warnings.push(`Unrecognised date format for Geburtsdatum: "${rawDob}"`);
      issues.push({ row: row.__line, source, kundennummer: id, severity: 'warning', message: `Unrecognised Geburtsdatum format "${rawDob}" — field will be left blank` });
    } else if (dob !== rawDob) {
      issues.push({ row: row.__line, source, kundennummer: id, severity: 'info', message: `Geburtsdatum normalised from "${rawDob}" → "${dob}"` });
    }

    parsed.push({
      Kundennummer: id,
      Anrede: row['Anrede'],
      Vorname: row['Vorname'],
      Nachname: row['Nachname'],
      Email: row['Email'] || null,
      Telefon: row['Telefon'],
      Strasse: row['Strasse'],
      PLZ: row['PLZ'],
      Ort: row['Ort'],
      Geburtsdatum: dob,
      Makler: row['Makler'],
      __line: row.__line,
      __source: source,
      _warnings: warnings,
    });
  }

  return { parsed, issues };
}

function parseContractsContent(raw, source, validKundennummern) {
  const rows = parseCsv(raw, source);
  const issues = [];
  const parsed = [];
  const seenVertragsnummer = new Set();

  for (const row of rows) {
    const vn = row['Vertragsnummer'];
    const warnings = [];

    if (seenVertragsnummer.has(vn)) {
      issues.push({ row: row.__line, source, vertragsnummer: vn, severity: 'warning', message: `Duplicate Vertragsnummer in "${source}" — skipping duplicate row` });
      continue;
    }
    seenVertragsnummer.add(vn);

    if (!validKundennummern.has(row['Kundennummer'])) {
      issues.push({
        row: row.__line,
        source,
        vertragsnummer: vn,
        severity: 'error',
        message: `Kundennummer ${row['Kundennummer']} not found in contacts — contract will be skipped`,
      });
      continue;
    }

    const beginn = normaliseDate(row['Beginn']);
    if (!beginn) {
      warnings.push(`Unrecognised Beginn format: "${row['Beginn']}"`);
      issues.push({ row: row.__line, source, vertragsnummer: vn, severity: 'warning', message: `Unrecognised Beginn format "${row['Beginn']}"` });
    } else if (beginn !== row['Beginn']) {
      issues.push({ row: row.__line, source, vertragsnummer: vn, severity: 'info', message: `Beginn normalised from "${row['Beginn']}" → "${beginn}"` });
    }

    const ablauf = normaliseDate(row['Ablaufdatum']);
    if (!ablauf) {
      warnings.push(`Unrecognised Ablaufdatum format: "${row['Ablaufdatum']}"`);
      issues.push({ row: row.__line, source, vertragsnummer: vn, severity: 'warning', message: `Unrecognised Ablaufdatum format "${row['Ablaufdatum']}"` });
    } else if (ablauf !== row['Ablaufdatum']) {
      issues.push({ row: row.__line, source, vertragsnummer: vn, severity: 'info', message: `Ablaufdatum normalised from "${row['Ablaufdatum']}" → "${ablauf}"` });
    }

    if (ablauf && ablauf < new Date().toISOString().slice(0, 10) && row['Status'] === 'Aktiv') {
      issues.push({ row: row.__line, source, vertragsnummer: vn, severity: 'warning', message: `Contract expired (${ablauf}) but Status = Aktiv — importing as-is, flagged for review` });
    }

    if (row['Status'] === 'Gekündigt') {
      issues.push({ row: row.__line, source, vertragsnummer: vn, severity: 'info', message: `Status = Gekündigt (cancelled) — will import but exclude from renewal console` });
    }

    const beitrag = normaliseAmount(row['Jahresbeitrag']);
    if (beitrag === null) {
      warnings.push(`Could not parse Jahresbeitrag: "${row['Jahresbeitrag']}"`);
      issues.push({ row: row.__line, source, vertragsnummer: vn, severity: 'warning', message: `Could not parse Jahresbeitrag "${row['Jahresbeitrag']}"` });
    }

    parsed.push({
      Vertragsnummer: vn,
      Kundennummer: row['Kundennummer'],
      Produkt: row['Produkt'],
      Versicherer: row['Versicherer'],
      Beginn: beginn,
      Ablaufdatum: ablauf,
      Jahresbeitrag: beitrag,
      Zahlweise: row['Zahlweise'],
      Status: row['Status'],
      Makler: row['Makler'],
      __line: row.__line,
      __source: source,
      _warnings: warnings,
    });
  }

  return { parsed, issues };
}

function parseAllFromUploads({ contactFiles = [], contractFiles = [] }) {
  let contacts = [];
  let contactIssues = [];
  const fileSummaries = [];

  for (const { content, source } of contactFiles) {
    const { parsed, issues } = parseContactsContent(content, source);
    fileSummaries.push({ source, module: 'contacts', rowCount: parsed.length });
    contacts = contacts.concat(parsed);
    contactIssues = contactIssues.concat(issues);
  }

  const dedupedContacts = [];
  const seenIds = new Set();
  for (const c of contacts) {
    if (seenIds.has(c.Kundennummer)) {
      contactIssues.push({ row: c.__line, source: c.__source, kundennummer: c.Kundennummer, severity: 'error', message: `Duplicate Kundennummer across uploaded files — skipping` });
      continue;
    }
    seenIds.add(c.Kundennummer);
    dedupedContacts.push(c);
  }
  contacts = dedupedContacts;

  const validKundennummern = new Set(contacts.map((c) => c.Kundennummer));

  let contracts = [];
  let contractIssues = [];

  for (const { content, source } of contractFiles) {
    const { parsed, issues } = parseContractsContent(content, source, validKundennummern);
    fileSummaries.push({ source, module: 'contracts', rowCount: parsed.length });
    contracts = contracts.concat(parsed);
    contractIssues = contractIssues.concat(issues);
  }

  const dedupedContracts = [];
  const seenVn = new Set();
  for (const c of contracts) {
    if (seenVn.has(c.Vertragsnummer)) {
      contractIssues.push({ row: c.__line, source: c.__source, vertragsnummer: c.Vertragsnummer, severity: 'warning', message: `Duplicate Vertragsnummer across uploaded files — skipping` });
      continue;
    }
    seenVn.add(c.Vertragsnummer);
    dedupedContracts.push(c);
  }
  contracts = dedupedContracts;

  const contactDuplicates = findPotentialDuplicates(contacts, CONTACT_ID_FIELD, CONTACT_COMPARE_FIELDS, 'contacts');
  const contractDuplicates = findPotentialDuplicates(contracts, CONTRACT_ID_FIELD, CONTRACT_COMPARE_FIELDS, 'contracts');
  const duplicates = [...contactDuplicates, ...contractDuplicates];

  return {
    contacts,
    contracts,
    fileSummaries,
    issues: [...contactIssues, ...contractIssues],
    duplicates,
    summary: {
      contactsRead: contacts.length,
      contractsRead: contracts.length,
      issueCount: contactIssues.length + contractIssues.length,
      duplicateCount: duplicates.length,
    },
  };
}

module.exports = { parseAllFromUploads };
