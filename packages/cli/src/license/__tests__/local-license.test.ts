import { LicenseState } from '@n8n/backend-common';
import { mockLogger } from '@n8n/backend-test-utils';
import { GlobalConfig } from '@n8n/config';
import {
	LICENSE_FEATURES,
	LICENSE_QUOTAS,
	UNLIMITED_LICENSE_QUOTA,
	type BooleanLicenseFeature,
} from '@n8n/constants';
import type { SettingsRepository } from '@n8n/db';
import { Container } from '@n8n/di';
import { LicenseManager } from '@n8n_io/license-sdk';
import type { InstanceSettings } from 'n8n-core';
import { mock } from 'vitest-mock-extended';

import { License } from '@/license';
import { LocalLicense } from '@/license/local-license';
import type { LicenseMetricsService } from '@/metrics/license-metrics.service';

vi.mock('@n8n_io/license-sdk');

const excludedFeatures: BooleanLicenseFeature[] = [
	LICENSE_FEATURES.API_DISABLED,
	LICENSE_FEATURES.SHOW_NON_PROD_BANNER,
	LICENSE_FEATURES.AI_CREDITS,
	LICENSE_FEATURES.AI_GATEWAY,
	LICENSE_FEATURES.AI_GATEWAY_CLOUD_UBB,
	LICENSE_FEATURES.AI_ASSISTANT_CLOUD_UBB_ENTITLEMENT,
];

describe('LocalLicense', () => {
	const adapter = new LocalLicense();

	test.each(Object.values(LICENSE_FEATURES))('returns an explicit boolean for %s', (feature) => {
		const expected = !excludedFeatures.includes(feature);
		expect(adapter.hasFeatureEnabled(feature)).toBe(expected);
		expect(adapter.getFeatureValue(feature)).toBe(expected);
	});

	test('returns no value for unknown features', () => {
		expect(adapter.hasFeatureEnabled('feat:future')).toBe(false);
		expect(adapter.getFeatureValue('feat:future')).toBeUndefined();
	});

	test.each(Object.values(LICENSE_QUOTAS))('returns a finite number for %s', (quota) => {
		expect(Number.isFinite(adapter.getFeatureValue(quota))).toBe(true);
	});

	test('keeps hosted balances at zero and retention maintenance finite', () => {
		expect(adapter.getFeatureValue(LICENSE_QUOTAS.AI_CREDITS)).toBe(0);
		expect(adapter.getFeatureValue(LICENSE_QUOTAS.AI_GATEWAY_BUDGET)).toBe(0);
		expect(adapter.getFeatureValue(LICENSE_QUOTAS.INSIGHTS_RETENTION_MAX_AGE_DAYS)).toBe(180);
		expect(adapter.getFeatureValue(LICENSE_QUOTAS.INSIGHTS_RETENTION_PRUNE_INTERVAL_DAYS)).toBe(24);
	});

	test('does not issue certificates or management credentials', () => {
		expect(adapter.isValid()).toBe(false);
		expect(adapter.hasFeatureEnabled(LICENSE_FEATURES.SHARING, false)).toBe(false);
		expect(adapter.getCurrentEntitlements()).toEqual([]);
		expect(adapter.getManagementJwt()).toBe('');
		expect(adapter.getExpiryDate()).toBeUndefined();
		expect(adapter.getTerminationDate()).toBeUndefined();
	});
});

describe.each(['production', 'development'])('local override in %s', (nodeEnv) => {
	const settings = mock<SettingsRepository>();
	const metrics = mock<LicenseMetricsService>();
	const instanceSettings = mock<InstanceSettings>({ instanceType: 'main', isLeader: true });

	beforeEach(() => {
		vi.clearAllMocks();
		vi.stubEnv('NODE_ENV', nodeEnv);
		Container.reset();
	});

	afterEach(() => vi.unstubAllEnvs());

	function createLicense() {
		return new License(
			mockLogger(),
			instanceSettings,
			settings,
			metrics,
			Container.get(GlobalConfig),
		);
	}

	test.each([undefined, 'false'])('uses the SDK when the flag is %s', async (flag) => {
		vi.stubEnv('N8N_LOCAL_LICENSE_OVERRIDE_ENABLED', flag);
		const license = createLicense();
		await license.init();
		expect(LicenseManager).toHaveBeenCalledOnce();
		expect(LicenseManager.prototype.initialize).toHaveBeenCalledOnce();
	});

	test('serves local features through LicenseState without the SDK', async () => {
		vi.stubEnv('N8N_LOCAL_LICENSE_OVERRIDE_ENABLED', 'true');
		const license = createLicense();
		await license.init();
		const state = new LicenseState();
		state.setLicenseProvider(license);

		expect(state.isSharingLicensed()).toBe(true);
		expect(state.isVariablesLicensed()).toBe(true);
		expect(state.isCustomRolesLicensed()).toBe(true);
		expect(state.isTeamProjectsLicensed()).toBe(true);
		expect(state.getMaxUsers()).toBe(UNLIMITED_LICENSE_QUOTA);
		expect(state.getMaxActiveWorkflows()).toBe(UNLIMITED_LICENSE_QUOTA);
		expect(state.getMaxVariables()).toBe(UNLIMITED_LICENSE_QUOTA);
		expect(state.getMaxTeamProjects()).toBe(UNLIMITED_LICENSE_QUOTA);
		expect(state.getWorkflowHistoryPruneQuota()).toBe(UNLIMITED_LICENSE_QUOTA);
		expect(state.getMaxWorkflowsWithEvaluations()).toBe(UNLIMITED_LICENSE_QUOTA);
		expect(state.getEvaluationConcurrencyQuota()).toBe(UNLIMITED_LICENSE_QUOTA);
		expect(state.isAPIDisabled()).toBe(false);
		expect(state.getMaxAiCredits()).toBe(0);
		expect(license.getPlanName()).toBe('Enterprise');
		expect(LicenseManager).not.toHaveBeenCalled();
	});

	test('keeps stored certificates unchanged during lifecycle operations', async () => {
		vi.stubEnv('N8N_LOCAL_LICENSE_OVERRIDE_ENABLED', 'true');
		settings.findOne.mockResolvedValue(null);
		const license = createLicense();
		await license.init();
		await license.init({ forceRecreate: true });
		await license.activate('unused');
		await license.renew();
		await license.renewIfDue();
		await license.reload();
		await license.clear();
		await license.saveCertStr('unused');
		await license.shutdown();
		await license.init({ forceRecreate: true });

		expect(settings.upsert).not.toHaveBeenCalled();
		expect(metrics.collectUsageMetrics).not.toHaveBeenCalled();
		expect(metrics.collectPassthroughData).not.toHaveBeenCalled();
		expect(LicenseManager).not.toHaveBeenCalled();
		expect(license.isLicensed(LICENSE_FEATURES.SHARING)).toBe(true);
	});
});
