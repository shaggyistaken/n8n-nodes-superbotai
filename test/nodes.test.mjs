// Unit tests against the built output (npm test runs the build first).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { SuperBot } = require('../dist/nodes/SuperBot/SuperBot.node.js');
const {
	SuperBotTrigger,
	isValidSignature,
} = require('../dist/nodes/SuperBotTrigger/SuperBotTrigger.node.js');
const { SuperBotApi } = require('../dist/credentials/SuperBotApi.credentials.js');

const BASE = 'https://superbotapp.ai/api/zapier';
const HOOK_URL = 'https://n8n.example.com/webhook/abc/webhook';

function httpError(message, httpCode) {
	return Object.assign(new Error(message), { httpCode });
}

function makeContext({
	params = {},
	items = [{ json: {} }],
	staticData = {},
	respond,
	continueOnFail = false,
	body,
	headers = {},
	rawBody,
} = {}) {
	const calls = [];
	const response = {
		statusCode: 200,
		payload: null,
		status(code) {
			this.statusCode = code;
			return this;
		},
		json(p) {
			this.payload = p;
			return this;
		},
	};
	return {
		calls,
		response,
		getInputData: () => items,
		getNodeParameter: (name, _i, fallback) => (name in params ? params[name] : fallback),
		getNode: () => ({
			name: 'SuperBot',
			type: 'n8n-nodes-superbot.superBot',
			typeVersion: 1,
			parameters: {},
		}),
		continueOnFail: () => continueOnFail,
		getWorkflowStaticData: () => staticData,
		getNodeWebhookUrl: () => HOOK_URL,
		getBodyData: () => body,
		getHeaderData: () => headers,
		getRequestObject: () => ({ rawBody }),
		getResponseObject: () => response,
		helpers: {
			returnJsonArray: (data) => (Array.isArray(data) ? data : [data]).map((json) => ({ json })),
			async httpRequestWithAuthentication(credentialName, options) {
				calls.push({ credentialName, ...options });
				return respond ? respond(options) : {};
			},
		},
	};
}

test('credential sends X-API-Key and tests against /me', () => {
	const cred = new SuperBotApi();
	assert.equal(cred.name, 'superBotApi');
	assert.equal(cred.authenticate.properties.headers['X-API-Key'], '={{$credentials.apiKey}}');
	assert.equal(cred.test.request.baseURL + cred.test.request.url, `${BASE}/me`);
});

test('package.json n8n entries point at built files and there are no runtime deps', () => {
	const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
	assert.ok(pkg.keywords.includes('n8n-community-node-package'));
	assert.equal(pkg.dependencies, undefined);
	for (const file of [...pkg.n8n.credentials, ...pkg.n8n.nodes]) {
		assert.ok(existsSync(new URL(`../${file}`, import.meta.url)), file);
	}
});

test('isValidSignature matches the server HMAC and rejects anything else', () => {
	const body = JSON.stringify({ id: '1', email: 'a@b.co' });
	const sig = createHmac('sha256', 's3cret').update(body).digest('hex');
	assert.equal(isValidSignature(body, 's3cret', sig), true);
	assert.equal(isValidSignature(body, 's3cret', sig.toUpperCase()), true);
	assert.equal(isValidSignature(body, 'other', sig), false);
	assert.equal(isValidSignature(body, 's3cret', ''), false);
	assert.equal(isValidSignature(body, 's3cret', 'abc'), false);
});

test('trigger create subscribes the webhook URL and stores id + secret', async () => {
	const node = new SuperBotTrigger();
	const ctx = makeContext({
		params: { event: 'new_lead' },
		respond: () => ({ id: 'hook-1', secret: 'sec' }),
	});
	assert.equal(await node.webhookMethods.default.create.call(ctx), true);
	assert.equal(ctx.calls[0].credentialName, 'superBotApi');
	assert.equal(ctx.calls[0].method, 'POST');
	assert.equal(ctx.calls[0].url, `${BASE}/hooks`);
	assert.deepEqual(ctx.calls[0].body, { event: 'new_lead', target_url: HOOK_URL });
	const data = ctx.getWorkflowStaticData();
	assert.equal(data.webhookId, 'hook-1');
	assert.equal(data.webhookSecret, 'sec');
	assert.equal(data.webhookUrl, HOOK_URL);
});

test('trigger create surfaces a clear error when SuperBot rejects the target', async () => {
	const node = new SuperBotTrigger();
	const ctx = makeContext({
		params: { event: 'new_lead' },
		respond: () => {
			throw httpError('target_url must be a https://hooks.zapier.com URL', '400');
		},
	});
	await assert.rejects(() => node.webhookMethods.default.create.call(ctx), /could not subscribe/i);
});

test('checkExists keeps a matching subscription and replaces a stale one', async () => {
	const node = new SuperBotTrigger();
	const same = makeContext({
		params: { event: 'new_lead' },
		staticData: { webhookId: 'h1', webhookUrl: HOOK_URL, event: 'new_lead' },
	});
	assert.equal(await node.webhookMethods.default.checkExists.call(same), true);
	assert.equal(same.calls.length, 0);

	const stale = makeContext({
		params: { event: 'new_conversation' },
		staticData: { webhookId: 'h1', webhookUrl: HOOK_URL, event: 'new_lead', webhookSecret: 'x' },
	});
	assert.equal(await node.webhookMethods.default.checkExists.call(stale), false);
	assert.equal(stale.calls[0].method, 'DELETE');
	assert.equal(stale.calls[0].url, `${BASE}/hooks/h1`);
	assert.deepEqual(stale.getWorkflowStaticData(), {});

	const none = makeContext({ params: { event: 'new_lead' } });
	assert.equal(await node.webhookMethods.default.checkExists.call(none), false);
});

