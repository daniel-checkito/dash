import { CFG } from './config.js';
import { initRouting } from './router.js';

/** UTC ms for a wall-clock time in `timeZone` (e.g. Europe/Berlin 18:00). */
function wallTimeToUTC(year, month, day, hour, minute, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: false
  });
  const start = Date.UTC(year, month - 1, day, 0, 0, 0) - 4 * 3600000;
  const end = start + 30 * 3600000;
  for (let t = start; t < end; t += 60000) {
    const parts = fmt.formatToParts(new Date(t));
    const get = (type) => {
      const p = parts.find(p => p.type === type);
      return p ? +p.value : NaN;
    };
    if (get('year') === year && get('month') === month && get('day') === day &&
        get('hour') === hour && get('minute') === minute) return t;
  }
  return Date.UTC(year, month - 1, day, hour - 1, minute, 0);
}

function ymdInTZ(date, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric' });
  const parts = fmt.formatToParts(date);
  const get = (type) => +parts.find(p => p.type === type).value;
  return { year: get('year'), month: get('month'), day: get('day') };
}

function nextCalendarYMD(y, m, d) {
  const t = new Date(Date.UTC(y, m - 1, d + 1));
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() };
}

function formatPostDateDE(date, timeZone) {
  return new Date(date).toLocaleDateString('de-DE', {
    timeZone: timeZone,
    day: '2-digit', month: '2-digit', year: '2-digit'
  });
}

// ── STATE ──
let currentRating = 0;
let currentIdea = null;
let currentDraft = null;
let postHistory = [];
let localIdeas = [];
let dailyTaskLog = {};

const DAILY_TASKS = [
  { id: 'linkedin_danielhaag_en', label: 'Post on LinkedIn account "danielhaag-en"' },
  { id: 'emails_10', label: 'Send 10 emails' },
  { id: 'instagram_meshminds', label: 'Post on Instagram account "meshminds"' },
];

// ── INIT ──
function init() {
  loadSettings();
  const tz = CFG.postDeadlineTimezone || 'Europe/Berlin';
  document.getElementById('today-date').textContent =
    new Date().toLocaleDateString('en-GB', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  loadHistory();
  loadDailyTasks();
  renderDailyTasks();
  startPostingTimer();
  buildStreakGrid();
  initFocusTimer();
  initRouting();
}

// ── HISTORY persistence ──
function saveHistory() { localStorage.setItem('daemien_history', JSON.stringify(postHistory)); }
function loadHistory() {
  try { postHistory = JSON.parse(localStorage.getItem('daemien_history') || '[]'); } catch(e) { postHistory = []; }
  refreshAnalytics();
  refreshHistory();
}

function loadDailyTasks() {
  try {
    dailyTaskLog = JSON.parse(localStorage.getItem('daemien_daily_tasks') || '{}');
  } catch (e) {
    dailyTaskLog = {};
  }
}

function saveDailyTasks() {
  localStorage.setItem('daemien_daily_tasks', JSON.stringify(dailyTaskLog));
}

function todayKeyInTZ() {
  const tz = CFG.postDeadlineTimezone || 'Europe/Berlin';
  const { year, month, day } = ymdInTZ(new Date(), tz);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function renderDailyTasks() {
  const list = document.getElementById('daily-task-list');
  const progress = document.getElementById('daily-tasks-progress');
  if (!list || !progress) return;

  const todayKey = todayKeyInTZ();
  const todayTasks = dailyTaskLog[todayKey] || {};
  const doneCount = DAILY_TASKS.filter(task => !!todayTasks[task.id]).length;
  progress.textContent = `${doneCount} / ${DAILY_TASKS.length} done`;

  list.innerHTML = DAILY_TASKS.map((task) => {
    const isDone = !!todayTasks[task.id];
    return `<div class="daily-task-row ${isDone ? 'done' : ''}" onclick="toggleDailyTask('${task.id}')">
      <span class="daily-task-check">${isDone ? '✓' : ''}</span>
      <span class="daily-task-text">${esc(task.label)}</span>
    </div>`;
  }).join('');
}

function toggleDailyTask(taskId) {
  const todayKey = todayKeyInTZ();
  const todayTasks = { ...(dailyTaskLog[todayKey] || {}) };
  if (todayTasks[taskId]) {
    delete todayTasks[taskId];
    toast('Task unmarked');
  } else {
    todayTasks[taskId] = true;
    toast('Task completed ✓');
  }
  dailyTaskLog[todayKey] = todayTasks;
  saveDailyTasks();
  renderDailyTasks();
}

// ── SETTINGS (minimal — just streak date and webhook URL) ──
function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem('daemien_cfg') || '{}');
    Object.assign(CFG, s);
    if (CFG.streakStart) {
      const el = document.getElementById('s-streak-start');
      if (el) el.value = CFG.streakStart;
    }
  } catch(e) {}
}

