import React, { useEffect, useMemo, useState } from "react";
import "./App.css";

const SLA_MS = 2 * 60 * 60 * 1000;
const STATUSES = [
  { id: "todo", label: "To do" },
  { id: "doing", label: "In progress" },
  { id: "done", label: "Done" },
];
const CATEGORIES = ["Work", "Personal", "Study", "Other"];
const VIEWS = [
  { id: "list", label: "List view", icon: "☰" },
  { id: "grid", label: "Grid view", icon: "▦" },
  { id: "kanban", label: "Kanban view", icon: "▤" },
  { id: "section", label: "Section view", icon: "☷" },
];
const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:5000/api";
const AUTH_KEY = "taskflow.auth.v1";

async function apiRequest(path, { token, ...options } = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || "Something went wrong. Please try again.");
  return data;
}

function normalizeTask(task) {
  return {
    ...task,
    id: String(task.id || task._id),
    createdAt: new Date(task.createdAt).getTime(),
    dueAt: new Date(task.dueAt).getTime(),
    completedAt: task.completedAt ? new Date(task.completedAt).getTime() : null,
    todoRemainingMs: task.todoRemainingMs ?? Math.max(0, new Date(task.dueAt).getTime() - Date.now()),
    todoStartedAt: task.todoStartedAt ? new Date(task.todoStartedAt).getTime() : null,
    doingRemainingMs: task.doingRemainingMs ?? null,
    doingStartedAt: task.doingStartedAt ? new Date(task.doingStartedAt).getTime() : null,
    todoFrozenRemainingMs: task.todoFrozenRemainingMs ?? null,
    doingFrozenRemainingMs: task.doingFrozenRemainingMs ?? null,
    completionRemainingMs: task.completionRemainingMs ?? null,
  };
}

