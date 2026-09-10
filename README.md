# NOC Ticket Management & Customer Network System

A web-based NOC management system that replaces the Excel/manual workflow: customer master data is
stored once, NOC users select a customer and raise a ticket, and the system generates the
standardized ticket format automatically. Internal network details stay off the generated ticket but
remain fully searchable. Invoices are raised from a Ticket ID.

**Stack** — React + Vite + React Router + Axios · Node.js + Express · MongoDB + Mongoose · JWT +
bcrypt · PDFKit (server-side PDF) · xlsx (Excel import) · plain responsive CSS (no Tailwind).

---

## 1. Quick start

```bash
npm install     # installs server + client (npm workspaces)
npm run seed    # creates demo users, customers, tickets, invoice, network inventory
npm run dev     # starts API (:5000) and web app (:5173) together
```

Then open **http://localhost:5173**.

> **No MongoDB installed? Nothing to do.** If `MONGODB_URI` is not set the API starts an **embedded
> MongoDB** automatically and persists it to `server/.data/mongo`. The first start downloads a
> `mongod` binary (~100 MB, one time). To use your own MongoDB or Atlas instead, set `MONGODB_URI`
> in `server/.env`.

### Demo accounts

| Role | Email | Password |
|---|---|---|
| Admin | `admin@noc.local` | `Admin@123` |
| NOC Operator | `noc@noc.local` | `Noc@12345` |
| Field Engineer | `field@noc.local` | `Field@12345` |
| Accounts | `accounts@noc.local` | `Accounts@123` |

Seed data includes customer **10255 (Abdul Rouf)** with full network fields and ticket **TID 4626**
(Fiber Cut), matching the specification examples.

### All commands

| Command | What it does |
|---|---|
| `npm install` | Install both workspaces |
| `npm run dev` | API + web app together (development) |
| `npm run dev:server` / `npm run dev:client` | Run just one side |
| `npm run seed` | Seed demo data (safe to re-run — it never duplicates) |
| `npm run seed:reset` | **Wipes every collection** and re-seeds |
| `npm test` | Ticket-format, ETTR and invoice-maths test suite |
| `npm run build` | Production build of the web app into `client/dist` |
| `npm start` | Run the API alone (production) |

---

## 2. Environment variables

Copy `server/.env.example` to `server/.env` and edit. **Every value has a working default**, so the
app also boots with no `.env` at all.

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `5000` | API port |
| `NODE_ENV` | `development` | Set to `production` in production |
| `MONGODB_URI` | *(empty)* | Your MongoDB/Atlas connection string. Empty ⇒ embedded MongoDB |
| `USE_EMBEDDED_MONGO` | `true` | `false` fails fast instead of starting the embedded instance |
| `EMBEDDED_MONGO_PORT` | `27018` | Port for the embedded instance |
| `JWT_SECRET` | dev-only string | **Must be changed in production** (the server refuses to boot otherwise) |
| `JWT_EXPIRES_IN` | `12h` | Session lifetime |
| `BCRYPT_ROUNDS` | `10` | Password hashing cost |
| `APP_TIMEZONE` | `Asia/Karachi` | Timezone for every ticket/invoice date the server renders |
| `TICKET_NUMBER_START` | `4626` | First TID issued by the server-side sequence |
| `COMPANY_NAME` / `COMPANY_ADDRESS` / `COMPANY_PHONE` / `COMPANY_EMAIL` | NOC placeholders | Printed on invoice PDFs |
| `INVOICE_CURRENCY` | `PKR` | Invoice currency label |
| `INVOICE_DUE_DAYS` | `15` | Default gap between issue and due date |
| `INVOICE_TAX_PERCENT` | `0` | Default tax percentage |
| `CORS_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173` | Allowed browser origins (comma separated) |
| `ANTHROPIC_API_KEY` | *(empty)* | **Server-side only.** Enables the AI assistant. Never sent to the browser |
| `AI_MODEL` | `claude-opus-5` | Model used for ticket analysis |
| `AI_ENABLED` | `true` | `false` disables AI entirely |
| `AI_TIMEOUT_MS` | `30000` | AI request timeout |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | `admin@noc.local` / `Admin@123` | Seeded admin account |

---

## 3. The generated ticket

Produced entirely server-side and stored on the ticket:

```
*TID: 4626* | 09-Sep 06:38 PM
ETTR: 09-Sep 07:38 PM {1H 0M}
Time Left: *{0:Days 0:Hours 57:Mins }*
------------------------------
Site | Customer ID: 10255
Name: Abdul Rouf
Location: https://maps.app.goo.gl/EXwFUHbbik4spH5s8
Contact #: 0333-4458420
Connected From: Gajjumata Pop
------------------------------
Type: *Fiber Cut*
Remarks: shahid town fiber down
------------------------------
Assigned By: Mirza Arslan Shabbir
Required: Urgent (Do First)
Status: In Progress
*Sharafat Ali:* Resolve this ticket as soon as possible, it's Urgent
```

