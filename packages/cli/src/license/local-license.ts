import {
	LICENSE_FEATURES,
	LICENSE_QUOTAS,
	UNLIMITED_LICENSE_QUOTA,
	type BooleanLicenseFeature,
	type NumericLicenseFeature,
} from '@n8n/constants';
import type { LicenseManager, TEntitlement } from '@n8n_io/license-sdk';

/** The service uses the same interface for local features and the SDK. */
export interface LicenseAdapter
	extends Pick<
		LicenseManager,
		| 'initialize'
		| 'activate'
		| 'reloadStoredCert'
		| 'renewIfDue'
		| 'renew'
		| 'clear'
		| 'shutdown'
		| 'hasFeatureEnabled'
		| 'isValid'
		| 'getFeatureValue'
		| 'getCurrentEntitlements'
		| 'getManagementJwt'
		| 'getConsumerId'
		| 'toString'
	> {
	getExpiryDate(): Date | undefined;
	getTerminationDate(): Date | undefined;
}

// Keep the map exhaustive so new features require an explicit decision.
const FEATURES: Record<BooleanLicenseFeature, boolean> = {
	[LICENSE_FEATURES.SHARING]: true,
	[LICENSE_FEATURES.LDAP]: true,
	[LICENSE_FEATURES.SCIM]: true,
	[LICENSE_FEATURES.TYPE_AVAILABILITY_POLICIES]: true,
	[LICENSE_FEATURES.EXECUTION_LIMITS]: true,
	[LICENSE_FEATURES.SAML]: true,
	[LICENSE_FEATURES.OIDC]: true,
	[LICENSE_FEATURES.MFA_ENFORCEMENT]: true,
	[LICENSE_FEATURES.LOG_STREAMING]: true,
	[LICENSE_FEATURES.ADVANCED_EXECUTION_FILTERS]: true,
	[LICENSE_FEATURES.VARIABLES]: true,
	[LICENSE_FEATURES.SOURCE_CONTROL]: true,
	[LICENSE_FEATURES.PROMOTIONS]: true,
	[LICENSE_FEATURES.API_DISABLED]: false,
	[LICENSE_FEATURES.EXTERNAL_SECRETS]: true,
	[LICENSE_FEATURES.SHOW_NON_PROD_BANNER]: false,
	[LICENSE_FEATURES.DEBUG_IN_EDITOR]: true,
	[LICENSE_FEATURES.BINARY_DATA_S3]: true,
	[LICENSE_FEATURES.BINARY_DATA_AZURE]: true,
	[LICENSE_FEATURES.EXECUTION_DATA_S3]: true,
	[LICENSE_FEATURES.EXECUTION_DATA_AZURE]: true,
	[LICENSE_FEATURES.MULTIPLE_MAIN_INSTANCES]: true,
	[LICENSE_FEATURES.WORKER_VIEW]: true,
	[LICENSE_FEATURES.ADVANCED_PERMISSIONS]: true,
	[LICENSE_FEATURES.PROJECT_ROLE_ADMIN]: true,
	[LICENSE_FEATURES.PROJECT_ROLE_EDITOR]: true,
	[LICENSE_FEATURES.PROJECT_ROLE_VIEWER]: true,
	[LICENSE_FEATURES.AI_ASSISTANT]: true,
	[LICENSE_FEATURES.ASK_AI]: true,
	[LICENSE_FEATURES.COMMUNITY_NODES_CUSTOM_REGISTRY]: true,
	[LICENSE_FEATURES.AI_CREDITS]: false,
	[LICENSE_FEATURES.AI_GATEWAY]: false,
	[LICENSE_FEATURES.AI_GATEWAY_CLOUD_UBB]: false,
	[LICENSE_FEATURES.AI_ASSISTANT_CLOUD_UBB_ENTITLEMENT]: false,
	[LICENSE_FEATURES.FOLDERS]: true,
	[LICENSE_FEATURES.INSIGHTS_VIEW_SUMMARY]: true,
	[LICENSE_FEATURES.INSIGHTS_VIEW_DASHBOARD]: true,
	[LICENSE_FEATURES.INSIGHTS_VIEW_HOURLY_DATA]: true,
	[LICENSE_FEATURES.API_KEY_SCOPES]: true,
	[LICENSE_FEATURES.WORKFLOW_DIFFS]: true,
	[LICENSE_FEATURES.NAMED_VERSIONS]: true,
	[LICENSE_FEATURES.CUSTOM_ROLES]: true,
	[LICENSE_FEATURES.AI_BUILDER]: true,
	[LICENSE_FEATURES.DYNAMIC_CREDENTIALS]: true,
	[LICENSE_FEATURES.PERSONAL_SPACE_POLICY]: true,
	[LICENSE_FEATURES.TOKEN_EXCHANGE]: true,
	[LICENSE_FEATURES.DATA_REDACTION]: true,
	[LICENSE_FEATURES.OTEL_CUSTOM_SPAN_ATTRIBUTES]: true,
	[LICENSE_FEATURES.WORKFLOW_REVIEWS]: true,
	[LICENSE_FEATURES.WORKER_POOLS]: true,
	[LICENSE_FEATURES.TRUSTED_SOURCE_MANAGE]: true,
};