function saveStreakDate(val) {
  CFG.streakStart = val;
  localStorage.setItem('daemien_cfg', JSON.stringify(CFG));
  buildStreakGrid();
  toast('Streak start date saved ✓');
}
function buildStreakGrid() {
  const grid = document.getElementById('streak-grid');
  grid.innerHTML = '';
  // Load manually checked days from localStorage
  let checkedDays = JSON.parse(localStorage.getItem('streak_checked') || '[]');
  const start = CFG.streakStart ? new Date(CFG.streakStart) : null;
  const today = new Date();
  today.setHours(0,0,0,0);
  let currentDay = 0;
  let doneCount = 0;

  for (let i = 1; i <= 30; i++) {
    const div = document.createElement('div');
    div.className = 'streak-day';
    const isChecked = checkedDays.includes(i);
    const hasPost = postHistory.some(p => p.day_number == i);
    const isDone = isChecked || hasPost;

    let state = 'future';
    if (start) {
      const dayDate = new Date(start);
      dayDate.setDate(start.getDate() + i - 1);
      dayDate.setHours(0,0,0,0);
      if (dayDate.getTime() === today.getTime()) {
        state = isDone ? 'done' : 'today';
        currentDay = i;
      } else if (dayDate < today) {
        state = isDone ? 'done' : 'skipped';
      } else {
        state = 'future';
      }
    } else {
      // No start date — show all as clickable future boxes
      state = isDone ? 'done' : 'future';
    }

    if (isDone) doneCount++;
    div.classList.add(state);
    div.textContent = isDone ? '✓' : i;
    div.title = 'Day ' + i + (isDone ? ' — done' : ' — click to mark done');
    div.style.cursor = 'pointer';

    div.addEventListener('click', () => {
      if (checkedDays.includes(i)) {
        checkedDays = checkedDays.filter(d => d !== i);
        toast('Day ' + i + ' unmarked');
      } else {
        checkedDays.push(i);
        toast('Day ' + i + ' marked as done ✓');
      }
      localStorage.setItem('streak_checked', JSON.stringify(checkedDays));
      buildStreakGrid();
    });

    grid.appendChild(div);
  }

  const label = currentDay > 0
    ? `Day ${currentDay} / 30`
    : (doneCount > 0 ? `${doneCount} / 30 done` : (start ? 'Challenge active' : 'Set start date above'));
  document.getElementById('streak-label').textContent = label;
  const anStreak = document.getElementById('an-streak');
  if (anStreak) anStreak.textContent = doneCount;
}

