# Process Manager on Cloud Run behind IAP

A small set-up for a demo or a first installation: **one** Cloud Run service runs the portal's
Go server (the image from the repository's `Dockerfile`). It answers `/api/*` and serves the
app's pages, which live in a **private** Cloud Storage bucket mounted read-only into the service.
Postgres has a private address only and is reached through a Serverless VPC Access connector.
Identity-Aware Proxy (IAP) is the gate in front of the service: only members of one Google group
get through. Behind the gate, the portal signs people in with Google itself, as it always does.

```
browser
   |
   v
IAP  (only members of GROUP_EMAIL get through)
   |
   v
Cloud Run service SERVICE  [Go server, port 8080]
   |                         \
   |  /srv/www (read-only)    \  private address, through the VPC connector
   v                          v
bucket BUCKET              Postgres
(the app's files)          (processes, standards, roles, ...)
```

**Read "Not tested" at the end first.** Nothing here has been run against a real project: the
commands and the service definition were written from Google's documentation and need to be
checked on the first deployment.

Files:

| | |
| --- | --- |
| `service.yaml` | the Cloud Run service, for `gcloud run services replace` |
| `upload-app.sh` | builds the app and uploads it to the bucket in a safe order |

## Two sign-ins, two separate checks

People sign in twice, and the two checks are independent:

- **IAP** decides whether a person may reach the portal at all: they must be in `GROUP_EMAIL`.
  The portal does not read anything IAP sends along and does not rely on it.
- **The portal's own sign-in** (Google, limited to your Workspace domain) says *who* the person
  is inside the portal: their name, their roles, what they may change.

So a person could pass IAP with one account and then sign in to the portal with another account
of the same Workspace domain. That is expected: IAP keeps everyone else out, the portal's roles
decide what each signed-in person can do.

## Before you start

- A Google Cloud project with billing, and the right to create service accounts, buckets,
  secrets and Cloud Run services and to change IAM in it.
- `gcloud` (signed in), Docker, Node.js 22 and npm, `openssl`, and this repository.
- Postgres 16 or newer with a **private address** in a VPC network of the project (for example
  Cloud SQL with private IP), and a **Serverless VPC Access connector** in the same region on that
  network. Search by meaning stays off here, so the database does not need pgvector.
- An Artifact Registry Docker repository in the region (created in step 6 if you have none).
- A Google group whose members may use the portal, and a Google Workspace domain.
- The APIs switched on:

  ```sh
  gcloud services enable run.googleapis.com artifactregistry.googleapis.com \
    secretmanager.googleapis.com iap.googleapis.com vpcaccess.googleapis.com \
    storage.googleapis.com --project "$PROJECT_ID"
  ```

Set these once in your shell; every command below uses them:

```sh
PROJECT_ID=your-project-id
REGION=your-region                      # e.g. the region of the database and the connector
SERVICE=process-manager                 # the Cloud Run service
BUCKET=your-bucket-name                 # the private bucket for the app's files
REPOSITORY=your-artifact-repository     # Artifact Registry, Docker format
CONNECTOR=your-vpc-connector            # Serverless VPC Access connector in REGION
SERVICE_ACCOUNT=process-manager-run     # the service's own service account (name part)
GROUP_EMAIL=your-group@your-domain      # who may get through IAP
WORKSPACE_DOMAIN=your-domain            # who may sign in to the portal
ADMIN_EMAIL=you@your-domain             # the first admin of the portal

PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
SA="$SERVICE_ACCOUNT@$PROJECT_ID.iam.gserviceaccount.com"
BASE_URL="https://$SERVICE-$PROJECT_NUMBER.$REGION.run.app"   # the portal's address
```

## Steps

### 1. The service account

The service runs as its own service account, which may read the bucket and the secrets and
nothing else.

```sh
gcloud iam service-accounts create "$SERVICE_ACCOUNT" \
  --display-name="Process Manager portal" --project "$PROJECT_ID"
```

### 2. The private bucket

Uniform bucket-level access and public access prevention: nobody outside the project can read
the files, and no one can make them public by mistake. Do not grant `allUsers` or
`allAuthenticatedUsers` anything on it.

```sh
gcloud storage buckets create "gs://$BUCKET" --project "$PROJECT_ID" --location "$REGION" \
  --uniform-bucket-level-access --public-access-prevention

gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" \
  --member="serviceAccount:$SA" --role=roles/storage.objectViewer
```

### 3. The database

Create a database and a user for the portal. The user must be able to **create tables** in that
database (make it the owner): the server creates and upgrades its tables itself at every start,
under a lock, so two instances starting at the same time is safe.

The database address, with the private address of the server:

```
postgres://USER:PASSWORD@PRIVATE_IP:5432/DATABASE?sslmode=require
```

`sslmode=require` encrypts the connection but does not check the server's certificate;
checking it (`verify-full`) would need the database's CA certificate inside the container, which
the image does not hold. On a private address this is the usual choice. Use `sslmode=disable`
only if the database does not offer encryption at all.

### 4. The OAuth client for the portal's own sign-in

In the Google Cloud console, under *Google Auth Platform* (formerly *APIs & Services › OAuth
consent screen*):

1. Set the audience (user type) to **Internal**, so only accounts of your Workspace can sign in.
   IAP needs this too.
2. Create an OAuth client of type **Web application**, with the authorised redirect address

   ```
   https://SERVICE-PROJECT_NUMBER.REGION.run.app/auth/callback
   ```

   that is, `$BASE_URL/auth/callback`. It must match `PM_BASE_URL` in `service.yaml` exactly.

Keep the client id and the client secret for the next step. This client is the portal's own;
IAP uses its own sign-in and does not need it.

### 5. The secrets

Four values go into Secret Manager; the service reads the latest version of each.

```sh
# a long random value that signs the portal's session cookie
openssl rand -base64 48 | tr -d '\n' | \
  gcloud secrets create pm-session-secret --data-file=- --project "$PROJECT_ID"

# the database address from step 3 (paste it after the command, press Enter, then Ctrl-D)
gcloud secrets create pm-database-url --data-file=- --project "$PROJECT_ID"

# the OAuth client from step 4
printf '%s' 'CLIENT_ID' | gcloud secrets create pm-oidc-client-id --data-file=- --project "$PROJECT_ID"
printf '%s' 'CLIENT_SECRET' | gcloud secrets create pm-oidc-client-secret --data-file=- --project "$PROJECT_ID"

for s in pm-session-secret pm-database-url pm-oidc-client-id pm-oidc-client-secret; do
  gcloud secrets add-iam-policy-binding "$s" --project "$PROJECT_ID" \
    --member="serviceAccount:$SA" --role=roles/secretmanager.secretAccessor
done
```

The server ignores spaces and line breaks around these values, so a line break at the end does
no harm.
Commands typed with secrets stay in your shell history: clear it afterwards, or create the
secrets in the console.

### 6. The image

Build the image from the repository root and push it to Artifact Registry, tagged with the
commit it comes from.

```sh
# once, if the repository does not exist yet
gcloud artifacts repositories create "$REPOSITORY" --repository-format=docker \
  --location="$REGION" --project "$PROJECT_ID"
gcloud auth configure-docker "$REGION-docker.pkg.dev"

IMAGE_TAG=$(git rev-parse --short HEAD)
IMAGE="$REGION-docker.pkg.dev/$PROJECT_ID/$REPOSITORY/process-manager:$IMAGE_TAG"
docker build -t "$IMAGE" .
docker push "$IMAGE"
```

The image also contains a copy of the app, but this set-up does not use it: `PM_STATIC_DIR`
points the server at the bucket.

### 7. Upload the app

```sh
BUCKET="$BUCKET" deploy/cloudrun/upload-app.sh
```

It runs `npm ci` and `npm run build`, then uploads `dist/`: the files under `assets/` first, the
other files next, `index.html` last, so that a browser never gets a page that asks for files
that are not there yet. Files of earlier versions under `assets/` are left in place (people who
still have the previous page open need them); the script prints how to remove them later.

Until `index.html` is in the bucket, the portal answers its pages with "The portal's pages are
not in place yet" (status 503), the API keeps working, and the server log has a warning at start
that names the folder. Once the file is there it is used without a restart.

### 8. Deploy

Fill in the placeholders of `service.yaml` into a copy (do not commit the filled copy), then
create or update the service. `SERVICE_ACCOUNT` must be replaced before `SERVICE`.

```sh
sed -e "s|SERVICE_ACCOUNT|$SERVICE_ACCOUNT|g" -e "s|SERVICE|$SERVICE|g" \
    -e "s|PROJECT_NUMBER|$PROJECT_NUMBER|g" -e "s|PROJECT_ID|$PROJECT_ID|g" \
    -e "s|REGION|$REGION|g" -e "s|REPOSITORY|$REPOSITORY|g" -e "s|IMAGE_TAG|$IMAGE_TAG|g" \
    -e "s|BUCKET|$BUCKET|g" -e "s|CONNECTOR|$CONNECTOR|g" \
    -e "s|WORKSPACE_DOMAIN|$WORKSPACE_DOMAIN|g" -e "s|ADMIN_EMAIL|$ADMIN_EMAIL|g" \
    deploy/cloudrun/service.yaml > /tmp/service.filled.yaml
grep -nE '[A-Z]{2,}_[A-Z_]+' /tmp/service.filled.yaml | grep -vE 'PM_|DATABASE_URL'   # placeholders left?

gcloud run services replace /tmp/service.filled.yaml --project "$PROJECT_ID" --region "$REGION"
```

What the definition sets: second-generation environment; port 8080; the service account from
step 1; the bucket mounted read-only at `/srv/www`; the VPC connector, used only for private
addresses; CPU always allocated and at least one instance, because the server keeps working
after it has answered (it sends notifications and brings generated skills and counts up to date
in the background); a start-up check on `/healthz`; 1 CPU and 512 MiB; the settings and the four
secrets. Nobody is given the right to call the service without IAP.

### 9. Switch IAP on and let the group in

```sh
# IAP's own service agent must exist and be allowed to call the service
gcloud beta services identity create --service=iap.googleapis.com --project="$PROJECT_ID"
gcloud run services add-iam-policy-binding "$SERVICE" --region "$REGION" --project "$PROJECT_ID" \
  --member="serviceAccount:service-$PROJECT_NUMBER@gcp-sa-iap.iam.gserviceaccount.com" \
  --role=roles/run.invoker

# only if `describe` below does not show IAP as on (the line in service.yaml did not take effect)
gcloud beta run services update "$SERVICE" --region "$REGION" --project "$PROJECT_ID" --iap

# who may get through
gcloud iap web add-iam-policy-binding --project "$PROJECT_ID" \
  --resource-type=cloud-run --service="$SERVICE" --region="$REGION" \
  --member="group:$GROUP_EMAIL" --role=roles/iap.httpsResourceAccessor

gcloud beta run services describe "$SERVICE" --region "$REGION" --project "$PROJECT_ID"
# look for:  Iap Enabled: true
```

Do not grant `roles/run.invoker` to `allUsers` and do not deploy with
`--allow-unauthenticated`: that would open a way around IAP.

### 10. The first admin

`PM_ADMINS` in `service.yaml` (here `ADMIN_EMAIL`) is always an admin, so there is always a way
in. Sign in with that account and give others their roles in the portal under Admin › Access.
More than one first admin: separate the addresses with commas. Changing the list needs a new
deployment (step 8).

### 11. Check that it works

1. Open `$BASE_URL` in a browser, signed in to Google with an account in `GROUP_EMAIL`. IAP may
   ask you to choose an account; then the portal appears.
2. Choose *Sign in* in the portal. Google's sign-in opens and **comes back to the portal**,
   signed in, with your name shown. If it ends on an error page from Google about the redirect
   address, the OAuth client's redirect address (step 4) and `PM_BASE_URL` differ. Always open
   the portal at `PM_BASE_URL`: Cloud Run may show a second address for the same service, and
   the sign-in only comes back to the one in `PM_BASE_URL`.
3. Open the browser's developer tools, *Network* tab, and reload: the files under `/assets/`
   must answer 200. If they answer 404 while the page itself loads (a blank page), the mount
   does not show the `assets/` folder: check that `mountOptions: implicit-dirs` is in the
   definition and accepted (see "Not tested").
4. From a private window, or with an account that is not in the group: IAP refuses, the portal
   never answers. `curl -sI "$BASE_URL"` must not return the portal's page.
5. The log:

   ```sh
   gcloud run services logs read "$SERVICE" --region "$REGION" --project "$PROJECT_ID" --limit 100
   ```

   You should see an entry `listening` with the address `0.0.0.0:8080` and `auth` `google`, and
   one saying `search by meaning is off`. You should **not** see "the portal's pages are not in place" (step 7) or
   "configuration:" (a missing or wrong setting; the message says which).

## Releasing a new version

The image and the app must come from **the same commit**: the page and the server it talks to
change together.

```sh
git checkout <the commit to release>
IMAGE_TAG=$(git rev-parse --short HEAD)
# step 6: build and push the image with this tag
# step 8: fill in service.yaml with this IMAGE_TAG and replace the service
# step 7: upload the app, right after the deployment
```

Deploy and upload one right after the other: deploying first means the new page never talks to
the old server. Take a backup of the database before each release: the new server upgrades the
tables when it starts.

## Rolling back

```sh
gcloud run revisions list --service "$SERVICE" --region "$REGION" --project "$PROJECT_ID"
gcloud run services update-traffic "$SERVICE" --region "$REGION" --project "$PROJECT_ID" \
  --to-revisions=REVISION_NAME=100
```

Then upload the app of the same commit as that revision (`git checkout` it, run
`upload-app.sh`). If the release upgraded the tables, the older server may not work on them:
restore the backup taken before the release. Before the next release, send all traffic to the
latest revision again (`--to-latest`).

## Deliberately not here

- **The MCP server for agents**: not part of this deployment.
- **Search by meaning**: `PM_EMBEDDINGS` is not set, so it is off, nothing is sent to Vertex AI
  and the database does not need pgvector.
- **Terraform**: the team keeps that in its own repository; these steps say what it must create.
- **A load balancer and your own domain**: see below.

## Later, behind the load balancer

The usual set-up puts the bucket and the service behind an HTTPS load balancer. When moving
there:

- **Security headers.** The Go server sets the content security policy and the other security
  headers on everything it answers (`guard` in `server/internal/httpapi/api.go`). If the load
  balancer serves the bucket directly, those headers must be added there (custom response
  headers on the backend bucket), with the same values.
- **One address.** The app and `/api` must stay on one address (`/api/*` and `/auth/*` to the
  service, the rest to the bucket): the session cookie, the content security policy (`'self'`)
  and the sign-in redirect all depend on it. `PM_BASE_URL` and the OAuth client's redirect
  address change to the new address.
- **Paths of the app.** The server answers any path without a file extension with `index.html`;
  the load balancer needs the same rule for the bucket, and answers for missing files under
  `/assets/` must stay "not found".
- **IAP** moves to the load balancer's backend: it cannot be on the Cloud Run service and the
  load balancer at the same time.

## Not tested

Nothing here was run against a real project. Look here first when something does not work:

1. **IAP in the definition.** `run.googleapis.com/iap-enabled: "true"` in `service.yaml` is
   listed in Google's YAML reference but was not tried. If `services replace` refuses it, remove
   the line and use `gcloud beta run services update --iap` (step 9; `gcloud run deploy --iap`
   also exists). Whether the command needs `beta` was not confirmed. If IAP is switched on by
   command only, check after every `services replace` that `describe` still shows
   `Iap Enabled: true`.
2. **IAP's service agent.** The `gcloud beta services identity create --service=iap.googleapis.com`
   command and the `roles/run.invoker` grant to `service-PROJECT_NUMBER@gcp-sa-iap.iam.gserviceaccount.com`
   come from Google's guide; the console grants it by itself when IAP is switched on there.
3. **Letting the group in.** The flags of `gcloud iap web add-iam-policy-binding`
   (`--resource-type=cloud-run --service --region`) were confirmed only from search results;
   some pages show it with `beta`.
4. **The bucket volume.** The field names (`csi`, `driver: gcsfuse.run.googleapis.com`,
   `readOnly`, `volumeAttributes.bucketName`, `volumeAttributes.mountOptions`) match Google's
   reference but were not tried. `implicit-dirs` is there because files uploaded with
   `gcloud storage cp` leave `assets/` as a folder that exists only in the files' names, which the
   mount does not show without it; whether Cloud Run accepts this option was not confirmed. If it
   is refused, remove it and check step 11.3; a bucket with hierarchical namespace would not
   need it.
5. **How soon an upload shows.** The mount may remember for a short while that a file was
   missing or what a folder held. After an upload, the new page may take up to a minute or so to
   appear. Not measured.
6. **The other settings in `service.yaml`.** `vpc-access-egress: private-ranges-only`,
   `cpu-throttling: "false"`, `minScale`/`maxScale`, `execution-environment: gen2` and the
   start-up check (Cloud Run allows at most 240 seconds in total for it; 10 s x 24 is exactly
   that) were written from Google's reference and not tried. 512 MiB was not measured under
   load.
7. **The address.** `https://SERVICE-PROJECT_NUMBER.REGION.run.app` is the address format Cloud
   Run gives services; `gcloud run services describe` may also show an older form. Both reach
   the service, but only the one in `PM_BASE_URL` completes the sign-in.
8. **Smaller commands.** `--public-access-prevention` on `gcloud storage buckets create`,
   `gcloud storage rsync --delete-unmatched-destination-objects` (printed by `upload-app.sh` for
   the cleanup) and `gcloud run services logs read` were not run.
9. **The consent screen.** Where the Internal setting sits in the console has moved over time
   (*Google Auth Platform* today).
