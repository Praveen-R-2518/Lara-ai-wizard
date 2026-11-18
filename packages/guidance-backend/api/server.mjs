import { createServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractApplication } from '../../code-analyzer/parser/source-map.mjs';
import { verifyWorkflow } from '../../code-analyzer/verifier/verify.mjs';
import { matchWorkflow } from '../agent/nlu/match.mjs';
import { answerQuestion } from '../agent/nlu/answer.mjs';
import { applyEvent } from '../agent/engine/session.mjs';
import { openStore } from '../db/store.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const db = openStore(process.env.LARA_DB ?? resolve(root, 'tmp/lara.sqlite'));
const time = () => new Date().toISOString();
const builtins = [
  { id: 'demo-shop', name: 'Demo Application', route: '/demo/', source: 'demos/demo-shop/index.html' },
  { id: 'demo-desk', name: 'Service Desk', route: '/desk/', source: 'demos/demo-shop/desk.html' }
];
const log = (app, title, detail, icon) => db.prepare('INSERT INTO activity(app_id, title, detail, icon, created) VALUES (?, ?, ?, ?, ?)').run(app, title, detail, icon, time());
const hash = source => createHash('sha256').update(source).digest('hex');

class RequestError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function transaction(operation) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = operation();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function analyze(app, markup, initial = false) {
  let source;
  try {
    source = extractApplication(markup);
  } catch (error) {
    throw new RequestError(422, error.message);
  }
  const seen = new Set();
  const now = time();
  const update = db.prepare("INSERT INTO workflows VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET title=excluded.title, status=excluded.status, version=workflows.version+1, definition=excluded.definition, updated=excluded.updated WHERE workflows.definition<>excluded.definition OR workflows.status='archived'");
  for (const definition of source.workflows) {
    const verification = verifyWorkflow(definition, source.routes);
    const status = initial && definition.seed === 'published' && verification.valid ? 'published' : 'under-review';
    const id = `${app.id}:${definition.id}`;
    seen.add(id);
    update.run(id, app.id, definition.title, status, 1, JSON.stringify({ ...definition, verification }), now);
  }
  const existing = db.prepare("SELECT id FROM workflows WHERE app_id=? AND status<>'archived'").all(app.id);
  const archive = db.prepare("UPDATE workflows SET status='archived', updated=? WHERE id=?");
  for (const { id } of existing) {
    if (!seen.has(id)) archive.run(now, id);
  }
  db.prepare('INSERT INTO analysis_runs(app_id, source_hash, route_map, workflow_count, analyzed, knowledge) VALUES (?, ?, ?, ?, ?, ?)')
    .run(app.id, hash(markup), JSON.stringify(source.routes), source.workflows.length, now, JSON.stringify(source.knowledge));
  log(app.id, initial ? 'Application connected' : 'Source analysis completed',
    initial ? app.name : `${source.routes.length} screens · ${source.workflows.length} workflows`, initial ? 'apps' : 'scan');
  return { routes: source.routes.length, workflows: source.workflows.length };
}

for (const app of builtins) {
  const markup = readFileSync(resolve(root, app.source), 'utf8');
  transaction(() => {
    const exists = db.prepare('SELECT id FROM applications WHERE id = ?').get(app.id);
    if (!exists) db.prepare('INSERT INTO applications VALUES (?, ?, ?, ?, ?)').run(app.id, app.name, app.route, app.source, time());
    if (app.id === 'demo-shop') db.prepare("UPDATE applications SET name=? WHERE id=? AND name='Demo Shop'").run(app.name, app.id);
    const last = latestRun(app.id);
    if (!last || last.source_hash !== hash(markup)) analyze(app, markup, !exists);
  });
}

