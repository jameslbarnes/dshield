#!/bin/bash
# Integration tests for generate-prompt function

set -e

AUDITOR_URL="${AUDITOR_URL:-https://8f20c29f45571bade4b63d0f704faa926af53e7c-3000.dstack-pha-prod5.phala.network}"

PASS=0
FAIL=0

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color

test_case() {
    local name="$1"
    local expected_status="$2"
    local body="$3"
    local check_field="$4"

    echo -n "Testing: $name... "

    RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$AUDITOR_URL/invoke/generate-prompt" \
        -H "Content-Type: application/json" \
        -d "$body")

    HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
    BODY=$(echo "$RESPONSE" | sed '$d')

    if [ "$HTTP_CODE" != "$expected_status" ]; then
        echo -e "${RED}FAIL${NC} (expected status $expected_status, got $HTTP_CODE)"
        echo "Response: $BODY"
        ((FAIL++))
        return
    fi

    if [ -n "$check_field" ]; then
        if echo "$BODY" | grep -q "$check_field"; then
            echo -e "${GREEN}PASS${NC}"
            ((PASS++))
        else
            echo -e "${RED}FAIL${NC} (missing field: $check_field)"
            echo "Response: $BODY"
            ((FAIL++))
        fi
    else
        echo -e "${GREEN}PASS${NC}"
        ((PASS++))
    fi
}

echo "=========================================="
echo "Integration Tests: generate-prompt"
echo "Target: $AUDITOR_URL"
echo "=========================================="
echo ""

# Basic functionality tests
echo "--- Basic Functionality ---"

test_case "returns prompt for valid input" "200" \
    '{"session_id": "test-1", "transcript": "A beautiful mountain landscape", "style_tags": "", "vj_instruction": null}' \
    '"prompt"'

test_case "returns provider_used" "200" \
    '{"session_id": "test-2", "transcript": "Ocean waves at sunset", "style_tags": "", "vj_instruction": null}' \
    '"provider_used"'

test_case "returns latency_ms" "200" \
    '{"session_id": "test-3", "transcript": "A forest path", "style_tags": "", "vj_instruction": null}' \
    '"latency_ms"'

test_case "handles empty transcript" "200" \
    '{"session_id": "test-4", "transcript": "", "style_tags": "genre:abstract", "vj_instruction": null}' \
    '"prompt"'

# Style tags tests
echo ""
echo "--- Style Tags ---"

test_case "accepts style tags" "200" \
    '{"session_id": "test-5", "transcript": "A garden", "style_tags": "artist:monet, genre:impressionism", "vj_instruction": null}' \
    '"prompt"'

# VJ instruction tests
echo ""
echo "--- VJ Instructions ---"

test_case "handles evolve instruction" "200" \
    '{"session_id": "test-6", "transcript": "Keep it going", "style_tags": "", "vj_instruction": "evolve"}' \
    '"prompt"'

test_case "handles jump instruction" "200" \
    '{"session_id": "test-7", "transcript": "Something new", "style_tags": "", "vj_instruction": "jump"}' \
    '"prompt"'

test_case "handles remix instruction" "200" \
    '{"session_id": "test-8", "transcript": "Mix it up", "style_tags": "", "vj_instruction": "remix"}' \
    '"prompt"'

# Session tests
echo ""
echo "--- Session Management ---"

# Create a session with multiple calls
SESSION_ID="session-test-$$"

test_case "first call creates session" "200" \
    "{\"session_id\": \"$SESSION_ID\", \"transcript\": \"First call\", \"style_tags\": \"\", \"vj_instruction\": null}" \
    '"prompt"'

test_case "second call uses same session" "200" \
    "{\"session_id\": \"$SESSION_ID\", \"transcript\": \"Second call\", \"style_tags\": \"\", \"vj_instruction\": null}" \
    '"prompt"'

# Edge cases
echo ""
echo "--- Edge Cases ---"

test_case "handles unicode in transcript" "200" \
    '{"session_id": "test-unicode", "transcript": "日本語テスト emoji 🎨", "style_tags": "", "vj_instruction": null}' \
    '"prompt"'

test_case "handles special characters" "200" \
    '{"session_id": "test-special", "transcript": "Test with \"quotes\" and <tags>", "style_tags": "", "vj_instruction": null}' \
    '"prompt"'

# Security tests
echo ""
echo "--- Security ---"

RESPONSE=$(curl -s -X POST "$AUDITOR_URL/invoke/generate-prompt" \
    -H "Content-Type: application/json" \
    -d '{"session_id": "security-test", "transcript": "Test", "style_tags": "", "vj_instruction": null}')

echo -n "Testing: no API key leakage... "
if echo "$RESPONSE" | grep -q "sk-ant\|sk-or"; then
    echo -e "${RED}FAIL${NC} (API key found in response)"
    ((FAIL++))
else
    echo -e "${GREEN}PASS${NC}"
    ((PASS++))
fi

# Summary
echo ""
echo "=========================================="
echo "Results: $PASS passed, $FAIL failed"
echo "=========================================="

if [ $FAIL -gt 0 ]; then
    exit 1
fi
