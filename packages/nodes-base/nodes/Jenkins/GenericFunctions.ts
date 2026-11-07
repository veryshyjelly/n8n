import type {
	IDataObject,
	IExecuteFunctions,
	IHookFunctions,
	ILoadOptionsFunctions,
	JsonObject,
	IRequestOptions,
	IHttpRequestMethods,
} from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';

import { removeTrailingSlash } from '@utils/utilities';

async function getJenkinsCrumb(
	this: IHookFunctions | IExecuteFunctions | ILoadOptionsFunctions,
	credentials: IDataObject,
): Promise<IDataObject | null> {
	const options: IRequestOptions = {
		headers: {
			Accept: 'application/json',
		},
		method: 'GET',
		auth: {
			username: credentials.username as string,
			password: credentials.apiKey as string,
		},
		sendCredentialsOnCrossOriginRedirect: false,
		uri: `${removeTrailingSlash((credentials.baseUrl as string) || '')}/crumbIssuer/api/json`,
		json: true,
		resolveWithFullResponse: true,
	};
	const response = (await this.helpers.request(options)) as {
		body?: IDataObject;
		headers?: Record<string, string | string[]>;
	};
	const body = response?.body;
	if (!body?.crumbRequestField || !body.crumb) {
		return null;
	}

	const crumbHeaders: IDataObject = {
		[body.crumbRequestField as string]: body.crumb as string,
	};
	// Since Jenkins 2.176.2 a crumb is only valid together with the session it was issued for
	const setCookie = response.headers?.['set-cookie'];
	if (setCookie) {
		crumbHeaders.Cookie = (Array.isArray(setCookie) ? setCookie : [setCookie])
			.map((cookie) => cookie.split(';', 1)[0])
			.join('; ');
	}
	return crumbHeaders;
}

// Jenkins only reports a missing crumb in the body of the 403 response
function isMissingCrumbError(error: JsonObject): boolean {
	return Number(error.statusCode) === 403 && /no valid crumb/i.test(String(error.message ?? ''));
}

/**
 * Read the queue item URL from an accepted build response.
 */
function getQueueItemUrl(result: JsonObject, baseUrl: string): string | undefined {
	const response = result.response as JsonObject | undefined;
	const rawStatusCode = result.statusCode ?? result.httpCode ?? result.status ?? response?.status;
	if (![201, 302, 303].includes(Number(rawStatusCode))) {
		return undefined;
	}

	const headers = (response?.headers ?? result.headers ?? {}) as Record<string, string | undefined>;
	const location = headers.location ?? headers.Location;
	if (typeof location !== 'string') {
		return undefined;
	}

	// Only the path is checked: the Location host or scheme can differ from the base URL,
	// e.g. with Docker networking or a TLS-terminating proxy
	try {
		const target = new URL(location, baseUrl);
		if (/\/queue\/item\/\d+\/?$/.test(target.pathname)) {
			return target.href;
		}
	} catch {
		// Invalid base URL or Location header
	}
	return undefined;
}

export async function jenkinsApiRequest(
	this: IHookFunctions | IExecuteFunctions | ILoadOptionsFunctions,
	method: IHttpRequestMethods,
	uri: string,
	qs: IDataObject = {},
	body: any = '',
	option: IDataObject = {},
): Promise<any> {
	const credentials = await this.getCredentials('jenkinsApi');
	const baseUrl = (credentials.baseUrl as string) || '';
	const isBuildTrigger = method === 'POST' && /\/(?:build|buildWithParameters)$/.test(uri);
	const triggerResult = (result: JsonObject = {}): IDataObject => {
		const queueUrl = getQueueItemUrl(result, baseUrl);
		if (!queueUrl) return { success: true };
		const queueId = Number(new URL(queueUrl).pathname.split('/').filter(Boolean).pop());
		return { success: true, queueId, queueUrl };
	};

	const buildOptions = (extraHeaders: IDataObject = {}): IRequestOptions => {
		const options: IRequestOptions = {
			method,
			auth: {
				username: credentials.username as string,
				password: credentials.apiKey as string,
			},
			sendCredentialsOnCrossOriginRedirect: false,
			uri: `${removeTrailingSlash(baseUrl)}${uri}`,
			json: true,
			qs,
			body,
		};
		return Object.assign(
			{},
			options,
			option,
			isBuildTrigger
				? {
						resolveWithFullResponse: true,
						followRedirect: false,
						followAllRedirects: false,
					}
				: {},
			{
				headers: {
					Accept: 'application/json',
					...extraHeaders,
					...(option.headers as IDataObject | undefined),
				},
			},
		);
	};

	const sendRequest = async () => {
		try {
			return await this.helpers.request(buildOptions());
		} catch (error) {
			// API token requests skip the CSRF check, so a crumb is only fetched when
			// Jenkins asks for one (e.g. password auth) and the request is retried once
			if (!isMissingCrumbError(error)) throw error;
			const crumb = await getJenkinsCrumb.call(this, credentials);
			if (!crumb) throw error;
			return await this.helpers.request(buildOptions(crumb));
		}
	};

	try {
		const result = await sendRequest();
		return isBuildTrigger ? triggerResult(result) : result;
	} catch (error) {
		if (isBuildTrigger && getQueueItemUrl(error as JsonObject, baseUrl)) {
			return triggerResult(error as JsonObject);
		}

		throw new NodeApiError(this.getNode(), error as JsonObject);
	}
}