const files = new Map(Object.entries({
  '/': 'packages/admin-portal/index.html',
  '/portal/style.css': 'packages/admin-portal/style.css',
  '/portal/portal.js': 'packages/admin-portal/portal.js',
  '/portal/workspace.js': 'packages/admin-portal/workspace.js',
  '/portal/lara-orbit.png': 'packages/admin-portal/lara-orbit.png',
  '/sdk/ui/icons.js': 'packages/web-sdk/src/ui/icons.js',
  '/sdk/ui/chat.js': 'packages/web-sdk/src/ui/chat.js',
  '/sdk/ui/chat.css': 'packages/web-sdk/src/ui/chat.css',
  '/demo/': 'demos/demo-shop/index.html',
  '/desk/': 'demos/demo-shop/desk.html',
  '/demo/host.js': 'demos/demo-shop/host.js',
  '/demo/style.css': 'demos/demo-shop/style.css',
  '/sdk/ui/wizard.js': 'packages/web-sdk/src/ui/wizard.js',
  '/sdk/ui/wizard.css': 'packages/web-sdk/src/ui/wizard.css',
  '/sdk/dom/context.js': 'packages/web-sdk/src/dom/context.js',
  '/sdk/voice/voice.js': 'packages/web-sdk/src/voice/voice.js'
}));
const contentTypes = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png'
};

function send(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
}

async function readBody(request, limit = 8192) {
  if (request.headers['content-type']?.split(';')[0] !== 'application/json') throw new RequestError(415, 'Send JSON input.');
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > limit) throw new RequestError(413, 'Input is too large.');
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString());
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  } catch {}
  throw new RequestError(400, 'The request body must be a JSON object.');
}

function dashboard() {
  const applications = appList();
  const workflows = db.prepare('SELECT w.*, a.name AS app_name FROM workflows w JOIN applications a ON a.id=w.app_id ORDER BY w.updated DESC, w.id').all()
    .map(({ definition, ...record }) => ({ ...record, ...JSON.parse(definition), id: record.id }));
  const sessions = db.prepare('SELECT s.id, s.status, s.input_type, s.started, s.ended, json_extract(s.snapshot, \'$.title\') AS title, a.name AS app_name FROM sessions s JOIN workflows w ON w.id=s.workflow_id JOIN applications a ON a.id=w.app_id ORDER BY s.started DESC LIMIT 100').all();
  const stats = db.prepare("SELECT COUNT(*) AS sessions, COUNT(CASE WHEN status='completed' THEN 1 END) AS completed, COUNT(CASE WHEN status IN ('completed','cancelled') THEN 1 END) AS finished FROM sessions").get();
  const activity = db.prepare('SELECT title, detail, icon, created FROM activity ORDER BY id DESC LIMIT 8').all();
  return { applications, workflows, sessions, stats, activity };
}

function appList() {
  return db.prepare('SELECT id, name, base_url AS url, source IS NOT NULL AS built_in, created, (SELECT MAX(analyzed) FROM analysis_runs WHERE app_id=applications.id) AS analyzed FROM applications ORDER BY created, id').all();
}

function latestRun(appId) {
  return db.prepare('SELECT * FROM analysis_runs WHERE app_id=? ORDER BY id DESC LIMIT 1').get(appId);
}

function requireApp(id) {
  const app = db.prepare('SELECT id, name, base_url AS url, source IS NOT NULL AS built_in, created FROM applications WHERE id=?').get(String(id ?? ''));
  if (!app) throw new RequestError(404, 'Application not found.');
  return app;
}

function scopedWorkflows(id, publishedOnly = false) {
  return db.prepare(`SELECT * FROM workflows WHERE app_id=? ${publishedOnly ? "AND status='published'" : ''} ORDER BY updated DESC, id`).all(id)
    .map(({ definition, ...record }) => ({ ...record, ...JSON.parse(definition), id: record.id }));
}

