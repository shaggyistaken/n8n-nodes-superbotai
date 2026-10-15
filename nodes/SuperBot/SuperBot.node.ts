import {
	NodeApiError,
	NodeConnectionTypes,
	NodeOperationError,
	type IDataObject,
	type IExecuteFunctions,
	type INodeExecutionData,
	type INodeType,
	type INodeTypeDescription,
	type JsonObject,
} from 'n8n-workflow';
import { superBotApiRequest } from '../shared/transport';

const LEAD_STATUSES = [
	{ name: 'New', value: 'new' },
	{ name: 'Contacted', value: 'contacted' },
	{ name: 'Qualified', value: 'qualified' },
	{ name: 'Unqualified', value: 'unqualified' },
];

export class SuperBot implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'SuperBot',
		name: 'superBot',
		icon: { light: 'file:../../icons/superbot.svg', dark: 'file:../../icons/superbot.dark.svg' },
		group: ['output'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description:
			'Create leads, add AI training answers and read recent leads and conversations in SuperBot',
		defaults: {
			name: 'SuperBot',
		},
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'superBotApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Conversation', value: 'conversation' },
					{ name: 'Lead', value: 'lead' },
					{ name: 'Training Answer', value: 'trainingAnswer' },
				],
				default: 'lead',
			},

			// Lead
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['lead'] } },
				options: [
					{
						name: 'Create',
						value: 'create',
						description:
							'Add a lead to the SuperBot CRM (an existing lead with the same email is returned instead)',
						action: 'Create a lead',
					},
					{
						name: 'Get Many',
						value: 'getAll',
						description: 'Get the most recent leads, newest first',
						action: 'Get many leads',
					},
				],
				default: 'create',
			},
			{
				displayName: 'Email',
				name: 'email',
				type: 'string',
				placeholder: 'name@email.com',
				default: '',
				description: 'Name or email is required',
				displayOptions: { show: { resource: ['lead'], operation: ['create'] } },
			},
			{
				displayName: 'Name',
				name: 'name',
				type: 'string',
				default: '',
				description: 'Name or email is required',
				displayOptions: { show: { resource: ['lead'], operation: ['create'] } },
			},
			{
				displayName: 'Additional Fields',
				name: 'additionalFields',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				displayOptions: { show: { resource: ['lead'], operation: ['create'] } },
				options: [
					{ displayName: 'Company', name: 'company', type: 'string', default: '' },
					{
						displayName: 'Notes',
						name: 'notes',
						type: 'string',
						typeOptions: { rows: 3 },
						default: '',
					},
					{ displayName: 'Phone', name: 'phone', type: 'string', default: '' },
					{
						displayName: 'Source',
						name: 'source',
						type: 'string',
						default: 'n8n',
						description: 'Where the lead came from',
					},
					{
						displayName: 'Status',
						name: 'status',
						type: 'options',
						options: LEAD_STATUSES,
						default: 'new',
					},
				],
			},

			// Conversation
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['conversation'] } },
				options: [
					{
						name: 'Get Many',
						value: 'getAll',
						description: 'Get the most recent conversations, newest first',
						action: 'Get many conversations',
					},
				],
				default: 'getAll',
			},
			{
				displayName: 'Escalated Only',
				name: 'escalatedOnly',
				type: 'boolean',
				default: false,
				description: 'Whether to return only conversations handed off to a human',
				displayOptions: { show: { resource: ['conversation'], operation: ['getAll'] } },
			},

			// Shared limit for Get Many
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				typeOptions: { minValue: 1, maxValue: 50 },
				default: 50,
				description: 'Max number of results to return',
				displayOptions: { show: { resource: ['lead', 'conversation'], operation: ['getAll'] } },
			},

			// Training answer
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['trainingAnswer'] } },
				options: [
					{
						name: 'Create or Update',
						value: 'upsert',
						description:
							'Create a new record, or update the current one if it already exists (upsert)',
						action: 'Create or update a training answer',
					},
				],
				default: 'upsert',
			},
			{
				displayName: 'Question',
				name: 'question',
				type: 'string',
				required: true,
				default: '',
				description: 'What a customer might ask',
				displayOptions: { show: { resource: ['trainingAnswer'], operation: ['upsert'] } },
			},
			{
				displayName: 'Answer',
				name: 'answer',
				type: 'string',
				typeOptions: { rows: 4 },
				required: true,
				default: '',
				description: 'How SuperBot should answer',
				displayOptions: { show: { resource: ['trainingAnswer'], operation: ['upsert'] } },
			},
			{
				displayName: 'Category',
				name: 'category',
				type: 'string',
				default: 'general',
				displayOptions: { show: { resource: ['trainingAnswer'], operation: ['upsert'] } },
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const resource = this.getNodeParameter('resource', i) as string;
				const operation = this.getNodeParameter('operation', i) as string;
				let response: IDataObject | IDataObject[];

				if (resource === 'lead' && operation === 'create') {
					const email = String(this.getNodeParameter('email', i, '')).trim();
					const name = String(this.getNodeParameter('name', i, '')).trim();
					if (!email && !name) {
						throw new NodeOperationError(this.getNode(), 'Enter a name or an email for the lead.', {
							itemIndex: i,
						});
					}
					const additional = this.getNodeParameter('additionalFields', i, {}) as IDataObject;
					response = await superBotApiRequest.call(this, 'POST', '/actions/lead', {
						email,
						name,
						source: 'n8n',
						...additional,
					});
				} else if (resource === 'lead' && operation === 'getAll') {
					const limit = this.getNodeParameter('limit', i, 50) as number;
					response = await superBotApiRequest.call(this, 'GET', '/triggers/new_lead', undefined, {
						limit,
					});
				} else if (resource === 'conversation' && operation === 'getAll') {
					const limit = this.getNodeParameter('limit', i, 50) as number;
					const escalated = this.getNodeParameter('escalatedOnly', i, false) as boolean;
					const trigger = escalated ? 'conversation_escalated' : 'new_conversation';
					response = await superBotApiRequest.call(
						this,
						'GET',
						`/triggers/${trigger}`,
						undefined,
						{ limit },
					);
				} else if (resource === 'trainingAnswer' && operation === 'upsert') {
					response = await superBotApiRequest.call(this, 'POST', '/actions/training-answer', {
						question: this.getNodeParameter('question', i) as string,
						answer: this.getNodeParameter('answer', i) as string,
						category: (this.getNodeParameter('category', i, 'general') as string) || 'general',
					});
				} else {
					throw new NodeOperationError(
						this.getNode(),
						`Unsupported operation "${operation}" for resource "${resource}"`,
						{ itemIndex: i },
					);
				}

				const records = Array.isArray(response) ? response : [response];
				for (const record of records) {
					returnData.push({ json: record, pairedItem: { item: i } });
				}
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (error as Error).message },
						pairedItem: { item: i },
					});
					continue;
				}
				throw error instanceof NodeOperationError
					? new NodeOperationError(this.getNode(), error, { itemIndex: i })
					: new NodeApiError(this.getNode(), error as JsonObject, { itemIndex: i });
			}
		}

		return [returnData];
	}
}
