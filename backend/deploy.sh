#!/usr/bin/env bash
# ==============================================================================
# Zootopia Backend Deployment Script (AWS SAM / CloudFormation)
# ==============================================================================
# This script packages and displays the deployment command for Zootopia Backend.
# DO NOT RUN WITHOUT EXPLICIT USER APPROVAL.
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

AWS_REGION="ap-southeast-2"
AWS_ACCOUNT_ID="019094759625"
EC2_INSTANCE_ID="i-02de910a9f70196b4"
STACK_NAME="zootopia-backend-stack"
ADMIN_USERNAME="chief"
# Scrypt hash for chief / chief100 with default salt
ADMIN_PASSWORD_HASH="423d1916c88c4c504a354867012c11baa3f40b1701de3999003ee5253f8c2c19799a9e7a218c4ecdd0bb998b9fc0f6f6b9048b0d281ed30bb179893165edf665"

echo "=========================================================="
echo "=== Zootopia Backend Deployment Configuration ==="
echo "=========================================================="
echo "AWS Account:     $AWS_ACCOUNT_ID"
echo "AWS Region:      $AWS_REGION"
echo "EC2 Instance:    $EC2_INSTANCE_ID"
echo "Stack Name:      $STACK_NAME"
echo "Admin Username:  $ADMIN_USERNAME"
echo "Target Frontend: https://dotdeb.dpdns.org"
echo ""

echo "Packaging Lambda files locally..."
rm -f /tmp/zootopia-backend.zip
zip -j /tmp/zootopia-backend.zip index.mjs auth.mjs mindustry-ping.mjs

echo "Package ready: /tmp/zootopia-backend.zip"
echo ""
echo "----------------------------------------------------------"
echo "To deploy to AWS using AWS SAM CLI, execute:"
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
echo "    AdminPasswordHash=\"$ADMIN_PASSWORD_HASH\""
echo "----------------------------------------------------------"
echo "Awaiting explicit user approval before modifying AWS resources."
