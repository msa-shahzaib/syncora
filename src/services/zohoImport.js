'use strict';

const { zohoRequest } = require('../zoho/client');

const CONTRACTS_MODULE = () => process.env.ZOHO_CONTRACTS_MODULE || 'Contracts';
const LOOKUP_FIELD = () => process.env.ZOHO_CONTRACT_LOOKUP_FIELD || 'Contact';
const CONTACT_EXT_FIELD = () => process.env.ZOHO_CONTACT_EXTERNAL_FIELD || 'Customer_number';
const CONTRACT_EXT_FIELD = () => process.env.ZOHO_CONTRACT_EXTERNAL_FIELD || 'Contract_Number';

const BATCH_SIZE = 100;

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function findManyByExternalField(module, fieldApiName, values) {
  const unique = [...new Set(values.filter(Boolean))];
  const result = new Map();
  if (unique.length === 0) return result;

  const batches = chunk(unique, BATCH_SIZE);
  await Promise.all(batches.map(async (batch) => {
    const criteria = `(${fieldApiName}:in:${batch.join(',')})`;
    const data = await zohoRequest('get', `/crm/v6/${module}/search`, {
      params: { criteria, fields: `id,${fieldApiName}`, per_page: 200 },
    });
    for (const record of data?.data ?? []) {
      result.set(record[fieldApiName], record.id);
    }
  }));
  return result;
}

async function findEmailConflicts(contacts) {
  const withEmail = contacts.filter((c) => c.Email);
  const [byNumber, byEmail] = await Promise.all([
    findManyByExternalField('Contacts', CONTACT_EXT_FIELD(), contacts.map((c) => c.Kundennummer)),
    findManyByExternalField('Contacts', 'Email', withEmail.map((c) => c.Email)),
  ]);

  const conflicts = [];
  for (const contact of withEmail) {
    if (byNumber.has(contact.Kundennummer)) continue;
    const existingZohoId = byEmail.get(contact.Email);
    if (existingZohoId) {
      conflicts.push({ kundennummer: contact.Kundennummer, email: contact.Email, existingZohoId });
    }
  }
  return conflicts;
}

async function bulkInsert(module, items) {
  const outcomes = [];
  for (const batch of chunk(items, BATCH_SIZE)) {
    const result = await zohoRequest('post', `/crm/v6/${module}`, {
      data: { data: batch.map((i) => i.payload) },
    });
    const responses = result?.data ?? [];
    batch.forEach((item, idx) => {
      const r = responses[idx];
      if (r?.code === 'SUCCESS') {
        outcomes.push({ identifier: item.identifier, ok: true, id: r.details.id });
      } else {
        outcomes.push({ identifier: item.identifier, ok: false, error: r ? JSON.stringify(r) : 'No response from Zoho' });
      }
    });
  }
  return outcomes;
}

async function bulkUpdate(module, items) {
  const outcomes = [];
  for (const batch of chunk(items, BATCH_SIZE)) {
    const result = await zohoRequest('put', `/crm/v6/${module}`, {
      data: { data: batch.map((i) => ({ id: i.id, ...i.payload })) },
    });
    const responses = result?.data ?? [];
    batch.forEach((item, idx) => {
      const r = responses[idx];
      if (r?.code === 'SUCCESS') {
        outcomes.push({ identifier: item.identifier, ok: true, id: item.id });
      } else {
        outcomes.push({ identifier: item.identifier, ok: false, error: r ? JSON.stringify(r) : 'No response from Zoho' });
      }
    });
  }
  return outcomes;
}

function buildContactPayload(contact) {
  const payload = {
    Last_Name: contact.Nachname,
    First_Name: contact.Vorname,
    Salutation: contact.Anrede,
    Phone: contact.Telefon,
    Mailing_Street: contact.Strasse,
    Mailing_Zip: contact.PLZ,
    Mailing_City: contact.Ort,
    [CONTACT_EXT_FIELD()]: contact.Kundennummer,
    Broker: contact.Makler,
  };
  if (contact.Email) payload.Email = contact.Email;
  if (contact.Geburtsdatum) payload.Date_of_Birth = contact.Geburtsdatum;
  return payload;
}

