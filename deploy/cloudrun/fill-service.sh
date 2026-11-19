#!/bin/sh
# Fills in the placeholders of deploy/cloudrun/service.yaml and writes the result to stdout.
# Write it outside the repository and never commit the filled copy:
#
#   deploy/cloudrun/fill-service.sh > /tmp/service.filled.yaml
#
# Every placeholder comes from the shell variable of the same name (README, "Before you
# start"): SERVICE SERVICE_ACCOUNT PROJECT_ID REGION REPOSITORY IMAGE_TAG BUCKET CONNECTOR
# WORKSPACE_DOMAIN ADMIN_EMAIL PORTAL_URL. It refuses to run when one is empty, and refuses its
# own result when a placeholder is left in it.
set -eu

: "${SERVICE:?Set SERVICE: the name of the Cloud Run service}"
: "${SERVICE_ACCOUNT:?Set SERVICE_ACCOUNT: the name part of the service account}"
: "${PROJECT_ID:?Set PROJECT_ID: the project id}"
: "${REGION:?Set REGION: the region of the service}"
: "${REPOSITORY:?Set REPOSITORY: the Artifact Registry repository}"
: "${IMAGE_TAG:?Set IMAGE_TAG: the tag of the image to deploy (the commit)}"
: "${BUCKET:?Set BUCKET: the bucket with the app files}"
: "${CONNECTOR:?Set CONNECTOR: the Serverless VPC Access connector}"
: "${WORKSPACE_DOMAIN:?Set WORKSPACE_DOMAIN: the Workspace domain people sign in with}"
: "${ADMIN_EMAIL:?Set ADMIN_EMAIL: the first admin (several: separated by commas)}"
: "${PORTAL_URL:?Set PORTAL_URL: the address of the service, https://...}"

BUCKET=${BUCKET#gs://}
BUCKET=${BUCKET%/}

# the values go into sed: refuse the characters that would change what sed does
for value in "$SERVICE" "$SERVICE_ACCOUNT" "$PROJECT_ID" "$REGION" "$REPOSITORY" "$IMAGE_TAG" \
  "$BUCKET" "$CONNECTOR" "$WORKSPACE_DOMAIN" "$ADMIN_EMAIL" "$PORTAL_URL"; do
  case "$value" in
    *'|'* | *'&'* | *'\'* | *'"'*)
      echo "The value \"$value\" contains | & \\ or \": not allowed here." >&2
      exit 2
      ;;
  esac
done
case "$PORTAL_URL" in
  https://*) ;;
  *)
    echo "PORTAL_URL must start with https://" >&2
    exit 2
    ;;
esac

# The longer names first: SERVICE_ACCOUNT before SERVICE.
filled=$(sed \
  -e "s|PORTAL_URL|${PORTAL_URL%/}|g" \
  -e "s|SERVICE_ACCOUNT|$SERVICE_ACCOUNT|g" \
  -e "s|SERVICE|$SERVICE|g" \
  -e "s|PROJECT_ID|$PROJECT_ID|g" \
  -e "s|REGION|$REGION|g" \
  -e "s|REPOSITORY|$REPOSITORY|g" \
  -e "s|IMAGE_TAG|$IMAGE_TAG|g" \
  -e "s|BUCKET|$BUCKET|g" \
  -e "s|CONNECTOR|$CONNECTOR|g" \
  -e "s|WORKSPACE_DOMAIN|$WORKSPACE_DOMAIN|g" \
  -e "s|ADMIN_EMAIL|$ADMIN_EMAIL|g" \
  "$(dirname "$0")/service.yaml")

# a value that is still the placeholder's own name (as in the README's variables block)
left=$(printf '%s\n' "$filled" | grep -nE 'PORTAL_URL|SERVICE|PROJECT_ID|REGION|REPOSITORY|IMAGE_TAG|BUCKET|CONNECTOR|WORKSPACE_DOMAIN|ADMIN_EMAIL' || true)
if [ -n "$left" ]; then
  echo "Placeholders are left in the result: set the variables to your own values." >&2
  printf '%s\n' "$left" >&2
  exit 1
fi

printf '%s\n' "$filled"
