import { pages } from './config.js';

function normalizePath(pathname) {
  let p = pathname.replace(/\/index\.html$/, '') || '/';
  if (p !== '/' && p.endsWith('/')) p = p.slice(0, -1);
  return p || '/';
}

export function pathToScreen(pathname) {
  const p = normalizePath(pathname);
  const map = {
    '/': 'overview',
    '/overview': 'overview',
    '/li-run': 'li-run',
    '/li-ideas-bank': 'li-ideas-bank',
    '/li-analytics': 'li-analytics',
    '/li-history': 'li-history',
  };
  return map[p] ?? 'overview';
}

export function screenToPath(screenId) {
  if (screenId === 'overview') return '/overview';
  return '/' + screenId;
}

function applyNavDom(id, btn) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(n => n.classList.remove('active'));
  const screen = document.getElementById('screen-' + id);
  if (screen) screen.classList.add('active');
  let activeBtn = btn;
  if (!activeBtn) activeBtn = document.querySelector('[data-nav="' + id + '"]');
  if (activeBtn) activeBtn.classList.add('active');
  const p = pages[id];
  if (p) {
    const root = document.getElementById('crumb-root');
    const page = document.getElementById('crumb-page');
    if (root) root.textContent = p.root;
    if (page) page.textContent = p.page;
  }
}

export function nav(id, btn) {
  applyNavDom(id, btn);
  history.pushState({ screen: id }, '', screenToPath(id));
}

export function initRouting() {
  const id = pathToScreen(location.pathname);
  const navBtn = document.querySelector('[data-nav="' + id + '"]');
  history.replaceState({ screen: id }, '', screenToPath(id));
  applyNavDom(id, navBtn);
  window.addEventListener('popstate', () => {
    const pid = pathToScreen(location.pathname);
    const b = document.querySelector('[data-nav="' + pid + '"]');
    applyNavDom(pid, b);
  });
}