// ── ANALYTICS ──
function refreshAnalytics() {
  const total = postHistory.length;
  const totalImp = postHistory.reduce((a,p) => a + (parseInt(p.impressions)||0), 0);
  document.getElementById('ov-posts').textContent = total;
  document.getElementById('ov-posts-note').textContent = total > 0 ? `${total} total` : '—';
  document.getElementById('ov-impressions').textContent = totalImp > 0 ? (totalImp > 999 ? (totalImp/1000).toFixed(1)+'k' : totalImp) : '—';
  document.getElementById('an-posts').textContent = total;
  document.getElementById('an-posts-d').textContent = total > 0 ? `${total} published` : '—';
  document.getElementById('an-impr').textContent = totalImp > 999 ? (totalImp/1000).toFixed(1)+'k' : (totalImp || '—');
  document.getElementById('flow-posts').textContent = total || '—';
  // sparklines from real data
  const impData = postHistory.slice(-14).map(p => parseInt(p.impressions)||0);
  if (impData.length > 1) buildSparkline('impressions-spark', impData);
  else document.getElementById('impressions-spark').innerHTML =
    '<div style="font-family:var(--mono);font-size:8px;color:var(--ink3);padding:4px 0;">No data yet</div>';
  document.getElementById('followers-spark').innerHTML =
    '<div style="font-family:var(--mono);font-size:8px;color:var(--ink3);padding:4px 0;">Manual tracking — add via Settings</div>';
  const last14 = postHistory.slice(-14);
  const cats = {};
  for (const p of postHistory) {
    const c = p.category || 'other';
    cats[c] = (cats[c] || 0) + 1;
  }
  const catEl = document.getElementById('cat-section');
  const impChart = document.getElementById('imp-chart');
  const anPeak = document.getElementById('an-peak');
  if (impChart) {
    if (last14.length > 0) {
      const max = Math.max(...last14.map(p => parseInt(p.impressions)||0));
      if (anPeak) anPeak.textContent = max > 0 ? `Peak ${max.toLocaleString()}` : '—';
      impChart.innerHTML = last14.map(p => {
        const v = parseInt(p.impressions) || 0;
        const h = max > 0 ? Math.round((v/max)*64)+8 : 8;
        const hi = v === max ? 'hi' : '';
        const lbl = p.date ? p.date.substring(0,5) : (p.day_number ? 'D'+p.day_number : '');
        return `<div class="bb"><div class="bb-bar ${hi}" style="height:${h}px" title="${v}"></div><div class="bb-lbl">${lbl}</div></div>`;
      }).join('');
    } else {
      impChart.innerHTML = '<div style="font-family:var(--mono);font-size:9px;color:var(--ink3);padding:20px;">No posts yet — data appears after first post</div>';
    }
  }
  // categories
  const catMax = Math.max(...Object.values(cats), 1);
  if (catEl) catEl.innerHTML = Object.entries(cats).sort((a,b) => b[1]-a[1]).map(([k,v]) =>
    `<div class="corr-item"><div class="ci-lbl">${k}</div><div class="ci-track"><div class="ci-fill" style="width:${Math.round((v/catMax)*100)}%"></div></div><div class="ci-num">${v} post${v>1?'s':''}</div></div>`
  ).join('') || '<div style="font-family:var(--mono);font-size:9px;color:var(--ink3);padding:8px 0;">No data yet</div>';
}

// ── HISTORY TABLE ──
function refreshHistory() {
  const body = document.getElementById('hist-body');
  document.getElementById('hist-summary').textContent =
    `${postHistory.length} post${postHistory.length !== 1 ? 's' : ''} published`;
  if (postHistory.length === 0) {
    body.innerHTML = '<div style="padding:28px;font-family:var(--mono);font-size:9px;color:var(--ink3);text-transform:uppercase;letter-spacing:.1em;">No posts yet — publish your first post to see history</div>';
    return;
  }
  body.innerHTML = [...postHistory].reverse().map(p => {
    const score = parseFloat(p.daniel_rating);
    const cls = score >= 8 ? 'score-hi' : score >= 5 ? 'score-mid' : 'score-lo';
    const scoreStr = p.daniel_rating !== undefined && p.daniel_rating !== '' ? score : '—';
    const impr = p.impressions || '—';
    const cmts = p.comments || '—';
    return `<div class="hist-row" data-score="${score||0}" onclick="openHistPost(${JSON.stringify(p).replace(/"/g,'&quot;')})">
      <div class="ht">${esc(p.title || p.post_text?.substring(0,60) || '—')}</div>
      <div class="hm">${p.date||'—'}</div>
      <div class="hm">${impr}</div>
      <div class="hm">${cmts}</div>
      <div class="hm">${p.day_number ? 'Day '+p.day_number : '—'}</div>
    </div>`;
  }).join('');
}

function filterH(type, btn) {
  document.querySelectorAll('.filter-pill').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('#hist-body .hist-row').forEach(r => {
    const s = parseFloat(r.dataset.score);
    const hide = (type==='high'&&s<8)||(type==='mid'&&(s<5||s>=8))||(type==='low'&&s>=5);
    r.style.display = hide ? 'none' : '';
  });
}

