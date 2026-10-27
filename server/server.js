import 'dotenv/config';
import dns from 'node:dns';
import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET;
const SLA_MS = 2 * 60 * 60 * 1000;
const CATEGORIES = ['Work', 'Personal', 'Study', 'Other'];
const STATUSES = ['todo', 'doing', 'done'];

if (!JWT_SECRET) {
  console.error('Missing JWT_SECRET. Copy server/.env.example to server/.env and set it.');
  process.exit(1);
}

app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173' }));
app.use(express.json());

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 80 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
}, { timestamps: true });

const taskSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  text: { type: String, required: true, trim: true, maxlength: 250 },
  category: { type: String, enum: CATEGORIES, default: 'Work' },
  status: { type: String, enum: STATUSES, default: 'todo' },
  createdAt: { type: Date, default: Date.now },
  dueAt: { type: Date, required: true },
  completedAt: { type: Date, default: null },
  todoRemainingMs: { type: Number, default: null },
  todoStartedAt: { type: Date, default: null },
  todoInitialized: { type: Boolean, default: false },
  todoRunning: { type: Boolean, default: false },
  doingRemainingMs: { type: Number, default: null },
  doingStartedAt: { type: Date, default: null },
  doingInitialized: { type: Boolean, default: false },
  doingRunning: { type: Boolean, default: false },
  todoFrozenRemainingMs: { type: Number, default: null },
  doingFrozenRemainingMs: { type: Number, default: null },
  completionRemainingMs: { type: Number, default: null },
}, { versionKey: false });

const User = mongoose.model('User', userSchema);
const Task = mongoose.model('Task', taskSchema);

function publicUser(user) {
  return { id: String(user._id), name: user.name, email: user.email };
}
function publicTask(task) {
  return {
    id: String(task._id),
    text: task.text,
    category: task.category,
    status: task.status,
    createdAt: task.createdAt,
    dueAt: task.dueAt,
    completedAt: task.completedAt,
    todoRemainingMs: task.todoRemainingMs,
    todoStartedAt: task.todoStartedAt,
    todoInitialized: task.todoInitialized,
    todoRunning: task.todoRunning,
    doingRemainingMs: task.doingRemainingMs,
    doingStartedAt: task.doingStartedAt,
    doingInitialized: task.doingInitialized,
    doingRunning: task.doingRunning,
    todoFrozenRemainingMs: task.todoFrozenRemainingMs,
    doingFrozenRemainingMs: task.doingFrozenRemainingMs,
    completionRemainingMs: task.completionRemainingMs,
  };
}
function getTimerRemaining(task, timer, now = new Date()) {
  const remainingField = `${timer}RemainingMs`;
  const startedField = `${timer}StartedAt`;
  const remaining = task[remainingField] ?? (task.dueAt ? task.dueAt.getTime() - now.getTime() : SLA_MS);
  return task[startedField] ? remaining - (now.getTime() - new Date(task[startedField]).getTime()) : remaining;
}
function ensureLegacyTimerState(task, now = new Date()) {
  const legacyRemaining = task.dueAt ? task.dueAt.getTime() - now.getTime() : SLA_MS;
  const legacyDuration = task.dueAt && task.createdAt
    ? task.dueAt.getTime() - new Date(task.createdAt).getTime()
    : SLA_MS;
  if (!task.todoInitialized) {
    task.todoInitialized = true;
    task.todoRemainingMs = legacyDuration;
    task.todoStartedAt = task.status === 'todo' ? (task.createdAt || now) : null;
    task.todoRunning = task.status === 'todo';
  }
  if (task.status === 'doing' && !task.doingInitialized) {
    task.doingInitialized = true;
    task.doingRemainingMs = legacyDuration;
    task.doingStartedAt = task.createdAt || now;
    task.doingRunning = true;
  }
  if (task.status === 'done' && task.completionRemainingMs == null) {
    const completedAt = task.completedAt ? new Date(task.completedAt).getTime() : now.getTime();
    task.completionRemainingMs = task.dueAt ? task.dueAt.getTime() - completedAt : legacyRemaining;
    task.todoFrozenRemainingMs = task.completionRemainingMs;
  }
}
function pauseTimer(task, timer, now) {
  task[`${timer}RemainingMs`] = getTimerRemaining(task, timer, now);
  task[`${timer}StartedAt`] = null;
  task[`${timer}Running`] = false;
}
function startTimer(task, timer, now) {
  if (!task[`${timer}Initialized`]) {
    task[`${timer}RemainingMs`] = SLA_MS;
    task[`${timer}Initialized`] = true;
  }
  task[`${timer}StartedAt`] = now;
  task[`${timer}Running`] = true;
}
function transitionTask(task, nextStatus, now = new Date()) {
  if (task.status === nextStatus) return;
  if (task.status === 'todo') pauseTimer(task, 'todo', now);
  if (task.status === 'doing') pauseTimer(task, 'doing', now);

  if (nextStatus === 'todo') {
    startTimer(task, 'todo', now);
    task.completedAt = null;
  } else if (nextStatus === 'doing') {
    startTimer(task, 'doing', now);
    task.completedAt = null;
  } else if (nextStatus === 'done') {
    task.completionRemainingMs = task.status === 'doing' ? task.doingRemainingMs : task.todoRemainingMs;
    task.todoFrozenRemainingMs = task.todoRemainingMs;
    task.doingFrozenRemainingMs = task.doingRemainingMs ?? SLA_MS;
    task.completedAt = now;
    task.todoStartedAt = null;
    task.doingStartedAt = null;
    task.todoRunning = false;
    task.doingRunning = false;
  }
  task.status = nextStatus;
}
function makeToken(user) {
  return jwt.sign({ sub: String(user._id) }, JWT_SECRET, { expiresIn: '7d' });
}
async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) return res.status(401).json({ message: 'Please log in to continue.' });
    const payload = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(payload.sub);
    if (!user) return res.status(401).json({ message: 'Session is no longer valid. Please log in again.' });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ message: 'Your session has expired. Please log in again.' });
  }
}

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

