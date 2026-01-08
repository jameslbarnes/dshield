"""
ETHEREA Prompt Generation - TEE Function

This function runs inside the Auditor TEE. All egress is attested.
Users can verify exactly what APIs are called.

Deployed to: /invoke/generate-prompt
"""

import os
import json
import time
import re
import urllib.request
import urllib.error

# Secrets injected by Auditor (never leave TEE)
ANTHROPIC_API_KEY = os.environ.get('ANTHROPIC_API_KEY', '')
OPENROUTER_API_KEY = os.environ.get('OPENROUTER_API_KEY', '')

# Session storage (in-memory, persisted by Auditor's encrypted storage)
sessions = {}

# Constants
CEREBRAS_MAX_RETRIES = 2  # 3 total attempts
CEREBRAS_TIMEOUT = 5
CLAUDE_TIMEOUT = 30

# Base system prompt
BASE_SYSTEM_PROMPT = """Given the following transcript, produce an effective Stable Diffusion prompt.

CRITICAL: The diffusion model has NO MEMORY. Each prompt is processed independently.
You must include ALL visual details in EVERY prompt.

IMPORTANT GUIDELINES FOR CHARACTERS AND IP:
- When users specifically request characters, reproduce them faithfully
- Include recognizable details like clothing, appearance, iconic features
- For fictional characters, use their proper names and distinctive visual traits
- Trust the user's intent

Never write things like "same as before", "continue the previous style".
Keep prompts under 300 characters. No emojis. Avoid hands/fingers if possible."""

# VJ instruction mappings
VJ_INSTRUCTIONS = {
    'evolve': 'Gradually evolve the current scene. Make subtle, gentle changes that flow naturally.',
    'jump': 'Make a significant visual shift. Create a new scene that departs from the current one.',
    'remix': 'Keep the subject but dramatically change the style. Same content, different aesthetic.'
}


def handler(request):
    """
    Main handler for generate-prompt function.

    Input:
    {
        "body": {
            "session_id": "uuid",
            "transcript": "recent speech text",
            "style_tags": "artist:monet, genre:impressionism",
            "vj_instruction": "evolve" | "jump" | "remix" | null
        }
    }

    Output:
    {
        "statusCode": 200,
        "body": {
            "prompt": "generated stable diffusion prompt",
            "provider_used": "cerebras" | "claude-fallback",
            "latency_ms": 1234
        }
    }
    """
    # Validate input
    body = request.get('body', {})
    if not body:
        return {
            'statusCode': 400,
            'body': {'error': 'Missing request body'}
        }

    session_id = body.get('session_id', 'default')
    transcript = body.get('transcript', '')
    style_tags = body.get('style_tags', '')
    vj_instruction = body.get('vj_instruction')

    # Get or create session
    session = get_or_create_session(session_id)

    # Build prompts
    system_prompt = build_system_prompt(
        style_tags=style_tags,
        recent_prompts=session['recent_prompts'],
        vj_instruction=vj_instruction
    )

    user_message = build_user_message(
        transcript=transcript,
        recent_prompts=session['recent_prompts']
    )

    # Call LLM with retry/fallback
    start_time = time.time()
    prompt, provider_used, error = call_llm_with_fallback(system_prompt, user_message)
    latency_ms = int((time.time() - start_time) * 1000)

    if not prompt:
        return {
            'statusCode': 500,
            'body': {'error': f'All LLM providers failed: {sanitize_error(error)}'}
        }

    # Update session state
    rotate_prompts(session, prompt)

    return {
        'statusCode': 200,
        'body': {
            'prompt': prompt,
            'provider_used': provider_used,
            'latency_ms': latency_ms
        }
    }


def get_or_create_session(session_id):
    """Get existing session or create new one."""
    if session_id not in sessions:
        sessions[session_id] = {
            'recent_prompts': ['', '', '', '', ''],  # Last 5 prompts
            'created_at': time.time()
        }
    return sessions[session_id]


def rotate_prompts(session, new_prompt):
    """Rotate prompts list, newest at index 0."""
    prompts = session['recent_prompts']
    session['recent_prompts'] = [new_prompt] + prompts[:4]


def build_system_prompt(style_tags, recent_prompts, vj_instruction):
    """Build the system prompt with style context."""
    prompt = BASE_SYSTEM_PROMPT

    # Add style tags if present
    if style_tags and style_tags.strip():
        prompt += f"""

=== STYLE CONTEXT (HIGH PRIORITY) ===
{style_tags}

These style elements should DOMINATE the visual output. Apply them consistently."""

    # Add recent prompt for continuity
    if recent_prompts[0]:
        prompt += f"""

=== RECENT PROMPT (for continuity) ===
{recent_prompts[0]}

Build iteratively on this scene. Evolve naturally, don't repeat exactly."""

    # Add VJ instruction if present
    if vj_instruction and vj_instruction in VJ_INSTRUCTIONS:
        prompt += f"""

=== VJ INSTRUCTION ===
{VJ_INSTRUCTIONS[vj_instruction]}"""

    return prompt


