'use strict';

const CONTACT_ID_FIELD = 'Kundennummer';
const CONTACT_COMPARE_FIELDS = ['Anrede', 'Vorname', 'Nachname', 'Email', 'Telefon', 'Strasse', 'PLZ', 'Ort', 'Geburtsdatum', 'Makler'];

const CONTRACT_ID_FIELD = 'Vertragsnummer';
const CONTRACT_COMPARE_FIELDS = ['Kundennummer', 'Produkt', 'Versicherer', 'Beginn', 'Ablaufdatum', 'Jahresbeitrag', 'Zahlweise', 'Status', 'Makler'];

const MIN_DIFF_FIELDS = 2;
const MAX_DIFF_FIELDS = 3;

function normaliseForCompare(v) {
    if (v === null || v === undefined) return '';
    return String(v).trim().toLowerCase();
}

function findPotentialDuplicates(records, idField, compareFields, module) {
    const groups = [];

    for (let i = 0; i < records.length; i++) {
        for (let j = i + 1; j < records.length; j++) {
            const a = records[i];
            const b = records[j];
            if (a[idField] === b[idField]) continue;

            const common = [];
            const different = [];

            for (const field of compareFields) {
                const va = normaliseForCompare(a[field]);
                const vb = normaliseForCompare(b[field]);
                if (va === '' && vb === '') continue;
                if (va === vb) {
                    common.push({ field, value: a[field] });
                } else {
                    different.push({ field, valueA: a[field], valueB: b[field] });
                }
            }

            if (different.length >= MIN_DIFF_FIELDS && different.length <= MAX_DIFF_FIELDS) {
                groups.push({
                    id: `${module}__${a[idField]}__${b[idField]}`,
                    module,
                    idField,
                    recordA: { id: a[idField], ...a },
                    recordB: { id: b[idField], ...b },
                    common,
                    different,
                });
            }
        }
    }

    return groups;
}

module.exports = {
    findPotentialDuplicates,
    CONTACT_ID_FIELD,
    CONTACT_COMPARE_FIELDS,
    CONTRACT_ID_FIELD,
    CONTRACT_COMPARE_FIELDS,
};