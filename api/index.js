import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';

// --- Import TaskEarn Handlers / Routes based on your file structure ---
import loginHandler from './auth/login.js';
import registerHandler from './auth/register.js';
import tasksRouter from './task/tasks.js'; // Adjust relative path to match your folder structure
//import dashboardRouter from './user/dashboard.js';

import referralStatsHandler from './referrals/stats.js';

//import tasksIndexHandler from './tasks/index.js';
//import tasksListHandler from './tasks/lists.js';
//import tasksSubmitHandler from './tasks/submit.js';

import userDashboardHandler from './user/dashboard.js';
import userProfileHandler from './user/profile.js';
import bonusRouter from './wallet/bonus.js';
import videosRouter from './task/videos.js'; 
import booksRouter from './task/books.js'; 
import websitesRouter from './task/websites.js'; 
import appsRouter from './task/apps.js'; 
import productsRouter from './task/products.js'; 
import surveysRouter from './task/surveys.js'; 
import webhookRouter from './wallet/webhook.js'; // Adjust path if located in ./routes/api/webhook.js
import withdrawRouter from './wallet/withdraw.js';


import userReferralsHandler from './user/referrals.js';
import vipUpgradeHandler from './vip/upgrade.js';
import walletBalanceHandler from './wallet/balance.js';
import walletDepositHandler from './wallet/deposit.js';
//import walletWithdrawHandler from './wallet/withdraw.js';

dotenv.config();

const app = express();

// --- 1. Security & Logging Middleware ---
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));

// --- 2. CORS Configuration ---
const corsOptions = {
  origin: [
    'http://localhost:3000',
    'http://ccb.site.je',
    'http://ccb.free.nf',
    'https://ccb.free.nf',
    'http://localhost:5173',
    'https://ccb.site.je' // Replace with your frontend domain
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

// --- 3. Endpoints Wired to File-Based API Handlers ---

// Auth
app.use(['/api/auth/register', '/auth/register', '/register'], registerHandler);
app.use(['/api/auth/login', '/auth/login', '/login'], loginHandler);
app.use(['/api/wallet/bonus', '/wallet/bonus', '/bonus'], bonusRouter);
app.use([
  '/api/bonus', 
  '/api/wallet/bonus', 
  '/wallet/bonus', 
  '/bonus'
], bonusRouter);


// Mount tasks router to handle all /api/tasks endpoints
app.use('/api/tasks', tasksRouter);
app.use('/api/videos', videosRouter);
app.use('/api/books', booksRouter);
app.use('/api/websites', websitesRouter);
app.use('/api/apps', appsRouter);
app.use('/api/products', productsRouter);
app.use('/api/surveys', surveysRouter);
app.use('/api/webhook', webhookRouter);
app.use('/api/wallet', withdrawRouter);


// Mounts dashboardHandler across all common dashboard endpoint aliases
app.use(['/api/user','/api/users','/api/user/dashboard','/dashboard'], userDashboardHandler);
app.use(['/api/user','/api/users','/api/user/profile','/profile'], userProfileHandler);
app.use(['/api/vip','/api/vips','/api/vip/upgrade','/upgrade'], vipUpgradeHandler);




app.use('/api/user', userDashboardHandler);
app.use('/api/users', userDashboardHandler);



// Referrals
app.use('/api/referrals/stats', referralStatsHandler);

// Tasks
//app.use('/api/tasks/index', tasksIndexHandler);
//app.use('/api/tasks/list', tasksListHandler);
//app.use('/api/tasks/submit', tasksSubmitHandler);

// User
app.use('/api/user/dashboard', userDashboardHandler);
app.use('/api/user/profile', userProfileHandler);
app.use('/api/user/referrals', userReferralsHandler);

// VIP
app.use('/api/vip/upgrade', vipUpgradeHandler);

// Wallet
app.use('/api/wallet/balance', walletBalanceHandler);
app.use('/api/wallet/deposit', walletDepositHandler);
//app.use('/api/wallet/withdraw', walletWithdrawHandler);

// --- 4. Service Status & Health Check ---
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

// --- 6. Local Dev Listener ---
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 4000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 TaskEarn Engine Active locally on Port ${PORT}`);
  });
}

export default app;