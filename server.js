/**
 * Сервис форм отклика для студентов (Тестовое задание)
 * Стек: Node.js 20+, Express, EJS, Tailwind CSS, JSON-база данных (db.json)
 */

import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'db.json');

// Safe Markdown and text formatter (links, bold, lists, linebreaks)
function renderMarkdown(text) {
  if (!text) return '';
  // 1. Escape HTML
  let escaped = String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // 2. Bold: **text** or __text__
  escaped = escaped.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  escaped = escaped.replace(/__(.*?)__/g, '<strong>$1</strong>');

  // 3. Italic: *text* or _text_
  escaped = escaped.replace(/\*(.*?)\*/g, '<em>$1</em>');
  escaped = escaped.replace(/_(.*?)_/g, '<em>$1</em>');

  // 4. Inline code: `code`
  escaped = escaped.replace(/`([^`]+)`/g, '<code class="bg-slate-100 text-slate-800 px-1.5 py-0.5 rounded text-xs font-mono border border-slate-200">$1</code>');

  // 5. Links: [label](url)
  escaped = escaped.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-indigo-600 hover:text-indigo-800 underline font-medium">$1</a>');

  // 6. Lists and paragraphs
  const lines = escaped.split(/\r?\n/);
  let html = '';
  let inList = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (/^[-*•]\s+(.*)$/.test(line)) {
      if (!inList) {
        html += '<ul class="list-disc list-inside space-y-1 my-2 text-slate-700">';
        inList = true;
      }
      const item = line.replace(/^[-*•]\s+/, '');
      html += `<li>${item}</li>`;
    } else {
      if (inList) {
        html += '</ul>';
        inList = false;
      }
      if (line === '') {
        html += '<div class="h-2"></div>';
      } else {
        html += `<p class="leading-relaxed mb-1">${line}</p>`;
      }
    }
  }
  if (inList) html += '</ul>';
  return html;
}

// Check if form deadline has passed
function isFormExpired(form) {
  if (!form || !form.deadline) return false;
  const deadlineDate = new Date(form.deadline);
  return !isNaN(deadlineDate.getTime()) && new Date() > deadlineDate;
}

// Helper labels for candidate statuses
const STATUS_LABELS = {
  new: 'Новый',
  reviewing: 'На рассмотрении',
  invited: 'Приглашен',
  rejected: 'Отказ'
};

// Express and View Engine setup
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.locals.renderMarkdown = renderMarkdown;
app.locals.isFormExpired = isFormExpired;
app.locals.STATUS_LABELS = STATUS_LABELS;

app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Database helper functions (JSON in root per requirements)
function getDb() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      const initialDb = { forms: [], responses: [] };
      fs.writeFileSync(DB_FILE, JSON.stringify(initialDb, null, 2), 'utf8');
      return initialDb;
    }
    const data = fs.readFileSync(DB_FILE, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error('Error reading db.json:', err);
    return { forms: [], responses: [] };
  }
}

function saveDb(data) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('Error writing db.json:', err);
    return false;
  }
}

// Helper to determine base URL
function getBaseUrl(req) {
  if (process.env.APP_URL) {
    return process.env.APP_URL.replace(/\/$/, '');
  }
  const host = req.get('host') || `localhost:${PORT}`;
  const protocol = req.protocol || 'http';
  return `${protocol}://${host}`;
}

// ----------------------------------------------------
// 1. Главный редирект на /admin
// ----------------------------------------------------
app.get('/', (req, res) => {
  res.redirect('/admin');
});

// ----------------------------------------------------
// 2. /admin (Панель менеджера)
// ----------------------------------------------------
app.get('/admin', (req, res) => {
  const db = getDb();
  let forms = db.forms || [];
  const responses = db.responses || [];

  // Ensure default author, status and deadline for forms
  forms.forEach(f => {
    if (!f.author) f.author = 'HR-менеджер';
    if (!f.status) f.status = 'active';
  });

  // Group responses by formId for quick counting
  const responsesByForm = {};
  responses.forEach(r => {
    if (!responsesByForm[r.formId]) {
      responsesByForm[r.formId] = [];
    }
    responsesByForm[r.formId].push(r);
  });

  // Filter by author/manager if specified
  const authorFilter = req.query.author || 'all';
  const filteredForms = authorFilter === 'all' 
    ? forms 
    : forms.filter(f => (f.author || '').toLowerCase() === authorFilter.toLowerCase());

  // Collect distinct authors for filter dropdown
  const authors = Array.from(new Set(forms.map(f => f.author || 'HR-менеджер'))).filter(Boolean);

  const totalResponses = responses.length;
  const totalViews = forms.reduce((acc, f) => acc + (f.views || 0), 0);
  const overallConversion = totalViews > 0 ? Math.round((totalResponses / totalViews) * 100) : 0;

  res.render('admin', {
    forms: filteredForms,
    allFormsCount: forms.length,
    authors,
    currentAuthor: authorFilter,
    responsesByForm,
    totalResponses,
    totalViews,
    overallConversion,
    baseUrl: getBaseUrl(req),
    query: req.query
  });
});

