#!/bin/sh
# Builds the app and uploads it to the private bucket the Cloud Run service mounts at /srv/www.
#
#   BUCKET=BUCKET deploy/cloudrun/upload-app.sh
#
# Run it from the same commit as the image you deploy (deploy/cloudrun/README.md, "Releasing a
# new version"). Needs Node.js, npm and gcloud signed in with the right to write to the bucket.
#
# Order matters: a browser that gets the new index.html must find every file it asks for, so
# the files under assets/ go first, the other files next, and index.html last.
# Files of earlier versions under assets/ are NOT deleted: people who still have the previous
# page open need them. The cleanup is printed at the end, to run later.
set -eu

if [ -z "${BUCKET:-}" ]; then
  echo "Set BUCKET to the name of the bucket that holds the app's files, e.g.:" >&2
  echo "  BUCKET=your-bucket-name $0" >&2
  exit 2
fi

# work from the repository root, wherever the script is started from
cd "$(dirname "$0")/../.."

npm ci
npm run build

if [ ! -f dist/index.html ]; then
  echo "The build did not produce dist/index.html: nothing was uploaded." >&2
  exit 1
fi

# 1. the scripts, styles and images the page asks for (their names change with every version)
if [ -d dist/assets ]; then
  gcloud storage cp --recursive dist/assets "gs://$BUCKET/"
fi

# 2. everything else except the page itself
for f in dist/*; do
  case "$f" in
    dist/assets | dist/index.html) continue ;;
  esac
  if [ -d "$f" ]; then
    gcloud storage cp --recursive "$f" "gs://$BUCKET/"
  else
    gcloud storage cp "$f" "gs://$BUCKET/"
  fi
done

# 3. the page last: from now on browsers load the new version
gcloud storage cp dist/index.html "gs://$BUCKET/index.html"

echo
echo "Uploaded to gs://$BUCKET. Files of earlier versions are still in gs://$BUCKET/assets/."
echo "To remove them later (for example a day from now), from this same build run:"
echo "  gcloud storage rsync --recursive --delete-unmatched-destination-objects dist/assets gs://$BUCKET/assets"
