# Brandovise CRM Tool

A browser-driven web application that imports customer and contract data from CSV files into **Zoho CRM** and provides a live contract management console for insurance and finance brokers.

Built with **Node.js / Express** (backend) and plain **HTML / CSS / JavaScript** (frontend). No frontend framework used as the requirement explicitly mentioned that the frontend won't be assessed, thus keeping the stack simple and the codebase easy to walk through.

---

## Live URL

> https://zoho-contract-console-production.up.railway.app

---

## How to Run Locally

### Prerequisites

- Node.js 18+
- A Zoho CRM account (Zoho One trial is sufficient)
- A registered Zoho server-based OAuth client with the scope `ZohoCRM.modules.ALL` and `ZohoCRM.org.ALL`

### Setup

1. Clone the repository and move into the project folder
    ```bash
    git clone https://github.com/msa-shahzaib/zoho-contract-console.git
    cd zoho-contract-console
    ``` 

2. Install dependencies
    ```bash
    npm i
    ```

3. Create your `.env` file and fill in values

### Environment variables (`.env`)

```env
# Zoho OAuth Credentials
ZOHO_CLIENT_ID=...
ZOHO_CLIENT_SECRET=...
ZOHO_REFRESH_TOKEN=...
ZOHO_API_BASE=https://www.zohoapis.com
ZOHO_ACCOUNTS_URL=https://accounts.zoho.com

# Zoho Module / Field API names
ZOHO_CONTRACTS_MODULE=...
ZOHO_CONTRACT_LOOKUP_FIELD=...
ZOHO_CONTACT_EXTERNAL_FIELD=...
ZOHO_CONTRACT_EXTERNAL_FIELD=...
ZOHO_FOLLOWUP_FIELD=...
ZOHO_TASK_TALKING_POINT_FIELD=...

# Google Gemini
GEMINI_API_KEY=...
GEMINI_MODEL=...

# Server
PORT=...
```

> All field names above must match the **API names** shown in Zoho CRM → Settings → Modules and Fields, not the display labels.

### Run

```bash
npm run dev      # development (nodemon, auto-reload)
npm start        # production
```

Open `http://localhost:3000`.

---

## Zoho Authentication

Zoho uses **OAuth 2.0** with a server-based (non-PKCE) flow. The credentials live entirely on the server as best practice, thus the browser never sees them.

**How it works at runtime:**

1. On startup, `src/zoho/auth.js` holds the refresh token in memory (loaded from `.env`).
2. Before every API call, `getAccessToken()` checks whether the cached access token is still valid (with a 5-minute buffer).
3. If it has expired, it exchanges the refresh token for a new access token via `POST /oauth/v2/token` on Zoho's accounts server.
4. The new token is cached in-process until it expires.

This means the application never requires the user to go through a browser login flow after the initial one-time setup.

**Where the secrets live:**

| Secret | Location |
|---|---|
| Client ID | `.env` (server-side only) |
| Client secret | `.env` (server-side only) |
| Refresh token | `.env` (server-side only) |
| Access token | In-process memory only — never written to disk, never sent to the browser |

`.env` is listed in `.gitignore` and is never committed to the repository.

**Data centre note:** Zoho runs separate API clusters per region (`.com`, `.eu`, `.in`). The `ZOHO_API_BASE` and `ZOHO_ACCOUNTS_URL` variables must both point to the same cluster the account was created in. A mismatch is the single most common cause of first-time connection failures.

---

## Data Model Design For the Use Case

### Contacts module (standard)

The standard **Contacts** module was chosen for customers. Reasons:

- Zoho's built-in contact management features (deduplication, activity timeline, tasks) apply immediately.
- The Tasks module's `Who_Id` field natively links a task to a Contact, that's why this field is used to link the task with the relevant contact.
- The standard module already has almost all the fields needed (salutation, first name, last name, date of birth, phone, email, address).

Two custom fields were added:
- `Customer_number` (Single Line): Stores the original `Kundennummer`, used as the primary key for upsert/idempotent imports.
- `Broker` (Single Line): Stores the responsible `Makler`.

### Contracts module (custom)

