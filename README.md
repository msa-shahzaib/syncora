# Syncora — Contract Management Console

> A personal side project. A clean, browser-based tool for importing contacts and contracts into **Zoho CRM** and managing renewal follow-ups from a live contract console.

[![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Express](https://img.shields.io/badge/Express-5.x-000000?logo=express&logoColor=white)](https://expressjs.com)
[![Zoho CRM](https://img.shields.io/badge/Zoho%20CRM-API%20v6-E42527?logo=zoho&logoColor=white)](https://www.zoho.com/crm/)

**Live demo →** [syncora-production-d7e1.up.railway.app](https://syncora-production-d7e1.up.railway.app)

---

## What It Does

Syncora is a two-tab single-page application:

| Tab | What it does |
|-----|-------------|
| **Import Data** | Upload one or more CSV files (contacts and/or contracts), get a live preview with issue detection, duplicate flagging, and conflict resolution, then confirm to upsert everything into Zoho CRM. |
| **Contract Console** | Browse all contracts synced to Zoho, filter by broker or expiry window, edit contract details inline, create renewal follow-up tasks per contract or in bulk, and AI-generated talking points for each renewal call. |

---

## Features

- **Smart CSV Import** — validates, normalises dates and amounts, detects duplicates before touching Zoho
- **Conflict Resolution UI** — surfaces potential duplicates and email conflicts; lets you decide row-by-row before committing
- **Idempotent Upserts** — re-running the import updates existing records instead of creating duplicates
- **Live Contract Console** — paginated, filterable table with urgency colour-coding by days to expiry
- **Inline Editing** — edit contract fields directly from the console; changes sync to Zoho instantly
- **Renewal Follow-ups** — create a Zoho Task linked to both the contract and its customer in one click
- **Bulk Follow-up** — batch-create follow-up tasks for all contracts expiring within 30 days
- **AI Talking Points** — Gemini LLM generates focused talking points per contract, written into the Task record
- **Dark UI** — glassmorphism design, neon accents, fully responsive

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js 18+, Express 5 |
| Frontend | Vanilla HTML / CSS / JavaScript |
| CRM | Zoho CRM API v6 (OAuth 2.0, server-side token refresh) |
| AI | Google Gemini API |
| Deployment | Railway |

---

## Getting Started

### Prerequisites

- Node.js 18+
- A Zoho CRM account (free trial works)
- A Zoho server-based OAuth client with scopes `ZohoCRM.modules.ALL` and `ZohoCRM.org.ALL`
- A Google Gemini API key (for talking-point generation)

### Installation

```bash
# 1. Clone the repo
git clone https://github.com/msa-shahzaib/syncora.git
cd syncora

# 2. Install dependencies
npm install

```

### Environment Variables

Create a `.env` file at the project root:

```env
# Zoho OAuth
ZOHO_CLIENT_ID=
ZOHO_CLIENT_SECRET=
ZOHO_REFRESH_TOKEN=
ZOHO_API_BASE=https://www.zohoapis.com       # change region suffix if needed (.eu, .in, etc.)
ZOHO_ACCOUNTS_URL=https://accounts.zoho.com  # must match the same region as above

# Zoho API names for your custom fields/modules
ZOHO_CONTRACTS_MODULE=
ZOHO_CONTRACT_LOOKUP_FIELD=
ZOHO_CONTACT_EXTERNAL_FIELD=
ZOHO_CONTRACT_EXTERNAL_FIELD=
ZOHO_FOLLOWUP_FIELD=
ZOHO_TASK_TALKING_POINT_FIELD=

# Google Gemini
GEMINI_API_KEY=
GEMINI_MODEL=

# Server
PORT=3000
```

> **Note on regions:** Zoho API clusters are region-specific. `ZOHO_API_BASE` and `ZOHO_ACCOUNTS_URL` must both point to the region your account was created in. A mismatch is the most common cause of first-run auth failures.

### Running Locally

```bash
npm run dev    # development — nodemon with auto-reload
npm start      # production
```

Open [http://localhost:3000](http://localhost:3000).

---

## Zoho CRM Setup

The app expects the following custom fields and modules in your Zoho CRM org:

### Contacts module (standard, two custom fields added)

| API Name | Type | Purpose |
|----------|------|---------|
| `Customer_number` | Single Line | External key (Kundennummer) for upserts |
| `Broker` | Single Line | Responsible broker/agent |

### Contracts module (custom module)

| API Name | Type | Notes |
|----------|------|-------|
| `Contract_Number` | Single Line | External key (Vertragsnummer) |
| `Contact` | Lookup → Contacts | Links contract to customer |
| `Product` | Single Line | Insurance product name |
| `Insurer` | Single Line | Insurance company |
| `Start_Date` | Date | Contract start |
| `Expiry_Date` | Date | Contract expiry |
| `Annual_Premium` | Currency | Annual premium amount |
| `Payment_Method` | Picklist | Payment frequency |
| `Contract_Status` | Picklist | Aktiv / Gekündigt / In Bearbeitung |
| `Broker` | Single Line | Responsible broker/agent |
| `Renewal_Followup_Created` | Checkbox | Flagged when a follow-up Task exists |

### Tasks module (standard, two custom fields added)

| API Name | Type | Purpose |
|----------|------|---------|
| `Responsible_Broker` | Single Line | Broker name for the task |
| `Talking_Point` | Multi Line | AI-generated renewal talking points |

---

## Project Structure

```
├── public/
│   └── index.html                  # Single-page frontend
├── src/
│   ├── server.js                   # Express entry point
│   ├── zoho/
│   │   ├── auth.js                 # OAuth 2.0 token refresh
│   │   └── client.js               # Axios wrapper that injects Bearer token on every request
│   ├── routes/
│   │   ├── import.js               # import contacts and contracts into zoho
│   │   └── contracts.js            # get contracts, create follow-up tasks, update contracts, bulk follow-ups
│   └── services/
│       ├── csvParser.js            # Parses, normalises, and validates CSV files
│       ├── importSessions.js       # Holds preview state between preview and confirm
│       ├── duplicateDetector.js    # Near-duplicate detection logic
│       ├── zohoImport.js           # Upserts contacts then contracts into Zoho
│       ├── zohoContracts.js        # Fetches contracts; creates follow-up Tasks
│       └── llmTalkingPoint.js      # Calls Gemini API to generate talking points
├── .env                            # Environment variables
├── .gitignore
└── package.json
```

---
