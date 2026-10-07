# SafeLanka

Monorepo:
```
project/
├── backend/ (Node.js + Express)
├── web/ (React + Vite)
└── mobile/ (React Native + Expo)
```

## Prereqs
- Node 20+
- npm
- Cloud MongoDB (Atlas) connection string in `backend/.env` as `MONGO_URI`
- Expo Go app with SDK 57 support (for mobile testing)

## Setup
```bash
npm run install:all
# backend: copy backend/.env.example to backend/.env and fill MONGO_URI + JWT secrets
# users: citizen self-signup via mobile app; staff created by DMC via POST /api/users/staff
```

## Run
Backend (http://localhost:5000):
```bash
npm run dev:backend
```

Web (http://localhost:5173):
```bash
npm run dev:web
```
Staff logins: `dmc@safelanka.lk / Dmc123!`, `district@safelanka.lk / Dis123!`, `warden@safelanka.lk / War123!`, `team@safelanka.lk / Tea123!`.

Mobile:
```bash
cd mobile
npx expo start
```
Citizen login: `citizen@safelanka.lk / Cit123!`. On emulator the API is `http://10.0.2.2:5000/api`; on a physical device replace with your PC LAN IP in `mobile/api/client.js`.

## API (v1)
- `POST /api/auth/signup|signin|refresh|logout`, `GET /api/auth/me`
- Alerts (DMC): `POST /api/alerts`, `/api/alerts/:id/publish|cancel|retry|reissue`, `GET /api/alerts/active?district=`
- Reports: `POST /api/reports`, `GET /api/reports/mine|queue|:id`
- Verify (DMC): `POST /api/reports/:id/lock`, `DELETE .../lock`, `POST .../verify`
- Shelters: `POST /api/shelters`, `/:id/open|close|checkin|checkout|alternate`, `GET /api/shelters/open`
- Dispatch: `POST /api/dispatch`, `/:id/reserve|assign|ack|arrive|distribute|abort`, `GET /api/dispatch/mine`
- `GET /api/audit`, `PATCH /api/users/me`, `GET /api/health`