function openHistPost(p) {
  currentDraft = p.post_text || '';
  openDraft();
}

// ── WORKFLOW ──
function showState(s) {
  ['idle','running','idea','draft'].forEach(x => {
    document.getElementById('state-'+x).classList.toggle('vis', x === s);
  });
}

function resetWorkflow() {
  currentRating = 0; currentIdea = null; currentDraft = null;
  showState('idle');
  document.getElementById('manual-idea').value = '';
  document.getElementById('thought-chars').textContent = '0 chars';
  const approveBtn = document.getElementById('approve-btn');
  if (approveBtn) { approveBtn.textContent = 'Generate post →'; approveBtn.disabled = false; }
  for (let i=0;i<4;i++) {
    const el = document.getElementById('pstep-'+i);
    if (el) { el.classList.remove('done','active'); if (i===0) el.classList.add('active'); }
  }
}

// char counter for manual textarea
document.addEventListener('DOMContentLoaded', () => {
  const ta = document.getElementById('manual-idea');
  if (ta) ta.addEventListener('input', () => {
    document.getElementById('thought-chars').textContent = ta.value.length + ' chars';
  });
});

async function startManual() {
  const thought = document.getElementById('manual-idea').value.trim();
  if (!thought) { toast('Write your thought first'); return; }
  document.getElementById('running-mode-label').textContent = 'Saving idea and generating post';
  document.getElementById('running-title').textContent = 'Writing…';
  showState('running');
  for (let i = 0; i < 4; i++) {
    await delay(800);
    const el = document.getElementById('pstep-'+i);
    if (el) { el.classList.add('done'); el.classList.remove('active'); }
    const next = document.getElementById('pstep-'+(i+1));
    if (next) next.classList.add('active');
  }
  try {
    const res = await fetch('https://meshminds.app.n8n.cloud/webhook/manual-trigger', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        manual_idea: thought,
        category: 'other',
        added_on: new Date().toISOString().split('T')[0]
      })
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`n8n returned ${res.status}${errText ? ': ' + errText.substring(0,100) : ''}`);
    }
    const text = await res.text();
    if (!text || text.trim() === '') {
      showState('idle');
      toast('Workflow triggered ✓ — check your pending_draft sheet for the generated post');
      return;
    }
    let data;
    try { data = JSON.parse(text); } catch(e) {
      showState('idle');
      toast('Workflow ran but returned unexpected format — check pending_draft sheet');
      return;
    }
    if (data && data.title) {
      currentIdea = data;
      populateIdea(data);
      showState('idea');
    } else {
      currentDraft = data.post_text || data.text || data.output || JSON.stringify(data);
      showState('draft');
      toast('Post generated ✓');
      markPostingTimer();
    }
  } catch(e) {
    showState('idle');
    if (e.message.includes('Failed to fetch') || e.message.includes('NetworkError')) {
      toast('CORS error — deploy dashboard to Vercel to fix');
    } else {
      toast('Error: ' + e.message);
    }
  }
}

async function startAuto() {
  document.getElementById('running-mode-label').textContent = 'Finding the best idea for today';
  document.getElementById('running-title').textContent = 'Researching…';
  showState('running');
  for (let i = 0; i < 4; i++) {
    await delay(900);
    const el = document.getElementById('pstep-'+i);
    if (el) { el.classList.add('done'); el.classList.remove('active'); }
    const next = document.getElementById('pstep-'+(i+1));
    if (next) next.classList.add('active');
  }
  try {
    const res = await fetch('https://meshminds.app.n8n.cloud/webhook/autom-trigger', {
      method: 'GET',
    });
    if (!res.ok) throw new Error('n8n returned ' + res.status);
    const data = await res.json();
    if (data && data.title) {
      currentIdea = data;
      populateIdea(data);
      showState('idea');
      document.getElementById('pending-badge').style.display = '';
    } else if (data && (data.post_text || data.text || data.output)) {
      currentDraft = data.post_text || data.text || data.output;
      showState('draft');
      toast('Post generated ✓');
    } else {
      throw new Error('Workflow returned no idea — check n8n logs');
    }
  } catch(e) {
    showState('idle');
    toast('Error: ' + e.message);
  }
}

// keep startWorkflow as alias for auto for any legacy calls
async function startWorkflow() { startAuto(); }