function appDetails(app) {
  const last = latestRun(app.id);
  const sessions = db.prepare(`SELECT s.id, s.status, s.input_type, s.started, s.ended, s.step_index,
    json_extract(s.snapshot, '$.title') AS title, json_array_length(s.snapshot, '$.steps') AS total,
    (SELECT COUNT(*) FROM session_events WHERE session_id=s.id AND accepted=0) AS rejected
    FROM sessions s JOIN workflows w ON w.id=s.workflow_id WHERE w.app_id=? ORDER BY s.started DESC LIMIT 100`).all(app.id);
  const activity = db.prepare(`SELECT title, detail, icon, created FROM (
    SELECT title, detail, icon, created FROM activity WHERE app_id=? AND icon<>'check'
    UNION ALL SELECT CASE WHEN s.status='completed' THEN 'Guided session completed' ELSE 'Guided session ended' END,
      json_extract(s.snapshot, '$.title'), 'check', s.ended
    FROM sessions s JOIN workflows w ON w.id=s.workflow_id WHERE w.app_id=? AND s.ended IS NOT NULL
  ) ORDER BY created DESC LIMIT 30`).all(app.id, app.id);
  const runs = db.prepare('SELECT source_hash, route_map, workflow_count, analyzed FROM analysis_runs WHERE app_id=? ORDER BY id DESC LIMIT 20')
    .all(app.id).map(({ route_map, ...run }) => ({ ...run, route_count: JSON.parse(route_map).length }));
  return { app, workflows: scopedWorkflows(app.id), sessions, activity, runs,
    routes: last ? JSON.parse(last.route_map) : [], knowledge: last ? JSON.parse(last.knowledge) : {} };
}

function threadMessages(app, thread) {
  const exists = db.prepare('SELECT id FROM conversations WHERE id=? AND app_id=?').get(thread, app);
  if (!exists) throw new RequestError(404, 'Conversation not found for this application.');
  return db.prepare(`SELECT m.id, m.role, m.content, m.source, m.created, w.title AS workflow_title
    FROM messages m LEFT JOIN workflows w ON w.id=m.workflow_id AND w.status='published'
    WHERE m.conversation_id=? ORDER BY m.id`).all(thread);
}

function chatIndex(app) {
  const last = latestRun(app.id);
  const knowledge = last ? JSON.parse(last.knowledge) : {};
  const suggestions = [...(knowledge.answers ?? []).slice(0, 2).map(item => item.question),
    ...scopedWorkflows(app.id, true).map(item => `How do I ${item.title.toLowerCase()}?`)];
  return {
    suggestions: [...new Set(suggestions)].slice(0, 4),
    threads: db.prepare('SELECT id, title, updated FROM conversations WHERE app_id=? ORDER BY updated DESC, rowid DESC').all(app.id)
  };
}

function chatReply(input) {
  const app = requireApp(input.app);
  const question = typeof input.question === 'string' ? input.question.trim() : '';
  if (!question || question.length > 1200) throw new RequestError(400, 'Enter a question up to 1,200 characters.');
  const id = input.thread ? String(input.thread) : randomUUID();
  if (input.thread && !db.prepare('SELECT id FROM conversations WHERE app_id=? AND id=?').get(app.id, id)) {
    throw new RequestError(404, 'Conversation not found for this application.');
  }
  const published = scopedWorkflows(app.id, true);
  const reference = db.prepare(`SELECT workflow_id FROM messages WHERE conversation_id=? AND role='assistant' ORDER BY id DESC LIMIT 1`).get(id);
  const last = latestRun(app.id);
  const answer = answerQuestion(question, { app, workflows: published,
    knowledge: last ? JSON.parse(last.knowledge) : {}, routes: last ? JSON.parse(last.route_map) : [],
    previousWorkflow: published.find(item => item.id === reference?.workflow_id) });
  const now = time();
  if (input.thread) db.prepare('UPDATE conversations SET updated=? WHERE id=?').run(now, id);
  else db.prepare('INSERT INTO conversations VALUES (?, ?, ?, ?, ?)').run(id, app.id, question.slice(0, 78), now, now);
  const insert = db.prepare('INSERT INTO messages(conversation_id, role, content, source, workflow_id, created) VALUES (?, ?, ?, ?, ?, ?)');
  insert.run(id, 'user', question, null, null, now);
  insert.run(id, 'assistant', answer.content, answer.source ?? null, answer.workflowId ?? null, now);
  return { thread: id, messages: threadMessages(app.id, id), ...chatIndex(app) };
}

