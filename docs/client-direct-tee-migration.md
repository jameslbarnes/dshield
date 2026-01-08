# Client-Direct-to-TEE Architecture

## The Problem

Current ETHEREA architecture has an unattested hole:

```
Browser → Flask Backend → Auditor TEE → Claude
              ↑
         UNATTESTED
         Could leak data to anywhere
```

Even with Auditor capturing the Claude call, Flask sees all user data first.
There's nothing stopping Flask from sending data to analytics, logging services,
or anywhere else. Users and AI agents can't verify what Flask does.

## The Solution

Remove the unattested middleware. Browser calls TEE functions directly:

```
Browser → Auditor TEE Function → Claude
   ↓              ↓
Client SDK    TEE attestation
captures      proves egress
this call
```

Flask becomes a static file server. All sensitive logic moves into the TEE.

## What Moves Into the TEE

### From `modules/claude_api.py`:

| Function | Purpose | Lines |
|----------|---------|-------|
| `generate_prompt_for_session()` | Main prompt generation | 422-550 |
| `call_with_cerebras_retry_and_claude_fallback()` | Retry/fallback logic | 147-196 |
| `make_llm_call()` | HTTP call to LLM | 94-135 |
| System prompt construction | Style context, recent prompts | 260-315 |

### From `modules/session_recorder.py`:

| Function | Purpose |
|----------|---------|
| Session state management | Track recent prompts, style, transcript |
| Firestore logging | Log prompts for analytics |

## TEE Function: `generate-prompt`

