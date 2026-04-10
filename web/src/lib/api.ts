const API_BASE = ''

export interface StoredFunction {
  id: string
  name: string
  runtime: 'node' | 'python'
  handler: string
  code: string
  timeout: number
  envVars?: string[]
  createdAt: string
  updatedAt: string
}

export interface ApiKey {
  id: string
  name: string
  createdAt: string
  lastUsedAt?: string
  permissions: string[]
}

export interface Secret {
  name: string
  createdAt: string
  updatedAt: string
}

export interface LogEntry {
  timestamp: string
  method: string
  url: string
  statusCode?: number
  functionId: string
  invocationId: string
  sequence: number
  signature: string
}

export interface LogsResponse {
  entries: LogEntry[]
  publicKey: string
}

class ApiClient {
  private apiKey: string | null = null

  setApiKey(key: string | null) {
    this.apiKey = key
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...options.headers as Record<string, string>
    }

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`
    }

    const res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers
    })

    if (!res.ok) {
      const error = await res.json().catch(() => ({ error: res.statusText }))
      throw new Error(error.error || `Request failed: ${res.status}`)
    }

    return res.json()
  }

  // Health
  async getHealth() {
    return this.request<{ status: string; uptime: number }>('/health')
  }

  // Functions
  async getFunctions() {
    return this.request<{ functions: StoredFunction[] }>('/api/functions')
  }

  async getFunction(id: string) {
    return this.request<{ function: StoredFunction }>(`/api/functions/${id}`)
  }

  async createFunction(data: {
    name: string
    runtime: 'node' | 'python'
    handler: string
    code: string
    timeout?: number
    envVars?: string[]
  }) {
    return this.request<{ function: StoredFunction }>('/api/functions', {
      method: 'POST',
      body: JSON.stringify(data)
    })
  }

  async updateFunction(id: string, data: Partial<{
    name: string
    handler: string
    code: string
    timeout: number
    envVars: string[]
  }>) {
    return this.request<{ function: StoredFunction }>(`/api/functions/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    })
  }

  async deleteFunction(id: string) {
    return this.request<{ success: boolean }>(`/api/functions/${id}`, {
      method: 'DELETE'
    })
  }

  // Secrets
  async getSecrets() {
    return this.request<{ secrets: Secret[] }>('/api/secrets')
  }

  async createSecret(name: string, value: string) {
    return this.request<{ success: boolean }>('/api/secrets', {
      method: 'POST',
      body: JSON.stringify({ name, value })
    })
  }

  async deleteSecret(name: string) {
    return this.request<{ success: boolean }>(`/api/secrets/${name}`, {
      method: 'DELETE'
    })
  }

  // API Keys
  async getKeys() {
    return this.request<{ keys: ApiKey[] }>('/api/keys')
  }

  async createKey(data: { name: string; permissions: string[] }) {
    return this.request<{ key: ApiKey; rawKey: string }>('/api/keys', {
      method: 'POST',
      body: JSON.stringify(data)
    })
  }

  async deleteKey(id: string) {
    return this.request<{ success: boolean }>(`/api/keys/${id}`, {
      method: 'DELETE'
    })
  }

  // Invoke
  async invokeFunction(functionId: string, payload: unknown) {
    return this.request<unknown>(`/invoke/${functionId}`, {
      method: 'POST',
      body: JSON.stringify(payload)
    })
  }

  // Logs
  async getLogs(functionId: string) {
    return this.request<LogsResponse>(`/logs/${functionId}`)
  }

  // Public Key
  async getPublicKey() {
    return this.request<{ publicKey: string; algorithm: string }>('/publicKey')
  }
}

export const api = new ApiClient()