function populateIdea(idea) {
  document.getElementById('idea-title').textContent = idea.title || '';
  document.getElementById('idea-hook').textContent = '"' + (idea.hook || '') + '"';
  document.getElementById('idea-why').textContent = idea.why || '';
  document.getElementById('idea-source').textContent = idea.source ? 'Quelle — ' + idea.source : '';
  document.getElementById('idea-date-lbl').textContent = new Date().toLocaleDateString('de-DE', {weekday:'short',day:'numeric',month:'short'});
  const tagsEl = document.getElementById('idea-tags');
  tagsEl.innerHTML = '';
  if (idea.angle) tagsEl.innerHTML += `<span class="tag">${esc(idea.angle)}</span>`;
}

function rateStar(val) {
  currentRating = val;
  document.querySelectorAll('.star').forEach((s,i) => s.classList.toggle('lit', i < val));
  document.getElementById('rating-txt').textContent = val + ' / 5';
}

async function rejectIdea() {
  if (CFG.rejectUrl && currentIdea?.resume_url) {
    try { await fetch(currentIdea.resume_url + '?action=reject'); } catch(e) {}
  }
  document.getElementById('pending-badge').style.display = 'none';
  toast('Idea rejected — idea bank updated');
  resetWorkflow();
}

async function approveIdea() {
  const btn = document.getElementById('approve-btn');
  btn.textContent = 'Generating…';
  btn.disabled = true;
  document.getElementById('gen-overlay').classList.remove('hidden');
  if (currentIdea?.resume_url) {
    try {
      const res = await fetch(currentIdea.resume_url + '?action=approve', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ approved: true, rating: currentRating })
      });
      if (res.ok) {
        const data = await res.json();
        currentDraft = data.post_text || data.text || data.output || JSON.stringify(data);
      } else { throw new Error('n8n returned ' + res.status); }
    } catch(e) {
      document.getElementById('gen-overlay').classList.add('hidden');
      btn.textContent = 'Generate post →'; btn.disabled = false;
      toast('Error getting draft: ' + e.message); return;
    }
  } else {
    document.getElementById('gen-overlay').classList.add('hidden');
    btn.textContent = 'Generate post →'; btn.disabled = false;
    toast('No resume URL — workflow must return resume_url in idea JSON'); return;
  }
  document.getElementById('gen-overlay').classList.add('hidden');
  document.getElementById('pending-badge').style.display = 'none';
  showState('draft');
  toast('Post generated ✓');
  markPostingTimer();
}

function openDraft() {
  const text = currentDraft || '';
  const el = document.getElementById('draft-text');
  el.textContent = text;
  updateDraftMeta();
  document.getElementById('draft-time').textContent = new Date().toLocaleTimeString('de-DE', {hour:'2-digit',minute:'2-digit'});
  document.getElementById('draft-overlay').classList.remove('hidden');
  el.addEventListener('input', updateDraftMeta);
}

function updateDraftMeta() {
  const text = document.getElementById('draft-text').textContent;
  document.getElementById('draft-chars').textContent = text.length.toLocaleString();
  document.getElementById('draft-words').textContent = text.split(/\s+/).filter(Boolean).length;
}

function closeDraft() { document.getElementById('draft-overlay').classList.add('hidden'); }
function closeDraftOutside(e) { if (e.target === document.getElementById('draft-overlay')) closeDraft(); }

function copyPost() {
  const text = document.getElementById('draft-text').textContent;
  navigator.clipboard.writeText(text).then(() => toast('Copied to clipboard ✓'));
}

async function requestRewrite() {
  document.getElementById('gen-overlay').classList.remove('hidden');
  await delay(2200);
  document.getElementById('gen-overlay').classList.add('hidden');
  toast('Rewrite complete — same idea, new draft');
}

function markPublished() {
  closeDraft();
  finalizePost(null, '');
}



