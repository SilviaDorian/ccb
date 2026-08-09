import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';

// --- Auth Imports ---
import loginHandler from './auth/login.js';
import registerHandler from './auth/register.js';

// --- Task Routes ---
import tasksRouter from './task/tasks.js';
import videosRouter from './task/videos.js'; 
import booksRouter from './task/books.js'; 
import websitesRouter from './task/websites.js'; 
import appsRouter from './task/apps.js'; 
import productsRouter from './task/products.js'; 
import surveysRouter from './task/surveys.js'; 

// --- User & Referral Handlers ---
import userDashboardHandler from './user/dashboard.js';
import userProfileHandler from './user/profile.js';
import userReferralsHandler from './user/referrals.js';
import referralStatsHandler from './referrals/stats.js';

// --- VIP Routes ---
import upgradeRouter from './vip/upgrade.js';

// --- Wallet & Payment Handlers ---
import bonusRouter from './wallet/bonus.js';
import withdrawRouter from './wallet/withdraw.js';
import webhookRouter from './wallet/webhook.js';
import walletBalanceHandler from './wallet/balance.js';
import walletDepositHandler from './wallet/deposit.js';

dotenv.config();

const app = express();

// --- 1. Security & Logging Middleware ---
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));

// --- 2. CORS Configuration ---
const corsOptions = {
  origin: [
    'http://localhost:3000',
    'http://localhost:5173',
    'http://ccb.site.je',
    'https://ccb.site.je',
    'http://ccb.free.nf',
    'https://ccb.free.nf'
  ],
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-admin-key'],
  credentials: true,
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions)); // Preflight requests

app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- 3. Express Route Mounts ---

// Authentication
app.use('/api/auth/register', registerHandler);
app.use('/api/auth/login', loginHandler);

// Wallet & Webhook
app.use('/api/wallet/bonus', bonusRouter);
app.use('/api/wallet/balance', walletBalanceHandler);
app.use('/api/wallet/deposit', walletDepositHandler);
app.use('/api/wallet/withdraw', withdrawRouter);
app.use('/api/wallet', withdrawRouter); // Mount for general endpoints like /initialize-code-fee and /code-status
app.use('/api/webhook', webhookRouter);

// Tasks Modules
app.use('/api/tasks', tasksRouter);
app.use('/api/videos', videosRouter);
app.use('/api/books', booksRouter);
app.use('/api/websites', websitesRouter);
app.use('/api/apps', appsRouter);
app.use('/api/products', productsRouter);
app.use('/api/surveys', surveysRouter);

// User Profile & Dashboard
app.use('/api/user/dashboard', userDashboardHandler);
app.use('/api/user/profile', userProfileHandler);
app.use('/api/user/referrals', userReferralsHandler);
app.use('/api/referrals/stats', referralStatsHandler);

// VIP Module
app.use('/api/vip/upgrade', upgradeRouter);
app.use('/api/upgrade', upgradeRouter);

// --- 4. Health Check Endpoints ---
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

// --- 5. 404 & Global Error Handling ---
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'API endpoint not found' });
});

app.use((err, req, res, next) => {
  console.error('Unhandled TaskEarn Server Error:', err);
  res.status(500).json({ success: false, message: 'Internal Server Error' });
});

// --- 6. Local Server Listener ---
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 4000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 TaskEarn Engine Active locally on Port ${PORT}`);
  });
}

export default app;