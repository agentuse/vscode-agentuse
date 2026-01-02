#!/usr/bin/env npx tsx
"use strict";
/**
 * Sync VS Code extension schema with AgentUse CLI
 *
 * Reads CLI source files and generates extension data for:
 * - Models (from src/generated/models.ts)
 * - Frontmatter fields (from src/parser.ts)
 * - MCP server fields (from src/parser.ts)
 * - Tools config (from src/tools/types.ts)
 *
 * Run with: pnpm sync-cli
 */
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = require("fs");
const path_1 = require("path");
const url_1 = require("url");
const __dirname = (0, path_1.dirname)((0, url_1.fileURLToPath)(import.meta.url));
const EXTENSION_ROOT = (0, path_1.join)(__dirname, '..');
const CLI_ROOT = (0, path_1.join)(EXTENSION_ROOT, '../agentuse');
// ============================================================================
// CLI Source Parsers
// ============================================================================
function parseModels(content) {
    const models = [];
    // Parse each model entry individually
    // Pattern: 'model-id': { id: '...', name: '...', reasoning: ..., toolCall: ..., ... limit: { context: ..., } }
    const modelBlockRegex = /'([^']+)':\s*\{\s*id:\s*'([^']+)',\s*name:\s*'([^']+)',\s*reasoning:\s*(true|false),\s*toolCall:\s*(true|false),[\s\S]*?context:\s*(\d+),/g;
    // First, identify which provider section we're in
    const providers = [];
    const providerStarts = [
        { name: 'anthropic', regex: /anthropic:\s*\{/g },
        { name: 'openai', regex: /openai:\s*\{/g },
        { name: 'openrouter', regex: /openrouter:\s*\{/g },
    ];
    for (const { name, regex } of providerStarts) {
        const match = regex.exec(content);
        if (match) {
            providers.push({ name, start: match.index, end: 0 });
        }
    }
    // Sort by position and calculate end positions
    providers.sort((a, b) => a.start - b.start);
    for (let i = 0; i < providers.length; i++) {
        providers[i].end = i < providers.length - 1 ? providers[i + 1].start : content.length;
    }
    // Extract models from each provider section
    for (const provider of providers) {
        const section = content.slice(provider.start, provider.end);
        let match;
        while ((match = modelBlockRegex.exec(section)) !== null) {
            const [, , id, name, reasoning, toolCall, context] = match;
            models.push({
                label: `${provider.name}:${id}`,
                detail: name,
                info: {
                    reasoning: reasoning === 'true',
                    toolCall: toolCall === 'true',
                    contextLimit: parseInt(context, 10),
                },
            });
        }
    }
    // Sort: latest versions first, then alphabetically
    return models.sort((a, b) => {
        // Prioritize "latest" models
        const aLatest = a.detail.toLowerCase().includes('latest') ? 0 : 1;
        const bLatest = b.detail.toLowerCase().includes('latest') ? 0 : 1;
        if (aLatest !== bLatest)
            return aLatest - bLatest;
        // Then by provider
        const aProvider = a.label.split(':')[0];
        const bProvider = b.label.split(':')[0];
        if (aProvider !== bProvider)
            return aProvider.localeCompare(bProvider);
        // Then by model name
        return a.label.localeCompare(b.label);
    });
}
function parseFrontmatterFields(content) {
    // Extract fields from AgentSchema = z.object({ ... })
    const schemaMatch = content.match(/const AgentSchema = z\.object\(\{([\s\S]*?)\}\)\.transform/);
    if (!schemaMatch) {
        throw new Error('Could not find AgentSchema in parser.ts');
    }
    const fields = [
        { label: 'model', detail: 'LLM provider and model (required)', insertText: 'model: ', required: true },
        { label: 'description', detail: 'Brief description of what the agent does', insertText: 'description: ' },
        { label: 'timeout', detail: 'Execution timeout in seconds (default: 300)', insertText: 'timeout: ' },
        { label: 'maxSteps', detail: 'Maximum reasoning steps (default: 100)', insertText: 'maxSteps: ' },
        { label: 'openai', detail: 'OpenAI-specific options (reasoningEffort, textVerbosity)', insertText: 'openai:\n  reasoningEffort: ' },
        { label: 'mcpServers', detail: 'MCP server configurations', insertText: 'mcpServers:\n  ' },
        { label: 'subagents', detail: 'Sub-agent definitions', insertText: 'subagents:\n  - path: ' },
        { label: 'tools', detail: 'Custom tool configurations (filesystem, bash)', insertText: 'tools:\n  filesystem:\n    - path: ' },
    ];
    return fields;
}
function parseMCPServerFields(content) {
    const stdio = [
        { label: 'command', detail: 'Command to run (npx, node, uvx, uv)', insertText: 'command: ' },
        { label: 'args', detail: 'Command arguments array', insertText: 'args:\n      - ' },
        { label: 'env', detail: 'Environment variables object', insertText: 'env:\n      ' },
    ];
    const http = [
        { label: 'url', detail: 'Remote MCP server URL (http:// or https://)', insertText: 'url: ' },
        { label: 'sessionId', detail: 'Optional session identifier', insertText: 'sessionId: ' },
        { label: 'auth', detail: 'Authentication configuration', insertText: 'auth:\n      type: bearer\n      token: ${env:' },
        { label: 'headers', detail: 'Custom HTTP headers', insertText: 'headers:\n      ' },
    ];
    const shared = [
        { label: 'requiredEnvVars', detail: 'Required environment variables (agent fails if missing)', insertText: 'requiredEnvVars:\n      - ' },
        { label: 'allowedEnvVars', detail: 'Optional environment variables (warns if missing)', insertText: 'allowedEnvVars:\n      - ' },
        { label: 'disallowedTools', detail: 'Tool patterns to exclude from this server', insertText: 'disallowedTools:\n      - ' },
        { label: 'toolTimeout', detail: 'Timeout for tool calls in milliseconds', insertText: 'toolTimeout: ' },
    ];
    return { stdio, http, shared };
}
function parseToolsConfig(content) {
    // Extract permissions from FilesystemPermissionSchema
    const permMatch = content.match(/FilesystemPermissionSchema = z\.enum\(\[([^\]]+)\]\)/);
    const permissions = permMatch
        ? permMatch[1].split(',').map((p) => p.trim().replace(/['"]/g, ''))
        : ['read', 'write', 'edit'];
    const filesystemFields = [
        { label: 'path', detail: 'Single path to allow access', insertText: 'path: ${root}/' },
        { label: 'paths', detail: 'Multiple paths to allow access', insertText: 'paths:\n        - ' },
        { label: 'permissions', detail: `Allowed operations: ${permissions.join(', ')}`, insertText: 'permissions:\n        - read' },
    ];
    const bashFields = [
        { label: 'commands', detail: 'Allowed command patterns (e.g., git:*, npm:run:*)', insertText: 'commands:\n      - ' },
        { label: 'timeout', detail: 'Command execution timeout in milliseconds', insertText: 'timeout: ' },
        { label: 'allowedPaths', detail: 'Paths that commands can access', insertText: 'allowedPaths:\n      - ' },
    ];
    return { permissions, filesystemFields, bashFields };
}
// Common MCP server templates - these are curated and don't change often
const COMMON_MCP_SERVERS = {
    filesystem: {
        detail: 'File system access',
        snippet: `filesystem:
    command: "npx"
    args:
      - "-y"
      - "@modelcontextprotocol/server-filesystem"
      - "\${1:./tmp}"`,
    },
    puppeteer: {
        detail: 'Browser automation',
        snippet: `puppeteer:
    command: "npx"
    args:
      - "-y"
      - "@modelcontextprotocol/server-puppeteer"`,
    },
    slack: {
        detail: 'Slack integration',
        snippet: `slack:
    command: "npx"
    args:
      - "-y"
      - "@modelcontextprotocol/server-slack"
    allowedEnvVars:
      - SLACK_BOT_TOKEN
      - SLACK_TEAM_ID`,
    },
    fetch: {
        detail: 'HTTP fetch capabilities',
        snippet: `fetch:
    command: "uvx"
    args:
      - "mcp-server-fetch"`,
    },
    github: {
        detail: 'GitHub API access',
        snippet: `github:
    command: "npx"
    args:
      - "-y"
      - "@modelcontextprotocol/server-github"
    requiredEnvVars:
      - GITHUB_PERSONAL_ACCESS_TOKEN`,
    },
    memory: {
        detail: 'Persistent memory storage',
        snippet: `memory:
    command: "npx"
    args:
      - "-y"
      - "@modelcontextprotocol/server-memory"`,
    },
    'brave-search': {
        detail: 'Brave search API',
        snippet: `brave-search:
    command: "npx"
    args:
      - "-y"
      - "@modelcontextprotocol/server-brave-search"
    requiredEnvVars:
      - BRAVE_API_KEY`,
    },
    'google-maps': {
        detail: 'Google Maps API',
        snippet: `google-maps:
    command: "npx"
    args:
      - "-y"
      - "@modelcontextprotocol/server-google-maps"
    requiredEnvVars:
      - GOOGLE_MAPS_API_KEY`,
    },
    sqlite: {
        detail: 'SQLite database access',
        snippet: `sqlite:
    command: "uvx"
    args:
      - "mcp-server-sqlite"
      - "--db-path"
      - "\${1:./data.db}"`,
    },
    postgres: {
        detail: 'PostgreSQL database access',
        snippet: `postgres:
    command: "npx"
    args:
      - "-y"
      - "@modelcontextprotocol/server-postgres"
    requiredEnvVars:
      - POSTGRES_CONNECTION_STRING`,
    },
    exa: {
        detail: 'Exa search API',
        snippet: `exa:
    command: "npx"
    args:
      - "-y"
      - "exa-mcp-server"
    requiredEnvVars:
      - EXA_API_KEY`,
    },
    notion: {
        detail: 'Notion integration',
        snippet: `notion:
    command: "npx"
    args:
      - "-y"
      - "@suekou/mcp-notion-server"
    requiredEnvVars:
      - NOTION_API_KEY`,
    },
    'slack-webhook': {
        detail: 'Slack webhook notifications',
        snippet: `slack-webhook:
    command: "npx"
    args:
      - "-y"
      - "@agentuse/mcp-slack-webhook"
    requiredEnvVars:
      - SLACK_WEBHOOK_URL`,
    },
};
const MCP_COMMANDS = [
    { label: 'npx', detail: 'Run npm package' },
    { label: 'node', detail: 'Run Node.js script' },
    { label: 'uvx', detail: 'Run Python package with uv' },
    { label: 'uv', detail: 'Run Python with uv' },
];
// ============================================================================
// Code Generation
// ============================================================================
function generateSchemaFile(models, frontmatterFields, mcpFields, toolsConfig) {
    const timestamp = new Date().toISOString();
    return `// AUTO-GENERATED FILE - DO NOT EDIT
// Generated by: pnpm sync-cli
// Source: ../agentuse (CLI)
// Last sync: ${timestamp}

export interface ModelItem {
  label: string;
  detail: string;
  info?: {
    reasoning: boolean;
    toolCall: boolean;
    contextLimit: number;
  };
}

export interface FieldItem {
  label: string;
  detail: string;
  insertText: string;
  required?: boolean;
}

export interface MCPServerTemplate {
  detail: string;
  snippet: string;
}

// ============================================================================
// Models (${models.length} total)
// ============================================================================

export const MODELS: ModelItem[] = ${JSON.stringify(models, null, 2)};

// ============================================================================
// Frontmatter Fields
// ============================================================================

export const FRONTMATTER_FIELDS: FieldItem[] = ${JSON.stringify(frontmatterFields, null, 2)};

// ============================================================================
// MCP Server Fields
// ============================================================================

export const MCP_SERVER_FIELDS = {
  stdio: ${JSON.stringify(mcpFields.stdio, null, 2)},
  http: ${JSON.stringify(mcpFields.http, null, 2)},
  shared: ${JSON.stringify(mcpFields.shared, null, 2)},
};

// Combined MCP server fields for simple iteration (stdio + http unique + shared)
export const MCP_SERVER_FIELDS_ALL: FieldItem[] = [
  ...MCP_SERVER_FIELDS.stdio,
  ...MCP_SERVER_FIELDS.http.filter(f => !MCP_SERVER_FIELDS.stdio.some(s => s.label === f.label)),
  ...MCP_SERVER_FIELDS.shared,
];

export const MCP_COMMANDS = ${JSON.stringify(MCP_COMMANDS, null, 2)};

export const COMMON_MCP_SERVERS: Record<string, MCPServerTemplate> = ${JSON.stringify(COMMON_MCP_SERVERS, null, 2)};

// ============================================================================
// Tools Configuration
// ============================================================================

export const TOOLS_CONFIG = {
  permissions: ${JSON.stringify(toolsConfig.permissions)},
  filesystem: ${JSON.stringify(toolsConfig.filesystemFields, null, 2)},
  bash: ${JSON.stringify(toolsConfig.bashFields, null, 2)},
};

// ============================================================================
// Variables
// ============================================================================

export const VARIABLES = [
  { pattern: '\${root}', detail: 'Project root directory (where .git, package.json, or .agentuse exists)' },
  { pattern: '\${agentDir}', detail: 'Directory containing the agent file' },
  { pattern: '\${tmpDir}', detail: 'System temp directory' },
  { pattern: '\${env:VAR_NAME}', detail: 'Environment variable (only in HTTP auth.token)' },
];
`;
}
// ============================================================================
// Main
// ============================================================================
async function main() {
    console.log('Syncing VS Code extension with AgentUse CLI...\n');
    // Verify CLI exists
    if (!(0, fs_1.existsSync)(CLI_ROOT)) {
        console.error(`ERROR: AgentUse CLI not found at ${CLI_ROOT}`);
        console.error('Make sure the CLI repo is at ../agentuse relative to this extension.');
        process.exit(1);
    }
    // Read CLI source files
    const modelsPath = (0, path_1.join)(CLI_ROOT, 'src/generated/models.ts');
    const parserPath = (0, path_1.join)(CLI_ROOT, 'src/parser.ts');
    const typesPath = (0, path_1.join)(CLI_ROOT, 'src/tools/types.ts');
    if (!(0, fs_1.existsSync)(modelsPath)) {
        console.error(`ERROR: Models file not found: ${modelsPath}`);
        process.exit(1);
    }
    if (!(0, fs_1.existsSync)(parserPath)) {
        console.error(`ERROR: Parser file not found: ${parserPath}`);
        process.exit(1);
    }
    if (!(0, fs_1.existsSync)(typesPath)) {
        console.error(`ERROR: Types file not found: ${typesPath}`);
        process.exit(1);
    }
    const modelsContent = (0, fs_1.readFileSync)(modelsPath, 'utf-8');
    const parserContent = (0, fs_1.readFileSync)(parserPath, 'utf-8');
    const typesContent = (0, fs_1.readFileSync)(typesPath, 'utf-8');
    // Parse CLI sources
    console.log('Parsing CLI source files...');
    const models = parseModels(modelsContent);
    const frontmatterFields = parseFrontmatterFields(parserContent);
    const mcpFields = parseMCPServerFields(parserContent);
    const toolsConfig = parseToolsConfig(typesContent);
    console.log(`  - Models: ${models.length}`);
    console.log(`  - Frontmatter fields: ${frontmatterFields.length}`);
    console.log(`  - MCP stdio fields: ${mcpFields.stdio.length}`);
    console.log(`  - MCP http fields: ${mcpFields.http.length}`);
    console.log(`  - MCP shared fields: ${mcpFields.shared.length}`);
    console.log(`  - Filesystem permissions: ${toolsConfig.permissions.join(', ')}`);
    // Create generated directory
    const generatedDir = (0, path_1.join)(EXTENSION_ROOT, 'src/generated');
    if (!(0, fs_1.existsSync)(generatedDir)) {
        (0, fs_1.mkdirSync)(generatedDir, { recursive: true });
        console.log(`\nCreated directory: ${generatedDir}`);
    }
    // Generate schema file
    const schemaContent = generateSchemaFile(models, frontmatterFields, mcpFields, toolsConfig);
    const schemaPath = (0, path_1.join)(generatedDir, 'schema.ts');
    (0, fs_1.writeFileSync)(schemaPath, schemaContent);
    console.log(`\nGenerated: ${schemaPath}`);
    // Validation
    console.log('\nValidation:');
    if (models.length === 0) {
        console.error('  ERROR: No models extracted!');
        process.exit(1);
    }
    console.log(`  ✓ Models count: ${models.length}`);
    const hasModel = frontmatterFields.some((f) => f.label === 'model' && f.required);
    if (!hasModel) {
        console.error('  ERROR: Required "model" field missing from frontmatter!');
        process.exit(1);
    }
    console.log('  ✓ Required "model" field present');
    const hasCommand = mcpFields.stdio.some((f) => f.label === 'command');
    if (!hasCommand) {
        console.error('  ERROR: "command" field missing from MCP stdio!');
        process.exit(1);
    }
    console.log('  ✓ MCP stdio has "command" field');
    const hasUrl = mcpFields.http.some((f) => f.label === 'url');
    if (!hasUrl) {
        console.error('  ERROR: "url" field missing from MCP http!');
        process.exit(1);
    }
    console.log('  ✓ MCP http has "url" field');
    console.log('\nSync complete!');
}
main().catch((err) => {
    console.error('Sync failed:', err);
    process.exit(1);
});
//# sourceMappingURL=sync-cli.js.map