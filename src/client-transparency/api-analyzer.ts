/**
 * API Surface Analyzer
 *
 * Static analysis tool to discover API calls in client code.
 * Scans JavaScript/TypeScript files for fetch, axios, XHR, and WebSocket usage.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import type { ApiEndpoint, ApiSurface, HttpMethod, WebSocketEndpoint } from './types.js';

/**
 * Discovered API call from static analysis.
 */
export interface DiscoveredApiCall {
  /** The URL or URL pattern found */
  url: string;
  /** HTTP method if detectable */
  method?: HttpMethod;
  /** File where this was found */
  file: string;
  /** Line number */
  line: number;
  /** The code snippet */
  snippet: string;
  /** Type of API call */
  type: 'fetch' | 'axios' | 'xhr' | 'websocket' | 'other';
  /** Confidence level */
  confidence: 'high' | 'medium' | 'low';
}

/**
 * Analysis result from scanning a codebase.
 */
export interface AnalysisResult {
  /** All discovered API calls */
  apiCalls: DiscoveredApiCall[];
  /** Unique domains found */
  domains: string[];
  /** WebSocket endpoints */
  websockets: string[];
  /** Suggested API surface based on analysis */
  suggestedApiSurface: Partial<ApiSurface>;
  /** Files analyzed */
  filesAnalyzed: number;
  /** Analysis timestamp */
  analyzedAt: string;
  /** Warnings during analysis */
  warnings: string[];
}

