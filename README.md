# 🎱 The Golden Frame — Restaurant & Cafe Management System

A **production-ready, full-stack restaurant and cafe management platform** built for multi-branch venues. Real-time table tracking, automated billing, inventory control, staff management, and detailed analytics — all in one modern dashboard.

---

## ✨ Features at a Glance

| Module | Highlights |
|---|---|
| **Live Tables** | Real-time timer, pause/resume, extend, transfer customer, Socket.io updates |
| **Billing** | Auto-invoice from session, inventory add-ons, discounts, membership pricing, PDF export |
| **Dashboard** | Revenue/expense/profit cards, area charts, pie charts, branch comparison, table usage |
| **Customers** | Profiles, visit history, membership tiers (Silver/Gold/Platinum), reward points |
| **Inventory** | Stock tracking, low-stock alerts, restock history, category filters |
| **Expenses** | Category breakdown, pie chart, date-range filters, quick entry |
| **Reports** | Daily/weekly/monthly P&L, branch comparison, table performance, Excel export |
| **Staff** | Role-based access (Super Admin / Manager / Staff), branch assignment |
| **Attendance** | Daily attendance marking per employee |
| **Bookings** | Reservation system with status tracking |
| **Audit Logs** | Complete activity history for compliance |
| **Settings** | Business name, currency, tax %, receipt footer |

---

## 🏗️ Architecture

```
thegoldenframe/
├── backend/                  # Node.js + Express API
│   ├── config/               # DB, Cloudinary, constants/enums
│   ├── controllers/          # Business logic per domain
│   ├── middleware/           # Auth guards, error handler, validation
│   ├── models/               # Mongoose schemas (15 collections)
│   ├── routes/               # RESTful API routes
│   ├── services/             # PDF generator, QR codes, activity logger
│   ├── utils/                # AppError, asyncHandler, invoice numbering
│   └── server.js             # HTTP server + Socket.io + DB seeder
│
├── frontend/                 # React 18 + Vite + TypeScript SPA
│   └── src/
│       ├── components/
│       │   ├── ui/           # Button, Card, Badge, Modal, Table, Toast, …
│       │   └── layout/       # Sidebar, Navbar, AppLayout
│       ├── hooks/            # useSocket (real-time), custom hooks
│       ├── pages/            # One file per page/domain
│       ├── routes/           # React Router v6 with auth guards
│       ├── services/         # Typed Axios service layer (per domain)
│       ├── store/            # Zustand (auth, app state, branch selector)
│       ├── types/            # Shared TypeScript interfaces
│       └── utils/            # cn, formatCurrency, formatDate, …
│
├── docker-compose.yml        # MongoDB + Backend + Frontend (Nginx)
├── mongo-init.js             # DB bootstrap script
└── .env.example              # Environment variable template
```

---

## 🛠️ Tech Stack

### Backend
| Layer | Technology |
|---|---|
| Runtime | Node.js 20 + Express.js |
| Database | MongoDB 7 + Mongoose |
| Auth | JWT (access + refresh tokens, rotation, bcrypt) |
| Real-time | Socket.io |
| PDF | PDFKit |
| Excel | ExcelJS |
| QR Codes | qrcode |
| Images | Cloudinary + Multer |
| Email | Nodemailer |
| Security | Helmet, CORS, express-rate-limit, mongo-sanitize |

### Frontend
| Layer | Technology |
|---|---|
| Framework | React 18 + TypeScript |
| Build | Vite |
| Styling | Tailwind CSS + custom CSS variables (dark/light) |
| State | Zustand (persist) |
| Data Fetching | TanStack Query v5 |
| Forms | React Hook Form + Zod |
| Charts | Recharts |
| Animations | Framer Motion |
| HTTP | Axios with auto-refresh interceptor |
| Real-time | Socket.io-client |
| Routing | React Router v6 |

---

## 🚀 Quick Start

### Option 1: Docker (Recommended — one command)

```bash
# 1. Clone the repo
git clone https://github.com/your-org/thegoldenframe.git
cd thegoldenframe

# 2. Create environment file
cp .env.example .env
# ⚠️  Edit .env — set strong JWT secrets before proceeding

# 3. Launch everything
docker compose up -d

# App is now running at http://localhost
# API health: http://localhost/api/health
```