def build_user_message(transcript, recent_prompts):
    """Build the user message with transcript and context."""
    # Get last 3 non-empty prompts for context
    prompt_context = '\n'.join([p for p in recent_prompts[:3] if p])

    if prompt_context:
        return f"""Recent prompts for context:
{prompt_context}

New transcript to respond to:
{transcript}

Generate a new Stable Diffusion prompt that builds on the scene."""
    else:
        return f"""Transcript:
{transcript}

Generate a Stable Diffusion prompt for this scene."""


def call_llm_with_fallback(system_prompt, user_message):
    """Try Cerebras via OpenRouter, fall back to Claude."""
    last_error = None

    # Try Cerebras (fast, cheap) with retries
    for attempt in range(CEREBRAS_MAX_RETRIES + 1):
        prompt, error = call_openrouter(system_prompt, user_message)
        if prompt:
            return prompt, 'cerebras', None
        last_error = error

    # Fall back to Claude
    prompt, error = call_claude(system_prompt, user_message)
    if prompt:
        return prompt, 'claude-fallback', None

    return None, None, error or last_error


def call_openrouter(system_prompt, user_message):
    """Call Cerebras via OpenRouter."""
    if not OPENROUTER_API_KEY:
        return None, 'OPENROUTER_API_KEY not set'

    try:
        data = json.dumps({
            'model': 'openai/gpt-oss-120b',
            'messages': [
                {'role': 'system', 'content': system_prompt},
                {'role': 'user', 'content': user_message}
            ],
            'max_tokens': 300,
            'temperature': 0.7,
            'provider': {
                'order': ['Cerebras'],
                'allow_fallbacks': False
            }
        }).encode('utf-8')

        req = urllib.request.Request(
            'https://openrouter.ai/api/v1/chat/completions',
            data=data,
            headers={
                'Content-Type': 'application/json',
                'Authorization': f'Bearer {OPENROUTER_API_KEY}',
                'HTTP-Referer': 'https://etherea.ai',
                'X-Title': 'Etherea'
            },
            method='POST'
        )

        with urllib.request.urlopen(req, timeout=CEREBRAS_TIMEOUT) as response:
            if response.status != 200:
                return None, f'HTTP {response.status}'

            result = json.loads(response.read().decode('utf-8'))

            # Parse OpenRouter/Cerebras response
            if 'choices' in result and len(result['choices']) > 0:
                choice = result['choices'][0]
                if 'message' in choice and 'content' in choice['message']:
                    content = choice['message']['content'].strip()
                    return extract_prompt(content), None

            return None, 'Unexpected response format'

    except urllib.error.HTTPError as e:
        return None, f'HTTP {e.code}'
    except urllib.error.URLError as e:
        return None, f'URL error: {str(e.reason)}'
    except Exception as e:
        return None, str(e)


def call_claude(system_prompt, user_message):
    """Call Claude directly via Anthropic API."""
    if not ANTHROPIC_API_KEY:
        return None, 'ANTHROPIC_API_KEY not set'

    try:
        data = json.dumps({
            'model': 'claude-sonnet-4-5',
            'max_tokens': 300,
            'system': system_prompt,
            'messages': [
                {'role': 'user', 'content': user_message}
            ]
        }).encode('utf-8')

        req = urllib.request.Request(
            'https://api.anthropic.com/v1/messages',
            data=data,
            headers={
                'Content-Type': 'application/json',
                'x-api-key': ANTHROPIC_API_KEY,
                'anthropic-version': '2023-06-01'
            },
            method='POST'
        )

        with urllib.request.urlopen(req, timeout=CLAUDE_TIMEOUT) as response:
            if response.status != 200:
                return None, f'HTTP {response.status}'

            result = json.loads(response.read().decode('utf-8'))

            # Parse Claude response
            if 'content' in result and len(result['content']) > 0:
                content = result['content'][0].get('text', '').strip()
                return extract_prompt(content), None

            return None, 'Unexpected response format'

    except urllib.error.HTTPError as e:
        return None, f'HTTP {e.code}'
    except urllib.error.URLError as e:
        return None, f'URL error: {str(e.reason)}'
    except Exception as e:
        return None, str(e)


def extract_prompt(content):
    """Extract prompt from <prompt> tags if present, otherwise return as-is."""
    if not content:
        return None

    # Try to extract from <prompt> tags
    match = re.search(r'<prompt>(.*?)</prompt>', content, re.DOTALL)
    if match:
        return match.group(1).strip()

    # Return content as-is, trimmed
    return content.strip()


def sanitize_error(error):
    """Remove any sensitive information from error messages."""
    if not error:
        return 'Unknown error'

    # Remove API keys if accidentally included
    sanitized = str(error)
    sanitized = re.sub(r'sk-ant-[a-zA-Z0-9_-]+', '[REDACTED]', sanitized)
    sanitized = re.sub(r'sk-or-[a-zA-Z0-9_-]+', '[REDACTED]', sanitized)
    sanitized = re.sub(r'Bearer [a-zA-Z0-9_-]+', 'Bearer [REDACTED]', sanitized)

    return sanitized


# Export for Auditor runtime
def main(request):
    """Entry point for Auditor function runtime."""
    return handler(request)