// Regex patterns for detecting API calls
const PATTERNS = {
  // fetch("url") or fetch('url') or fetch(`url`)
  fetch: /fetch\s*\(\s*["'`]([^"'`]+)["'`]/g,
  // fetch(url, { method: "POST" })
  fetchWithMethod: /fetch\s*\([^)]*method\s*:\s*["'`](\w+)["'`]/gi,
  // axios.get("url"), axios.post("url"), etc.
  axiosMethod: /axios\s*\.\s*(get|post|put|patch|delete|head|options)\s*\(\s*["'`]([^"'`]+)["'`]/gi,
  // axios("url") or axios({ url: "..." })
  axiosUrl: /axios\s*\(\s*(?:["'`]([^"'`]+)["'`]|\{[^}]*url\s*:\s*["'`]([^"'`]+)["'`])/gi,
  // XMLHttpRequest.open("METHOD", "url")
  xhr: /\.open\s*\(\s*["'`](\w+)["'`]\s*,\s*["'`]([^"'`]+)["'`]/gi,
  // new WebSocket("url")
  websocket: /new\s+WebSocket\s*\(\s*["'`]([^"'`]+)["'`]/gi,
  // Environment variable URLs: process.env.API_URL, import.meta.env.VITE_API_URL
  envUrl: /(?:process\.env|import\.meta\.env)\s*\.\s*(\w*(?:URL|ENDPOINT|API|HOST|BASE)[^\s,;)]*)/gi,
  // URL construction: new URL("/path", baseUrl)
  urlConstruction: /new\s+URL\s*\(\s*["'`]([^"'`]+)["'`]/gi,
  // Template literals with URLs: `${baseUrl}/path`
  templateUrl: /`\$\{[^}]+\}([^`]*(?:\/api\/|\/v\d+\/|\/graphql)[^`]*)`/gi,
  // Common API path patterns
  apiPath: /["'`]((?:https?:\/\/[^"'`\s]+)|(?:\/api\/[^"'`\s]+)|(?:\/v\d+\/[^"'`\s]+))["'`]/g,
};

// Known third-party service domains
const KNOWN_SERVICES: Record<string, { name: string; category: string }> = {
  'api.anthropic.com': { name: 'Anthropic Claude API', category: 'ai' },
  'api.openai.com': { name: 'OpenAI API', category: 'ai' },
  'googleapis.com': { name: 'Google APIs', category: 'cloud' },
  'api.stripe.com': { name: 'Stripe Payments', category: 'payment' },
  'js.stripe.com': { name: 'Stripe.js', category: 'payment' },
  'api.github.com': { name: 'GitHub API', category: 'dev' },
  'sentry.io': { name: 'Sentry Error Tracking', category: 'monitoring' },
  'api.segment.io': { name: 'Segment Analytics', category: 'analytics' },
  'api.mixpanel.com': { name: 'Mixpanel Analytics', category: 'analytics' },
  'api.amplitude.com': { name: 'Amplitude Analytics', category: 'analytics' },
  'www.google-analytics.com': { name: 'Google Analytics', category: 'analytics' },
  'firebaseio.com': { name: 'Firebase', category: 'cloud' },
  'supabase.co': { name: 'Supabase', category: 'cloud' },
  'auth0.com': { name: 'Auth0', category: 'auth' },
  'clerk.dev': { name: 'Clerk Auth', category: 'auth' },
  'cloudflare.com': { name: 'Cloudflare', category: 'cdn' },
  'cdn.jsdelivr.net': { name: 'jsDelivr CDN', category: 'cdn' },
  'unpkg.com': { name: 'unpkg CDN', category: 'cdn' },
};

/**
 * Extract domain from a URL string.
 */
function extractDomain(url: string): string | null {
  try {
    // Handle relative URLs
    if (url.startsWith('/')) {
      return null;
    }
    // Handle protocol-relative URLs
    if (url.startsWith('//')) {
      url = 'https:' + url;
    }
    // Handle URLs without protocol
    if (!url.includes('://') && !url.startsWith('/')) {
      url = 'https://' + url;
    }
    const parsed = new URL(url);
    return parsed.hostname;
  } catch {
    return null;
  }
}

/**
 * Determine confidence level based on URL pattern.
 */
function determineConfidence(url: string): 'high' | 'medium' | 'low' {
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return 'high';
  }
  if (url.startsWith('/api/') || url.startsWith('/v1/') || url.startsWith('/v2/')) {
    return 'medium';
  }
  if (url.includes('${') || url.includes('$env')) {
    return 'low';
  }
  return 'medium';
}

/**
 * Scan a single file for API calls.
 */
function scanFile(filePath: string, content: string): DiscoveredApiCall[] {
  const calls: DiscoveredApiCall[] = [];
  const lines = content.split('\n');

  // Helper to find line number for a match
  const findLineNumber = (index: number): number => {
    let chars = 0;
    for (let i = 0; i < lines.length; i++) {
      chars += lines[i].length + 1; // +1 for newline
      if (chars > index) return i + 1;
    }
    return lines.length;
  };

  // Scan for fetch calls
  let match;
  const fetchRegex = new RegExp(PATTERNS.fetch.source, 'g');
  while ((match = fetchRegex.exec(content)) !== null) {
    const line = findLineNumber(match.index);
    calls.push({
      url: match[1],
      type: 'fetch',
      file: filePath,
      line,
      snippet: lines[line - 1]?.trim() || '',
      confidence: determineConfidence(match[1]),
    });
  }

  // Scan for axios method calls
  const axiosMethodRegex = new RegExp(PATTERNS.axiosMethod.source, 'gi');
  while ((match = axiosMethodRegex.exec(content)) !== null) {
    const line = findLineNumber(match.index);
    calls.push({
      url: match[2],
      method: match[1].toUpperCase() as HttpMethod,
      type: 'axios',
      file: filePath,
      line,
      snippet: lines[line - 1]?.trim() || '',
      confidence: determineConfidence(match[2]),
    });
  }

  // Scan for XHR calls
  const xhrRegex = new RegExp(PATTERNS.xhr.source, 'gi');
  while ((match = xhrRegex.exec(content)) !== null) {
    const line = findLineNumber(match.index);
    calls.push({
      url: match[2],
      method: match[1].toUpperCase() as HttpMethod,
      type: 'xhr',
      file: filePath,
      line,
      snippet: lines[line - 1]?.trim() || '',
      confidence: determineConfidence(match[2]),
    });
  }

  // Scan for WebSocket calls
  const wsRegex = new RegExp(PATTERNS.websocket.source, 'gi');
  while ((match = wsRegex.exec(content)) !== null) {
    const line = findLineNumber(match.index);
    calls.push({
      url: match[1],
      type: 'websocket',
      file: filePath,
      line,
      snippet: lines[line - 1]?.trim() || '',
      confidence: determineConfidence(match[1]),
    });
  }

  // Scan for general API paths
  const apiPathRegex = new RegExp(PATTERNS.apiPath.source, 'g');
  while ((match = apiPathRegex.exec(content)) !== null) {
    const url = match[1];
    const line = findLineNumber(match.index);
    // Avoid duplicates
    const isDuplicate = calls.some(
      (c) => c.url === url && c.file === filePath && Math.abs(c.line - line) < 3
    );
    if (!isDuplicate) {
      calls.push({
        url,
        type: 'other',
        file: filePath,
        line,
        snippet: lines[line - 1]?.trim() || '',
        confidence: determineConfidence(url),
      });
    }
  }

  return calls;
}

/**
 * Recursively collect all JavaScript/TypeScript files.
 */
function collectJsFiles(dir: string, baseDir: string): string[] {
  const files: string[] = [];
  const jsExtensions = ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'];

  const items = readdirSync(dir);
  for (const item of items) {
    // Skip common non-source directories
    if (['node_modules', '.git', 'dist', 'build', '.next', '.nuxt'].includes(item)) {
      continue;
    }

    const fullPath = join(dir, item);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      files.push(...collectJsFiles(fullPath, baseDir));
    } else if (stat.isFile() && jsExtensions.includes(extname(item).toLowerCase())) {
      files.push(fullPath);
    }
  }

  return files;
}

/**
 * Group API calls by domain and generate suggested endpoints.
 */
function generateSuggestedEndpoints(calls: DiscoveredApiCall[]): ApiEndpoint[] {
  const endpointMap = new Map<string, ApiEndpoint>();

  for (const call of calls) {
    const domain = extractDomain(call.url);
    const key = domain || call.url;

    if (!endpointMap.has(key)) {
      const knownService = domain ? KNOWN_SERVICES[domain] : undefined;
      endpointMap.set(key, {
        id: key.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase(),
        name: knownService?.name || `API: ${key}`,
        baseUrl: domain ? `https://${domain}` : call.url,
        methods: call.method ? [call.method] : ['GET'],
        purpose: knownService ? `${knownService.name} integration` : 'TODO: Add description',
        required: true,
        sourceLocations: [call.file],
      });
    } else {
      const existing = endpointMap.get(key)!;
      if (call.method && !existing.methods.includes(call.method)) {
        existing.methods.push(call.method);
      }
      if (!existing.sourceLocations?.includes(call.file)) {
        existing.sourceLocations?.push(call.file);
      }
    }
  }

  return Array.from(endpointMap.values());
}

/**
 * Generate suggested WebSocket endpoints.
 */
function generateSuggestedWebsockets(calls: DiscoveredApiCall[]): WebSocketEndpoint[] {
  const wsCalls = calls.filter((c) => c.type === 'websocket');
  return wsCalls.map((call, index) => ({
    id: `ws-${index + 1}`,
    url: call.url,
    purpose: 'TODO: Add description',
  }));
}

/**
 * Analyze a directory for API calls.
 */
export function analyzeApiSurface(
  dir: string,
  options: { includeNodeModules?: boolean } = {}
): AnalysisResult {
  if (!existsSync(dir)) {
    throw new Error(`Directory not found: ${dir}`);
  }

  const warnings: string[] = [];
  const files = collectJsFiles(dir, dir);

  if (files.length === 0) {
    warnings.push('No JavaScript/TypeScript files found');
  }

  const allCalls: DiscoveredApiCall[] = [];

  for (const file of files) {
    try {
      const content = readFileSync(file, 'utf-8');
      const relativePath = relative(dir, file);
      const calls = scanFile(relativePath, content);
      allCalls.push(...calls);
    } catch (error) {
      warnings.push(`Failed to analyze ${file}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // Extract unique domains
  const domains = new Set<string>();
  for (const call of allCalls) {
    const domain = extractDomain(call.url);
    if (domain) {
      domains.add(domain);
    }
  }

  // Extract WebSocket URLs
  const websockets = allCalls
    .filter((c) => c.type === 'websocket')
    .map((c) => c.url);

  // Generate suggested API surface
  const suggestedApiSurface: Partial<ApiSurface> = {
    version: '1.0',
    generatedAt: new Date().toISOString(),
    endpoints: generateSuggestedEndpoints(allCalls.filter((c) => c.type !== 'websocket')),
    websockets: generateSuggestedWebsockets(allCalls),
  };

  return {
    apiCalls: allCalls,
    domains: Array.from(domains),
    websockets,
    suggestedApiSurface,
    filesAnalyzed: files.length,
    analyzedAt: new Date().toISOString(),
    warnings,
  };
}

/**
 * Format analysis result as human-readable report.
 */
export function formatAnalysisReport(result: AnalysisResult): string {
  const lines: string[] = [];

  lines.push('# API Surface Analysis Report');
  lines.push('');
  lines.push(`Analyzed: ${result.filesAnalyzed} files`);
  lines.push(`Generated: ${result.analyzedAt}`);
  lines.push('');

  // Domains summary
  lines.push('## Domains Contacted');
  lines.push('');
  if (result.domains.length === 0) {
    lines.push('No external domains detected.');
  } else {
    for (const domain of result.domains.sort()) {
      const known = KNOWN_SERVICES[domain];
      if (known) {
        lines.push(`- **${domain}** - ${known.name} (${known.category})`);
      } else {
        lines.push(`- **${domain}**`);
      }
    }
  }
  lines.push('');

  // WebSockets
  if (result.websockets.length > 0) {
    lines.push('## WebSocket Connections');
    lines.push('');
    for (const ws of result.websockets) {
      lines.push(`- ${ws}`);
    }
    lines.push('');
  }

  // API calls detail
  lines.push('## Detected API Calls');
  lines.push('');
  lines.push(`Found ${result.apiCalls.length} API call(s)`);
  lines.push('');

  // Group by file
  const byFile = new Map<string, DiscoveredApiCall[]>();
  for (const call of result.apiCalls) {
    const existing = byFile.get(call.file) || [];
    existing.push(call);
    byFile.set(call.file, existing);
  }

  for (const [file, calls] of byFile) {
    lines.push(`### ${file}`);
    lines.push('');
    for (const call of calls) {
      const method = call.method ? `${call.method} ` : '';
      const confidence = call.confidence === 'low' ? ' (⚠️ low confidence)' : '';
      lines.push(`- Line ${call.line}: \`${method}${call.url}\`${confidence}`);
    }
    lines.push('');
  }

  // Warnings
  if (result.warnings.length > 0) {
    lines.push('## Warnings');
    lines.push('');
    for (const warning of result.warnings) {
      lines.push(`- ⚠️ ${warning}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Generate an API surface template from analysis.
 */
export function generateApiSurfaceTemplate(result: AnalysisResult): ApiSurface {
  return {
    version: '1.0',
    generatedAt: new Date().toISOString(),
    endpoints: result.suggestedApiSurface.endpoints || [],
    websockets: result.suggestedApiSurface.websockets,
  };
}