### The visibility rule

`server/src/utils/ticketFormatter.js` narrows the customer document to a whitelist
(`TICKET_VISIBLE_CUSTOMER_FIELDS`) before rendering, so **address, PUM/PMB/COR type, source port,
destination port and VLAN cannot reach a generated ticket even by accident**. Those fields remain
fully visible and searchable on the customer detail page, in global search, and in the internal
ticket view.

`GET /api/tickets/:id/verify-visibility` proves it for any ticket, and `npm test` asserts it.

### Time handling

- **TID** — atomic `$inc` on a counter document, so concurrent creation can never issue a duplicate.
- **ETTR** — always `createdAt + ettrMinutes`, computed from server time.
- **Time Left** — recomputed on every request from stored timestamps. The browser countdown ticks
  against a measured server-clock offset, so a wrong local clock cannot hide an overdue ticket.
- A **Resolved/Closed** ticket freezes its countdown at the resolution time.

---

## 4. Roles

| Role | Can do |
|---|---|
| **Admin** | Everything, plus user management, master data, deletes (soft) and audit log |
| **NOC Operator** | Create/search customers and tickets, assign, resolve, view network inventory and invoices |
| **Field Engineer** | Sees **only their own assigned tickets**; can update status and remarks |
| **Accounts** | Create and manage invoices, view customers and tickets |

Every protected route verifies both authentication and role. Deletes are soft and audited.

---

## 5. API

```
POST   /api/auth/login              POST   /api/auth/logout
GET    /api/auth/me                 POST   /api/auth/change-password

GET    /api/customers               POST   /api/customers
GET    /api/customers/:id           PUT    /api/customers/:id
DELETE /api/customers/:id           POST   /api/customers/:id/restore
GET    /api/customers/meta          GET    /api/customers/import/template
POST   /api/customers/import/upload POST   /api/customers/import/preview
POST   /api/customers/import

GET    /api/tickets                 POST   /api/tickets
GET    /api/tickets/:id             PUT    /api/tickets/:id
POST   /api/tickets/:id/assign      POST   /api/tickets/:id/resolve
POST   /api/tickets/:id/analyze     GET    /api/tickets/:id/verify-visibility
DELETE /api/tickets/:id

GET    /api/invoices                POST   /api/invoices
GET    /api/invoices/:id            PUT    /api/invoices/:id
GET    /api/invoices/:id/pdf        PATCH  /api/invoices/:id/status
GET    /api/invoices/lookup/:tid    POST   /api/invoices/preview
DELETE /api/invoices/:id

GET    /api/search?q=...            GET    /api/dashboard
GET    /api/field-teams             POST   /api/field-teams
GET    /api/field-teams/:id         PUT    /api/field-teams/:id
DELETE /api/field-teams/:id

GET/POST/PUT/DELETE /api/network/{pops,devices,connections,vlans}
GET    /api/users                   POST   /api/users
PUT    /api/users/:id               DELETE /api/users/:id
GET    /api/meta                    GET    /api/meta/audit-logs
POST   /api/meta/issue-types        PUT    /api/meta/issue-types/:id
GET    /api/ai/status               POST   /api/ai/analyze-ticket
GET    /api/health
```

Tickets and customers accept either the Mongo id **or** the business key (TID / customer reference),
so `GET /api/tickets/4626` and `GET /api/customers/10255` both work.

---

## 6. Global search

One box searches customer reference, name, address, contact, VLAN, source/destination port,
POP, TID, issue type, remarks and invoice number. Results are grouped into Customers, Tickets,
Invoices and Network inventory.

Verified examples: `10255` · `Abdul Rouf` · `613` · `4626` · `Gajjumata` · `GE0/0/1`.

---

## 7. Excel import

`Customers → Import Excel`. Upload `.xlsx` / `.xls` / `.csv` → columns are auto-mapped (editable) →
every row is validated and classified (**New / Exists / Duplicate in file / Invalid**) → import →
result report per row.

**Existing customers are never overwritten silently** — matching rows are skipped unless you
explicitly choose *Update*. A ready-to-fill template is downloadable from the same page.

---

## 8. AI assistant (optional)

On ticket creation the backend asks Claude for a suggested category, priority, one-line summary,
troubleshooting steps and a customer-facing response.

- The API key lives **only** on the server (`ANTHROPIC_API_KEY`) and is never exposed to React.
- AI **never blocks ticket creation** — the ticket is saved and returned first, analysis runs after.
- If AI is unavailable the ticket still exists and its AI status becomes `unavailable`/`failed`,
  with a **Retry analysis** button on the ticket page.

Without a key the whole system works normally; the AI panel simply reports that it is not configured.

---

## 9. Project structure