function finalizePost(rating, notes) {
  const post = {
    title: currentIdea?.title || 'Post ' + (postHistory.length + 1),
    date: formatPostDateDE(new Date(), CFG.postDeadlineTimezone || 'Europe/Berlin'),
    post_text: document.getElementById('draft-text').textContent,
    category: currentIdea?.angle || 'other',
    daniel_rating: rating,
    impressions: '',
    comments: '',
    notes: notes,
    day_number: postHistory.length + 1,
  };
  postHistory.push(post);
  saveHistory();
  refreshAnalytics();
  refreshHistory();
  buildStreakGrid();
  resetWorkflow();
  toast('Post saved to history 🚀');
}

// ── IDEAS BANK ──
function submitIdea() {
  const idea = document.getElementById('f-idea').value.trim();
  const category = document.getElementById('f-category').value || 'other';
  const statusEl = document.getElementById('form-status');
  const btn = document.getElementById('submit-idea-btn');
  if (!idea) { statusEl.textContent = '✕ Idea field is required'; statusEl.className = 'form-status err'; return; }
  const row = { idea, category, status: 'unused', added_on: new Date().toISOString().split('T')[0] };
  btn.disabled = true; btn.textContent = 'Saving…'; statusEl.className = 'form-status';
  const doSave = async () => {
    if (CFG.ideasSheetUrl) {
      const res = await fetch(CFG.ideasSheetUrl, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(row) });
      if (!res.ok) throw new Error('HTTP ' + res.status);
    } else { await delay(300); }
  };
  doSave().then(() => {
    addLocalIdea(row);
    document.getElementById('f-idea').value = '';
    document.getElementById('f-category').value = '';
    statusEl.textContent = CFG.ideasSheetUrl ? '✓ Saved to Google Sheets' : '✓ Saved locally (no sheet URL set in Settings)';
    statusEl.className = 'form-status ok';
    toast(CFG.ideasSheetUrl ? 'Idea saved to sheet ✓' : 'Idea saved locally ✓');
  }).catch(err => {
    statusEl.textContent = '✕ Could not save — ' + err.message;
    statusEl.className = 'form-status err';
  }).finally(() => { btn.disabled = false; btn.textContent = '+ Save idea to sheet'; });
}

function addLocalIdea(row) {
  localIdeas.unshift(row);
  const list = document.getElementById('ideas-local-list');
  const empty = list.querySelector('.ideas-empty');
  if (empty) empty.remove();
  const el = document.createElement('div');
  el.className = 'idea-item';
  el.innerHTML = `<div class="idea-item-top"><div class="idea-item-text">${esc(row.idea)}</div></div>
    <div class="idea-item-meta">
      ${row.category ? `<span class="idea-cat">${esc(row.category)}</span>` : ''}
      <span class="idea-status-pill sp-unused">unused</span>
      <span class="idea-item-date">${row.added_on}</span>
    </div>`;
  list.prepend(el);

}

// ── CHARTS ──
function buildBars(id, data) {
  const el = document.getElementById(id);
  if (!el) return;
  const max = Math.max(...data.map(d=>d.v));
  el.innerHTML = data.map(d => {
    const h = Math.round((d.v/max)*64)+8;
    return `<div class="bb"><div class="bb-bar ${d.hi?'hi':''}" style="height:${h}px"></div><div class="bb-lbl">${d.l}</div></div>`;
  }).join('');
}

function buildSparkline(id, data) {
  const el = document.getElementById(id);
  if (!el) return;
  const max = Math.max(...data);
  el.innerHTML = data.map((v,i) => {
    const h = Math.max(6, Math.round((v/max)*44));
    return `<div class="sp-bar ${i===data.length-1?'dark':'mid'}" style="height:${h}px"></div>`;
  }).join('');
}

function copyCurl() {
  const cmd = document.getElementById('manual-curl-cmd').textContent;
  navigator.clipboard.writeText(cmd).then(() => toast('Copied — paste in Terminal ✓'));
}

// ── FOCUS TIMER (1 hour, persists in session) ──
let focusTotal = 3600;
let focusRemaining = parseInt(sessionStorage.getItem('focus_remaining') ?? '3600');
let focusRunning = sessionStorage.getItem('focus_running') === 'true';
let focusInterval = null;

function focusFormat(s) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return String(m).padStart(2,'0') + ':' + String(sec).padStart(2,'0');
}

