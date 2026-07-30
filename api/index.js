import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';

// Import TaskEarn Controllers
import {
  getUserProfile,
  getReferralSummary
} from '../controllers/userController.js';

import {
  getTasksList,
  submitTaskProof
} from '../controllers/taskController.js';

import {
  upgradeVipLevel
} from '../controllers/vipController.js';

// Import TaskEarn Modular Routes
import authRoutes from '../routes/auth.js';
import userRoutes from '../routes/users.js';
import taskRoutes from '../routes/tasks.js';
import vipRoutes from '../routes/vip.js';
import transactionRoutes from '../routes/transactions.js';

dotenv.config();

const app = express();

// --- 1. Security & Logging Middleware ---
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));

// --- 2. CORS Configuration ---
const corsOptions = {
  origin: [
    'http://localhost:3000',
    'http://localhost:5173',
    'https://your-taskearn-frontend.vercel.app' // Replace with your frontend domain
  ],
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-admin-key'],
  credentials: true,
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions)); // Explicitly handle preflight requests

app.use(morgan('dev'));
app.use(express.json());

// --- 3. Modular Routes ---
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/vip', vipRoutes);
app.use('/api/transactions', transactionRoutes);

// --- 4. Direct Task & User Route Shortcuts ---
app.get('/api/user/profile', getUserProfile);
app.get('/api/user/referrals', getReferralSummary);
app.get('/api/tasks/list', getTasksList);
app.post('/api/tasks/submit', submitTaskProof);
app.post('/api/vip/upgrade', upgradeVipLevel);

// --- 5. Service Status & Health Check ---
app.get('/', (req, res) => {
  res.json({
    status: 'Online',
    project: 'TaskEarn Micro-Task & Rewards Engine',
    version: '1.0.0'
  });
});

app.get('/api', (req, res) => {
  res.json({
    status: 'Online',
    project: 'TaskEarn API Engine',
    timestamp: new Date().toISOString()
  });
});

// --- 6. 404 & Global Error Handling ---
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'API endpoint not found' });
});

app.use((err, req, res, next) => {
  console.error('Unhandled TaskEarn Server Error:', err);
  res.status(500).json({ success: false, message: 'Internal Server Error' });
});

// --- 7. Local Dev Listener ---
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 4000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 TaskEarn Engine Active locally on Port ${PORT}`);
  });
}

export default app;