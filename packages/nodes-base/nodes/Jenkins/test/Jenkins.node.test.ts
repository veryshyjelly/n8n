import { mockDeep } from 'vitest-mock-extended';
import type {
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INode,
	INodePropertyOptions,
} from 'n8n-workflow';

import * as GenericFunctions from '../GenericFunctions';
import { Jenkins } from '../Jenkins.node';
import type { Mocked, MockInstance } from 'vitest';

describe('Jenkins node', () => {
	let node: Jenkins;
	let loadOptionsFunctions: Mocked<ILoadOptionsFunctions>;
	let jenkinsApiRequestSpy: MockInstance;

	beforeEach(() => {
		node = new Jenkins();
		loadOptionsFunctions = mockDeep<ILoadOptionsFunctions>();
		loadOptionsFunctions.getCurrentNodeParameter.mockReturnValue('demo-job');
		vi.clearAllMocks();
		jenkinsApiRequestSpy = vi.spyOn(GenericFunctions, 'jenkinsApiRequest');
	});

	afterEach(() => {
		vi.resetAllMocks();
	});

	describe('loadOptions.getJobs', () => {
		it('keeps top-level job values and sorts the options', async () => {
			jenkinsApiRequestSpy.mockResolvedValue({
				jobs: [{ name: 'z-job' }, { name: 'A Job' }],
			});

			await expect(node.methods.loadOptions.getJobs.call(loadOptionsFunctions)).resolves.toEqual([
				{ name: 'A Job', value: 'A Job' },
				{ name: 'z-job', value: 'z-job' },
			]);
			expect(jenkinsApiRequestSpy).toHaveBeenCalledExactlyOnceWith('GET', '/api/json', {
				tree: 'jobs[name,jobs[name]]',
			});
		});

		it('lists jobs in nested folders and multibranch projects with full labels', async () => {
			jenkinsApiRequestSpy
				.mockResolvedValueOnce({
					jobs: [
						{ name: 'z-job' },
						{ name: 'Team', jobs: [{ name: 'Service' }, { name: 'build' }] },
						{ name: 'Empty', jobs: [] },
					],
				})
				.mockResolvedValueOnce({
					jobs: [{ name: 'Service', jobs: [{ name: 'main' }] }, { name: 'build' }],
				})
				.mockResolvedValueOnce({ jobs: [{ name: 'main' }] });

			await expect(node.methods.loadOptions.getJobs.call(loadOptionsFunctions)).resolves.toEqual([
				{ name: 'Team/Service/main', value: 'Team/job/Service/job/main' },
				{ name: 'Team/build', value: 'Team/job/build' },
				{ name: 'z-job', value: 'z-job' },
			]);
			expect(jenkinsApiRequestSpy.mock.calls.map(([, endpoint]) => endpoint)).toEqual([
				'/api/json',
				'/job/Team/api/json',
				'/job/Team/job/Service/api/json',
			]);
		});

		it('encodes each path segment and preserves encoded branch names', async () => {
			jenkinsApiRequestSpy
				.mockResolvedValueOnce({ jobs: [{ name: 'Team A', jobs: [{ name: 'service' }] }] })
				.mockResolvedValueOnce({ jobs: [{ name: 'service', jobs: [{ name: 'feature%2Ftest' }] }] })
				.mockResolvedValueOnce({ jobs: [{ name: 'feature%2Ftest' }] });

			await expect(node.methods.loadOptions.getJobs.call(loadOptionsFunctions)).resolves.toEqual([
				{
					name: 'Team A/service/feature%2Ftest',
					value: 'Team%20A/job/service/job/feature%252Ftest',
				},
			]);
			expect(jenkinsApiRequestSpy).toHaveBeenNthCalledWith(
				3,
				'GET',
				'/job/Team%20A/job/service/api/json',
				{ tree: 'jobs[name,jobs[name]]' },
			);
		});

		it('returns no options for an empty instance', async () => {
			jenkinsApiRequestSpy.mockResolvedValue({ jobs: [] });

			await expect(node.methods.loadOptions.getJobs.call(loadOptionsFunctions)).resolves.toEqual(
				[],
			);
		});

		it('reports folder request failures instead of returning an incomplete list', async () => {
			jenkinsApiRequestSpy
				.mockResolvedValueOnce({ jobs: [{ name: 'Team', jobs: [{ name: 'build' }] }] })
				.mockRejectedValueOnce(new Error('Forbidden'));

			await expect(node.methods.loadOptions.getJobs.call(loadOptionsFunctions)).rejects.toThrow(
				'Forbidden',
			);
		});
	});

	it('loads parameters for a selected nested job', async () => {
		loadOptionsFunctions.getCurrentNodeParameter.mockReturnValue('Team%20A/job/build');
		jenkinsApiRequestSpy.mockResolvedValue({
			property: [
				{
					_class: 'hudson.model.ParametersDefinitionProperty',
					parameterDefinitions: [{ name: 'BRANCH', type: 'StringParameterDefinition' }],
				},
			],
		});

		await expect(
			node.methods.loadOptions.getJobParameters.call(loadOptionsFunctions),
		).resolves.toEqual([{ name: 'BRANCH - (StringParameterDefinition)', value: 'BRANCH' }]);
		expect(jenkinsApiRequestSpy).toHaveBeenCalledWith('GET', '/job/Team%20A/job/build/api/json', {
			tree: 'actions[parameterDefinitions[*]],property[parameterDefinitions[*]]',
		});
	});

	it.each([
		['job', 'trigger', 'POST', '/job/Team%20A/job/build/build'],
		['job', 'triggerParams', 'POST', '/job/Team%20A/job/build/buildWithParameters'],
		['build', 'getAll', 'GET', '/job/Team%20A/job/build/api/json'],
		['job', 'copy', 'POST', '/createItem'],
	])('uses a selected nested job for %s/%s', async (resource, operation, method, endpoint) => {
		jenkinsApiRequestSpy
			.mockResolvedValueOnce({ jobs: [{ name: 'Team A', jobs: [{ name: 'build' }] }] })
			.mockResolvedValueOnce({ jobs: [{ name: 'build' }] })
			.mockResolvedValue({ builds: [] });
		const options = await node.methods.loadOptions.getJobs.call(loadOptionsFunctions);
		const executeFunctions = mockDeep<IExecuteFunctions>();
		executeFunctions.getInputData.mockReturnValue([{ json: {} }]);
		executeFunctions.getNodeParameter.mockImplementation((name: string) => {
			switch (name) {
				case 'resource':
					return resource;
				case 'operation':
					return operation;
				case 'job':
					return options[0].value;
				case 'param.params':
					return [{ name: 'BRANCH', value: 'main' }];
				case 'newJob':
					return 'build-copy';
				case 'returnAll':
					return true;
				default:
					return undefined;
			}
		});

		await node.execute.call(executeFunctions);

		const expectedArgs: unknown[] = [];
		if (operation === 'copy') {
			expectedArgs.push({ name: 'build-copy', mode: 'copy', from: 'Team A/build' });
		} else if (operation === 'triggerParams') {
			expectedArgs.push(
				{},
				{},
				{
					form: { BRANCH: 'main' },
					headers: { 'content-type': 'application/x-www-form-urlencoded' },
				},
			);
		} else if (operation === 'getAll') {
			expectedArgs.push({ tree: 'builds[*]' });
		}
		expect(jenkinsApiRequestSpy).toHaveBeenLastCalledWith(method, endpoint, ...expectedArgs);
	});

	it('passes a limited build query through the request query parameters', async () => {
		const executeFunctions = mockDeep<IExecuteFunctions>();
		executeFunctions.getInputData.mockReturnValue([{ json: {} }]);
		executeFunctions.getNodeParameter.mockImplementation((name: string) => {
			switch (name) {
				case 'resource':
					return 'build';
				case 'operation':
					return 'getAll';
				case 'job':
					return 'Team/job/build';
				case 'returnAll':
					return false;
				case 'limit':
					return 5;
				default:
					return undefined;
			}
		});
		jenkinsApiRequestSpy.mockResolvedValue({ builds: [] });

		await node.execute.call(executeFunctions);

		expect(jenkinsApiRequestSpy).toHaveBeenCalledWith('GET', '/job/Team/job/build/api/json', {
			tree: 'builds[*]{0,5}',
		});
	});

	describe('loadOptions.getJobParameters', () => {
		it('loads parameters from actions', async () => {
			jenkinsApiRequestSpy.mockResolvedValue({
				actions: [
					{
						_class: 'hudson.model.ParametersDefinitionProperty',
						parameterDefinitions: [
							{ name: 'BRANCH', type: 'StringParameterDefinition' },
							{ name: 'DRY_RUN', type: 'BooleanParameterDefinition' },
						],
					},
				],
			});

			const result = await node.methods.loadOptions.getJobParameters.call(loadOptionsFunctions);

			expect(result).toEqual<INodePropertyOptions[]>([
				{ name: 'BRANCH - (StringParameterDefinition)', value: 'BRANCH' },
				{ name: 'DRY_RUN - (BooleanParameterDefinition)', value: 'DRY_RUN' },
			]);
			expect(jenkinsApiRequestSpy).toHaveBeenCalledWith('GET', '/job/demo-job/api/json', {
				tree: 'actions[parameterDefinitions[*]],property[parameterDefinitions[*]]',
			});
		});

		it('loads parameters from property', async () => {
			jenkinsApiRequestSpy.mockResolvedValue({
				property: [
					{
						_class:
							'org.jenkinsci.plugins.workflow.job.properties.PipelineTriggersJobProperty ParametersDefinitionProperty',
						parameterDefinitions: [{ name: 'VERSION', type: 'StringParameterDefinition' }],
					},
				],
			});

			const result = await node.methods.loadOptions.getJobParameters.call(loadOptionsFunctions);

			expect(result).toEqual<INodePropertyOptions[]>([
				{ name: 'VERSION - (StringParameterDefinition)', value: 'VERSION' },
			]);
		});

		it('merges actions and property results and deduplicates parameter names', async () => {
			jenkinsApiRequestSpy.mockResolvedValue({
				actions: [
					{
						_class: 'hudson.model.ParametersDefinitionProperty',
						parameterDefinitions: [{ name: 'ENV', type: 'StringParameterDefinition' }],
					},
				],
				property: [
					{
						_class: 'hudson.model.ParametersDefinitionProperty',
						parameterDefinitions: [
							{ name: 'ENV', type: 'StringParameterDefinition' },
							{ name: 'REGION', type: 'ChoiceParameterDefinition' },
						],
					},
				],
			});

			const result = await node.methods.loadOptions.getJobParameters.call(loadOptionsFunctions);

			expect(result).toEqual<INodePropertyOptions[]>([
				{ name: 'ENV - (StringParameterDefinition)', value: 'ENV' },
				{ name: 'REGION - (ChoiceParameterDefinition)', value: 'REGION' },
			]);
		});

		it('filters non parameter classes and sorts by display name', async () => {
			jenkinsApiRequestSpy.mockResolvedValue({
				actions: [
					{
						_class: 'hudson.model.ScmProperty',
						parameterDefinitions: [
							{ name: 'SHOULD_NOT_APPEAR', type: 'StringParameterDefinition' },
						],
					},
					{
						_class: 'hudson.model.ParametersDefinitionProperty',
						parameterDefinitions: [
							{ name: 'ZZZ', type: 'StringParameterDefinition' },
							{ name: 'AAA', type: 'StringParameterDefinition' },
						],
					},
				],
			});

			const result = await node.methods.loadOptions.getJobParameters.call(loadOptionsFunctions);

			expect(result).toEqual<INodePropertyOptions[]>([
				{ name: 'AAA - (StringParameterDefinition)', value: 'AAA' },
				{ name: 'ZZZ - (StringParameterDefinition)', value: 'ZZZ' },
			]);
		});
	});

	describe('execute', () => {
		it.each(['trigger', 'triggerParams'])(
			'returns the queue identity for a %s request accepted with 201',
			async (operation) => {
				const executeFunctions = mockDeep<IExecuteFunctions>();
				executeFunctions.getInputData.mockReturnValue([{ json: {} }]);
				executeFunctions.getCredentials.mockResolvedValue({
					username: 'user',
					apiKey: 'token',
					baseUrl: 'https://jenkins.example.com',
				});
				executeFunctions.getNodeParameter.mockImplementation((name: string) => {
					if (name === 'resource') return 'job';
					if (name === 'operation') return operation;
					if (name === 'job') return 'Team/job/demo-job';
					if (name === 'param.params') return [];
					return undefined;
				});
				executeFunctions.helpers.returnJsonArray.mockImplementation((data) =>
					(Array.isArray(data) ? data : [data]).map((json) => ({ json })),
				);
				executeFunctions.helpers.request.mockResolvedValue({
					statusCode: 201,
					headers: { location: '/queue/item/123/' },
					body: '',
				});

				await expect(node.execute.call(executeFunctions)).resolves.toEqual([
					[
						{
							json: {
								success: true,
								queueId: 123,
								queueUrl: 'https://jenkins.example.com/queue/item/123/',
							},
						},
					],
				]);
				expect(executeFunctions.helpers.request).toHaveBeenCalledTimes(1);
			},
		);

		it('triggers a job with parameters successfully when jenkinsApiRequest returns queue redirect', async () => {
			const executeFunctions = mockDeep<IExecuteFunctions>();
			executeFunctions.getInputData.mockReturnValue([{ json: {} }]);
			executeFunctions.helpers.returnJsonArray.mockImplementation((data: any) =>
				data.map((item: any) => ({ json: item })),
			);
			executeFunctions.getNodeParameter.mockImplementation((name: string) => {
				if (name === 'resource') return 'job';
				if (name === 'operation') return 'triggerParams';
				if (name === 'job') return 'demo-job';
				if (name === 'param.params') return [{ name: 'BRANCH', value: 'main' }];
				return undefined;
			});
			jenkinsApiRequestSpy.mockResolvedValue({
				success: true,
				queueId: 42,
				queueUrl: 'https://jenkins.example.com/queue/item/42/',
			});

			const result = await node.execute.call(executeFunctions);

			expect(jenkinsApiRequestSpy).toHaveBeenCalledWith(
				'POST',
				'/job/demo-job/buildWithParameters',
				{},
				{},
				{
					form: { BRANCH: 'main' },
					headers: {
						'content-type': 'application/x-www-form-urlencoded',
					},
				},
			);
			expect(result).toEqual([
				[
					{
						json: {
							success: true,
							queueId: 42,
							queueUrl: 'https://jenkins.example.com/queue/item/42/',
						},
					},
				],
			]);
		});

		it('triggers a parameterless job successfully', async () => {
			const executeFunctions = mockDeep<IExecuteFunctions>();
			executeFunctions.getInputData.mockReturnValue([{ json: {} }]);
			executeFunctions.helpers.returnJsonArray.mockImplementation((data: any) =>
				data.map((item: any) => ({ json: item })),
			);
			executeFunctions.getNodeParameter.mockImplementation((name: string) => {
				if (name === 'resource') return 'job';
				if (name === 'operation') return 'trigger';
				if (name === 'job') return 'demo-job';
				return undefined;
			});
			jenkinsApiRequestSpy.mockResolvedValue({ success: true });

			const result = await node.execute.call(executeFunctions);

			expect(jenkinsApiRequestSpy).toHaveBeenCalledWith('POST', '/job/demo-job/build');
			expect(result).toEqual([[{ json: { success: true } }]]);
		});

		it('triggers a job through the real request helper when Jenkins requires a crumb and redirects to the queue', async () => {
			// The beforeEach spy calls through to the real jenkinsApiRequest, so only the HTTP layer is stubbed
			const executeFunctions = mockDeep<IExecuteFunctions>();
			executeFunctions.getInputData.mockReturnValue([{ json: {} }]);
			executeFunctions.getNode.mockReturnValue({
				name: 'Jenkins',
				type: 'n8n-nodes-base.jenkins',
				typeVersion: 1,
			} as INode);
			executeFunctions.getCredentials.mockResolvedValue({
				username: 'user',
				apiKey: 'password',
				baseUrl: 'http://jenkins:8080',
			});
			executeFunctions.helpers.returnJsonArray.mockImplementation((data: any) =>
				data.map((item: any) => ({ json: item })),
			);
			executeFunctions.getNodeParameter.mockImplementation((name: string) => {
				if (name === 'resource') return 'job';
				if (name === 'operation') return 'triggerParams';
				if (name === 'job') return 'demo-job';
				if (name === 'param.params') return [{ name: 'BRANCH', value: 'main' }];
				return undefined;
			});
			const httpError = (statusCode: number, data: string, headers = {}) =>
				Object.assign(new Error(`${statusCode} - ${JSON.stringify(data)}`), {
					statusCode,
					response: { status: statusCode, headers },
				});
			executeFunctions.helpers.request
				.mockRejectedValueOnce(httpError(403, 'No valid crumb was included in the request'))
				.mockResolvedValueOnce({
					body: { crumbRequestField: 'Jenkins-Crumb', crumb: 'test-crumb' },
					headers: { 'set-cookie': ['JSESSIONID=test-session; Path=/; HttpOnly'] },
				})
				.mockRejectedValueOnce(
					httpError(303, '', { location: 'https://jenkins.acme.com/queue/item/42/' }),
				);

			const result = await node.execute.call(executeFunctions);

			expect(result).toEqual([
				[
					{
						json: {
							success: true,
							queueId: 42,
							queueUrl: 'https://jenkins.acme.com/queue/item/42/',
						},
					},
				],
			]);
			expect(executeFunctions.helpers.request).toHaveBeenCalledTimes(3);
			expect(executeFunctions.helpers.request).toHaveBeenNthCalledWith(
				2,
				expect.objectContaining({ uri: 'http://jenkins:8080/crumbIssuer/api/json' }),
			);
			expect(executeFunctions.helpers.request).toHaveBeenLastCalledWith(
				expect.objectContaining({
					method: 'POST',
					uri: 'http://jenkins:8080/job/demo-job/buildWithParameters',
					form: { BRANCH: 'main' },
					headers: {
						Accept: 'application/json',
						'Jenkins-Crumb': 'test-crumb',
						Cookie: 'JSESSIONID=test-session',
						'content-type': 'application/x-www-form-urlencoded',
					},
				}),
			);
		});
	});
});