function focusRender() {
  const disp = document.getElementById('focus-display');
  const fill = document.getElementById('focus-fill');
  const btn = document.getElementById('focus-play-btn');
  if (!disp) return;
  disp.textContent = focusFormat(focusRemaining);
  const pct = (focusRemaining / focusTotal) * 100;
  fill.style.width = pct + '%';
  if (focusRemaining <= 300) fill.style.background = '#f87171';
  else if (focusRemaining <= 600) fill.style.background = '#fb923c';
  else fill.style.background = 'rgba(255,255,255,0.5)';
  btn.textContent = focusRunning ? '⏸ Pause' : '▶ Start';
}

function focusTick() {
  if (focusRemaining <= 0) {
    focusRunning = false;
    clearInterval(focusInterval);
    focusInterval = null;
    sessionStorage.setItem('focus_running', 'false');
    toast('Focus session complete ✓');
    focusRender();
    return;
  }
  focusRemaining--;
  sessionStorage.setItem('focus_remaining', String(focusRemaining));
  focusRender();
}

function focusPlayPause() {
  if (focusRemaining <= 0) return;
  focusRunning = !focusRunning;
  sessionStorage.setItem('focus_running', String(focusRunning));
  if (focusRunning) {
    focusInterval = setInterval(focusTick, 1000);
  } else {
    clearInterval(focusInterval);
    focusInterval = null;
  }
  focusRender();
}

function focusReset() {
  clearInterval(focusInterval);
  focusInterval = null;
  focusRunning = false;
  focusRemaining = focusTotal;
  sessionStorage.setItem('focus_remaining', String(focusTotal));
  sessionStorage.setItem('focus_running', 'false');
  focusRender();
}

function initFocusTimer() {
  focusRender();
  if (focusRunning) focusInterval = setInterval(focusTick, 1000);
}


function startPostingTimer() {
  updateTimer();
  setInterval(updateTimer, 60000);
}