// ----------------------------------------------------
// 3. /admin/forms/new (Конструктор новой формы)
// ----------------------------------------------------
app.get('/admin/forms/new', (req, res) => {
  res.render('new_form', {
    baseUrl: getBaseUrl(req)
  });
});

// ----------------------------------------------------
// 4. POST /admin/forms (Сохранение новой формы)
// ----------------------------------------------------
app.post('/admin/forms', (req, res) => {
  const { title, description, category, author, deadline, questionsJson } = req.body;

  if (!title || !title.trim()) {
    return res.status(400).send('Название формы обязательно');
  }

  let questions = [];
  try {
    questions = questionsJson ? JSON.parse(questionsJson) : [];
  } catch (err) {
    console.error('Error parsing questions JSON:', err);
  }

  // Fallback: if questions array is empty, provide a default name question
  if (questions.length === 0) {
    questions = [
      {
        id: 'q_' + crypto.randomUUID().substring(0, 8),
        label: 'Ваше ФИО',
        type: 'text',
        required: true,
        placeholder: 'Иван Иванов'
      }
    ];
  }

  // Ensure each question has a clean structure
  const sanitizedQuestions = questions.map((q, index) => ({
    id: q.id || `q_${index}_${crypto.randomUUID().substring(0, 6)}`,
    label: (q.label || '').trim(),
    type: q.type || 'text',
    required: Boolean(q.required),
    placeholder: (q.placeholder || '').trim(),
    options: Array.isArray(q.options) ? q.options.filter(o => o && o.trim()) : []
  }));

  const newForm = {
    id: 'f_' + crypto.randomUUID().substring(0, 8),
    title: title.trim(),
    description: (description || '').trim(),
    category: (category || 'Стажировка').trim(),
    author: (author || 'HR-менеджер').trim(),
    deadline: deadline && deadline.trim() ? deadline.trim() : null,
    status: 'active', // 'active' | 'paused'
    createdAt: new Date().toISOString(),
    views: 0,
    questions: sanitizedQuestions
  };

  const db = getDb();
  if (!db.forms) db.forms = [];
  db.forms.unshift(newForm);
  saveDb(db);

  res.redirect('/admin?created=1');
});

// ----------------------------------------------------
// 5. GET /admin/forms/:id/edit (Страница редактирования формы)
// ----------------------------------------------------
app.get('/admin/forms/:id/edit', (req, res) => {
  const formId = req.params.id;
  const db = getDb();

  const form = (db.forms || []).find(f => f.id === formId);
  if (!form) return res.redirect('/admin');

  res.render('edit_form', {
    form,
    baseUrl: getBaseUrl(req)
  });
});

// ----------------------------------------------------
// 6. POST /admin/forms/:id/edit (Сохранение изменений формы)
// ----------------------------------------------------
app.post('/admin/forms/:id/edit', (req, res) => {
  const formId = req.params.id;
  const { title, description, category, author, deadline, questionsJson } = req.body;

  if (!title || !title.trim()) {
    return res.status(400).send('Название формы обязательно');
  }

  const db = getDb();
  const form = (db.forms || []).find(f => f.id === formId);
  if (!form) return res.redirect('/admin');

  let questions = [];
  try {
    questions = questionsJson ? JSON.parse(questionsJson) : form.questions || [];
  } catch (err) {
    console.error('Error parsing questions JSON:', err);
    questions = form.questions || [];
  }

  // Ensure each question has a clean structure
  const sanitizedQuestions = questions.map((q, index) => ({
    id: q.id || `q_${index}_${crypto.randomUUID().substring(0, 6)}`,
    label: (q.label || '').trim(),
    type: q.type || 'text',
    required: Boolean(q.required),
    placeholder: (q.placeholder || '').trim(),
    options: Array.isArray(q.options) ? q.options.filter(o => o && o.trim()) : []
  }));

  form.title = title.trim();
  form.description = (description || '').trim();
  form.category = (category || 'Стажировка').trim();
  form.author = (author || 'HR-менеджер').trim();
  form.deadline = deadline && deadline.trim() ? deadline.trim() : null;
  form.questions = sanitizedQuestions;
  form.updatedAt = new Date().toISOString();

  saveDb(db);

  res.redirect('/admin?updated=1');
});

