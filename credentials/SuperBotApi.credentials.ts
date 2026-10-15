import type {
	IAuthenticateGeneric,
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class SuperBotApi implements ICredentialType {
	name = 'superBotApi';

	displayName = 'SuperBot API';

	icon: Icon = { light: 'file:../icons/superbot.svg', dark: 'file:../icons/superbot.dark.svg' };

	documentationUrl = 'https://superbotapp.ai/docs/zapier#other-tools';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description:
				'In SuperBot open Integrations, scroll to API keys and click Create API key. Under "Used with" choose "n8n, Make, Pipedream or my own server" so the trigger can send events to n8n.',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				'X-API-Key': '={{$credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://superbotapp.ai/api/zapier',
			url: '/me',
			method: 'GET',
		},
	};
}
