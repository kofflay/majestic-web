// ============================================
// ЕДИНЫЙ КОНФИГ ВСЕХ ОТДЕЛОВ LSPD
// ============================================
// 
// Здесь хранятся все данные об отделах:
// - id (используется в коде)
// - name (полное название)
// - roleId / roleId2 (роли для пинга в Discord)
//
// При добавлении нового отдела — добавь строку сюда,
// и он автоматически появится во ВСЕХ формах.
// ============================================

export const DEPARTMENTS = [
  { id: 'af',    name: 'AF' },
  { id: 'iad',   name: 'IAD' },
  { id: 'swat',  name: 'SWAT' },
  { id: 'pai',   name: 'PAI' },
  { id: 'pa',    name: 'PA' },
  { id: 'alpha', name: 'ALPHA' },
  { id: 'dvd',   name: 'DVD' },
  { id: 'db',    name: 'DB' },
  { id: 'k9',    name: 'K9' },
  { id: 'cpd',   name: 'CPD' },
  { id: 'halt',  name: 'HALT' },
  { id: 'ted',   name: 'TED' },
  { id: 'srt',   name: 'SRT' },
  { id: 'nred',  name: 'NRED' },
  { id: 'med',   name: 'MED' }
];

// Отделы, куда НЕЛЬЗЯ переводиться (академия, стажёры и т.п.)
export const DEPARTMENTS_WITHOUT_TRANSFER = ['pa'];

// Отделы, доступные для перевода
export const TRANSFER_DEPARTMENTS = DEPARTMENTS.filter(
  d => !DEPARTMENTS_WITHOUT_TRANSFER.includes(d.id)
);

// Получить отдел по ID
export function getDepartment(id) {
  return DEPARTMENTS.find(d => d.id === id);
}

// Получить вебхук для отчётов отдела (только на сервере)
export function getReportWebhook(id) {
  if (!id) return null;
  return process.env['LV_WEBHOOK_REPORT_' + id.toUpperCase()];
}

// Получить вебхук для переводов в отдел (только на сервере)
export function getTransferWebhook(id) {
  if (!id) return null;
  return process.env['LV_WEBHOOK_TRANSFER_' + id.toUpperCase()];
}

// Получить массив упоминаний ролей для пинга
export function getRoleMentions(id) {
  const dept = getDepartment(id);
  if (!dept) return '';
  let mentions = '';
  const roleId = process.env['LV_DEPARTMENT_ROLE_' + String(id).toUpperCase()];
  if (roleId) mentions += `<@&${roleId}> `;
  return mentions.trim();
}