app.post('/api/auth/signup', async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    if (!name) return res.status(400).json({ message: 'Name is required.' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ message: 'Enter a valid email address.' });
    if (password.length < 8) return res.status(400).json({ message: 'Password must contain at least 8 characters.' });
    const existing = await User.findOne({ email });
    if (existing) return res.status(409).json({ message: 'An account with this email already exists. Please log in.' });
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({ name, email, passwordHash });
    return res.status(201).json({ token: makeToken(user), user: publicUser(user) });
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ message: 'An account with this email already exists.' });
    console.error('Signup error:', error.message);
    return res.status(500).json({ message: 'Could not create the account.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const user = await User.findOne({ email });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(401).json({ message: 'Email or password is incorrect.' });
    }
    return res.json({ token: makeToken(user), user: publicUser(user) });
  } catch (error) {
    console.error('Login error:', error.message);
    return res.status(500).json({ message: 'Could not log in.' });
  }
});

app.get('/api/auth/me', requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));

app.get('/api/tasks', requireAuth, async (req, res) => {
  try {
    const tasks = await Task.find({ user: req.user._id }).sort({ createdAt: -1 });
    tasks.forEach((task) => ensureLegacyTimerState(task));
    res.json({ tasks: tasks.map(publicTask) });
  } catch (error) {
    console.error('Fetch tasks error:', error.message);
    res.status(500).json({ message: 'Could not load tasks.' });
  }
});

