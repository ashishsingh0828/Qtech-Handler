# QTECH Data Management

Internal registry for customer, instrument, validation, PMS, complaint, breakdown, AMC, and follow-up records.

## Layout

- `client` — React, Vite, and Tailwind. Executive Ivory workspace, virtualized sheet, and role-aware controls.
- `server` — Express API, PostgreSQL, workbook import and export, workflow actions, and notification stream.
- `shared` — role permissions and calendar computations used by both sides.

## Run

```bash
cp .env.example server/.env
createdb qtech
cd server && npm install && npm start
cd client && npm install && npm run dev
```

The API listens on port 4000. The client dev server proxies `/api` from port 5173.

When the users table is empty and `SEED_DEMO` is not `false`, the API creates four local accounts:

| Role | Email | Password |
| --- | --- | --- |
| Admin | admin@qtech.local | Admin#824610 |
| Manager | manager@qtech.local | Manager#824610 |
| Validator | validator@qtech.local | Validator#824610 |
| Service | service@qtech.local | Service#824610 |

Set `SEED_DEMO=false` before the first boot to skip them. Sessions are HTTP-only cookies lasting 8 hours. Dates and overdue checks use `APP_TIMEZONE` (`Asia/Kolkata` by default).
