import type {
	IDataObject,
	IExecuteFunctions,
	IHookFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	IWebhookFunctions,
} from 'n8n-workflow';

export const SUPERBOT_API_BASE = 'https://superbotapp.ai/api/zapier';

export const SUPERBOT_EVENTS = [
	{
		name: 'Conversation Escalated to Human',
		value: 'conversation_escalated',
		description: 'A conversation is handed off to your team',
	},
	{
		name: 'New Conversation',
		value: 'new_conversation',
		description: 'A visitor starts a new conversation',
	},
	{
		name: 'New Lead',
		value: 'new_lead',
		description: 'A lead is captured by your bot or a form',
	},
];

type Context = IExecuteFunctions | IHookFunctions | ILoadOptionsFunctions | IWebhookFunctions;

/** Authenticated call to the SuperBot public API (the same API the Zapier app uses). */
export async function superBotApiRequest(
	this: Context,
	method: IHttpRequestMethods,
	path: string,
	body?: IDataObject,
	qs?: IDataObject,
) {
	const options: IHttpRequestOptions = {
		method,
		url: `${SUPERBOT_API_BASE}${path}`,
		json: true,
		headers: { Accept: 'application/json' },
	};
	if (body && Object.keys(body).length) options.body = body;
	if (qs && Object.keys(qs).length) options.qs = qs;
	return await this.helpers.httpRequestWithAuthentication.call(this, 'superBotApi', options);
}