A custom module named **Contracts** was created because the data is domain-specific and has no equivalent in Zoho's standard modules.

Fields created:

| API Name | Type | Notes |
|---|---|---|
| `Contract_Number` | Single Line | External key (Vertragsnummer) |
| `Contact` | Lookup → Contacts | Links contract to its customer |
| `Product` | Single Line | Insurance product name |
| `Insurer` | Single Line | Insurance company |
| `Start_Date` | Date | Contract start |
| `Expiry_Date` | Date | Contract expiry |
| `Annual_Premium` | Currency | Jahresbeitrag |
| `Payment_Method` | Picklist | Zahlweise: jährlich, halbjährlich, vierteljährlich, monatlich |
| `Contract_Status` | Picklist | Status: Aktiv, Gekündigt, In Bearbeitung |
| `Broker` | Single Line | Responsible Makler |
| `Renewal_Followup_Created` | Checkbox | Set to true when a follow-up Task exists |

### Tasks module (standard)

The following fields are utilized on the standard Task module:

- `Subject` (Single Line): Stores the subject of the task.
- `Due_Date` (Date): Stores the due date of the task.
- `Status` (Picklist): Stores the status of the task.
- `Priority` (Picklist): Stores the priority of the task.
- `Who_Id` (Lookup → Contacts): Links task to its customer.
- `$se_module` (Module): Stores the Contract module name.
- `What_Id` (Lookup → Contracts): Links task to its contract.

Two new custom fields were created on the standard Task module:
- `Responsible_Broker` (Single Line): Stores the responsible `Makler`. (Note: The purpose of creating this field and not using the Task's `Assigned To` standard field is because that requires a lookup to a Zoho user and we don't have emails of the brokers which we can use to create users in Zoho. Alternatively we can have a default user in Zoho CRM and assign all tasks to that user.)
- `Talking_Point` (Multi Line): Stores the talking points generated by the LLM for the renewal call.

---

## How Contracts Are Linked to Customers

Every contract record in Zoho contains a **Lookup field** (`Contact`) that points to a record in the Contacts module. This is a native Zoho relational link.

How it works in the import:

1. Contacts are upserted first. The Zoho record ID returned for each contact is stored in a `kundennummer → zohoId` map.
2. When each contract is written, the `Contact` lookup field is set to `{ id: zohoId }`, creating the real relationship.
3. After import, opening a customer in Zoho → Related tab shows all their contracts. Opening a contract shows the linked customer.

The renewal Task is also linked in two directions:
- `Who_Id` → the Contact (customer)
- `$se_module` and `What_Id` → the Contract module and the specific record respectively.

---

## Data Issues Found and Decisions Made

### `kontakte_export.csv` (Contacts)

| # | Issue | Decision |
|---|---|---|
| 1 | **Missing email addresses** — several contacts have no email. | Imported without email. Zoho allows contact records creation with no email. Flagged as a warning in the preview. |
| 2 | **Near-duplicate contact** — two rows share the same email address (Doris Frank appears twice with slightly different names). | The pair is surfaced as a "Potential Duplicate" in the preview for a human to review and take action before confirming. |
| 3 | **Date format** — `Geburtsdatum` values are in `DD.MM.YYYY` format, not ISO. | Normalised to `YYYY-MM-DD` before sending to Zoho. Rows with an unrecognisable date are imported with the field left blank and flagged with a warning. |

### `vertraege_export.csv` (Contracts)