### Option 2: Local Development

#### Prerequisites
- Node.js ≥ 18
- MongoDB running locally (or MongoDB Atlas URI)

#### Backend
```bash
cd backend
npm install
cp .env.example .env
# Edit .env — set MONGO_URI and JWT secrets
npm run dev         # Starts on :5000 with nodemon
```

#### Frontend
```bash
cd frontend
npm install
npm run dev         # Starts on :5173 with HMR
```

> Vite's dev server proxies `/api` and `/socket.io` to `localhost:5000` automatically.

---

## 🔐 Default Login

| Field | Value |
|---|---|
| Email | `admin@thegoldenframe.app` |
| Password | `Admin@123456` |
| Role | Super Admin |

> **⚠️ Change the default password immediately after first login.**

The super admin account, default branches (Daman & DNH), and settings are auto-seeded on first start.

---

## 👥 User Roles & Permissions

### Super Admin
- Full access to all modules across all branches
- Can create/manage branches, staff, pricing, and settings
- Access to audit logs and backup

### Branch Manager
- Scoped to their assigned branches only
- Dashboard, Live Tables, Billing, Customers, Inventory, Expenses, Attendance, Reports, Bookings
- **Cannot**: delete branches, change global pricing, view other branches

### Staff
- Start / Stop / Pause / Resume table sessions
- Create bills and receive payments
- Add customers

---

## 📡 API Reference

All endpoints are prefixed with `/api`.

| Resource | Methods | Auth |
|---|---|---|
| `/auth/login` | POST | Public |
| `/auth/refresh` | POST | Cookie |
| `/auth/logout` | POST | JWT |
| `/auth/me` | GET | JWT |
| `/auth/change-password` | PATCH | JWT |
| `/branches` | GET, POST, PATCH, DELETE | JWT + Role |
| `/tables` | GET, POST, PATCH, DELETE | JWT + Permission |
| `/sessions/start` | POST | JWT |
| `/sessions/:id/pause` | PATCH | JWT |
| `/sessions/:id/resume` | PATCH | JWT |
| `/sessions/:id/stop` | PATCH | JWT |
| `/sessions/:id/extend` | PATCH | JWT |
| `/sessions/live` | GET | JWT |
| `/customers` | GET, POST, PATCH, DELETE | JWT |
| `/bills` | GET, POST | JWT |
| `/bills/:id/payment` | POST | JWT |
| `/bills/:id/pdf` | GET | JWT |
| `/inventory` | GET, POST, PATCH, DELETE | JWT |
| `/inventory/:id/restock` | POST | JWT |
| `/expenses` | GET, POST, PATCH, DELETE | JWT |
| `/bookings` | GET, POST, PATCH | JWT |
| `/attendance` | GET, POST, PATCH | JWT |
| `/reports/dashboard` | GET | JWT |
| `/reports/revenue` | GET | JWT |
| `/reports/table-usage` | GET | JWT |
| `/reports/branch-comparison` | GET | JWT |
| `/reports/export/excel` | GET | JWT |
| `/users` | GET, POST, PATCH, DELETE | Super Admin |
| `/settings` | GET, PATCH | JWT |
| `/logs` | GET | Super Admin |
| `/notifications` | GET | JWT |

---

## 🔌 Socket.io Events

| Event | Direction | Payload |
|---|---|---|
| `join:branch` | Client → Server | `branchId: string` |
| `leave:branch` | Client → Server | `branchId: string` |
| `table:updated` | Server → Client | Full `Table` document |

The frontend automatically joins the selected branch room and updates the table grid in real-time when any session action (start/pause/resume/stop/extend) fires.

---

## 📊 Database Schema

