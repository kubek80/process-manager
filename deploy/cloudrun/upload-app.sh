#!/bin/sh
# Builds the app and uploads it to the private bucket the Cloud Run service mounts at /srv/www.
#
#   BUCKET=BUCKET deploy/cloudrun/upload-app.sh
#
# BUCKET is the bucket's name, with or without gs:// in front. APP_DIR (optional) is the
# checkout to build; by default the one this script is in. To upload the app of an older
# commit (rolling back), check it out elsewhere and point APP_DIR at it, using this script:
#
#   git worktree add /tmp/pm-old OLD_COMMIT
#   APP_DIR=/tmp/pm-old BUCKET=BUCKET deploy/cloudrun/upload-app.sh
#
# Run it from the same commit as the image you deploy (README, "Releasing a new version").
# Needs Node.js, npm and gcloud signed in with the right to write to the bucket.
#
# Order matters: a browser that gets the new index.html must find every file it asks for, so
# the files under assets/ go first, the other files next, and index.html last.
# Files of earlier versions under assets/ are NOT deleted: people who still have the previous
# page open need them. The cleanup is printed at the end, to run later.
set -eu

bucket=${BUCKET:-}
bucket=${bucket#gs://}
bucket=${bucket%/}
if [ -z "$bucket" ]; then
  echo "Set BUCKET to the name of the bucket that holds the app's files, e.g.:" >&2
  echo "  BUCKET=your-bucket-name $0" >&2
  exit 2
fi

# the checkout to build: APP_DIR, or the repository this script is in
cd "${APP_DIR:-$(dirname "$0")/../..}"

npm ci
npm run build

if [ ! -f dist/index.html ]; then
  echo "The build did not produce dist/index.html: nothing was uploaded." >&2
  exit 1
fi

# 1. the scripts, styles and images the page asks for (their names change with every version)
if [ -d dist/assets ]; then
  gcloud storage cp --recursive dist/assets "gs://$bucket/"
fi

# 2. everything else except the page itself
for f in dist/*; do
  case "$f" in
    dist/assets | dist/index.html) continue ;;
  esac
  if [ -d "$f" ]; then
    gcloud storage cp --recursive "$f" "gs://$bucket/"
  else
    gcloud storage cp "$f" "gs://$bucket/"
  fi
done

# 3. the page last: from now on browsers load the new version
gcloud storage cp dist/index.html "gs://$bucket/index.html"

echo
echo "Uploaded to gs://$bucket. Files of earlier versions are still in gs://$bucket/assets/."
echo "For about a minute some people may get a blank or cut-off page; reloading fixes it."
echo "To remove the old files later (for example a day from now), from this same build run:"
echo "  gcloud storage rsync --recursive --delete-unmatched-destination-objects $(pwd)/dist/assets gs://$bucket/assets"