test('delete treats 404 as already removed but reports other failures', async () => {
	const node = new SuperBotTrigger();
	const gone = makeContext({
		staticData: { webhookId: 'h1' },
		respond: () => {
			throw httpError('not found', '404');
		},
	});
	assert.equal(await node.webhookMethods.default.delete.call(gone), true);
	assert.deepEqual(gone.getWorkflowStaticData(), {});

	const down = makeContext({
		staticData: { webhookId: 'h1' },
		respond: () => {
			throw httpError('boom', '500');
		},
	});
	assert.equal(await node.webhookMethods.default.delete.call(down), false);
	assert.equal(down.getWorkflowStaticData().webhookId, 'h1');
});

test('webhook accepts a correctly signed delivery and rejects a forged one', async () => {
	const node = new SuperBotTrigger();
	const body = { id: 'l1', email: 'jane@example.com' };
	const raw = Buffer.from(JSON.stringify(body));
	const sig = createHmac('sha256', 'sec').update(raw).digest('hex');

	const ok = makeContext({
		params: { verifySignature: true },
		staticData: { webhookSecret: 'sec' },
		body,
		rawBody: raw,
		headers: { 'x-superbot-signature': sig },
	});
	assert.deepEqual((await node.webhook.call(ok)).workflowData, [[{ json: body }]]);

	const bad = makeContext({
		params: { verifySignature: true },
		staticData: { webhookSecret: 'sec' },
		body,
		rawBody: raw,
		headers: { 'x-superbot-signature': 'deadbeef' },
	});
	const rejected = await node.webhook.call(bad);
	assert.equal(rejected.noWebhookResponse, true);
	assert.equal(rejected.workflowData, undefined);
	assert.equal(bad.response.statusCode, 401);

	const off = makeContext({
		params: { verifySignature: false },
		staticData: { webhookSecret: 'sec' },
		body,
	});
	assert.deepEqual((await node.webhook.call(off)).workflowData, [[{ json: body }]]);
});

test('SuperBot node: create lead posts to /actions/lead', async () => {
	const node = new SuperBot();
	const ctx = makeContext({
		params: {
			resource: 'lead',
			operation: 'create',
			email: ' jane@example.com ',
			name: 'Jane',
			additionalFields: { phone: '+1 555', status: 'qualified' },
		},
		respond: (o) => ({ id: 'l1', ...o.body, created: true }),
	});
	const [out] = await node.execute.call(ctx);
	assert.equal(ctx.calls[0].url, `${BASE}/actions/lead`);
	assert.deepEqual(ctx.calls[0].body, {
		email: 'jane@example.com',
		name: 'Jane',
		source: 'n8n',
		phone: '+1 555',
		status: 'qualified',
	});
	assert.equal(out[0].json.id, 'l1');
	assert.deepEqual(out[0].pairedItem, { item: 0 });
});

test('SuperBot node: lead without name or email fails, or is reported with continueOnFail', async () => {
	const node = new SuperBot();
	const params = { resource: 'lead', operation: 'create', email: '', name: '' };
	await assert.rejects(() => node.execute.call(makeContext({ params })), /name or an email/);
	const [out] = await node.execute.call(makeContext({ params, continueOnFail: true }));
	assert.match(out[0].json.error, /name or an email/);
});

test('SuperBot node: get many maps to the trigger sample endpoints', async () => {
	const node = new SuperBot();
	const ctx = makeContext({
		params: { resource: 'conversation', operation: 'getAll', escalatedOnly: true, limit: 5 },
		respond: () => [{ id: 'c1' }, { id: 'c2' }],
	});
	const [out] = await node.execute.call(ctx);
	assert.equal(ctx.calls[0].method, 'GET');
	assert.equal(ctx.calls[0].url, `${BASE}/triggers/conversation_escalated`);
	assert.deepEqual(ctx.calls[0].qs, { limit: 5 });
	assert.deepEqual(
		out.map((o) => o.json.id),
		['c1', 'c2'],
	);

	const all = makeContext({
		params: { resource: 'conversation', operation: 'getAll', limit: 5 },
		respond: () => [],
	});
	await node.execute.call(all);
	assert.equal(all.calls[0].url, `${BASE}/triggers/new_conversation`);

	const leads = makeContext({
		params: { resource: 'lead', operation: 'getAll', limit: 3 },
		respond: () => [],
	});
	await node.execute.call(leads);
	assert.equal(leads.calls[0].url, `${BASE}/triggers/new_lead`);
});

test('SuperBot node: training answer upsert', async () => {
	const node = new SuperBot();
	const ctx = makeContext({
		params: {
			resource: 'trainingAnswer',
			operation: 'upsert',
			question: 'Ship to Canada?',
			answer: 'Yes',
			category: '',
		},
		respond: () => ({ id: 't1', updated: false }),
	});
	await node.execute.call(ctx);
	assert.equal(ctx.calls[0].method, 'POST');
	assert.equal(ctx.calls[0].url, `${BASE}/actions/training-answer`);
	assert.deepEqual(ctx.calls[0].body, {
		question: 'Ship to Canada?',
		answer: 'Yes',
		category: 'general',
	});
});
