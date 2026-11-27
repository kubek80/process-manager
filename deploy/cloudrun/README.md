# Pattern Catalog on Cloud Run behind IAP

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
commands and the service definition were written from Google's documentation, Google's samples
and search results, and need to be checked on the first deployment.

Files:

| | |
| --- | --- |
| `service.yaml` | the Cloud Run service, with placeholders; never filled in place |
| `fill-service.sh` | fills in the placeholders from shell variables and writes a copy to deploy |
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

The two sessions also run out separately. When **IAP's** session runs out while a portal page is
open, the page's requests to the server are answered by IAP instead of the portal (it asks the
browser to sign in to Google again), and the portal shows **"The server cannot be reached. Is it
running?"**, also when someone saves. **Reloading the page** fixes it: IAP signs the person in
again and the portal works as before. A save that showed this message did not happen; after the
reload, check and save again. (The portal's side of this is how the app handles a failed request;
IAP's side comes from Google's description of IAP sessions and was not tried.)

## Before you start

- A Google Cloud project that belongs to a **Google Workspace or Cloud Identity organisation**
  (needed for the *Internal* sign-in audience in step 4), with billing.
- For the person deploying: the right to create service accounts, buckets, secrets and Cloud
  Run services and to change IAM in the project, and **`roles/iam.serviceAccountUser` on the
  service's own service account** (step 1), without which Cloud Run refuses to deploy a service
  that runs as it.
- `gcloud` (signed in), Docker, Node.js 22 and npm, `openssl`, and this repository.
- Postgres 16 or newer with a **private address** in a VPC network of the project (for example
  Cloud SQL with private IP), and a **Serverless VPC Access connector** in the same region on that
  network. Search by meaning stays off here, so the database does not need pgvector.
- A Google group whose members may use the portal. The first admin (step 10) must be in it too.
- The APIs switched on (add `cloudbuild.googleapis.com` if you build with `gcloud builds submit`):

  ```sh
  gcloud services enable run.googleapis.com iap.googleapis.com secretmanager.googleapis.com \
    artifactregistry.googleapis.com vpcaccess.googleapis.com storage.googleapis.com \
    --project "$PROJECT_ID"
  ```

Set these once in your shell and replace each value on the right with your own; every command
below, and `fill-service.sh`, uses them. A value left as its own name is refused by
`fill-service.sh`.

```sh
export PROJECT_ID=PROJECT_ID               # the project's id
export REGION=REGION                       # the region of the database and the connector
export SERVICE=SERVICE                     # the Cloud Run service: keep it short (see step 8)
export BUCKET=BUCKET                       # the private bucket for the app's files
export REPOSITORY=REPOSITORY               # Artifact Registry repository, Docker format
export CONNECTOR=CONNECTOR                 # Serverless VPC Access connector in REGION
export SERVICE_ACCOUNT=SERVICE_ACCOUNT     # the service's own service account (name part)
export GROUP_EMAIL=GROUP_EMAIL             # the Google group that may get through IAP
export WORKSPACE_DOMAIN=WORKSPACE_DOMAIN   # who may sign in to the portal
export ADMIN_EMAIL=ADMIN_EMAIL             # the first admin of the portal
export DEPLOYER_EMAIL=DEPLOYER_EMAIL       # you, the person deploying

export PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
export SA="$SERVICE_ACCOUNT@$PROJECT_ID.iam.gserviceaccount.com"
# the address of the service; checked against Cloud Run's own answer in step 8
export PORTAL_URL="https://$SERVICE-$PROJECT_NUMBER.$REGION.run.app"
```

## Steps

### 1. The service account

The service runs as its own service account, which may read the bucket and the secrets and
nothing else. You need the right to deploy a service that runs as it.

```sh
gcloud iam service-accounts create "$SERVICE_ACCOUNT" \
  --display-name="Pattern Catalog portal" --project "$PROJECT_ID"

gcloud iam service-accounts add-iam-policy-binding "$SA" --project "$PROJECT_ID" \
  --member="user:$DEPLOYER_EMAIL" --role=roles/iam.serviceAccountUser
```

A new service account can take a few seconds (sometimes a minute) before grants on it work: if a
grant in the next steps says the account does not exist, wait and run it again.

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
postgres://DB_USER:DB_PASSWORD@DB_PRIVATE_IP:5432/DB_NAME?sslmode=require
```

- **Special characters in the password** (`@ : / ? # % &` and the like) must be
  percent-encoded in the address, for example `@` as `%40` and `%` as `%25`, or the address is
  read wrongly.
- `sslmode=require` encrypts the connection but does not check the server's certificate;
  checking it (`verify-full`) would need the database's CA certificate inside the container,
  which the image does not hold. On a private address this is the usual choice. Use
  `sslmode=disable` only if the database does not offer encryption at all.

