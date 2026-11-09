#!/usr/bin/env bash
# ==============================================================================
# Zootopia Backend Deployment Script (AWS CLI)
# ==============================================================================
# This script packages and deploys the Zootopia Management API Lambda & API Gateway.
# DO NOT RUN WITHOUT EXPLICIT USER APPROVAL.
# ==============================================================================
set -euo pipefail

AWS_REGION="ap-southeast-2"
AWS_ACCOUNT_ID="019094759625"
EC2_INSTANCE_ID="i-02de910a9f70196b4"
FUNCTION_NAME="zootopia-backend-api"
ROLE_NAME="ZootopiaBackendLambdaRole"
API_NAME="zootopia-management-api"

echo "=== Zootopia Backend Deployment (Dry-Run / Plan Ready) ==="
echo "AWS Account:     $AWS_ACCOUNT_ID"
echo "AWS Region:      $AWS_REGION"
echo "Target Instance: $EC2_INSTANCE_ID"
echo "Target API:      https://api.dotdeb.dpdns.org/"
echo ""
echo "Packaging lambda..."
rm -f /tmp/zootopia-backend.zip
zip -j /tmp/zootopia-backend.zip index.mjs auth.mjs mindustry-ping.mjs

echo "Package ready: /tmp/zootopia-backend.zip"
echo "Awaiting user approval before creating AWS resources."