function formatDuration(ms) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return [hours, minutes, secs].map((n) => String(n).padStart(2, "0")).join(":");
}
function formatSummaryDuration(ms) {
  if (ms === null || ms === undefined) return "--";
  if (ms < 0) return `Overdue ${formatSummaryDuration(-ms)}`;
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}
function formatDate(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString([], {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}
function getSlaState(task, now) {
  const timer = task.status === "doing" ? "doing" : "todo";
  const remainingField = task.status === "done"
    ? "completionRemainingMs"
    : `${timer}RemainingMs`;
  const startedField = task.status === "done" ? null : `${timer}StartedAt`;
  const savedRemaining = task[remainingField] ?? task.todoRemainingMs ?? Math.max(0, task.dueAt - task.createdAt);
  const remaining = task.status === "done" || !task[startedField]
    ? savedRemaining
    : savedRemaining - (now - task[startedField]);
  if (task.status === "done") {
    return { id: remaining < 0 ? "overdue" : "completed", label: remaining < 0 ? "Completed overdue" : "Completed", remaining };
  }
  if (remaining <= 0) return { id: "overdue", label: "Overdue", remaining };
  return { id: remaining <= 15 * 60 * 1000 ? "warning" : "active", label: "Time left", remaining };
}

function getTaskRemaining(task, status, now) {
  const timer = status === "doing" ? "doing" : "todo";
  const remaining = task[`${timer}RemainingMs`] ?? Math.max(0, task.dueAt - task.createdAt);
  const startedAt = task[`${timer}StartedAt`];
  return startedAt ? remaining - (now - startedAt) : remaining;
}

function SlaSummary({ tasks, now }) {
  const sections = [
    { status: "todo", label: "Todo", title: "Average SLA" },
    { status: "doing", label: "In Progress", title: "Average SLA" },
    { status: "done", label: "Done", title: "Average SLA at completion" },
  ];
  return <div className="sla-summary-grid">{sections.map((section) => {
    const items = tasks.filter((task) => task.status === section.status);
    const average = items.length
      ? items.reduce((sum, task) => sum + (section.status === "done"
        ? (task.completionRemainingMs ?? task.todoFrozenRemainingMs ?? task.todoRemainingMs ?? 0)
        : getTaskRemaining(task, section.status, now)), 0) / items.length
      : null;
    return <div className="sla-summary-card" key={section.status}>
      <div><span className={`column-dot ${section.status}-dot`} /><strong>{section.label}</strong></div>
      <span className="sla-summary-label">{section.title}</span>
      <strong className={average !== null && average < 0 ? "summary-overdue" : ""}>{formatSummaryDuration(average)}</strong>
      <span className="sla-summary-count">Tasks: {items.length}</span>
    </div>;
  })}</div>;
}

function AuthScreen({ onLogin }) {
  const [mode, setMode] = useState("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const submit = async (event) => {
    event.preventDefault();
    setError("");
    setNotice("");
    const normalizedEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setError("Enter a valid email address.");
      return;
    }
    if (password.length < 8) {
      setError("Use at least 8 characters for the password.");
      return;
    }
    if (mode === "signup" && !name.trim()) {
      setError("Enter your name to create an account.");
      return;
    }
    setSubmitting(true);
    try {
      const result = await apiRequest(mode === "signup" ? "/auth/signup" : "/auth/login", {
        method: "POST",
        body: JSON.stringify(mode === "signup"
          ? { name: name.trim(), email: normalizedEmail, password }
          : { email: normalizedEmail, password }),
      });
      onLogin(result);
    } catch (err) {
      setError(err.message || "Unable to authenticate. Check that the backend is running.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-shell">
      <div className="auth-art">
        <div className="auth-brand"><span className="brand-logo">✳</span> TaskFlow</div>
        <div className="auth-art-copy">
          <span className="eyebrow">MAKE TIME FOR WHAT MATTERS</span>
          <h1>Good work starts with a clear plan<span>.</span></h1>
          <p>Bring your tasks, deadlines, and daily focus into one calm workspace.</p>
          <div className="art-mini-board">
            <div className="mini-board-head"><span>Today at a glance</span><span className="mini-live">● LIVE SLA</span></div>
            <div className="mini-task"><span className="mini-check">✓</span><span>Review sprint goals</span><span className="mini-time">01:24:08</span></div>
            <div className="mini-task"><span className="mini-check empty-check"/><span>Finish project outline</span><span className="mini-time">00:42:16</span></div>
            <div className="mini-task"><span className="mini-check empty-check"/><span>Prepare study notes</span><span className="mini-time">01:51:32</span></div>
          </div>
        </div>
        <p className="auth-art-footer">A little progress, every day.</p>
      </div>
      <div className="auth-panel-wrap">
        <form className="auth-panel" onSubmit={submit}>
          <div className="auth-mobile-brand"><span className="brand-logo">✳</span> TaskFlow</div>
          <span className="eyebrow">YOUR PRODUCTIVITY HUB</span>
          <h2>{mode === "login" ? "Welcome back" : "Create your account"}</h2>
          <p className="auth-subtitle">{mode === "login" ? "Pick up where you left off." : "Set up your personal task workspace."}</p>
          {mode === "signup" && <label className="field-label">Full name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" autoComplete="name" /></label>}
          <label className="field-label">Email address<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" /></label>
          <label className="field-label">Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" autoComplete={mode === "login" ? "current-password" : "new-password"} /></label>
          {error && <p className="form-message form-error">{error}</p>}
          {notice && <p className="form-message">{notice}</p>}
          <button className="btn auth-submit" type="submit" disabled={submitting}>{submitting ? "Please wait…" : mode === "login" ? "Log in" : "Create account"}<span>→</span></button>
          <p className="auth-switch">{mode === "login" ? "New to TaskFlow?" : "Already have an account?"} <button type="button" onClick={() => { setMode(mode === "login" ? "signup" : "login"); setError(""); setNotice(""); }}>{mode === "login" ? "Create an account" : "Log in"}</button></p>
          <div className="demo-note"><span>ⓘ</span><p><strong>Assignment version</strong><br/>Authentication uses your Express API and MongoDB. Passwords are hashed on the server. Email verification is not included in this basic version.</p></div>
        </form>
      </div>
    </div>
  );
}

function TaskEditor({ initial, onSave, onCancel }) {
  const [text, setText] = useState(initial?.text || "");
  const [category, setCategory] = useState(initial?.category || "Work");
  const [status, setStatus] = useState(initial?.status || "todo");
  const [error, setError] = useState("");
  const submit = (event) => {
    event.preventDefault();
    if (!text.trim()) { setError("Task title cannot be empty."); return; }
    onSave({ text: text.trim(), category, status });
  };
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <form className="edit-modal" onSubmit={submit}>
        <div className="modal-title-row"><div><span className="eyebrow">TASK DETAILS</span><h2>{initial ? "Edit task" : "New task"}</h2></div><button type="button" className="modal-close" onClick={onCancel} aria-label="Close">×</button></div>
        <label className="field-label">Task title<input autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="What needs doing?" /></label>
        <div className="editor-fields">
          <label className="field-label">Category<select value={category} onChange={(e) => setCategory(e.target.value)}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></label>
          <label className="field-label">Status<select value={status} onChange={(e) => setStatus(e.target.value)}>{STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
        </div>
        <div className="sla-info"><span>◷</span><p><strong>Automatic 2-hour SLA</strong><br/>The SLA starts when a task is first created. Editing the task does not reset its deadline.</p></div>
        {error && <p className="form-message form-error">{error}</p>}
        <div className="modal-actions"><button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button><button type="submit" className="btn">Save task</button></div>
      </form>
    </div>
  );
}

function Task({ task, variant = "row", now, onStatus, onDelete, onEdit, draggable = false, onDragStart }) {
  const sla = getSlaState(task, now);
  const elapsed = Math.min(100, Math.max(0, 100 - ((sla.remaining / SLA_MS) * 100)));
  const [showDetails, setShowDetails] = useState(false);
  return (
    <article className={`task task--${variant} task--${task.status} ${sla.id === "overdue" ? "task--overdue" : ""}`} draggable={draggable} onDragStart={onDragStart}>
      <div className="task-main-line">
        <label className="task__main">
          <input type="checkbox" checked={task.status === "done"} onChange={(e) => onStatus(task.id, e.target.checked ? "done" : "todo")} aria-label={`Mark ${task.text} ${task.status === "done" ? "not done" : "done"}`} />
          <span className="task__text">{task.text}</span>
        </label>
        <div className="task-actions"><button type="button" className="icon-btn" onClick={() => onEdit(task)} aria-label={`Edit ${task.text}`} title="Edit task">✎</button><button type="button" className="icon-btn delete-icon" onClick={() => onDelete(task.id)} aria-label={`Delete ${task.text}`} title="Delete task">×</button></div>
      </div>
      <div className="task__meta">
        <span className={`chip chip--${task.category.toLowerCase()}`}>{task.category}</span>
        <select className={`status status--${task.status}`} value={task.status} onChange={(e) => onStatus(task.id, e.target.value)} aria-label={`Status for ${task.text}`}>
          {STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <span className={`sla-badge sla--${sla.id}`} title={`Created ${formatDate(task.createdAt)} · Due ${formatDate(task.dueAt)}`}>
          <span className="sla-pulse" />{sla.id === "overdue" ? `Overdue ${formatSummaryDuration(Math.abs(sla.remaining))}` : sla.id === "completed" ? "Completed" : formatDuration(sla.remaining)}
        </span>
      </div>
      <div className="sla-progress" aria-label="SLA elapsed"><span className={`sla-progress-fill ${sla.id === "overdue" ? "fill-overdue" : sla.id === "met" ? "fill-done" : ""}`} style={{ width: `${task.status === "done" ? (task.completedAt <= task.dueAt ? 100 : elapsed) : elapsed}%` }} /></div>
      <button className="task-details-toggle" type="button" onClick={() => setShowDetails(!showDetails)} aria-expanded={showDetails}>{showDetails ? "Hide details" : "SLA details"}<span>{showDetails ? "−" : "+"}</span></button>
      {showDetails && <div className="task-details"><div><span>Created</span><strong>{formatDate(task.createdAt)}</strong></div><div><span>SLA deadline</span><strong>{formatDate(task.dueAt)}</strong></div><div><span>Completed</span><strong>{task.completedAt ? formatDate(task.completedAt) : "Not completed"}</strong></div><div><span>Result</span><strong className={`result-${sla.id}`}>{sla.label}</strong></div></div>}
    </article>
  );
}

function App() {
  const [auth, setAuth] = useState(() => {
    try { return JSON.parse(localStorage.getItem(AUTH_KEY) || "null"); } catch { return null; }
  });
  const profile = auth?.user || null;
  const token = auth?.token || null;
  const [tasks, setTasks] = useState([]);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [view, setView] = useState("list");
  const [now, setNow] = useState(Date.now());
  const [editor, setEditor] = useState(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [toast, setToast] = useState("");
  const [collapsed, setCollapsed] = useState({});

  useEffect(() => {
    let cancelled = false;
    async function loadTasks() {
      if (!token) { setTasks([]); return; }
      setLoadingTasks(true);
      try {
        // Validate the saved token, then fetch tasks belonging to this user.
        const me = await apiRequest("/auth/me", { token });
        if (cancelled) return;
        setAuth((current) => current ? { ...current, user: me.user } : current);
        const result = await apiRequest("/tasks", { token });
        if (!cancelled) setTasks(result.tasks.map(normalizeTask));
      } catch (err) {
        if (!cancelled) {
          localStorage.removeItem(AUTH_KEY);
          setAuth(null);
          setTasks([]);
          setToast(err.message || "Session expired. Please log in again.");
        }
      } finally {
        if (!cancelled) setLoadingTasks(false);
      }
    }
    loadTasks();
    return () => { cancelled = true; };
  }, [token]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(""), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const signIn = (result) => {
    const nextAuth = { token: result.token, user: result.user };
    localStorage.setItem(AUTH_KEY, JSON.stringify(nextAuth));
    setAuth(nextAuth);
  };
  const signOut = () => {
    // Tasks stay in MongoDB; signing out only removes the local login token.
    localStorage.removeItem(AUTH_KEY);
    setAuth(null);
    setTasks([]);
    setView("list");
  };
  const addTask = async (data) => {
    try {
      const result = await apiRequest("/tasks", { token, method: "POST", body: JSON.stringify(data) });
      setTasks((prev) => [normalizeTask(result.task), ...prev]);
      setEditor(null);
      setToast("Task created. Your 2-hour SLA has started.");
    } catch (err) { setToast(err.message); }
  };
  const saveEdit = async (data) => {
    if (!editor?.id) { await addTask(data); return; }
    try {
      const result = await apiRequest(`/tasks/${editor.id}`, { token, method: "PATCH", body: JSON.stringify(data) });
      const updated = normalizeTask(result.task);
      setTasks((prev) => prev.map((task) => task.id === updated.id ? updated : task));
      setEditor(null);
      setToast("Task updated.");
    } catch (err) { setToast(err.message); }
  };
  const setStatus = async (id, status) => {
    const current = tasks.find((task) => task.id === String(id));
    if (!current || current.status === status) return;
    try {
      const result = await apiRequest(`/tasks/${id}`, { token, method: "PATCH", body: JSON.stringify({ status }) });
      const updated = normalizeTask(result.task);
      setTasks((prev) => prev.map((task) => task.id === updated.id ? updated : task));
    } catch (err) { setToast(err.message); }
  };
  const deleteTask = async (id) => {
    try {
      await apiRequest(`/tasks/${id}`, { token, method: "DELETE" });
      setTasks((prev) => prev.filter((task) => task.id !== String(id)));
      setToast("Task deleted.");
    } catch (err) { setToast(err.message); }
  };

  const counts = useMemo(() => ({
    all: tasks.length,
    open: tasks.filter((t) => t.status !== "done" && t.dueAt > now).length,
    overdue: tasks.filter((t) => t.status !== "done" && t.dueAt <= now).length,
    done: tasks.filter((t) => t.status === "done").length,
  }), [tasks, now]);
  const visibleTasks = useMemo(() => tasks.filter((task) => {
    const matchesSearch = task.text.toLowerCase().includes(search.toLowerCase()) || task.category.toLowerCase().includes(search.toLowerCase());
    const matchesFilter = filter === "all" || (filter === "open" && task.status !== "done" && task.dueAt > now) || (filter === "overdue" && task.status !== "done" && task.dueAt <= now) || (filter === "done" && task.status === "done");
    return matchesSearch && matchesFilter;
  }), [tasks, search, filter, now]);

  const taskActions = { now, onStatus: setStatus, onDelete: deleteTask, onEdit: (task) => setEditor(task) };
  const renderTask = (task, variant = "row", drag = false) => <Task key={task.id} task={task} variant={variant} {...taskActions} draggable={drag} onDragStart={(e) => e.dataTransfer.setData("text/plain", task.id)} />;

  const renderView = () => {
    if (!visibleTasks.length) return <div className="empty-state"><div className="empty-icon">✦</div><h3>{tasks.length ? "No matching tasks" : "Your space is clear"}</h3><p>{tasks.length ? "Try another search or filter." : "Add your first task to get things moving."}</p><button className="btn empty-cta" onClick={() => setEditor({})}>+ Create a task</button></div>;
    if (view === "grid") return <div className="task-grid">{visibleTasks.map((t) => renderTask(t, "card"))}</div>;
    if (view === "kanban") return <div className="kanban-board">{STATUSES.map((col) => {
      const items = visibleTasks.filter((t) => t.status === col.id);
      return <section key={col.id} className="kanban-column" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const id = e.dataTransfer.getData("text/plain"); if (id) setStatus(id, col.id); }}><div className="column-heading"><span className={`column-dot ${col.id}-dot`} />{col.label}<span className="column-count">{items.length}</span></div><div className="kanban-column-body">{items.map((t) => renderTask(t, "card", true))}{!items.length && <p className="column-empty">Drop a task here</p>}</div></section>;
    })}</div>;
    if (view === "section") return <div className="section-view">{CATEGORIES.map((cat) => {
      const items = visibleTasks.filter((t) => t.category === cat);
      if (!items.length) return null;
      const isClosed = !!collapsed[cat];
      return <section className="task-section" key={cat}><button className="section-heading" onClick={() => setCollapsed((prev) => ({ ...prev, [cat]: !prev[cat] }))} aria-expanded={!isClosed}><span className={`chevron ${isClosed ? "" : "chevron-open"}`} />{cat}<span className="column-count">{items.length}</span></button>{!isClosed && <div className="section-tasks">{items.map((t) => renderTask(t))}</div>}</section>;
    })}</div>;
    return <div className="task-list">{visibleTasks.map((t) => renderTask(t))}</div>;
  };

  if (!profile) return <AuthScreen onLogin={signIn} />;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-logo">✳</span>TaskFlow</div>
        <p className="sidebar-label">WORKSPACE</p>
        <button className={`sidebar-link ${filter === "all" ? "active-link" : ""}`} onClick={() => setFilter("all")}><span>◫</span> My Tasks <span className="sidebar-count">{counts.all}</span></button>
        <button className={`sidebar-link ${filter === "open" ? "active-link" : ""}`} onClick={() => setFilter("open")}><span>◷</span> Active <span className="sidebar-count">{counts.open}</span></button>
        <button className={`sidebar-link ${filter === "overdue" ? "active-link" : ""}`} onClick={() => setFilter("overdue")}><span>!</span> Overdue <span className="sidebar-count">{counts.overdue}</span></button>
        <button className={`sidebar-link ${filter === "done" ? "active-link" : ""}`} onClick={() => setFilter("done")}><span>✓</span> Completed <span className="sidebar-count">{counts.done}</span></button>
        <div className="sidebar-note"><span className="note-icon">◷</span><div><strong>2-hour SLA</strong><p>Every new task gets an automatic deadline.</p></div></div>
        <div className="sidebar-bottom"><div className="avatar">{(profile.name || profile.email || "U").slice(0, 1).toUpperCase()}</div><div className="profile-summary"><strong>{profile.name || "My Workspace"}</strong><p>{profile.email}</p></div><button className="signout-btn" onClick={signOut} title="Sign out" aria-label="Sign out">↪</button></div>
      </aside>

      <main className="main-content">
        <header className="topbar"><span className="breadcrumb">Workspace / My Tasks</span><span className="topbar-date">YOUR SPACE, YOUR PACE ✨</span></header>
        <div className="page-content">
          <div className="welcome-row"><div><p className="eyebrow">YOUR PRODUCTIVITY HUB</p><h1>My Tasks<span className="heading-period">.</span></h1><p className="page-subtitle">One step at a time. Make today count.</p></div><div className="task-summary"><span className="summary-icon">✦</span><div><strong>{counts.all}</strong><p>Total tasks</p></div></div></div>

          <section className="add-task-panel"><div className="panel-heading"><div><h2>Capture a thought</h2><p>Every new task starts a 2-hour SLA automatically.</p></div><span className="sparkle">✧</span></div><button type="button" className="create-task-button" onClick={() => setEditor({})}><span>＋</span> Create a task <span className="create-hint">Title · Category · Status</span></button></section>

          <section className="sla-overview"><div className="sla-overview-item"><span className="overview-icon icon-purple">◷</span><div><span>Active</span><strong>{counts.open}</strong></div></div><div className="sla-overview-item"><span className="overview-icon icon-red">!</span><div><span>Overdue</span><strong>{counts.overdue}</strong></div></div><div className="sla-overview-item"><span className="overview-icon icon-green">✓</span><div><span>Completed</span><strong>{counts.done}</strong></div></div><div className="sla-overview-item"><span className="overview-icon icon-amber">⌁</span><div><span>SLA target</span><strong>2 hours</strong></div></div></section>

          <section className="tasks-area"><div className="tasks-toolbar"><div><h2>All tasks</h2><span className="tasks-subtitle">{visibleTasks.length} of {tasks.length} tasks · Live SLA countdowns</span></div><div className="toolbar-controls"><label className="search-box"><span>⌕</span><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search tasks" aria-label="Search tasks" /></label><div className="view-switcher">{VIEWS.map((v) => <button key={v.id} type="button" className={`view-button ${view === v.id ? "selected-view" : ""}`} aria-pressed={view === v.id} onClick={() => setView(v.id)}><span>{v.icon}</span>{v.label}</button>)}</div></div></div><SlaSummary tasks={tasks} now={now} /><div className="view-container">{loadingTasks ? <div className="empty-state"><h3>Loading your tasks…</h3><p>Getting your saved workspace.</p></div> : renderView()}</div></section>
          <p className="prototype-footnote">MongoDB-backed assignment version · Tasks are saved to your account and remain available after refresh or sign-out. Every new task receives a 2-hour SLA.</p>
        </div>
      </main>
      {editor && <TaskEditor initial={editor.id ? editor : null} onSave={saveEdit} onCancel={() => setEditor(null)} />}
      {toast && <div className="toast" role="status"><span>✓</span>{toast}</div>}
    </div>
  );
}

export default App;