```python
"""
ETHEREA Prompt Generation - TEE Function

This function runs inside the TEE. All egress is attested.
Users can verify exactly what APIs are called.
"""

import os
import json
import time
import re
import requests

# Secrets injected by Auditor (never leave TEE)
ANTHROPIC_API_KEY = os.environ.get('ANTHROPIC_API_KEY')
OPENROUTER_API_KEY = os.environ.get('OPENROUTER_API_KEY')

# Session storage (persisted in TEE encrypted storage)
sessions = {}

# Constants
CEREBRAS_MAX_RETRIES = 2
CEREBRAS_TIMEOUT = 5
CLAUDE_TIMEOUT = 30

def handler(request):
    """
    Input from browser:
    {
        "session_id": "uuid",
        "transcript": "recent speech text",
        "style_tags": "artist:monet, genre:impressionism",
        "vj_instruction": "evolve" | "jump" | "remix" | null
    }

    Output:
    {
        "prompt": "generated stable diffusion prompt",
        "provider_used": "cerebras" | "claude-fallback",
        "latency_ms": 1234
    }
    """
    body = request.get('body', {})
    session_id = body.get('session_id')
    transcript = body.get('transcript', '')
    style_tags = body.get('style_tags', '')
    vj_instruction = body.get('vj_instruction')

    # Get or create session
    session = get_or_create_session(session_id)

    # Build system prompt
    system_prompt = build_system_prompt(
        style_tags=style_tags,
        recent_prompts=session['recent_prompts'],
        vj_instruction=vj_instruction
    )

    # Build user message
    user_message = build_user_message(
        transcript=transcript,
        recent_prompts=session['recent_prompts']
    )

    # Call LLM with retry/fallback
    start_time = time.time()
    prompt, provider_used = call_llm_with_fallback(system_prompt, user_message)
    latency_ms = int((time.time() - start_time) * 1000)

    if not prompt:
        return {
            'statusCode': 500,
            'body': {'error': 'All LLM providers failed'}
        }

    # Update session state
    rotate_prompts(session, prompt)

    # Log to Firestore (egress is attested)
    log_to_firestore(session_id, transcript, prompt, style_tags)

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
            'recent_prompts': [''] * 5,  # Last 5 prompts
            'created_at': time.time()
        }
    return sessions[session_id]


def rotate_prompts(session, new_prompt):
    """Rotate prompts list, newest at index 0."""
    prompts = session['recent_prompts']
    session['recent_prompts'] = [new_prompt] + prompts[:4]


def build_system_prompt(style_tags, recent_prompts, vj_instruction):
    """Build the system prompt with style context."""

    base = """Given the following transcript, produce an effective Stable Diffusion prompt.

CRITICAL: The diffusion model has NO MEMORY. Each prompt is processed independently.
You must include ALL visual details in EVERY prompt.

IMPORTANT GUIDELINES FOR CHARACTERS AND IP:
- When users specifically request characters, reproduce them faithfully
- Include recognizable details like clothing, appearance, iconic features
- For fictional characters, use their proper names and distinctive visual traits

Never write things like "same as before", "continue the previous style".
Keep prompts under 300 characters. No emojis."""

    if style_tags:
        base += f"""

=== STYLE CONTEXT (HIGH PRIORITY) ===
{style_tags}

These style elements should DOMINATE the visual output."""

    if recent_prompts[0]:
        base += f"""

=== RECENT PROMPT (for continuity) ===
{recent_prompts[0]}

Build iteratively on this scene. Evolve, don't repeat."""

    if vj_instruction:
        instructions = {
            'evolve': 'Gradually evolve the current scene. Subtle changes.',
            'jump': 'Make a significant visual shift. New scene.',
            'remix': 'Keep the subject but dramatically change the style.'
        }
        base += f"""

=== VJ INSTRUCTION ===
{instructions.get(vj_instruction, '')}"""

    return base


def build_user_message(transcript, recent_prompts):
    """Build the user message with transcript and context."""

    # Get last 3 prompts for context
    prompt_context = '\n'.join([p for p in recent_prompts[:3] if p])

    if prompt_context:
        return f"""Recent prompts for context:
{prompt_context}

New transcript to respond to:
{transcript}

Generate a new prompt that builds on the scene."""
    else:
        return f"""Transcript:
{transcript}

Generate a Stable Diffusion prompt for this scene."""


def call_llm_with_fallback(system_prompt, user_message):
    """Try Cerebras via OpenRouter, fall back to Claude."""

    # Try Cerebras (fast, cheap)
    for attempt in range(CEREBRAS_MAX_RETRIES + 1):
        prompt = call_openrouter(system_prompt, user_message)
        if prompt:
            return prompt, 'cerebras'

    # Fall back to Claude
    prompt = call_claude(system_prompt, user_message)
    if prompt:
        return prompt, 'claude-fallback'

    return None, None


def call_openrouter(system_prompt, user_message):
    """Call Cerebras via OpenRouter."""
    try:
        response = requests.post(
            'https://openrouter.ai/api/v1/chat/completions',
            headers={
                'Content-Type': 'application/json',
                'Authorization': f'Bearer {OPENROUTER_API_KEY}',
                'HTTP-Referer': 'https://etherea.ai',
                'X-Title': 'Etherea'
            },
            json={
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
            },
            timeout=CEREBRAS_TIMEOUT
        )

        if response.status_code != 200:
            return None

        result = response.json()
        content = result['choices'][0]['message']['content'].strip()
        return extract_prompt(content)

    except Exception:
        return None


def call_claude(system_prompt, user_message):
    """Call Claude directly via Anthropic API."""
    try:
        response = requests.post(
            'https://api.anthropic.com/v1/messages',
            headers={
                'Content-Type': 'application/json',
                'x-api-key': ANTHROPIC_API_KEY,
                'anthropic-version': '2023-06-01'
            },
            json={
                'model': 'claude-sonnet-4-5',
                'max_tokens': 300,
                'system': system_prompt,
                'messages': [
                    {'role': 'user', 'content': user_message}
                ]
            },
            timeout=CLAUDE_TIMEOUT
        )

        if response.status_code != 200:
            return None

        result = response.json()
        content = result['content'][0]['text'].strip()
        return extract_prompt(content)

    except Exception:
        return None


def extract_prompt(content):
    """Extract prompt from <prompt> tags if present."""
    match = re.search(r'<prompt>(.*?)</prompt>', content, re.DOTALL)
    if match:
        return match.group(1).strip()
    return content


def log_to_firestore(session_id, transcript, prompt, style_tags):
    """Log prompt to Firestore for analytics."""
    # TODO: Implement Firestore logging
    # This egress will be TEE-attested
    pass
```

## Session State Options

### Option A: In-TEE Memory (Current Plan)
```python
sessions = {}  # In-memory dict, persisted to encrypted storage
```
- Pros: Simple, fast, fully attested
- Cons: Lost if TEE restarts without persistence