function sessionView(id, snapshot, status, index) {
  return { id, status, index, total: snapshot.steps.length, title: snapshot.title, step: snapshot.steps[index] ?? null };
}

async function api(request, response, path) {
  const query = new URL(request.url, 'http://localhost').searchParams;
  if (request.method === 'GET' && path === '/api/applications') return send(response, 200, appList());
  if (request.method === 'GET' && path === '/api/application') return send(response, 200, appDetails(requireApp(query.get('app'))));
  if (request.method === 'GET' && path === '/api/chat') return send(response, 200, chatIndex(requireApp(query.get('app'))));
  if (request.method === 'GET' && path === '/api/chat/thread') {
    const app = requireApp(query.get('app'));
    return send(response, 200, threadMessages(app.id, query.get('thread')));
  }
  if (request.method === 'GET' && path === '/api/dashboard') return send(response, 200, dashboard());
  if (request.method === 'GET' && path === '/api/guides') {
    const app = new URL(request.url, 'http://localhost').searchParams.get('app');
    const guides = db.prepare("SELECT title FROM workflows WHERE app_id=? AND status='published' ORDER BY title").all(app);
    return send(response, 200, guides.map(guide => guide.title));
  }
  if (request.method !== 'POST') throw new RequestError(404, 'Endpoint not found.');
  const input = await readBody(request, path === '/api/analyze' ? 2 * 1024 * 1024 : undefined);
  if (path === '/api/chat') return send(response, 200, transaction(() => chatReply(input)));
  if (path === '/api/applications') {
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    let url;
    try { url = new URL(input.url); } catch { throw new RequestError(400, 'Enter a valid application URL.'); }
    if (!name || name.length > 80 || !['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      throw new RequestError(400, 'Enter an application name and an HTTP or HTTPS URL without credentials.');
    }
    const id = randomUUID();
    transaction(() => {
      db.prepare('INSERT INTO applications VALUES (?, ?, ?, NULL, ?)').run(id, name, url.href, time());
      log(id, 'Application registered', name, 'apps');
    });
    return send(response, 201, { id });
  }
  if (path === '/api/analyze') {
    const app = db.prepare('SELECT id, name, source FROM applications WHERE id=?').get(String(input.id ?? ''));
    if (!app) throw new RequestError(404, 'Application not found.');
    const markup = app.source ? readFileSync(resolve(root, app.source), 'utf8') : input.source;
    if (typeof markup !== 'string' || !markup.trim() || Buffer.byteLength(markup) > 1024 * 1024) {
      throw new RequestError(400, 'Choose an annotated HTML file up to 1 MB.');
    }
    return send(response, 200, transaction(() => analyze(app, markup)));
  }
  if (path === '/api/workflows/status') {
    const workflow = db.prepare('SELECT * FROM workflows WHERE id=?').get(String(input.id ?? ''));
    if (!workflow) throw new RequestError(404, 'Workflow not found.');
    const allowed = { 'under-review': ['approved'], approved: ['published', 'under-review'], published: ['under-review'] };
    if (!allowed[workflow.status]?.includes(input.status)) throw new RequestError(409, 'This workflow status change is unavailable.');
    if (input.status !== 'under-review' && !JSON.parse(workflow.definition).verification.valid) {
      throw new RequestError(409, 'Resolve source verification issues before approving this workflow.');
    }
    transaction(() => {
      db.prepare('UPDATE workflows SET status=?, updated=? WHERE id=?').run(input.status, time(), workflow.id);
      log(workflow.app_id, input.status === 'under-review' ? 'Workflow returned to review' : `Workflow ${input.status}`, workflow.title, 'workflow');
    });
    return send(response, 200, { status: input.status });
  }
  if (path === '/api/sessions') {
    const query = typeof input.query === 'string' ? input.query.trim() : '';
    if (!query || query.length > 240) throw new RequestError(400, 'Enter a task up to 240 characters.');
    const definitions = db.prepare("SELECT id, definition FROM workflows WHERE app_id=? AND status='published'").all(String(input.app ?? ''))
      .map(row => ({ ...JSON.parse(row.definition), id: row.id }));
    const snapshot = matchWorkflow(query, definitions);
    if (!snapshot) throw new RequestError(404, 'I couldn’t match that to a published guide. Try a suggested task.');
    const id = randomUUID();
    const inputType = input.type === 'voice' ? 'voice' : 'text';
    db.prepare("INSERT INTO sessions VALUES (?, ?, 'active', 0, ?, ?, ?, NULL)").run(id, snapshot.id, JSON.stringify(snapshot), inputType, time());
    return send(response, 201, sessionView(id, snapshot, 'active', 0));
  }
  const eventPath = path.match(/^\/api\/sessions\/([a-f0-9-]{36})\/events$/);
  if (eventPath) {
    const result = transaction(() => {
      const session = db.prepare('SELECT * FROM sessions WHERE id=?').get(eventPath[1]);
      if (!session) throw new RequestError(404, 'Session not found.');
      const snapshot = JSON.parse(session.snapshot);
      const transition = input.index === session.step_index
        ? applyEvent({ status: session.status, index: session.step_index, steps: snapshot.steps }, input)
        : { accepted: false, message: 'The guide has already moved to another step.' };
      db.prepare('INSERT INTO session_events(session_id, action, accepted, occurred) VALUES (?, ?, ?, ?)')
        .run(session.id, String(input.action ?? '').slice(0, 24), Number(transition.accepted), time());
      if (!transition.accepted) return { ...sessionView(session.id, snapshot, session.status, session.step_index), ...transition };
      const ended = ['completed', 'cancelled'].includes(transition.status);
      db.prepare('UPDATE sessions SET status=?, step_index=?, ended=? WHERE id=?')
        .run(transition.status, transition.index, ended ? time() : null, session.id);
      return { ...sessionView(session.id, snapshot, transition.status, transition.index), accepted: true };
    });
    return send(response, 200, result);
  }
  throw new RequestError(404, 'Endpoint not found.');
}

const port = Number(process.env.PORT ?? 4173);
const server = createServer(async (request, response) => {
  try {
    const authority = request.headers.host ?? '';
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(authority)) {
      throw new RequestError(403, 'The workspace is available on loopback only.');
    }
    const path = new URL(request.url, 'http://localhost').pathname;
    if (request.method === 'POST' && request.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(request.headers['sec-fetch-site'])) {
      throw new RequestError(403, 'Cross-origin requests are disabled in this local preview.');
    }
    if (path.startsWith('/api/')) return await api(request, response, path);
    if (path === '/demo' || path === '/desk') {
      response.writeHead(302, { Location: `${path}/` });
      return response.end();
    }
    const file = files.get(path);
    if (!file || request.method !== 'GET') throw new RequestError(404, 'Page not found.');
    response.writeHead(200, { 'Content-Type': contentTypes[extname(file)], 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
    response.end(readFileSync(resolve(root, file)));
  } catch (error) {
    if (!(error instanceof RequestError)) console.error(error);
    if (response.headersSent || response.destroyed) return response.end();
    send(response, error.status ?? 500, error.status ? error.message : 'The server could not complete this request.');
  }
});
server.listen(port, '127.0.0.1', () => console.log(`LARA workspace • http://127.0.0.1:${server.address().port}/`));