**Sample content.** On its first start with an empty database, the server fills it with the
repository's sample processes, standards and lists (teams, platforms, practices, tools and so on;
from `/app/seed` in the image). That suits a demo. It happens only while the database holds no
documents at all, so it never overwrites anything later. There is no setting to switch it off;
what there is:

- **To remove it afterwards:** an admin deletes the sample processes and standards in the
  portal (on each one's editing screen, *More › Delete…*) and changes or removes the list
  entries in *Admin › Teams* and *Admin › Tools* (an entry still used cannot be removed).
  The lists themselves stay, so the database is never empty again and the samples do not come
  back.
- **To start without it:** set `PM_SEED_DIR` to a folder that does not exist, for example
  `/app/no-seed`, and `PM_SCHEMA_DIR=/app/seed/schema` (the formats are read from
  `PM_SEED_DIR/schema` by default and are still needed). The portal then starts with no
  processes, no standards and empty lists, which an admin fills in the portal. This was not tried.
- **To start with your own content:** build your own image with your files in `/app/seed`, in the
  same layout as `processes/`, `standards/` and `catalog/` in this repository.

### 4. The OAuth client for the portal's own sign-in

In the Google Cloud console, under *Google Auth Platform* (formerly *APIs & Services › OAuth
consent screen*):

1. Set the audience (user type) to **Internal**, so only accounts of your organisation can sign
   in. IAP needs this too. It is only offered when the project belongs to an organisation.
2. Create an OAuth client of type **Web application**, with the authorised redirect address
   `$PORTAL_URL/auth/callback`, that is

   ```
   https://SERVICE-PROJECT_NUMBER.REGION.run.app/auth/callback
   ```

   It must match `PM_BASE_URL` of the service exactly. Step 8 checks that this is really the
   service's address; if it is not, change the redirect address here.

Keep the client id and the client secret for the next step. This client is the portal's own;
IAP uses its own sign-in and does not need it.

### 5. The secrets

Four values go into Secret Manager; the service reads the latest version of each. Never put a
secret on the command line or in `printf '…'`: it stays in your shell history. Paste it instead:
run the command, paste the value, press Enter, then Ctrl-D.

```sh
# a long random value that signs the portal's session cookie (never shown)
openssl rand -base64 48 | tr -d '\n' | \
  gcloud secrets create pm-session-secret --data-file=- --project "$PROJECT_ID"

# paste the database address from step 3
gcloud secrets create pm-database-url --data-file=- --project "$PROJECT_ID"
# paste the OAuth client id from step 4
gcloud secrets create pm-oidc-client-id --data-file=- --project "$PROJECT_ID"
# paste the OAuth client secret from step 4
gcloud secrets create pm-oidc-client-secret --data-file=- --project "$PROJECT_ID"

for s in pm-session-secret pm-database-url pm-oidc-client-id pm-oidc-client-secret; do
  gcloud secrets add-iam-policy-binding "$s" --project "$PROJECT_ID" \
    --member="serviceAccount:$SA" --role=roles/secretmanager.secretAccessor
done
```

The server ignores spaces and line breaks around these values, so the line break from pressing
Enter does no harm.

### 6. The image

Build the image from the repository root, **for `linux/amd64`** (on an Apple-silicon Mac a plain
`docker build` makes an arm64 image and Cloud Run fails with "exec format error"), and push it to
Artifact Registry, tagged with the commit it comes from.

```sh
# once, if the repository does not exist yet
gcloud artifacts repositories create "$REPOSITORY" --repository-format=docker \
  --location="$REGION" --project "$PROJECT_ID"
gcloud auth configure-docker "$REGION-docker.pkg.dev"

export IMAGE_TAG=$(git rev-parse --short HEAD)
IMAGE="$REGION-docker.pkg.dev/$PROJECT_ID/$REPOSITORY/process-manager:$IMAGE_TAG"
docker build --platform linux/amd64 -t "$IMAGE" .
docker push "$IMAGE"
```

Without Docker, Cloud Build builds it in the project instead (it builds for `linux/amd64`):
`gcloud builds submit --tag "$IMAGE" --project "$PROJECT_ID" .`

The image also contains a copy of the app, but this set-up does not use it: `PM_STATIC_DIR`
points the server at the bucket.

### 7. Upload the app

```sh
deploy/cloudrun/upload-app.sh        # reads BUCKET; gs:// in front is accepted
```

It runs `npm ci` and `npm run build`, then uploads `dist/`: the files under `assets/` first, the
other files next, `index.html` last, so that a browser never gets a page that asks for files
that are not there yet. Files of earlier versions under `assets/` are left in place (people who
still have the previous page open need them); the script prints how to remove them later.

Until `index.html` is in the bucket, the portal answers its pages with "The portal's pages are
not in place yet" (status 503), the API keeps working, and the server log has a warning at start
that names the folder. Once the file is there it is used without a restart.

### 8. Deploy

`fill-service.sh` fills in the placeholders of `service.yaml` from the shell variables and writes
the result to its output. Write it outside the repository and never commit it. It refuses to run
when a variable is empty or still its own name.

```sh
deploy/cloudrun/fill-service.sh > /tmp/service.filled.yaml
gcloud run services replace /tmp/service.filled.yaml --project "$PROJECT_ID" --region "$REGION"
```

Then check the address:

```sh
gcloud run services describe "$SERVICE" --region "$REGION" --project "$PROJECT_ID" \
  --format='value(status.url)'
```

`PM_BASE_URL` (`PORTAL_URL`) and the OAuth client's redirect address must be **that** address.
The short form `https://SERVICE-PROJECT_NUMBER.REGION.run.app` only exists when the service name
and the project number together are short enough (at most 63 characters); otherwise Cloud Run
gives only an address with a random part. Keep the service name short. If the address differs,
set `PORTAL_URL` to it, change the redirect address (step 4), and run the two commands above
again.

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

# who may get through
gcloud iap web add-iam-policy-binding --project "$PROJECT_ID" \
  --resource-type=cloud-run --service="$SERVICE" --region="$REGION" \
  --member="group:$GROUP_EMAIL" --role=roles/iap.httpsResourceAccessor

# is IAP on?
gcloud run services describe "$SERVICE" --region "$REGION" --project "$PROJECT_ID"
```

The output should contain `Iap Enabled: true` (from the `run.googleapis.com/iap-enabled` line
in `service.yaml`). **If it does not**, switch IAP on by command and look again:

```sh
gcloud run services update "$SERVICE" --region "$REGION" --project "$PROJECT_ID" --iap
gcloud run services describe "$SERVICE" --region "$REGION" --project "$PROJECT_ID"
```

If your `gcloud` does not know `--iap` there, update it, or try `gcloud beta run services update`.
If IAP had to be switched on by command, check `describe` again after every later deployment.

Do not grant `roles/run.invoker` to `allUsers` and do not deploy with
`--allow-unauthenticated`: that would open a way around IAP.

### 10. The first admin

`PM_ADMINS` (here `ADMIN_EMAIL`) is always an admin, so there is always a way in. That person
must also be in `GROUP_EMAIL`, or IAP keeps them out. Sign in with that account and give others
their roles in the portal under Admin › Access. More than one first admin: separate the
addresses with commas. Changing the list needs a new deployment (step 8).

### 11. Check that it works

1. Open `$PORTAL_URL` in a browser, signed in to Google with an account in `GROUP_EMAIL`. IAP
   may ask you to choose an account; then the portal appears, with the sample content (step 3)
   on a new database.
2. Choose *Sign in* in the portal. Google's sign-in opens and **comes back to the portal**,
   signed in, with your name shown. If Google shows an error about the redirect address, the
   OAuth client's redirect address (step 4) and `PM_BASE_URL` differ. Always open the portal at
   `PM_BASE_URL`: the sign-in only comes back to that address.
3. Open the browser's developer tools, *Network* tab, and reload: the files under `/assets/`
   must answer 200. If they answer 404 while the page itself loads (a blank page), the mount
   does not show the `assets/` folder: check that `mountOptions: implicit-dirs` is in the
   deployed definition (see "Not tested").
4. From a private window, or with an account that is not in the group: IAP refuses, the portal
   never answers. `curl -sI "$PORTAL_URL"` must not return the portal's page.
5. The log:

   ```sh
   gcloud run services logs read "$SERVICE" --region "$REGION" --project "$PROJECT_ID" --limit 100
   ```

   You should see an entry `listening` with the address `0.0.0.0:8080` and `auth` `google`, one
   saying `search by meaning is off`, and on the first start `content imported` (the sample
   content). You should **not** see "the portal's pages are not in place" (step 7) or
   "configuration:" (a missing or wrong setting; the message says which).

Known behaviour, not a fault:

- "The server cannot be reached. Is it running?" after the portal has been open for a long time:
  IAP's session ran out. Reload the page (see "Two sign-ins, two separate checks").
- A blank or cut-off page right after a new version was uploaded: reload (see "Releasing a new
  version").

## Releasing a new version

The image and the app must come from **the same commit**: the page and the server it talks to
change together.

```sh
git checkout COMMIT
export IMAGE_TAG=$(git rev-parse --short HEAD)
# step 6: build and push the image with this tag
# step 8: fill in service.yaml with this IMAGE_TAG and replace the service
# step 7: upload the app, right after the deployment
```

Deploy and upload one right after the other: deploying first means the new page never talks to
the old server. Take a backup of the database before each release: the new server upgrades the
tables when it starts.

**For about a minute after the upload, some people may get a broken page**, not just the old one:
a blank or cut-off page. The mount keeps what it knows about each file (its size, for example)
for about a minute, and reading a file that was replaced in the bucket in the meantime fails
halfway. Only `index.html` is replaced (the other files have new names in every version), so a
reload fixes it. Upload at a quiet time.

## Rolling back

```sh
gcloud run revisions list --service "$SERVICE" --region "$REGION" --project "$PROJECT_ID"
gcloud run services update-traffic "$SERVICE" --region "$REGION" --project "$PROJECT_ID" \
  --to-revisions=REVISION_NAME=100
```

Then upload the app of the same commit as that revision. An older commit may not have
`upload-app.sh`, so use the current script on a separate checkout of the old commit:

```sh
git worktree add /tmp/pm-rollback OLD_COMMIT
APP_DIR=/tmp/pm-rollback deploy/cloudrun/upload-app.sh
git worktree remove /tmp/pm-rollback
```

If the release upgraded the tables, the older server may not work on them: restore the backup
taken before the release. Before the next release, send all traffic to the latest revision again
(`--to-latest`).

## Deliberately not here

- **The MCP server for agents**: not part of this deployment.
- **Search by meaning**: `PM_EMBEDDINGS` is not set, so it is off, nothing is sent to Vertex AI
  and the database does not need pgvector.
- **The files of Admin › Code map**: `PM_SOURCE_DIR` is not set, because the image holds no
  source code and no git; the code map shows its paths, requirements, charts and tables, without
  the files themselves.
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

1. **Switching IAP on.** Google's release notes say IAP directly on Cloud Run is generally
   available (found by search, not read), and a deploy script of Google's uses
   `gcloud run deploy … --no-allow-unauthenticated --iap` without `beta`. The line
   `run.googleapis.com/iap-enabled: "true"` in the service's own annotations is what Google's
   Terraform sample sets, but it is not among the annotations the Cloud Run v1 API describes.
   Not tried: whether `services replace` accepts that line and switches IAP on, whether a later
   `services replace` keeps IAP on, and the exact form of `gcloud run services update --iap`.
2. **IAP's service agent.** The `gcloud beta services identity create --service=iap.googleapis.com`
   command and the `roles/run.invoker` grant to
   `service-PROJECT_NUMBER@gcp-sa-iap.iam.gserviceaccount.com` come from Google's guide; the
   console grants it by itself when IAP is switched on there.
3. **Letting the group in.** The flags of `gcloud iap web add-iam-policy-binding`
   (`--resource-type=cloud-run --service --region`) were confirmed only from search results;
   some pages show it with `beta`.
4. **The bucket volume.** The field names (`csi`, `driver: gcsfuse.run.googleapis.com`,
   `readOnly`, `volumeAttributes.bucketName`, `volumeAttributes.mountOptions`) and
   `implicit-dirs` match Google's reference and the Cloud Storage FUSE documentation, but were
   not tried on Cloud Run. Files uploaded with `gcloud storage cp` leave `assets/` as a folder
   that exists only in the files' names, which the mount does not show without `implicit-dirs`;
   a bucket with hierarchical namespace would not need it.
5. **Right after an upload.** The mount keeps file information for about a minute, and Cloud
   Storage FUSE fails a read of a file whose object was replaced in the meantime. So for about a
   minute after an upload the server can start sending the old `index.html` and fail halfway: a
   blank or cut-off page that a reload fixes. A shorter cache would shorten this; the mount
   option for it was not confirmed for Cloud Run, so none is set.
6. **IAP's session.** That the app's requests are answered by IAP (and the portal says "The
   server cannot be reached") when IAP's session runs out comes from Google's description of
   IAP sessions; how long that session lasts and exactly what IAP answers were not tried.
7. **The other settings in `service.yaml`.** `vpc-access-egress: private-ranges-only`,
   `cpu-throttling: "false"`, `minScale`/`maxScale` and `execution-environment: gen2` were
   written from Google's reference and not tried. The start-up check is tried every 10 seconds
   up to 24 times; the v1 API gives 240 as the largest `periodSeconds` (and
   `initialDelaySeconds`) but says nothing about a limit on the total. 512 MiB was not measured
   under load.
8. **The address.** Whether the short form of the address exists for your service depends on
   the length of its name (step 8); `describe` is what counts.
9. **Starting without the sample content** (step 3) by pointing `PM_SEED_DIR` elsewhere was not
   tried.
10. **Smaller commands.** `--public-access-prevention` on `gcloud storage buckets create`,
    `gcloud storage rsync --delete-unmatched-destination-objects` (printed by `upload-app.sh` for
    the cleanup), `gcloud builds submit` and `gcloud run services logs read` were not run.
11. **The consent screen.** Where the Internal setting sits in the console has moved over time
    (*Google Auth Platform* today).