| # | Issue | Decision |
|---|---|---|
| 4 | **Duplicate rows** — two rows (first & last) share the same `Vertragsnummer`. | First occurrence is imported; subsequent duplicates are skipped with a warning shown in the preview. |
| 5 | **Orphan contract (K-1099)** — references a `Kundennummer` that does not exist in the contacts file. | Skipped entirely and flagged as an error. A contract without a linked customer should not be created in a CRM, as it would be an orphan record with no meaning. |
| 6 | **Past expiry dates still marked "Aktiv"** — some contracts have an `Ablaufdatum` in the past but `Status = Aktiv`. | Imported as-is (the data reflects what the broker provided). Flagged as a warning in preview. The console marks these as "Expired" in the Days Left column, so a human can update the status in Zoho if needed. |
| 7 | **Cancelled contracts (`Gekündigt`)** — some contracts are already terminated. | Imported. Surfaced in the console in grey. Excluded from the bulk renewal follow-up action (no point creating a follow-up for a cancelled contract). |
| 8 | **German decimal format** — `Jahresbeitrag` values use comma as the decimal separator (e.g. `1.284,00`). | Normalised: replace `,` with `.`, parse as float before sending to Zoho. |
| 9 | **Date format** — `Beginn` and `Ablaufdatum` are in `DD.MM.YYYY` format. | Same normalisation as contacts: converted to `YYYY-MM-DD`. |

---

## Duplicates Handling While Importing Data More than Once (Idempotency)

Running the import a second time does **not** create duplicate records. The mechanism:

Before creating any record, the importer calls `GET /crm/v6/{Module}/search` with a `criteria` filter on the external key field (`Customer_number` for contacts, `Contract_Number` for contracts).

- If a matching record is found → the existing record is **updated** (PUT).
- If no match is found → a new record is **created** (POST).

This search-before-write approach means the import is safe to re-run after correcting a CSV, after a partial failure, or to pull in new records added to the file. No manual cleanup is needed between runs.

---

## Optional Extras Implemented

**Bulk action — create renewal follow-ups for all contracts expiring within 30 days in one click.**

The "⚡ Bulk Renewal Follow Up" button in the console filters all contracts (regardless of current broker/expiry filters) to those where `daysLeft` is between 0 and 30 and no follow-up exists yet. It calls `POST /api/contracts/bulk-followup`, which iterates through eligible contracts sequentially, creates a Zoho Task for each, and marks the `Renewal_Followup_Created` checkbox on the Contract record. The UI updates in-place, no page reload.

**Talking Points — automatically generates relevant talking points for single/bulk renewal followups.**

The "+ Follow Up" button on the single contract view and the "⚡ Bulk Renewal Follow Up" button on the console call a common API endpoint `POST /api/contracts/bulk-followup`. This endpoint generates talking points by making an internal request to the Google Gemini LLM API and populates the `Talking_Point` field on the Task record, related to each contract. These talking points can assist the broker to quickly get the key points for the conversation with the customer about the renewal of their contract.

**Editing Contracts from the Console — The ability to edit existing contracts from the console without having to navigate to Zoho.**

Another feasibility for the broker is that they can edit existing contract details from the console using the Edit button against each contract and those changes are reflected in real time. The changes are updated to Zoho by calling the `PUT /api/contracts/:id` endpoint to update the contract record in Zoho.

---

## What I Would Do Differently With More Time

1. **Auth on the web app itself.** Currently anyone who reaches the URL can trigger imports or create Tasks. A simple login gate / auth page would be the minimum for a real production deployment.

2. **Pagination on Zoho API calls.** Currently contacts and contracts are fetched with `per_page=200`, which covers this data set. For a real broker with thousands of records, cursor-based pagination would be required.

3. **Background import with a job queue.** For large files the import is synchronous and can time out. A production version would offload to a job queue (Bull + Redis), return a job ID immediately, and let the frontend poll for progress.

---

## Project Structure

```
src/
  server.js              # Express entry point
  zoho/
    auth.js              # OAuth token refresh (server-side only)
    client.js            # Axios wrapper (injects Bearer token on every call)
  routes/
    import.js            # POST /api/import/preview, POST /api/import/confirm
    contracts.js         # GET /api/contracts
                         # POST /api/contracts/:id/followup
                         # POST /api/contracts/bulk-followup
  services/
    csvParser.js         # Parses, normalises, and validates both CSV files
    duplicateDetector.js # Near-duplicate detection logic
    zohoImport.js        # Upserts contacts then contracts into Zoho
    zohoContracts.js     # Fetches contracts for console; creates follow-up Tasks
public/
  index.html             # Single-page frontend (Import Data tab + Contract Console tab)
.env                     # Environment variables
.gitignore               # Git ignore file
package.json             # Node.js project configuration
```

---
