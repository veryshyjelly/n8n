# Install and update this fork

Build the application and task runner images from this repository.
The source checkout and the deployment directory are separate:

- Source: `~/veryshyjelly/n8n`
- Deployment: `~/n8n`
- Editor: `http://localhost:5678`

## Requirements

- Node.js 24 or later. The Docker images pin Node.js 26.12.1.
- pnpm 12.4.2, as specified in `package.json`. See the [pnpm setup instructions](CONTRIBUTING.md#pnpm).
- Docker with Buildx Bake and Compose. Compose must support `env_file.format: raw`.
- Git and OpenSSL.

## Get the source

For a new checkout:

```sh
mkdir -p ~/veryshyjelly
git clone https://github.com/veryshyjelly/n8n.git ~/veryshyjelly/n8n
cd ~/veryshyjelly/n8n
```

For an existing checkout:

```sh
cd ~/veryshyjelly/n8n
git pull --ff-only
```

The existing checkout has pnpm under `.build/tooling/bin`.
Add that directory to `PATH` before you build:

```sh
export PATH="$PWD/.build/tooling/bin:$PATH"
pnpm --version
docker buildx version
docker compose version
```

The `.build` directory is ignored by Git. A fresh clone needs pnpm installed separately.

## Build the images

Run these commands from the source checkout.
Use `linux/arm64` on Apple Silicon. Use `linux/amd64` on an x86-64 host.

If this checkout uses the existing local Docker tooling directory, first set:

```sh
export DOCKER_CONFIG="$PWD/.build/tooling/docker"
```

Use this setting when Docker cannot find the Buildx plugin on this machine.
For a standard Docker installation, use its existing configuration.

```sh
mkdir -p .build/logs
export DOCKER_PLATFORM=linux/arm64
export N8N_VERSION="$(node -p "require('./package.json').version")"
export N8N_RELEASE_TYPE=stable
export IMAGE_BASE_NAME=local/n8n
export RUNNERS_IMAGE_BASE_NAME=local/n8n-runners
export IMAGE_TAG="${N8N_VERSION}-$(git rev-parse --short=10 HEAD)"

pnpm install --frozen-lockfile > .build/logs/install.log 2>&1
pnpm build:docker > .build/logs/docker-build.log 2>&1
```

Check the command exit status before you continue. Inspect the logs if a command fails:

```sh
tail -n 30 .build/logs/install.log
tail -n 30 .build/logs/docker-build.log
```

The build creates both images and records them in `docker-build-manifest.json`:

```text
local/n8n:<IMAGE_TAG>
local/n8n-runners:<IMAGE_TAG>
```

Keep the exported values for the installation steps below.
The `stable` release type preserves the setting used by the local deployment.
The full build regenerates node definitions and credential metadata.
Use it when you update Jenkins nodes or credentials.

## Fresh installation

Use this section for a new deployment directory.
If `~/n8n` already contains an installation, use [Update an existing installation](#update-an-existing-installation).

In the same shell used for the build, create the configuration files:

```sh
umask 077
mkdir -p ~/n8n
cd ~/n8n

cat > .env <<EOF
N8N_APP_IMAGE=local/n8n:${IMAGE_TAG}
N8N_RUNNERS_IMAGE=local/n8n-runners:${IMAGE_TAG}
N8N_VERSION=${N8N_VERSION}
N8N_DOCKER_PLATFORM=${DOCKER_PLATFORM}
N8N_PORT=5678
N8N_DATA_VOLUME=n8n_local_data
N8N_LOCAL_LICENSE_OVERRIDE_ENABLED=false
EOF

runner_token="$(openssl rand -hex 32)"
printf '%s\n' \
  'N8N_RUNNERS_ENABLED=true' \
  'N8N_RUNNERS_MODE=external' \
  'N8N_RUNNERS_BROKER_LISTEN_ADDRESS=0.0.0.0' \
  "N8N_RUNNERS_AUTH_TOKEN=${runner_token}" \
  'N8N_SECURE_COOKIE=false' \
  'GENERIC_TIMEZONE=UTC' > n8n.env
printf '%s\n' \
  "N8N_RUNNERS_AUTH_TOKEN=${runner_token}" \
  'N8N_RUNNERS_TASK_BROKER_URI=http://n8n:5679' > runners.env
unset runner_token
```

Save this as `~/n8n/docker-compose.yml`:

```yaml
name: n8n-local

services:
  n8n:
    image: ${N8N_APP_IMAGE:?Set N8N_APP_IMAGE}
    platform: ${N8N_DOCKER_PLATFORM:-linux/arm64}
    pull_policy: never
    restart: unless-stopped
    env_file:
      - path: ./n8n.env
        format: raw
    environment:
      N8N_VERSION: ${N8N_VERSION}
      N8N_LOCAL_LICENSE_OVERRIDE_ENABLED: ${N8N_LOCAL_LICENSE_OVERRIDE_ENABLED:-false}
    ports:
      - '127.0.0.1:${N8N_PORT:-5678}:5678'
    volumes:
      - data:/home/node/.n8n
    healthcheck:
      test:
        - CMD
        - node
        - -e
        - "fetch('http://127.0.0.1:5678/healthz/readiness').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
      interval: 30s
      timeout: 10s
      start_period: 60s
      retries: 3

  runners:
    image: ${N8N_RUNNERS_IMAGE:?Set N8N_RUNNERS_IMAGE}
    platform: ${N8N_DOCKER_PLATFORM:-linux/arm64}
    pull_policy: never
    restart: unless-stopped
    env_file:
      - path: ./runners.env
        format: raw
    depends_on:
      n8n:
        condition: service_healthy

volumes:
  data:
    name: ${N8N_DATA_VOLUME:-n8n_local_data}
```

Start the application:

```sh
docker compose config --quiet
docker compose up -d --wait
docker compose ps
```

Open http://localhost:5678 and create the owner account.
The fresh installation creates its own data volume and Compose network.
See [local replacement](docker/local-override/README.md) to migrate the original local installation and preserve its connected services.

## Update an existing installation

Build the new images before you change the deployment configuration.
Keep a backup of the data volume and the current Compose and environment files.
Keep environment files private, with mode `0600`.

The existing local installation uses:

- Deployment directory: `~/n8n`
- Data volume: `n8n_local_2470_data`
- External network: `n8n_default`
- Connected services: `sandbox-api` and `searxng`

Keep these settings and the existing application and runner environment files.
Update the image references to the tags from the completed build.

For the fresh-install template above, update `N8N_APP_IMAGE` and `N8N_RUNNERS_IMAGE` in `~/n8n/.env`.
The older local deployment pins the application image directly in `docker-compose.yml`.
Update `services.n8n.image` there to `local/n8n:<IMAGE_TAG>`.
Its runner image uses `${N8N_IMAGE_TAG}`. Update `N8N_IMAGE_TAG` in `.env` to the new runner tag.
Updating that variable alone does not change a pinned application image.

If the application version changes, also update `N8N_VERSION` in `.env`.
Apply the configuration from the deployment directory:

```sh
cd ~/n8n
docker compose config --quiet
docker compose up -d --wait
docker compose ps
docker compose logs --tail=100 n8n runners
```

Compose recreates services whose configuration or image changed.
`docker compose restart` does not apply new environment files or image references.
The Compose file uses local images and does not build or pull them.

## Check the update

Reload the editor after the application becomes healthy.
Check your saved workflows and credentials.
Run a small JavaScript Code node and a Python Code node to check both task runners.

For Jenkins:

- The job list includes jobs inside folders and multibranch projects.
- Trigger operations return `success`, `queueId`, and `queueUrl` when Jenkins supplies a queue location.
- HTTP Request supports **Authentication → Predefined Credential Type → Jenkins API**.
  Select an existing saved Jenkins credential. Its username and API token are reused.

The [local enterprise feature flag](docker/local-override/README.md) is optional.
Set `N8N_LOCAL_LICENSE_OVERRIDE_ENABLED=true` in the deployment `.env` file to enable it.
Apply that change with `docker compose up -d`.

## Roll back an image update

Restore the previous image references in the deployment configuration.
Run `docker compose up -d --wait` from `~/n8n`.
Keep the existing data volume and environment files.

If an upgrade changed the database schema, use a compatible backup for the older version.
See [the original cutover rollback](docker/local-override/README.md#rollback) only when returning to the preserved 2.46.6 containers.
