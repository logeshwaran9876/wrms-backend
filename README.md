# WRMS - Windows Restriction Management System (Backend API)

Express.js + MongoDB Atlas backend providing REST endpoints, active policy synchronization, and central telemetry for the Windows Restriction Management System.

## 🚀 Quick Start (Local Development)

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Start production server
npm start
```

---

## ⚡ Deployment on Render (Render.com)

1. Push this repository to your GitHub account under your profile (`logeshvaran.9876@gmail.com`).
2. Log in to [Render Dashboard](https://dashboard.render.com).
3. Click **"New +"** -> **"Web Service"**.
4. Connect this `wrms-backend` repository.
5. In the configuration page:
   - **Name**: `wrms-backend`
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Plan**: Free
6. In **Environment Variables**:
   - `MONGODB_URI`: `mongodb+srv://loky:Loky1234@cluster0.07kds7x.mongodb.net/windows_monitoring?retryWrites=true&w=majority`
   - `NODE_ENV`: `production`
   - `CLIENT_URL`: `https://your-wrms-frontend.vercel.app` (your Vercel frontend URL or `*`)
7. Click **Create Web Service**!
8. Render will provision the service and provide an HTTPS URL (e.g., `https://wrms-backend.onrender.com`).
9. Health check will automatically verify via `GET /api/health`.