// ----------------------------------------------------
// 7. POST /admin/forms/:id/toggle-status (Приостановка / возобновление приема)
// ----------------------------------------------------
app.post('/admin/forms/:id/toggle-status', (req, res) => {
  const formId = req.params.id;
  const db = getDb();
  const form = (db.forms || []).find(f => f.id === formId);

  if (form) {
    form.status = form.status === 'paused' ? 'active' : 'paused';
    saveDb(db);
  }

  res.redirect('/admin?status_changed=1');
});

// ----------------------------------------------------
// 8. POST /admin/forms/:id/delete (Свободное удаление формы)
// ----------------------------------------------------
app.post('/admin/forms/:id/delete', (req, res) => {
  const formId = req.params.id;
  const db = getDb();

  db.forms = (db.forms || []).filter(f => f.id !== formId);
  db.responses = (db.responses || []).filter(r => r.formId !== formId);
  saveDb(db);

  res.redirect('/admin?deleted=1');
});

// ----------------------------------------------------
// 7. /admin/forms/:id/responses (Просмотр ответов студентов)
// ----------------------------------------------------
app.get('/admin/forms/:id/responses', (req, res) => {
  const formId = req.params.id;
  const db = getDb();

  const form = (db.forms || []).find(f => f.id === formId);
  if (!form) {
    return res.status(404).render('partials/header', { title: 'Форма не найдена' }) + 
      '<div class="p-8 text-center"><h1 class="text-xl font-bold">Форма не найдена</h1><a href="/admin" class="text-indigo-600 underline">В панель</a></div>';
  }

  const responses = (db.responses || [])
    .filter(r => r.formId === formId)
    .map(r => ({
      ...r,
      status: r.status || 'new' // ensure candidate status is set
    }))
    .sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));

  res.render('form_responses', {
    form,
    responses,
    baseUrl: getBaseUrl(req),
    query: req.query
  });
});

// ----------------------------------------------------
// 8. POST /admin/responses/:id/status (Обновление статуса кандидата)
// ----------------------------------------------------
app.post('/admin/responses/:id/status', (req, res) => {
  const responseId = req.params.id;
  const { status } = req.body;

  const validStatuses = ['new', 'reviewing', 'invited', 'rejected'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ success: false, message: 'Неверный статус' });
  }

  const db = getDb();
  const resp = (db.responses || []).find(r => r.id === responseId);

  if (!resp) {
    return res.status(404).json({ success: false, message: 'Отклик не найден' });
  }

  resp.status = status;
  saveDb(db);

  return res.json({ 
    success: true, 
    status, 
    label: STATUS_LABELS[status] || status 
  });
});

// ----------------------------------------------------
// 8b. POST /admin/responses/:id/delete (Удаление отдельного отклика кандидата)
// ----------------------------------------------------
app.post('/admin/responses/:id/delete', (req, res) => {
  const responseId = req.params.id;
  const db = getDb();

  const resp = (db.responses || []).find(r => r.id === responseId);
  const formId = resp ? resp.formId : null;

  db.responses = (db.responses || []).filter(r => r.id !== responseId);
  saveDb(db);

  if (formId) {
    res.redirect(`/admin/forms/${formId}/responses?deleted_resp=1`);
  } else {
    res.redirect('/admin');
  }
});