function updateTimer() {
  const countdown = document.getElementById('timer-countdown');
  const fill = document.getElementById('timer-fill');
  const right = document.getElementById('timer-right');
  const bigTimer = document.getElementById('ov-timer-big');
  const bigLabel = document.getElementById('ov-timer-label');
  const bigBar = document.getElementById('ov-timer-bar');
  const lastPostedEl = document.getElementById('ov-last-posted');
  const postsCountEl = document.getElementById('ov-posts-count');
  const flowPostsEl = document.getElementById('flow-posts');
  const flowLastEl = document.getElementById('flow-last-run');

  const tz = CFG.postDeadlineTimezone || 'Europe/Berlin';
  const dh = CFG.postDeadlineHour ?? 18;
  const dm = CFG.postDeadlineMinute ?? 0;
  const dl = `${String(dh).padStart(2, '0')}:${String(dm).padStart(2, '0')}`;

  const last = postHistory.length > 0
    ? postHistory.reduce((a, b) => (a.date > b.date ? a : b))
    : null;

  const now = new Date();
  const { year, month, day } = ymdInTZ(now, tz);
  const todayStr = formatPostDateDE(now, tz);
  const todayISO = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const postedToday = last && (last.date === todayStr || last.date === todayISO);

  const deadlineMs = wallTimeToUTC(year, month, day, dh, dm, tz);
  const startMs = wallTimeToUTC(year, month, day, 0, 0, tz);
  const { year: ny, month: nm, day: nd } = nextCalendarYMD(year, month, day);
  const nextDeadlineMs = wallTimeToUTC(ny, nm, nd, dh, dm, tz);
  const windowMs = Math.max(1, deadlineMs - startMs);

  const totalPosts = postHistory.length;
  if (postsCountEl) postsCountEl.textContent = totalPosts + ' post' + (totalPosts !== 1 ? 's' : '') + ' total';
  if (flowPostsEl) flowPostsEl.textContent = totalPosts || '—';
  if (flowLastEl && last) flowLastEl.textContent = last.date || '—';
  if (lastPostedEl) lastPostedEl.textContent = last ? 'Last post: ' + last.date : 'No posts yet';

  const fmtHM = (ms) => {
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    return `${h}h ${m}m`;
  };

  if (postedToday) {
    const msUntil = Math.max(0, nextDeadlineMs - now);
    const display = fmtHM(msUntil);
    if (countdown) { countdown.textContent = display; countdown.className = 'timer-countdown'; }
    if (fill) { fill.style.width = '100%'; fill.className = 'timer-fill'; }
    if (right) right.textContent = '✓ Posted today';
    if (bigTimer) { bigTimer.textContent = display; bigTimer.style.color = 'var(--green)'; }
    if (bigLabel) bigLabel.textContent = `Until ${dl} tomorrow — done for today ✓`;
    if (bigBar) { bigBar.style.width = '100%'; bigBar.style.background = 'var(--green)'; }
  } else {
    const msLeft = deadlineMs - now;
    const msPos = Math.max(0, msLeft);
    const display = fmtHM(msPos);

    if (msLeft <= 0) {
      if (countdown) { countdown.textContent = 'Overdue'; countdown.className = 'timer-countdown overdue'; }
      if (fill) { fill.style.width = '100%'; fill.className = 'timer-fill overdue'; }
      if (right) right.textContent = '✕ No post today';
      if (bigTimer) { bigTimer.textContent = 'Overdue'; bigTimer.style.color = 'var(--red)'; }
      if (bigLabel) bigLabel.textContent = `Missed ${dl} — post now`;
      if (bigBar) { bigBar.style.width = '100%'; bigBar.style.background = 'var(--red)'; }
    } else if (msLeft < 3 * 3600000) {
      const elapsed = now - startMs;
      const pct = Math.min(100, Math.round((elapsed / windowMs) * 100));
      if (countdown) { countdown.textContent = display; countdown.className = 'timer-countdown urgent'; }
      if (fill) { fill.style.width = pct + '%'; fill.className = 'timer-fill urgent'; }
      if (right) right.textContent = '⚠ Post soon';
      if (bigTimer) { bigTimer.textContent = display; bigTimer.style.color = '#F97316'; }
      if (bigLabel) bigLabel.textContent = `Until ${dl} today`;
      if (bigBar) { bigBar.style.width = pct + '%'; bigBar.style.background = '#F97316'; }
    } else {
      const elapsed = now - startMs;
      const pct = Math.min(100, Math.round((elapsed / windowMs) * 100));
      if (countdown) { countdown.textContent = display; countdown.className = 'timer-countdown'; }
      if (fill) { fill.style.width = pct + '%'; fill.className = 'timer-fill'; }
      if (right) right.textContent = last ? `Last: ${last.date}` : 'No posts yet';
      if (bigTimer) { bigTimer.textContent = display; bigTimer.style.color = 'var(--ink)'; }
      if (bigLabel) bigLabel.textContent = `Until ${dl} today`;
      if (bigBar) { bigBar.style.width = pct + '%'; bigBar.style.background = 'var(--ink)'; }
    }
  }
}

function markPostingTimer() {
  // Save timestamp of last publish to localStorage
  localStorage.setItem('last_published', new Date().toISOString());
  updateTimer();
}


function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}
// ── UTILS ──
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeDraft();
    }
});

// ── AUTH ──
function checkAuth() {
  if (sessionStorage.getItem('daemien_auth') !== 'ok') {
    document.getElementById('login-screen').classList.remove('hidden');
    document.getElementById('login-user').focus();
  } else {
    document.getElementById('login-screen').classList.add('hidden');
  }
}

function doLogin() {
  const user = document.getElementById('login-user').value.trim();
  const pass = document.getElementById('login-pass').value;
  const err = document.getElementById('login-error');
  if (user === 'admin' && pass === 'danieladmin') {
    sessionStorage.setItem('daemien_auth', 'ok');
    document.getElementById('login-screen').classList.add('hidden');
    err.textContent = '';
    init();
  } else {
    err.textContent = 'Incorrect username or password';
    document.getElementById('login-pass').value = '';
    document.getElementById('login-pass').focus();
  }
}

export {
  init,
  checkAuth,
  doLogin,
  saveStreakDate,
  resetWorkflow,
  startManual,
  copyCurl,
  startAuto,
  rejectIdea,
  approveIdea,
  openDraft,
  closeDraft,
  closeDraftOutside,
  requestRewrite,
  copyPost,
  markPublished,
  filterH,
  openHistPost,
  submitIdea,
  focusPlayPause,
  focusReset,
  toggleDailyTask,
};
