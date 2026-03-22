export const CFG = {
  triggerUrl: 'https://meshminds.app.n8n.cloud/webhook/autom-trigger',
  manualUrl: 'https://meshminds.app.n8n.cloud/webhook/manual-trigger',
  approveUrl: '',
  rejectUrl: '',
  ideasSheetUrl: '',
  streakStart: null,
  /** Daily post deadline (wall clock in `postDeadlineTimezone`) */
  postDeadlineHour: 18,
  postDeadlineMinute: 0,
  postDeadlineTimezone: 'Europe/Berlin',
};

export const pages = {
  overview: { root: 'Workspace', page: 'Overview' },
  'li-run': { root: 'LinkedIn', page: 'Run Workflow' },
  'li-ideas-bank': { root: 'LinkedIn', page: 'My Ideas' },
  'li-analytics': { root: 'LinkedIn', page: 'Analytics' },
  'li-history': { root: 'LinkedIn', page: 'History' },
};