```
users           — Auth, role, branch assignments, hashed refresh tokens
branches        — Club locations (Daman, DNH, …)
tables          — Pool/Snooker/PS5 tables with QR codes
sessions        — Live timer records (start, pauses[], end, billable minutes)
bills           — Invoices (items, discounts, tax, payment status)
payments        — Payment receipts (method, amount, breakdown for mixed)
customers       — Profiles, membership, visit/spend history
bookings        — Reservations with status lifecycle
inventory       — Stock items with restock history and low-stock threshold
expenses        — Categorized outgoings with date and branch
attendance      — Daily employee check-in/status records
notifications   — System alerts (low stock, membership expiry, …)
activitylogs    — Immutable audit trail for all mutations
settings        — Singleton business config document
membershipplans — Silver/Gold/Platinum tier configuration
```

---

## 💡 Key Design Decisions

### Session Timer Model
Pause/resume is tracked as an array of `{ pausedAt, resumedAt }` objects on the session document. Billable minutes are calculated server-side on stop by subtracting all paused durations from total elapsed time. This means the timer survives server restarts — no in-memory state required.

### Two-Step Billing Flow
Stopping a table does **not** automatically create a bill. Instead it finalizes the session (calculates billable time) and redirects staff to the billing screen where they can add inventory items, apply discounts, and finalize payment before generating the invoice. This avoids surprise bills and allows upselling drinks/snacks.

### JWT Refresh Token Rotation
Each refresh issues a new refresh token and invalidates the old one. Only the last 5 refresh token hashes are stored per user, automatically expiring older sessions. Changing password wipes all refresh tokens.

### Branch Scoping
Role-based branch filtering is applied at both the middleware layer (via `scopeToBranch`) and again inside each controller as defense-in-depth. Super admins see all branches; managers/staff only see their assigned branches.

---

## 🗺️ Extending the System

### Adding a New Branch
```bash
# Via API (super admin token required)
POST /api/branches
{
  "name": "Mumbai",
  "code": "MUM",
  "address": "123 Marine Drive",
  "phone": "+91-9000000000",
  "openingTime": "10:00",
  "closingTime": "23:00"
}
```
Or use the **Branches** page in the dashboard UI.

### Adding a New Table Type
1. Add the new type string to `TABLE_TYPES` in `backend/config/constants.js`
2. Add a color/icon mapping in `frontend/src/utils/index.ts` (`TABLE_TYPE_COLORS`)
3. The rest of the system (CRUD, filters, charts) picks it up automatically

### Adding a New Role
1. Add to `ROLES` in `backend/config/constants.js`
2. Add the permission list to `PERMISSIONS`
3. Add the role to the sidebar `NAV_ITEMS` `roles` arrays in `Sidebar.tsx`

---

## 🚢 Production Deployment Checklist

- [ ] Set strong, unique `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` (≥64 chars)
- [ ] Change `SUPER_ADMIN_PASSWORD` in `.env`
- [ ] Set `MONGO_INITDB_ROOT_PASSWORD` to a secure value
- [ ] Configure `CLIENT_URL` to your actual domain
- [ ] Set up Cloudinary credentials for image uploads
- [ ] Configure SMTP for email notifications
- [ ] Enable MongoDB authentication and restrict network access
- [ ] Set up SSL/TLS (e.g., Certbot + Nginx or a load balancer)
- [ ] Configure automated MongoDB backups (e.g., mongodump cron)
- [ ] Set `NODE_ENV=production` (already set in Docker)
- [ ] Review and tighten CORS `origin` whitelist

---

## 📁 Complete File Tree

