import { createHmac, timingSafeEqual } from 'crypto';
import {
	NodeApiError,
	NodeConnectionTypes,
	type IDataObject,
	type IHookFunctions,
	type INodeType,
	type INodeTypeDescription,
	type IWebhookFunctions,
	type IWebhookResponseData,
	type JsonObject,
} from 'n8n-workflow';
import { SUPERBOT_EVENTS, superBotApiRequest } from '../shared/transport';

/** Hex HMAC-SHA256 of the raw body, compared in constant time. */
export function isValidSignature(
	rawBody: string | Buffer,
	secret: string,
	signature: string,
): boolean {
	if (!secret || !signature) return false;
	const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
	const a = Buffer.from(expected, 'utf8');
	const b = Buffer.from(signature.trim().toLowerCase(), 'utf8');
	return a.length === b.length && timingSafeEqual(a, b);
}

function clearSubscription(data: IDataObject) {
	delete data.webhookId;
	delete data.webhookSecret;
	delete data.webhookUrl;
	delete data.event;
}

function isNotFound(error: unknown): boolean {
	const e = error as { httpCode?: string; statusCode?: number; response?: { status?: number } };
	return e?.httpCode === '404' || e?.statusCode === 404 || e?.response?.status === 404;
}

export class SuperBotTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'SuperBot Trigger',
		name: 'superBotTrigger',
		icon: { light: 'file:../../icons/superbot.svg', dark: 'file:../../icons/superbot.dark.svg' },
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["event"]}}',
		description:
			'Starts the workflow when SuperBot captures a lead, starts a conversation or escalates one',
		defaults: {
			name: 'SuperBot Trigger',
		},
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'superBotApi',
				required: true,
			},
		],
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				path: 'webhook',
			},
		],
		properties: [
			{
				displayName:
					'Use an API key created with "Used with: n8n, Make, Pipedream or my own server". Zapier keys can only send events to Zapier.',
				name: 'keyNotice',
				type: 'notice',
				default: '',
			},
			{
				displayName: 'Event',
				name: 'event',
				type: 'options',
				required: true,
				default: 'new_lead',
				options: SUPERBOT_EVENTS,
			},
			{
				displayName: 'Verify Signature',
				name: 'verifySignature',
				type: 'boolean',
				default: true,
				description:
					'Whether to reject deliveries whose X-SuperBot-Signature header does not match the secret SuperBot issued for this subscription',
			},
		],
	};

	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				const data = this.getWorkflowStaticData('node');
				if (!data.webhookId) return false;
				const url = this.getNodeWebhookUrl('default');
				const event = this.getNodeParameter('event') as string;
				if (data.webhookUrl === url && data.event === event) return true;
				// Stale subscription (URL or event changed): drop it so create() re-subscribes.
				try {
					await superBotApiRequest.call(
						this,
						'DELETE',
						`/hooks/${encodeURIComponent(String(data.webhookId))}`,
					);
				} catch (error) {
					if (!isNotFound(error)) {
						throw new NodeApiError(this.getNode(), error as JsonObject);
					}
				}
				clearSubscription(data);
				return false;
			},

			async create(this: IHookFunctions): Promise<boolean> {
				const data = this.getWorkflowStaticData('node');
				const url = this.getNodeWebhookUrl('default') as string;
				const event = this.getNodeParameter('event') as string;
				let response: IDataObject;
				try {
					response = (await superBotApiRequest.call(this, 'POST', '/hooks', {
						event,
						target_url: url,
					})) as IDataObject;
				} catch (error) {
					throw new NodeApiError(this.getNode(), error as JsonObject, {
						message: 'SuperBot could not subscribe this webhook',
						description:
							'Check that the API key was created for "n8n, Make, Pipedream or my own server" and that this n8n instance is reachable over public https.',
					});
				}
				if (!response?.id) return false;
				data.webhookId = response.id;
				data.webhookSecret = response.secret;
				data.webhookUrl = url;
				data.event = event;
				return true;
			},

			async delete(this: IHookFunctions): Promise<boolean> {
				const data = this.getWorkflowStaticData('node');
				if (data.webhookId) {
					try {
						await superBotApiRequest.call(
							this,
							'DELETE',
							`/hooks/${encodeURIComponent(String(data.webhookId))}`,
						);
					} catch (error) {
						// 404 = already removed on SuperBot's side (revoked key, deleted subscription).
						if (!isNotFound(error)) return false;
					}
				}
				clearSubscription(data);
				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const body = this.getBodyData();
		const verify = this.getNodeParameter('verifySignature', true) as boolean;

		if (verify) {
			const data = this.getWorkflowStaticData('node');
			const secret = typeof data.webhookSecret === 'string' ? data.webhookSecret : '';
			const signature = String(this.getHeaderData()['x-superbot-signature'] ?? '');
			const req = this.getRequestObject() as unknown as { rawBody?: Buffer };
			const raw = req.rawBody ?? JSON.stringify(body);
			if (secret && !isValidSignature(raw, secret, signature)) {
				const res = this.getResponseObject();
				res.status(401).json({ ok: false, error: 'Invalid signature' });
				return { noWebhookResponse: true };
			}
		}

		return {
			workflowData: [this.helpers.returnJsonArray(body)],
		};
	}
}
