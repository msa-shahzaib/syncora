'use strict';

const { zohoRequest } = require('../zoho/client');
const { generateTalkingPoint } = require('./llmTalkingPoint');

const MODULE = () => process.env.ZOHO_CONTRACTS_MODULE || 'Contracts';
const LOOKUP = () => process.env.ZOHO_CONTRACT_LOOKUP_FIELD || 'Contact';
const EXT_CONTRACT = () => process.env.ZOHO_CONTRACT_EXTERNAL_FIELD || 'Contract_Number';
const FOLLOWUP_FLD = () => process.env.ZOHO_FOLLOWUP_FIELD || 'Renewal_Followup_Created';
const EXT_CONTACT = () => process.env.ZOHO_CONTACT_EXTERNAL_FIELD || 'Customer_number';
const TALKINGPOINT_FLD = () => process.env.ZOHO_TASK_TALKING_POINT_FIELD || 'Talking_Point';

async function getAllContracts() {
  const [contractsResp, contactsResp] = await Promise.all([
    zohoRequest('get', `/crm/v6/${MODULE()}`, {
      params: { fields: 'id,Contract_Number,Start_Date,Expiry_Date,Broker,Product,Insurer,Annual_Premium,Payment_Method,Contract_Status,Contact,Renewal_Followup_Created', per_page: 200 },
    }),
    zohoRequest('get', '/crm/v6/Contacts', {
      params: { fields: 'id,Customer_number,First_Name,Last_Name,Email,Phone', per_page: 200 },
    }),
  ]);

  const contracts = contractsResp?.data || [];
  const contactMap = {};
  (contactsResp?.data || []).forEach((c) => {
    contactMap[c.id] = c;
  });

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return contracts.map((c) => {
    const contactId = c[LOOKUP()]?.id;
    const contact = contactMap[contactId] || {};
    const expiryRaw = c.Expiry_Date;
    const daysLeft = expiryRaw
      ? Math.ceil((new Date(expiryRaw) - today) / 86400000)
      : null;

    return {
      id: c.id,
      contractNumber: c[EXT_CONTRACT()],
      product: c.Product,
      insurer: c.Insurer,
      startDate: c.Start_Date,
      expiryDate: expiryRaw,
      daysLeft,
      annualPremium: c.Annual_Premium,
      paymentMethod: c.Payment_Method,
      status: c.Contract_Status,
      broker: c.Broker,
      hasFollowup: !!c[FOLLOWUP_FLD()],
      contact: {
        id: contactId || null,
        name: [contact.First_Name, contact.Last_Name].filter(Boolean).join(' ') || '—',
        salutation: contact.Salutation || '',
        firstName: contact.First_Name || '',
        lastName: contact.Last_Name || '',
        phone: contact.Phone || '—',
        email: contact.Email || '—',
        customerNumber: contact[EXT_CONTACT()] || '—',
      },
    };
  });
}

async function createFollowup(contractId) {
  const resp = await zohoRequest('get', `/crm/v6/${MODULE()}/${contractId}`);
  const contract = resp?.data?.[0];
  if (!contract) throw new Error('Contract not found');

  const contactId = contract[LOOKUP()]?.id;
  const contactName = contract[LOOKUP()]?.name || '';
  const contractNumber = contract[EXT_CONTRACT()] || contractId;

  const expiryDate = new Date(contract.Expiry_Date);
  const dueDate = new Date(expiryDate.getTime() - 30 * 86400000);
  const dueDateStr = dueDate.toISOString().slice(0, 10);
  const responsibleBroker = contract.Broker || '';

  const subject = `Renewal call — ${contactName} (${contractNumber})`;


  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const daysLeft = contract.Expiry_Date
    ? Math.ceil((new Date(contract.Expiry_Date) - today) / 86400000)
    : null;

  let talkingPoint = null;
  try {
    talkingPoint = await generateTalkingPoint({
      contactName,
      product: contract.Product,
      insurer: contract.Insurer,
      expiryDate: contract.Expiry_Date,
      daysLeft,
      annualPremium: contract.Annual_Premium,
      broker: responsibleBroker,
    });
  } catch (err) {
    console.error(`[contracts] talking point generation failed for ${contractId}:`, err.message);
  }

  const taskPayload = {
    Subject: subject,
    Due_Date: dueDateStr,
    Status: 'Not Started',
    Priority: 'High',
    $se_module: MODULE(),
    What_Id: { id: contractId },
    Responsible_Broker: responsibleBroker,
  };
  if (contactId) taskPayload.Who_Id = { id: contactId };
  if (talkingPoint) taskPayload[TALKINGPOINT_FLD()] = talkingPoint;

  const taskResult = await zohoRequest('post', '/crm/v6/Tasks', {
    data: { data: [taskPayload] },
  });
  const taskCreated = taskResult?.data?.[0];
  if (taskCreated?.code !== 'SUCCESS') {
    throw new Error(`Task creation failed: ${JSON.stringify(taskCreated)}`);
  }

  await zohoRequest('put', `/crm/v6/${MODULE()}/${contractId}`, {
    data: { data: [{ id: contractId, [FOLLOWUP_FLD()]: true }] },
  });

  return {
    taskId: taskCreated.details.id,
    subject,
    dueDate: dueDateStr,
    talkingPoint,
  };
}

async function bulkFollowup() {
  const contracts = await getAllContracts();
  const eligible = contracts.filter(c =>
    !c.hasFollowup && c.daysLeft !== null && c.daysLeft >= 0 && c.daysLeft <= 30
  );

  const results = { created: 0, skipped: contracts.length - eligible.length, failed: [] };

  for (const contract of eligible) {
    try {
      await createFollowup(contract.id);
      results.created++;
    } catch (err) {
      results.failed.push({ id: contract.id, contractNumber: contract.contractNumber, error: err.message });
    }
  }

  return results;
}

const EDITABLE_FIELDS = ['Product', 'Insurer', 'Start_Date', 'Expiry_Date', 'Annual_Premium', 'Payment_Method', 'Contract_Status', 'Broker'];

async function updateContract(contractId, fields) {
  const payload = { id: contractId };
  for (const key of EDITABLE_FIELDS) {
    if (fields[key] !== undefined) payload[key] = fields[key];
  }
  if (Object.keys(payload).length === 1) {
    throw new Error('No editable fields provided');
  }

  const result = await zohoRequest('put', `/crm/v6/${MODULE()}/${contractId}`, {
    data: { data: [payload] },
  });
  const updated = result?.data?.[0];
  if (updated?.code !== 'SUCCESS') {
    throw new Error(`Contract update failed: ${JSON.stringify(updated)}`);
  }
  return { id: contractId };
}

module.exports = { getAllContracts, createFollowup, bulkFollowup, updateContract };
