import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const output = `${root}.build/local-deployment`;
mkdirSync(output, { recursive: true, mode: 0o700 });

function inspect(type, names) {
	return JSON.parse(execFileSync('docker', [type, 'inspect', ...names], { encoding: 'utf8' }));
}

const containers = inspect('container', ['n8n-n8n-1', 'n8n-runners-1']);
const images = inspect(
	'image',
	containers.map((container) => container.Image),
);
writeFileSync(`${output}/original-containers.json`, JSON.stringify(containers), { mode: 0o600 });

for (const [index, container] of containers.entries()) {
	const inherited = new Set(images[index].Config.Env);
	const env = container.Config.Env.filter((entry) => !inherited.has(entry));
	if (env.some((entry) => /[\r\n]/.test(entry))) {
		throw new Error('Environment values must fit on one line.');
	}
	const name = index === 0 ? 'app' : 'runners';
	writeFileSync(`${output}/${name}.env`, `${env.join('\n')}\n`, { mode: 0o600 });
	console.log(`Saved ${name} environment (${env.length} values).`);
}