function buildContractPayload(contract, contactZohoId) {
  return {
    [CONTRACT_EXT_FIELD()]: contract.Vertragsnummer,
    Contact: contract.Kundennummer,
    Product: contract.Produkt,
    Insurer: contract.Versicherer,
    Start_Date: contract.Beginn,
    Expiry_Date: contract.Ablaufdatum,
    Annual_Premium: contract.Jahresbeitrag,
    Payment_Method: contract.Zahlweise,
    Contract_Status: contract.Status,
    Broker: contract.Makler,
    [LOOKUP_FIELD()]: { id: contactZohoId },
  };
}

async function runImport(contacts, contracts, emailMergeMap = new Map()) {
  const results = {
    contacts: { created: 0, updated: 0, failed: [] },
    contracts: { created: 0, updated: 0, skipped: 0, failed: [] },
  };

  const existingByNumber = await findManyByExternalField('Contacts', CONTACT_EXT_FIELD(), contacts.map((c) => c.Kundennummer));

  const contactCreates = [];
  const contactUpdates = [];
  for (const contact of contacts) {
    const existingId = existingByNumber.get(contact.Kundennummer) || emailMergeMap.get(contact.Kundennummer);
    const payload = buildContactPayload(contact);
    if (existingId) {
      contactUpdates.push({ identifier: contact.Kundennummer, id: existingId, payload });
    } else {
      contactCreates.push({ identifier: contact.Kundennummer, payload });
    }
  }

  const [createOutcomes, updateOutcomes] = await Promise.all([
    bulkInsert('Contacts', contactCreates),
    bulkUpdate('Contacts', contactUpdates),
  ]);

  const kundennummerToZohoId = {};
  for (const o of [...createOutcomes, ...updateOutcomes]) {
    if (o.ok) kundennummerToZohoId[o.identifier] = o.id;
  }
  results.contacts.created = createOutcomes.filter((o) => o.ok).length;
  results.contacts.updated = updateOutcomes.filter((o) => o.ok).length;
  results.contacts.failed = [...createOutcomes, ...updateOutcomes]
    .filter((o) => !o.ok)
    .map((o) => ({ kundennummer: o.identifier, error: o.error }));

  const linkable = [];
  for (const contract of contracts) {
    const contactId = kundennummerToZohoId[contract.Kundennummer];
    if (!contactId) {
      results.contracts.skipped++;
      results.contracts.failed.push({
        vertragsnummer: contract.Vertragsnummer,
        error: `Contact ${contract.Kundennummer} does not exist or was not imported successfully — contract skipped`,
      });
      continue;
    }
    linkable.push({ contract, contactId });
  }

  const existingByContractNumber = await findManyByExternalField(
    CONTRACTS_MODULE(),
    CONTRACT_EXT_FIELD(),
    linkable.map((l) => l.contract.Vertragsnummer)
  );

  const contractCreates = [];
  const contractUpdates = [];
  for (const { contract, contactId } of linkable) {
    const payload = buildContractPayload(contract, contactId);
    const existingId = existingByContractNumber.get(contract.Vertragsnummer);
    if (existingId) {
      contractUpdates.push({ identifier: contract.Vertragsnummer, id: existingId, payload });
    } else {
      contractCreates.push({ identifier: contract.Vertragsnummer, payload });
    }
  }

  const [contractCreateOutcomes, contractUpdateOutcomes] = await Promise.all([
    bulkInsert(CONTRACTS_MODULE(), contractCreates),
    bulkUpdate(CONTRACTS_MODULE(), contractUpdates),
  ]);

  results.contracts.created = contractCreateOutcomes.filter((o) => o.ok).length;
  results.contracts.updated = contractUpdateOutcomes.filter((o) => o.ok).length;
  results.contracts.failed.push(
    ...[...contractCreateOutcomes, ...contractUpdateOutcomes]
      .filter((o) => !o.ok)
      .map((o) => ({ vertragsnummer: o.identifier, error: o.error }))
  );

  return results;
}

module.exports = { runImport, findEmailConflicts };