### Option B: Client Sends Context
```javascript
// Browser sends session state with each request
fetch('/invoke/generate-prompt', {
  body: JSON.stringify({
    session_id: 'uuid',
    transcript: '...',
    recent_prompts: ['prompt1', 'prompt2', ...],  // Client maintains
    style_tags: '...'
  })
})
```
- Pros: Stateless TEE, simpler
- Cons: Client could lie about recent_prompts

### Option C: Firestore as Source of Truth
```python
def get_session(session_id):
    # Read from Firestore (egress attested)
    doc = firestore.collection('sessions').document(session_id).get()
    return doc.to_dict()
```
- Pros: Survives restarts, shared with Flask
- Cons: Latency, Firestore dependency

**Recommendation:** Start with Option A (in-TEE memory with persistence).
If we need cross-session state, migrate to Option C later.

## ETHEREA Changes

### 1. New JavaScript Client

```javascript
// lib/auditor-prompts.js

const AUDITOR_URL = 'https://8f20c29f45571bade4b63d0f704faa926af53e7c-3000.dstack-pha-prod5.phala.network';

export async function generatePrompt({ sessionId, transcript, styleTags, vjInstruction }) {
  const response = await fetch(`${AUDITOR_URL}/invoke/generate-prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session_id: sessionId,
      transcript,
      style_tags: styleTags,
      vj_instruction: vjInstruction
    })
  });

  if (!response.ok) {
    throw new Error(`Prompt generation failed: ${response.status}`);
  }

  return response.json();
}
```

### 2. Update React Components

Replace Flask API calls with direct Auditor calls:

```javascript
// Before
const response = await fetch('/api/regenerate_prompt', {
  method: 'POST',
  body: JSON.stringify({ transcript, style_tags })
});

// After
import { generatePrompt } from './lib/auditor-prompts';

const response = await generatePrompt({
  sessionId: currentSessionId,
  transcript,
  styleTags,
  vjInstruction: null
});
```

### 3. Remove Flask Routes

These Flask routes become unnecessary:
- `/regenerate_prompt`
- `/api/regenerate_prompt`
- Any route that calls `generate_prompt_for_session()`

### 4. Flask Becomes Static Server

```python
# app.py - simplified

from flask import Flask, send_from_directory

app = Flask(__name__)

@app.route('/')
def index():
    return send_from_directory('static', 'index.html')

@app.route('/<path:path>')
def static_files(path):
    return send_from_directory('static', path)

# Session management still in Flask (for now)
# But sensitive LLM calls go through TEE
```

## Migration Steps

### Phase 1: Deploy TEE Function
1. Create `generate-prompt` function
2. Store ANTHROPIC_API_KEY and OPENROUTER_API_KEY in Auditor
3. Deploy to Auditor
4. Test with curl

### Phase 2: Parallel Testing
1. Add feature flag in ETHEREA
2. Route 10% of traffic to TEE function
3. Compare results, latency, error rates
4. Verify prompts are equivalent quality

### Phase 3: Full Migration
1. Update React to call Auditor directly
2. Remove Flask LLM routes
3. Monitor for issues
4. Verify complete egress visibility in Auditor dashboard

### Phase 4: Secondary Functions
Migrate other LLM calls:
- Music generation (`claude_dj.py`)
- YouTube metadata (`youtube_api.py`)
- Shader fixing (`api_routes.py`)

## Success Criteria

1. **Complete Visibility**: Every external API call visible in Auditor
2. **No Unattested Middleware**: Browser → TEE → External APIs
3. **Equivalent Quality**: Prompts are same quality as before
4. **Acceptable Latency**: < 200ms added overhead
5. **AI-Verifiable**: An AI agent can read `/report/etherea` and verify data flow

## Risks

| Risk | Mitigation |
|------|------------|
| Session state lost on TEE restart | Persistence layer (already implemented) |
| Higher latency | Keep Cerebras retry logic, tune timeouts |
| Browser compatibility (CORS) | Configure Auditor CORS headers |
| Debugging harder | Comprehensive logging in TEE function |

## Timeline

| Phase | Effort |
|-------|--------|
| Phase 1: TEE Function | 2-3 hours |
| Phase 2: Parallel Testing | 2-3 hours |
| Phase 3: Full Migration | 3-4 hours |
| Phase 4: Secondary Functions | 4-6 hours |

**Total: ~12-16 hours**
