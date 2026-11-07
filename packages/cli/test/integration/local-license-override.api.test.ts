import { LicenseState } from '@n8n/backend-common';
import { createWorkflow, getPersonalProject, mockInstance } from '@n8n/backend-test-utils';
import { GlobalConfig } from '@n8n/config';
import type { User } from '@n8n/db';
import { Container } from '@n8n/di';

import { ActiveWorkflowManager } from '@/active-workflow-manager';
import { License } from '@/license';

import { createMember, createOwner } from './shared/db/users';
import * as utils from './shared/utils';

const server = utils.setupTestServer({
	endpointGroups: ['variables', 'project', 'workflows', 'evaluation'],
});
mockInstance(ActiveWorkflowManager);

let owner: User;
let member: User;
let otherMember: User;

beforeAll(async () => {
	const config = Container.get(GlobalConfig);
	config.license.localOverrideEnabled = true;
	const license = Container.get(License);
	// Replace the test server's feature mock with the runtime provider.
	license.isLicensed = License.prototype.isLicensed.bind(license);
	license.getValue = License.prototype.getValue.bind(license);
	await license.init();
	Container.get(LicenseState).setLicenseProvider(license);
	owner = await createOwner();
	member = await createMember();
	otherMember = await createMember();
});

test('lets the owner create variables and keeps member permissions', async () => {
	await server
		.authAgentFor(owner)
		.post('/variables')
		.send({ key: 'LOCAL_TEST', value: 'value' })
		.expect(200);
	await server
		.authAgentFor(member)
		.post('/variables')
		.send({ key: 'MEMBER_TEST', value: 'value' })
		.expect(403);
	await server.authlessAgent.get('/variables').expect(401);
});

test('lets the owner create a project and keeps project access checks', async () => {
	const response = await server
		.authAgentFor(owner)
		.post('/projects')
		.send({ name: 'Local project' })
		.expect(200);
	await server.authAgentFor(otherMember).get(`/projects/${response.body.data.id}`).expect(403);
});

test('shares a workflow and keeps sharing permissions', async () => {
	const workflow = await createWorkflow({}, owner);
	const personalProject = await getPersonalProject(member);
	const otherProject = await getPersonalProject(otherMember);
	await server
		.authAgentFor(owner)
		.put(`/workflows/${workflow.id}/share`)
		.send({ shareWithIds: [personalProject.id] })
		.expect(200);
	await server
		.authAgentFor(member)
		.put(`/workflows/${workflow.id}/share`)
		.send({ shareWithIds: [personalProject.id, otherProject.id] })
		.expect(403);
});

test('serves evaluations and keeps workflow access checks', async () => {
	const workflow = await createWorkflow({}, member);
	await server.authAgentFor(member).get(`/workflows/${workflow.id}/test-runs`).expect(200);
	await server.authAgentFor(otherMember).get(`/workflows/${workflow.id}/test-runs`).expect(404);
});
