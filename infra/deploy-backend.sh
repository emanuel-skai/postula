#!/usr/bin/env bash
# Despliega el backend de Postula en AWS (Lambda + DynamoDB + Function URL).
# Configuración en infra/.env.local (no versionado); ver infra/.env.example.
# Idempotente: crea si no existe, actualiza código/config si existe.
set -euo pipefail
ENV_FILE="$(dirname "$0")/.env.local"
[ -f "$ENV_FILE" ] && { set -a; . "$ENV_FILE"; set +a; }
: "${EXPECTED_AWS_ACCOUNT:?Define EXPECTED_AWS_ACCOUNT en infra/.env.local}"
: "${COHERE_KEY_PARAM:?Define COHERE_KEY_PARAM (parámetro SSM con la clave de Cohere)}"
: "${ORIGINS:?Define ORIGINS (JSON con los orígenes permitidos)}"
AUTH_API=${AUTH_API:-https://auth.potenci.ai}
export AWS_PROFILE=${AWS_PROFILE:-default} AWS_REGION=${AWS_REGION:-us-west-2}
ACC=$(aws sts get-caller-identity --query Account --output text)
[ "$ACC" = "$EXPECTED_AWS_ACCOUNT" ] || { echo "Cuenta equivocada: $ACC"; exit 1; }
FN=postula-api-prod; TABLE=postula-prod; ROLE=postula-api-prod-role
PARAM=$COHERE_KEY_PARAM
cd "$(dirname "$0")/../backend"

npm run -s build
(cd dist && rm -f fn.zip && zip -q fn.zip index.mjs)

# 1. Tabla (on-demand)
if ! aws dynamodb describe-table --table-name $TABLE >/dev/null 2>&1; then
  aws dynamodb create-table --table-name $TABLE \
    --attribute-definitions AttributeName=pk,AttributeType=S AttributeName=sk,AttributeType=S \
    --key-schema AttributeName=pk,KeyType=HASH AttributeName=sk,KeyType=RANGE \
    --billing-mode PAY_PER_REQUEST --tags Key=project,Value=postula >/dev/null
  aws dynamodb wait table-exists --table-name $TABLE
  echo "tabla creada"
fi

# 2. Rol con mínimo privilegio
if ! aws iam get-role --role-name $ROLE >/dev/null 2>&1; then
  aws iam create-role --role-name $ROLE --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}' --tags Key=project,Value=postula >/dev/null
  aws iam attach-role-policy --role-name $ROLE --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
  echo "rol creado"; sleep 10
fi
aws iam put-role-policy --role-name $ROLE --policy-name postula-data --policy-document "{
 \"Version\":\"2012-10-17\",\"Statement\":[
  {\"Effect\":\"Allow\",\"Action\":[\"dynamodb:GetItem\",\"dynamodb:PutItem\",\"dynamodb:UpdateItem\",\"dynamodb:DeleteItem\",\"dynamodb:Query\",\"dynamodb:BatchGetItem\",\"dynamodb:BatchWriteItem\"],\"Resource\":\"arn:aws:dynamodb:$AWS_REGION:$ACC:table/$TABLE\"},
  {\"Effect\":\"Allow\",\"Action\":\"ssm:GetParameter\",\"Resource\":\"arn:aws:ssm:$AWS_REGION:$ACC:parameter$PARAM\"}]}"

# Admin (reclutador): wallets separadas por coma (ADMIN_WALLETS=0xabc...,0xdef...).
# Si no se pasa, conserva el valor actual del Lambda (no borra los admins ya configurados).
if [ -z "${ADMIN_WALLETS:-}" ]; then
  ADMIN_WALLETS=$(aws lambda get-function-configuration --function-name $FN --query "Environment.Variables.ADMIN_WALLETS" --output text 2>/dev/null || true)
  [ "$ADMIN_WALLETS" = "None" ] && ADMIN_WALLETS=""
fi
# JSON (not shorthand): ADMIN_WALLETS contains commas, which the CLI shorthand syntax can't take.
ENVV=$(TABLE="$TABLE" PARAM="$PARAM" AUTH_API="$AUTH_API" ADMIN_WALLETS="$ADMIN_WALLETS" python3 -c 'import json,os
v={"TABLE_NAME":os.environ["TABLE"],"COHERE_KEY_PARAM":os.environ["PARAM"],"AUTH_API":os.environ["AUTH_API"]}
if os.environ.get("ADMIN_WALLETS"): v["ADMIN_WALLETS"]=os.environ["ADMIN_WALLETS"]
print(json.dumps({"Variables":v}))')
# 3. Función
if ! aws lambda get-function --function-name $FN >/dev/null 2>&1; then
  aws lambda create-function --function-name $FN --runtime nodejs22.x --architectures arm64 \
    --handler index.handler --role arn:aws:iam::$ACC:role/$ROLE --zip-file fileb://dist/fn.zip \
    --timeout 30 --memory-size 512 --environment "$ENVV" --tags project=postula >/dev/null
  aws lambda wait function-active-v2 --function-name $FN
  aws logs create-log-group --log-group-name /aws/lambda/$FN 2>/dev/null || true
  aws logs put-retention-policy --log-group-name /aws/lambda/$FN --retention-in-days 14
  echo "función creada"
else
  aws lambda update-function-code --function-name $FN --zip-file fileb://dist/fn.zip >/dev/null
  aws lambda wait function-updated-v2 --function-name $FN
  aws lambda update-function-configuration --function-name $FN --environment "$ENVV" >/dev/null
  aws lambda wait function-updated-v2 --function-name $FN
  echo "función actualizada"
fi

# 4. Function URL (la API valida el JWT de sesión) + CORS
CORS="{\"AllowOrigins\":$ORIGINS,\"AllowMethods\":[\"*\"],\"AllowHeaders\":[\"authorization\",\"content-type\"],\"MaxAge\":3600}"
if ! aws lambda get-function-url-config --function-name $FN >/dev/null 2>&1; then
  aws lambda create-function-url-config --function-name $FN --auth-type NONE --cors "$CORS" >/dev/null
  aws lambda add-permission --function-name $FN --statement-id url-public --action lambda:InvokeFunctionUrl --principal '*' --function-url-auth-type NONE >/dev/null
  # Requiere CLI/boto3 reciente (InvokedViaFunctionUrl); con CLI viejo hacerlo vía boto3:
  aws lambda add-permission --function-name $FN --statement-id url-invoke --action lambda:InvokeFunction --principal "*" --invoked-via-function-url >/dev/null 2>&1 || echo "AVISO: agregar lambda:InvokeFunction con InvokedViaFunctionUrl=true (boto3 >= 1.40)"
else
  aws lambda update-function-url-config --function-name $FN --cors "$CORS" >/dev/null
fi
aws lambda get-function-url-config --function-name $FN --query FunctionUrl --output text
