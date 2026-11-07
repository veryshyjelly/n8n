# Local replacement

For current source builds, fresh installations, and updates to `~/n8n`, follow the
[installation and update guide](../../INSTALL.md).
The migration steps below describe the original 2.46.6-to-2.47.0 cutover.
Use them only when the original containers and data volume are still the migration source.

Set `N8N_LOCAL_LICENSE_OVERRIDE_ENABLED=true` to enable local enterprise features.
The default is `false`. Run `docker compose up -d` after you change this value in the deployment configuration.
The flag applies in production and development.
It does not provide hosted AI services or Gateway credits.
Existing AI provider settings and setup checks still apply.

The explicit feature map enables local capabilities. It keeps API disabling,
the non-production banner, and hosted billing features off.
Count quotas, workflow history, and evaluation quotas use the existing unlimited value.
History retention still follows the instance configuration.
Insights maintenance keeps finite retention values and intervals.
Authentication, scopes, configuration gates, and readiness checks still apply.
The editor reads features through the normal settings API.

The adapter does not activate, renew, or report usage to the license server.
It does not issue a signed certificate or a management token.
Stored certificates stay unchanged. Set the flag to `false` to restore normal licensing.

## Prepare the original installation

Build both images with the [source build instructions](../../INSTALL.md#build-the-images).
Keep `IMAGE_TAG` set to the tag from that build.

Run `node docker/local-override/prepare.mjs` to save the current environment.
This writes private files with mode `0600` under the ignored `.build/local-deployment` directory.
The Compose definition keeps port 5678 and the existing `n8n_default` network.
The existing sandbox and SearXNG containers stay running.

Create `.build/local-deployment/compose.env` with `N8N_LOCAL_IMAGE_TAG` set to the image tag:

```sh
umask 077
printf 'N8N_LOCAL_IMAGE_TAG=%s\n' "$IMAGE_TAG" > .build/local-deployment/compose.env
```

Use this command for the replacement:

```sh
docker compose --env-file .build/local-deployment/compose.env \
  -f docker/local-override/compose.yaml up -d
```

## Cutover

Validate both images on a fresh volume first.
Check editor loading and JavaScript and Python execution.

Stop `n8n-n8n-1` and `n8n-runners-1` before the final copy.
Copy all files from `n8n_n8n-data` to the new `n8n_local_2470_data` volume.
Mount the original volume read-only during the copy.
Keep the original volume and stopped containers.

Use a one-off CLI command on the copy to apply migrations.
Do not start the server or scheduled workflows during this check.
Compare account, workflow, credential, execution, and workflow history counts.
Validate credential decryption without printing or saving decrypted values on the host.
Start the replacement only after these checks pass.
Check readiness, account access, and sidecar connections.

## Rollback

Stop the replacement before you restart the original containers:

```sh
docker compose --env-file .build/local-deployment/compose.env \
  -f docker/local-override/compose.yaml stop
docker start n8n-n8n-1 n8n-runners-1
```

The original volume contains data from cutover time.
Later writes stay in the replacement volume. Do not delete either volume during rollback.