// ----------------------------------------------------
// 9. /admin/forms/:id/export.csv (Экспорт ответов в CSV)
// ----------------------------------------------------
app.get('/admin/forms/:id/export.csv', (req, res) => {
  const formId = req.params.id;
  const db = getDb();

  const form = (db.forms || []).find(f => f.id === formId);
  if (!form) return res.status(404).send('Форма не найдена');

  const responses = (db.responses || []).filter(r => r.formId === formId);

  // Build CSV header with UTF-8 BOM for Excel
  const questions = form.questions || [];
  const headerCols = ['ID отклика', 'Дата и время', 'Статус кандидата', ...questions.map(q => q.label)];
  
  const escapeCsv = (val) => {
    if (val === undefined || val === null) return '""';
    let text = Array.isArray(val) ? val.join('; ') : String(val);
    text = text.replace(/"/g, '""');
    return `"${text}"`;
  };

  const rows = responses.map(r => {
    const dateStr = new Date(r.submittedAt).toLocaleString('ru-RU');
    const statusLabel = STATUS_LABELS[r.status] || 'Новый';
    const cols = [
      escapeCsv(r.id),
      escapeCsv(dateStr),
      escapeCsv(statusLabel),
      ...questions.map(q => escapeCsv(r.answers[q.id]))
    ];
    return cols.join(',');
  });

  const csvContent = '\uFEFF' + [headerCols.map(escapeCsv).join(','), ...rows].join('\r\n');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="responses_${formId}.csv"`);
  res.send(csvContent);
});

// ----------------------------------------------------
// 10. /forms/:id (Публичная страница формы для студента)
// ----------------------------------------------------
app.get('/forms/:id', (req, res) => {
  const formId = req.params.id;
  const db = getDb();

  const form = (db.forms || []).find(f => f.id === formId);
  if (!form) {
    return res.status(404).send(`
      <!DOCTYPE html>
      <html lang="ru"><head><meta charset="utf-8"><script src="https://cdn.tailwindcss.com"></script><title>Форма не найдена</title></head>
      <body class="bg-slate-50 flex items-center justify-center min-h-screen text-slate-800 p-4">
        <div class="bg-white p-8 rounded-xl border border-slate-200 text-center max-w-md shadow-sm">
          <div class="text-3xl mb-2">🔍</div>
          <h1 class="text-xl font-bold text-slate-900 mb-2">Форма не найдена</h1>
          <p class="text-sm text-slate-500">Возможно, ссылка устарела или анкета была удалена организатором.</p>
        </div>
      </body>
      </html>
    `);
  }

  const isExpired = isFormExpired(form);

  // Increment view counter only if active and not expired
  if (form.status !== 'paused' && !isExpired) {
    form.views = (form.views || 0) + 1;
    saveDb(db);
  }

  res.render('form_view', {
    form,
    isExpired,
    baseUrl: getBaseUrl(req)
  });
});

// ----------------------------------------------------
// 11. POST /forms/:id (Обработка отправки формы студентом)
// ----------------------------------------------------
app.post('/forms/:id', (req, res) => {
  const formId = req.params.id;
  const db = getDb();

  const form = (db.forms || []).find(f => f.id === formId);
  if (!form) return res.status(404).send('Форма не найдена');

  // Check if form deadline has passed
  if (isFormExpired(form)) {
    return res.status(403).send(`
      <!DOCTYPE html>
      <html lang="ru"><head><meta charset="utf-8"><script src="https://cdn.tailwindcss.com"></script><title>Дедлайн прошел</title></head>
      <body class="bg-slate-50 flex items-center justify-center min-h-screen text-slate-800 p-4">
        <div class="bg-white p-8 rounded-xl border border-slate-200 text-center max-w-md shadow-sm">
          <div class="text-3xl mb-2">⏰</div>
          <h1 class="text-xl font-bold text-slate-900 mb-2">Прием откликов на эту вакансию завершен</h1>
          <p class="text-sm text-slate-500">Срок подачи заявок истек. Новые ответы больше не принимаются.</p>
        </div>
      </body>
      </html>
    `);
  }

  // Check if form is paused
  if (form.status === 'paused') {
    return res.status(403).send(`
      <!DOCTYPE html>
      <html lang="ru"><head><meta charset="utf-8"><script src="https://cdn.tailwindcss.com"></script><title>Прием закрыт</title></head>
      <body class="bg-slate-50 flex items-center justify-center min-h-screen text-slate-800 p-4">
        <div class="bg-white p-8 rounded-xl border border-slate-200 text-center max-w-md shadow-sm">
          <div class="text-3xl mb-2">⏸️</div>
          <h1 class="text-xl font-bold text-slate-900 mb-2">Прием откликов приостановлен</h1>
          <p class="text-sm text-slate-500">Набор кандидатов по этой форме временно закрыт организатором.</p>
        </div>
      </body>
      </html>
    `);
  }

  // Extract answers from body: keys starting with "q_"
  const answers = {};
  (form.questions || []).forEach(q => {
    const rawVal = req.body[`q_${q.id}`];
    answers[q.id] = rawVal !== undefined ? rawVal : '';
  });

  const responseId = 'resp_' + crypto.randomUUID().substring(0, 8);
  const newResponse = {
    id: responseId,
    formId: form.id,
    status: 'new', // default candidate status
    submittedAt: new Date().toISOString(),
    answers
  };

  if (!db.responses) db.responses = [];
  db.responses.push(newResponse);
  saveDb(db);

  res.redirect(`/forms/${form.id}/success?resp=${responseId}`);
});

// ----------------------------------------------------
// 12. /forms/:id/success (Экран "Спасибо за отклик!")
// ----------------------------------------------------
app.get('/forms/:id/success', (req, res) => {
  const formId = req.params.id;
  const db = getDb();

  const form = (db.forms || []).find(f => f.id === formId);
  if (!form) return res.redirect('/admin');

  res.render('thank_you', {
    form,
    responseId: req.query.resp || '',
    baseUrl: getBaseUrl(req)
  });
});

// ----------------------------------------------------
// Health check
// ----------------------------------------------------
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// Start Express server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Сервис форм стажировок запущен на порту ${PORT}`);
  console.log(`👉 Панель менеджера: http://localhost:${PORT}/admin`);
});
