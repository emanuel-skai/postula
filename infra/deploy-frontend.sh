#!/usr/bin/env bash
# Publica el frontend en Amplify (despliegue manual por zip) — app "postula", rama main.
set -euo pipefail
export AWS_PROFILE=${AWS_PROFILE:-default} AWS_REGION=${AWS_REGION:-us-west-2}
cd "$(dirname "$0")/../frontend"
npm run -s build >/dev/null
APP=$(aws amplify list-apps --query "apps[?name=='postula'].appId" --output text)
if [ -z "$APP" ]; then
  APP=$(aws amplify create-app --name postula --platform WEB --tags project=postula --query app.appId --output text)
  aws amplify create-branch --app-id $APP --branch-name main --stage PRODUCTION >/dev/null
  echo "app creada: $APP"
fi
(cd dist && rm -f ../site.zip && zip -qr ../site.zip .)
read JOB URL < <(aws amplify create-deployment --app-id $APP --branch-name main --query "[jobId,zipUploadUrl]" --output text)
curl -s -f -X PUT -H "Content-Type: application/zip" --upload-file site.zip "$URL" >/dev/null
aws amplify start-deployment --app-id $APP --branch-name main --job-id $JOB >/dev/null
for i in $(seq 1 40); do
  S=$(aws amplify get-job --app-id $APP --branch-name main --job-id $JOB --query job.summary.status --output text)
  [ "$S" = "SUCCEED" ] || [ "$S" = "FAILED" ] && break; sleep 3
done
echo "deploy $JOB: $S → https://main.$APP.amplifyapp.com"
