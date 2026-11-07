import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const database = new DatabaseSync('/home/node/.n8n/database.sqlite', { readOnly: true });
const reference = process.argv[2] ? JSON.parse(readFileSync(process.argv[2], 'utf8')) : undefined;
const tables = [
	'user',
	'auth_identity',
	'workflow_entity',
	'credentials_entity',
	'shared_credentials',
	'shared_workflow',
	'execution_entity',
	'execution_data',
	'workflow_history',
	'settings',
	'deployment_key',
	'ai_preference',
	'instance_ai_threads',
	'instance_ai_messages',
	'agent_history',
];

function quote(identifier) {
	return `"${identifier.replaceAll('"', '""')}"`;
}

const snapshot = {};
try {
	for (const table of tables) {
		const columns =
			reference?.[table]?.columns ??
			database
				.prepare(`PRAGMA table_info(${quote(table)})`)
				.all()
				.map((column) => column.name);
		const rows = database
			.prepare(`SELECT ${columns.map(quote).join(',')} FROM ${quote(table)}`)
			.all();
		const hashes = rows
			.map((row) => createHash('sha256').update(JSON.stringify(row)).digest('hex'))
			.sort();
		snapshot[table] = {
			columns,
			count: rows.length,
			hash: createHash('sha256').update(hashes.join('\n')).digest('hex'),
		};
	}
	console.log(JSON.stringify(snapshot));
} finally {
	database.close();
}

if (reference && JSON.stringify(snapshot) !== JSON.stringify(reference)) {
	throw new Error('Copied data differs from the reference snapshot.');
}
