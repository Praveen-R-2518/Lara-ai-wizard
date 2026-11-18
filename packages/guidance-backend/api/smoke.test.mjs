import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

test('source review, app-scoped retrieval and validated session progression', { timeout: 15000 }, async test => {
  const server = spawn(process.execPath, [fileURLToPath(new URL('./server.mjs', import.meta.url))], {
    env: { ...process.env, PORT: '0', LARA_DB: ':memory:' },
    stdio: ['ignore', 'pipe', 'inherit']
  });
  test.after(() => server.kill());
  const base = await Promise.race([
    (async () => {
      let output = '';
      for await (const chunk of server.stdout) {
        output += chunk;
        const url = output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
        if (url) return url;
      }
      throw new Error('The backend did not report a preview URL.');
    })(),
    once(server, 'exit').then(([code]) => { throw new Error(`Backend exited with code ${code}.`); })
  ]);

  async function api(path, body, expected = 200) {
    const options = body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {};
    const response = await fetch(base + path, options);
    assert.equal(response.status, expected, path);
    return response.json();
  }

  for (const path of ['/', '/demo/', '/desk/', '/portal/lara-orbit.png', '/sdk/ui/chat.js', '/sdk/ui/wizard.js', '/sdk/dom/context.js', '/sdk/voice/voice.js']) {
    assert.equal((await fetch(base + path)).status, 200, path);
  }
  const overview = await api('/api/dashboard');
  assert.equal(overview.applications.length, 2);
  assert.ok(overview.workflows.every(workflow => workflow.verification.valid));
  assert.deepEqual(await api('/api/analyze', { id: 'demo-shop' }), { routes: 4, workflows: 3 });
  const customApp = await api('/api/applications', { name: 'Sample host', url: 'https://example.test/' }, 201);
  const definition = { id: 'send-message', title: 'Send message', aliases: [], seed: 'published',
    steps: [{ route: 'home', target: 'send', action: 'success', instruction: 'Send the message.' }] };
  const source = (workflows, targets) => `<section data-route="home">${targets}</section>
    <script id="lara-workflows" type="application/json">${JSON.stringify(workflows)}</script>`;
  const sendButton = '<button data-lara="send">Send</button>';
  await api('/api/analyze', { id: customApp.id, source: '<html></html>' }, 422);
  await api('/api/analyze', { id: customApp.id, source: source([definition], sendButton.repeat(2)) });
  const customId = `${customApp.id}:send-message`;
  await api('/api/workflows/status', { id: customId, status: 'approved' }, 409);
  await api('/api/analyze', { id: customApp.id, source: source([definition], sendButton) });
  assert.deepEqual(await api(`/api/guides?app=${customApp.id}`), []);
  await api('/api/workflows/status', { id: customId, status: 'approved' });
  await api('/api/workflows/status', { id: customId, status: 'published' });
  assert.deepEqual(await api(`/api/guides?app=${customApp.id}`), ['Send message']);
  await api('/api/analyze', { id: customApp.id, source: source([{ ...definition, id: 'other-message' }], sendButton) });
  assert.deepEqual(await api(`/api/guides?app=${customApp.id}`), []);
  const customKnowledge = JSON.stringify({ description: 'Sample messaging tool.',
    answers: [{ question: 'Where can I check delivery?', answer: 'Open the Delivery screen.', aliases: ['check delivery'] }] });
  const annotatedSource = source([definition], sendButton) +
    `<script id="lara-knowledge" type="application/json">${customKnowledge}</script>`;
  await api('/api/analyze', { id: customApp.id, source: annotatedSource });
  const customChat = await api('/api/chat', { app: customApp.id, question: 'Where can I check delivery?' });
  assert.equal(customChat.messages[1].content, 'Open the Delivery screen.');
  assert.equal((await api(`/api/application?app=${customApp.id}`)).knowledge.description, 'Sample messaging tool.');
  assert.deepEqual(await api('/api/guides?app=demo-desk'), ['Create a new customer']);
  const track = { app: 'demo-shop', query: 'Where is my order?' };
  const id = 'demo-shop:track-order';
  await api('/api/sessions', track, 404);
  await api('/api/sessions', { app: 'demo-desk', query: 'create an account' }, 404);
  await api('/api/workflows/status', { id, status: 'published' }, 409);
  await api('/api/workflows/status', { id, status: 'approved' });
  await api('/api/workflows/status', { id, status: 'published' });
  const session = await api('/api/sessions', track, 201);
  const event = body => api(`/api/sessions/${session.id}/events`, body);
  assert.equal((await event({ index: 0, action: 'click', route: 'home', target: 'signup' })).accepted, false);
  assert.equal((await event({ index: 0, action: 'pause' })).status, 'paused');
  const first = { index: 0, action: 'click', route: 'home', target: 'orders' };
  assert.equal((await event(first)).accepted, false);
  assert.equal((await event({ index: 0, action: 'resume' })).status, 'active');
  assert.equal((await event(first)).index, 1);
  assert.equal((await event(first)).accepted, false);
  assert.equal((await event({ index: 1, action: 'valid', route: 'orders', target: 'order-code' })).index, 2);
  assert.equal((await event({ index: 2, action: 'click', route: 'orders', target: 'lookup-order' })).accepted, false);
  assert.equal((await event({ index: 2, action: 'success', route: 'orders', target: 'lookup-order' })).status, 'completed');
  assert.equal((await event({ index: 3, action: 'cancel' })).accepted, false);
  const updated = await api('/api/dashboard');
  assert.equal(updated.stats.completed, 1);
  assert.equal(updated.sessions[0].status, 'completed');

  const shop = await api('/api/application?app=demo-shop');
  const desk = await api('/api/application?app=demo-desk');
  assert.equal(shop.app.name, 'Demo Application');
  assert.ok(shop.routes.some(route => route.controls.some(control => control.id === 'signup')));
  assert.ok(shop.activity.some(event => event.title === 'Guided session completed'));
  assert.deepEqual(desk.sessions, []);
  assert.ok(desk.workflows.every(workflow => workflow.app_id === desk.app.id));
  assert.ok(!desk.activity.some(event => event.detail === 'Track an order'));
  const firstChat = await api('/api/chat', { app: 'demo-shop', question: 'What products are available?' });
  assert.match(firstChat.messages[1].content, /Studio Headphones/);
  assert.equal(firstChat.messages[1].source, 'What products are available?');
  const sameChat = await api('/api/chat', { app: 'demo-shop', thread: firstChat.thread, question: 'How do I create an account?' });
  assert.equal(sameChat.messages.at(-1).workflow_title, 'Create an account');
  const followup = await api('/api/chat', { app: 'demo-shop', thread: firstChat.thread, question: 'What about the email?' });
  assert.match(followup.messages.at(-1).content, /Step 3/);
  assert.deepEqual(await api(`/api/chat/thread?app=demo-shop&thread=${firstChat.thread}`), followup.messages);
  await api(`/api/chat/thread?app=demo-desk&thread=${firstChat.thread}`, undefined, 404);
  await api('/api/chat', { app: 'demo-desk', thread: firstChat.thread, question: 'Where are the customers?' }, 404);
  assert.deepEqual((await api('/api/chat?app=demo-desk')).threads, []);
  const deskChat = await api('/api/chat', { app: 'demo-desk', question: 'What products are available?' });
  assert.doesNotMatch(deskChat.messages[1].content, /Headphones|Mini Speaker/);
});