```
thegoldenframe/
├── .env.example
├── .gitignore
├── docker-compose.yml
├── mongo-init.js
│
├── backend/
│   ├── Dockerfile
│   ├── package.json
│   ├── server.js                    ← Entry point, Socket.io, seeder
│   ├── app.js                       ← Express app, all routes mounted
│   ├── .env.example
│   ├── config/
│   │   ├── constants.js             ← Roles, enums, permission map
│   │   ├── db.js                    ← Mongoose connect
│   │   └── cloudinary.js
│   ├── models/
│   │   ├── User.js                  ← Auth, JWT methods, password hash
│   │   ├── Branch.js
│   │   ├── Table.js
│   │   ├── Session.js               ← Timer engine, billable minutes calc
│   │   ├── Billing.js               ← Bill + Payment schemas
│   │   ├── Booking.js
│   │   ├── Operations.js            ← Inventory + Expense + MembershipPlan
│   │   └── System.js                ← Attendance + Notification + ActivityLog + Settings
│   ├── controllers/
│   │   ├── authController.js        ← Login, refresh, logout, changePassword
│   │   ├── userController.js
│   │   ├── branchController.js
│   │   ├── tableController.js
│   │   ├── sessionController.js     ← start/pause/resume/stop/extend/transfer
│   │   ├── customerController.js
│   │   ├── billingController.js     ← createBill, receivePayment, downloadPDF
│   │   ├── inventoryController.js
│   │   ├── expenseController.js
│   │   ├── bookingController.js
│   │   ├── attendanceController.js
│   │   └── reportsController.js     ← Dashboard stats, revenue, table usage, Excel
│   ├── routes/
│   │   ├── authRoutes.js
│   │   ├── userRoutes.js
│   │   ├── branchRoutes.js
│   │   ├── tableRoutes.js
│   │   ├── sessionRoutes.js
│   │   ├── customerRoutes.js
│   │   ├── billingRoutes.js
│   │   ├── inventoryRoutes.js
│   │   └── otherRoutes.js           ← Expenses, Bookings, Attendance, Reports, Settings, Logs, Notifications
│   ├── middleware/
│   │   ├── auth.js                  ← protect, restrictTo, requirePermission, scopeToBranch
│   │   ├── errorHandler.js          ← Global error handler (Mongoose, JWT, custom)
│   │   └── validate.js              ← express-validator result collector
│   ├── services/
│   │   ├── pdfService.js            ← PDFKit invoice generator
│   │   ├── qrCodeService.js         ← Table QR code generator
│   │   └── activityLogService.js    ← Fire-and-forget audit logger
│   └── utils/
│       ├── AppError.js              ← Operational error class
│       ├── asyncHandler.js          ← Promise catch wrapper
│       └── invoiceNumber.js         ← INV-YYYYMMDD-XXXX generator
│
└── frontend/
    ├── Dockerfile
    ├── nginx.conf                   ← SPA routing + API proxy + WebSocket
    ├── package.json
    ├── vite.config.ts
    ├── tailwind.config.js
    ├── tsconfig.json
    ├── index.html
    └── src/
        ├── App.tsx                  ← QueryClientProvider + BrowserRouter
        ├── main.tsx
        ├── index.css                ← Tailwind + CSS variable themes
        ├── types/index.ts           ← All TypeScript interfaces
        ├── utils/index.ts           ← cn, formatCurrency, formatDate, helpers
        ├── store/index.ts           ← Zustand: useAuthStore, useAppStore
        ├── services/
        │   ├── api.ts               ← Axios instance + auto-refresh interceptor
        │   └── index.ts             ← All domain service functions
        ├── hooks/
        │   └── useSocket.ts         ← Socket.io client hook
        ├── components/
        │   ├── ui/index.tsx         ← Button, Card, Badge, Input, Modal, Table, Toast, …
        │   └── layout/
        │       ├── Sidebar.tsx      ← Role-filtered nav, user profile
        │       ├── Navbar.tsx       ← Branch selector, notifications, theme toggle
        │       └── AppLayout.tsx
        ├── routes/index.tsx         ← ProtectedRoute, PublicRoute, ThemeProvider
        └── pages/
            ├── LoginPage.tsx
            ├── DashboardPage.tsx    ← Stats, charts, branch comparison
            ├── TablesPage.tsx       ← Live grid, start/pause/stop/extend modals
            ├── BillingPage.tsx      ← Bill list + new bill flow + payment
            ├── CustomersPage.tsx    ← List, search, membership, profile
            ├── InventoryPage.tsx    ← Stock, restock, low-stock alerts
            ├── ExpensesPage.tsx     ← Category breakdown, pie chart
            ├── ReportsPage.tsx      ← Revenue, table usage, P&L, branches, Excel export
            └── OtherPages.tsx       ← Branches, Users, Attendance, Bookings, Logs, Settings
```

---

## 📜 License

MIT — free to use, modify and deploy commercially.

---

**Built with ❤️ for billiard & gaming club owners. Questions? Open an issue!**
