# LARA

LARA is Team Slytherin’s floating guidance assistant for web applications. The local MVP includes a guidance API, admin workspace, source annotation analyzer, reusable web widget, and two independent demo hosts.

## Run the preview

From the repository root, run this with Node.js 24 or newer. No package installation or API keys are required.

```sh
node packages/guidance-backend/api/server.mjs
```

Open [LARA workspace](http://127.0.0.1:4173/). The workspace stores its data locally in `tmp/lara.sqlite`. Set `PORT` to use a different port or `LARA_DB` to use a different database file.

## Chat with LARA

Open **Conversations** or the floating **Ask LARA** button, choose an application, and ask “What products are available?” or “How do I create an account?” Chats are saved per application. Switch to **Service Desk** and ask “Where is the customer directory?” to see how the application context changes the answer.

Use **DEMO Application** to start a host or register a new one. In a demo host, ask the embedded assistant about a published workflow, choose **Start walkthrough**, then follow the highlighted controls. The wizard advances after a valid input or a host-confirmed action.

Use **Applications** to view each registered app’s Details, Knowledge base, Workflows, Guidance sessions, and Recent activity. To make the sample order walkthrough available, open **Applications → Demo Application → Workflows**, approve and publish **Track an order**, then ask about tracking inside the host. Use `LARA-1001` as the sample order number.

Voice input appears when the browser exposes a speech recognition API. Availability depends on the browser, device, and microphone permissions.

## Architecture and integration

- **Admin portal** registers applications, imports annotated HTML, reviews candidate workflows, publishes guides, and displays real session metrics.
- **Analyzer** extracts route titles, stable IDs, control types and links, along with documented answers from the supplied HTML. It checks workflow steps against the source map. A re-import returns changed guides to review and archives removed guides.
- **Guidance API** answers from the current application’s documented questions, analyzed controls, or published guides and stores conversation history by application. The state machine validates ordered events and stores a versioned workflow snapshot per session.
- **Web SDK** locates stable host annotations and sends route IDs, target IDs, and action types. Host form values are kept out of the guidance API and session log.

To integrate a host with this build, register it under **DEMO Application**, then select it in **Applications** and open **Details → Import source** with an annotated HTML file up to 1 MB. Follow the [demo source](demos/demo-shop/index.html) for the import format. Put `data-route` on the opening `section` tag, give each guided control a unique `data-lara` within that route, and put the workflow definitions in the `lara-workflows` JSON script. Import stores the route map, source hash, and extracted workflow definitions.
To add facts that are useful in chat, add a `lara-knowledge` JSON script with a `description` and an `answers` array. Each answer takes a `question`, an `answer`, and `aliases` for alternate phrasings.

Serve the SDK files, include `chat.css` and `wizard.css`, and proxy the guidance API on the host’s origin. Pass the registered application ID, application name, and host root to `mountLara`. Supply a navigation callback and fire `lara:route` after a route changes. Send `lara:success` with `{ detail: { target: 'stable-target-id' } }` only after the host confirms success. The [demo host](demos/demo-shop/host.js) shows the integration.

The MVP uses Node.js, SQLite, explicit source annotations, a keyword matcher, and browser-native speech. The proposed production stack, authenticated repository ingestion, Playwright verification during onboarding, tenant authentication and roles, and the comparative user evaluation are future milestones. Treat the workspace as a local demo and use sample data.

## Verify

```sh
node --test packages/guidance-backend/api/smoke.test.mjs
```

The automated check starts a disposable backend and tests scoped chat, conversation history, app details, source review and publishing, rejected and stale events, and walkthrough completion.