```
├── server/
│   ├── src/
│   │   ├── config/        env + database (incl. embedded-MongoDB fallback)
│   │   ├── models/        users, customers, tickets, field_teams, invoices,
│   │   │                  pops, network_devices, connections, vlans, audit_logs, counters
│   │   ├── middleware/    auth, roles, validation, rate limiting, uploads, error handling
│   │   ├── routes/        auth, customers, tickets, invoices, search, dashboard,
│   │   │                  field-teams, network, users, ai, meta
│   │   ├── services/      ticket generation, invoices, PDF, Excel import, search, AI
│   │   ├── utils/         ticket formatter, date/ETTR maths, TID sequence, audit
│   │   ├── validators/    Zod request schemas
│   │   └── seed/          demo data
│   └── tests/             ticket-format / ETTR / invoice-maths tests
└── client/
    └── src/
        ├── api/           axios client, error formatting
        ├── context/       auth (+ server clock offset), toasts
        ├── components/    layout, global search, countdown, ticket preview, UI kit
        ├── pages/         dashboard, customers, tickets, invoices, search,
        │                  field team, network, import, users, settings
        └── styles/        design system
```

---

## 10. Security

Passwords hashed with bcrypt · JWT auth with role middleware on every protected route · Zod
validation and sanitisation on every request body · `helmet` security headers · restricted CORS
origins · rate limiting on login (10 attempts / 15 min) and on the API generally · centralized error
handling that never leaks stack traces in production · audit log for creates, updates, assignments,
resolutions, deletes, imports and sign-ins · soft delete for customers, tickets and invoices ·
secrets only in environment variables.

**Before production:** set a strong `JWT_SECRET` (the server refuses to start in production with the
default), set `NODE_ENV=production`, point `MONGODB_URI` at a real MongoDB, and set `CORS_ORIGINS`
to your real web origin.

---

## 11. Going live (deployment)

In production the Express server also serves the compiled React app, so the whole system runs as
**one service on one URL** — no CORS, no separate frontend host, and it fits a free tier.

```bash
npm install
npm run build                 # compiles the React app into client/dist
NODE_ENV=production npm start # Express serves the API and the web app together
```

### Required production environment variables

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `JWT_SECRET` | A long random string — **the server refuses to boot without it** |
| `MONGODB_URI` | Your MongoDB Atlas connection string |
| `USE_EMBEDDED_MONGO` | `false` (never use the embedded database in production) |
| `ANTHROPIC_API_KEY` | Optional — enables the AI assistant |

`CORS_ORIGINS` is not needed when the app is served from the same origin.

### MongoDB Atlas

1. Create a **free M0** cluster at [cloud.mongodb.com](https://cloud.mongodb.com).
2. **Database Access** → add a user with *Read and write to any database*. Avoid `@ : / ?` in the
   password, or URL-encode it.
3. **Network Access** → allow your host's IP, or `0.0.0.0/0` for platforms with dynamic IPs.
4. **Connect → Drivers → Node.js** → copy the string and append the database name:
   ```
   mongodb+srv://user:password@cluster0.xxxxx.mongodb.net/noc_system?retryWrites=true&w=majority
   ```
5. Seed it once: `MONGODB_URI="<uri>" npm run seed`

> **Free M0 clusters pause after ~60 days of inactivity.** Press *Resume* in Atlas to wake one.

### Moving existing data to Atlas

```bash
npm run migrate -- --to "mongodb+srv://user:pass@cluster0.xxxxx.mongodb.net/noc_system"
npm run migrate -- --to "<uri>" --dry-run   # preview first
npm run migrate -- --to "<uri>" --drop      # replace the target contents
```

Document `_id`s are preserved, so every relationship between customers, tickets and invoices stays
intact. Indexes are recreated on the target.

### Hosting

- **Render** — `render.yaml` is included. Import the repo as a Blueprint, then set `MONGODB_URI`
  (and optionally `ANTHROPIC_API_KEY`) in the dashboard. `JWT_SECRET` is generated automatically.
- **Railway / Fly.io / Cloud Run / any container host** — a multi-stage `Dockerfile` is included.
- **A VPS** — `npm install && npm run build`, then run `npm start` behind nginx with a process
  manager such as `pm2` or a systemd unit.

Health check endpoint for all of them: `GET /api/health`.

### After the first deploy

1. Sign in as the seeded admin and **change the password immediately**.
2. Create real users under *Users & roles* and deactivate the demo accounts.
3. Set `TICKET_NUMBER_START` before the first real ticket if you need TIDs to continue from an
   existing series.

---

## 12. Verification

`npm test` covers the exact ticket format, the internal-data visibility rule, the 30-character
separator, overdue and frozen countdowns, ETTR/time-left maths, timezone rendering, and invoice
discount/tax maths.

The API was additionally exercised end-to-end against the specification's acceptance test
(customer 10255 → Fiber Cut ticket → format and visibility checks → TID uniqueness → assignment and
status → global search → invoice by Ticket ID → PDF → Excel import with duplicate handling → role
permissions): **52/52 checks passing**.
