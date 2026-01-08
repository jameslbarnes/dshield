#!/bin/bash
# Deploy generate-prompt function to Auditor

set -e

AUDITOR_URL="${AUDITOR_URL:-https://8f20c29f45571bade4b63d0f704faa926af53e7c-3000.dstack-pha-prod5.phala.network}"
ROOT_KEY="${AUDITOR_ROOT_KEY:-auditor_root_key_for_testing_12345}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FUNCTION_PATH="$SCRIPT_DIR/../functions/generate_prompt.py"

echo "Deploying generate-prompt function to $AUDITOR_URL"

# Read and base64 encode the function
CODE=$(base64 -w 0 "$FUNCTION_PATH" 2>/dev/null || base64 "$FUNCTION_PATH")

# Deploy the function
echo "Creating/updating function..."
RESPONSE=$(curl -s -X POST "$AUDITOR_URL/api/functions" \
  -H "Authorization: Bearer $ROOT_KEY" \
  -H "Content-Type: application/json" \
  -d @- <<EOF
{
  "id": "generate-prompt",
  "name": "ETHEREA Prompt Generation",
  "description": "Generates Stable Diffusion prompts from transcripts. TEE-attested egress to Anthropic and OpenRouter.",
  "runtime": "python",
  "code": "$CODE",
  "handler": "main",
  "timeout": 60000,
  "envVars": ["ANTHROPIC_API_KEY", "OPENROUTER_API_KEY"]
}
EOF
)

echo "$RESPONSE" | python -m json.tool 2>/dev/null || echo "$RESPONSE"

echo ""
echo "Function deployed. Test with:"
echo "curl -X POST '$AUDITOR_URL/invoke/generate-prompt' \\"
echo "  -H 'Content-Type: application/json' \\"
echo "  -d '{\"session_id\": \"test\", \"transcript\": \"A beautiful sunset\", \"style_tags\": \"\", \"vj_instruction\": null}'"