app.post('/api/tasks', requireAuth, async (req, res) => {
  try {
    const text = String(req.body.text || '').trim();
    const category = CATEGORIES.includes(req.body.category) ? req.body.category : 'Work';
    const status = STATUSES.includes(req.body.status) ? req.body.status : 'todo';
    if (!text) return res.status(400).json({ message: 'Task title is required.' });
    if (text.length > 250) return res.status(400).json({ message: 'Task title must be 250 characters or fewer.' });
    const createdAt = new Date();
    const task = await Task.create({
      user: req.user._id, text, category, status, createdAt,
      dueAt: new Date(createdAt.getTime() + SLA_MS),
      completedAt: status === 'done' ? createdAt : null,
      todoRemainingMs: SLA_MS,
      todoStartedAt: status === 'todo' ? createdAt : null,
      todoInitialized: true,
      todoRunning: status === 'todo',
      doingRemainingMs: status === 'doing' ? SLA_MS : null,
      doingStartedAt: status === 'doing' ? createdAt : null,
      doingInitialized: status === 'doing',
      doingRunning: status === 'doing',
      todoFrozenRemainingMs: status === 'done' ? SLA_MS : null,
      doingFrozenRemainingMs: status === 'done' ? SLA_MS : null,
      completionRemainingMs: status === 'done' ? SLA_MS : null,
    });
    res.status(201).json({ task: publicTask(task) });
  } catch (error) {
    console.error('Create task error:', error.message);
    res.status(500).json({ message: 'Could not create task.' });
  }
});

app.patch('/api/tasks/:id', requireAuth, async (req, res) => {
  try {
    const task = await Task.findOne({ _id: req.params.id, user: req.user._id });
    if (!task) return res.status(404).json({ message: 'Task not found.' });
    ensureLegacyTimerState(task);
    if (req.body.text !== undefined) {
      const text = String(req.body.text).trim();
      if (!text) return res.status(400).json({ message: 'Task title is required.' });
      if (text.length > 250) return res.status(400).json({ message: 'Task title must be 250 characters or fewer.' });
      task.text = text;
    }
    if (req.body.category !== undefined) {
      if (!CATEGORIES.includes(req.body.category)) return res.status(400).json({ message: 'Invalid category.' });
      task.category = req.body.category;
    }
    if (req.body.status !== undefined) {
      if (!STATUSES.includes(req.body.status)) return res.status(400).json({ message: 'Invalid task status.' });
      transitionTask(task, req.body.status);
    }
    await task.save();
    res.json({ task: publicTask(task) });
  } catch (error) {
    if (error?.name === 'CastError') return res.status(404).json({ message: 'Task not found.' });
    console.error('Update task error:', error.message);
    res.status(500).json({ message: 'Could not update task.' });
  }
});

app.delete('/api/tasks/:id', requireAuth, async (req, res) => {
  try {
    const task = await Task.findOneAndDelete({ _id: req.params.id, user: req.user._id });
    if (!task) return res.status(404).json({ message: 'Task not found.' });
    res.json({ message: 'Task deleted.' });
  } catch (error) {
    if (error?.name === 'CastError') return res.status(404).json({ message: 'Task not found.' });
    console.error('Delete task error:', error.message);
    res.status(500).json({ message: 'Could not delete task.' });
  }
});

app.use((error, _req, res, _next) => {
  console.error('Unhandled error:', error.message);
  res.status(500).json({ message: 'Unexpected server error.' });
});

try {
  if (!process.env.MONGODB_URI) throw new Error('Missing MONGODB_URI in server/.env');
  if (process.env.MONGODB_DNS_SERVERS) {
    const dnsServers = process.env.MONGODB_DNS_SERVERS
      .split(',')
      .map((server) => server.trim())
      .filter(Boolean);
    if (dnsServers.length === 0) throw new Error('MONGODB_DNS_SERVERS must contain at least one DNS server.');
    dns.setServers(dnsServers);
  }
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB');
  app.listen(PORT, () => console.log(`TaskFlow API running at http://localhost:${PORT}`));
} catch (error) {
  console.error('Could not start server:', error.message);
  process.exit(1);
}
