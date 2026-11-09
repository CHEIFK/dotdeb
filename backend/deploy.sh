#!/usr/bin/env bash
# ==============================================================================
# Continental Mindustry Network Backend Deployment Script (AWS SAM)
# ==============================================================================
# DO NOT RUN WITHOUT EXPLICIT USER APPROVAL.
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

AWS_REGION="ap-southeast-2"
AWS_ACCOUNT_ID="019094759625"
EC2_INSTANCE_ID="i-02de910a9f70196b4"
STACK_NAME="continental-backend-stack"
ADMIN_USERNAME="chief"

# Ensure secrets are NOT hardcoded in script
ADMIN_PASSWORD_HASH="${ADMIN_PASSWORD_HASH:-}"
SESSION_SECRET="${SESSION_SECRET:-}"

echo "=========================================================="
echo "=== Continental Backend Deployment Configuration ==="
echo "=========================================================="
echo "AWS Account:     $AWS_ACCOUNT_ID"
echo "AWS Region:      $AWS_REGION"
echo "EC2 Instance:    $EC2_INSTANCE_ID"
echo "Stack Name:      $STACK_NAME"
echo "Admin Username:  $ADMIN_USERNAME"
echo "Target Frontend: https://dotdeb.dpdns.org"
echo "=========================================================="

if [ -z "$ADMIN_PASSWORD_HASH" ]; then
  echo ""
  echo "NOTE: ADMIN_PASSWORD_HASH is not set in environment."
  echo "Generate a strong password hash using:"
  echo "  node hash-password.mjs '<your-strong-password>'"
  echo "Then run:"
  echo "  export ADMIN_PASSWORD_HASH='<generated-salt:hash>'"
  echo "  export SESSION_SECRET='$(node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))')'"
fi

echo ""
echo "Packaging Lambda files locally..."
rm -f /tmp/continental-backend.zip
zip -j /tmp/continental-backend.zip index.mjs auth.mjs mindustry-ping.mjs

echo "Package ready: /tmp/continental-backend.zip"
echo ""
echo "----------------------------------------------------------"
echo "Deployment requires explicit user approval. Command to execute:"
echo ""
echo "sam build --template-file template.yaml"
echo "sam deploy \\"
echo "  --stack-name \"$STACK_NAME\" \\"
echo "  --region \"$AWS_REGION\" \\"
echo "  --capabilities CAPABILITY_IAM \\"
echo "  --resolve-s3 \\"
echo "  --parameter-overrides \\"
echo "    Ec2InstanceId=\"$EC2_INSTANCE_ID\" \\"
echo "    AdminUsername=\"$ADMIN_USERNAME\" \\"
echo "    AdminPasswordHash=\"\$ADMIN_PASSWORD_HASH\" \\"
echo "    SessionSecret=\"\$SESSION_SECRET\""
echo "----------------------------------------------------------"