const QUOTAS: Record<NumericLicenseFeature, number> = {
	[LICENSE_QUOTAS.TRIGGER_LIMIT]: UNLIMITED_LICENSE_QUOTA,
	[LICENSE_QUOTAS.VARIABLES_LIMIT]: UNLIMITED_LICENSE_QUOTA,
	[LICENSE_QUOTAS.USERS_LIMIT]: UNLIMITED_LICENSE_QUOTA,
	[LICENSE_QUOTAS.WORKFLOW_HISTORY_PRUNE_LIMIT]: UNLIMITED_LICENSE_QUOTA,
	[LICENSE_QUOTAS.TEAM_PROJECT_LIMIT]: UNLIMITED_LICENSE_QUOTA,
	[LICENSE_QUOTAS.AI_CREDITS]: 0,
	[LICENSE_QUOTAS.AI_GATEWAY_BUDGET]: 0,
	[LICENSE_QUOTAS.INSIGHTS_MAX_HISTORY_DAYS]: UNLIMITED_LICENSE_QUOTA,
	[LICENSE_QUOTAS.INSIGHTS_RETENTION_MAX_AGE_DAYS]: 180,
	[LICENSE_QUOTAS.INSIGHTS_RETENTION_PRUNE_INTERVAL_DAYS]: 24,
	[LICENSE_QUOTAS.WORKFLOWS_WITH_EVALUATION_LIMIT]: UNLIMITED_LICENSE_QUOTA,
	[LICENSE_QUOTAS.EVALUATION_CONCURRENCY_LIMIT]: UNLIMITED_LICENSE_QUOTA,
};

export class LocalLicense implements LicenseAdapter {
	async initialize() {}

	async activate() {}

	async reloadStoredCert() {}

	async renewIfDue() {}

	async renew() {}

	async clear() {}

	async shutdown() {}

	hasFeatureEnabled(feature: string, requireValidCert = true): boolean {
		return (
			requireValidCert &&
			Object.entries(FEATURES).some(([key, enabled]) => key === feature && enabled)
		);
	}

	isValid(): boolean {
		return false;
	}

	getFeatureValue(feature: string): boolean | number | string | undefined {
		if (feature === 'planName') return 'Enterprise';
		return Object.entries({ ...FEATURES, ...QUOTAS }).find(([key]) => key === feature)?.[1];
	}

	getCurrentEntitlements(): TEntitlement[] {
		return [];
	}

	getManagementJwt(): string {
		return '';
	}

	getConsumerId(): string {
		return 'local';
	}

	getExpiryDate() {
		return undefined;
	}

	getTerminationDate() {
		return undefined;
	}

	toString(): string {
		return 'Local enterprise features';
	}
}
