import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

// ============================================================================
// Completion Data
// ============================================================================

const MODELS = [
    { label: 'anthropic:claude-opus-4-1', detail: 'Most capable Claude model' },
    { label: 'anthropic:claude-sonnet-4-0', detail: 'Balanced performance and speed' },
    { label: 'anthropic:claude-3-5-haiku-latest', detail: 'Fast and cost-effective' },
    { label: 'openai:gpt-5', detail: 'Most capable OpenAI model' },
    { label: 'openai:gpt-5-mini', detail: 'Balanced OpenAI model' },
    { label: 'openai:gpt-5-nano', detail: 'Fast and lightweight OpenAI model' },
    { label: 'openai:gpt-4.1', detail: 'GPT-4.1 model' },
    { label: 'openai:gpt-4.1-mini', detail: 'Fast GPT-4.1 model' },
    { label: 'openai:o4-mini', detail: 'Reasoning model' },
];

const FRONTMATTER_FIELDS = [
    { label: 'model', detail: 'LLM provider and model', insertText: 'model: ' },
    { label: 'timeout', detail: 'Execution timeout in milliseconds', insertText: 'timeout: ' },
    { label: 'maxSteps', detail: 'Maximum reasoning steps', insertText: 'maxSteps: ' },
    { label: 'tools', detail: 'Custom tool references', insertText: 'tools:\n  - ' },
    { label: 'mcp_servers', detail: 'MCP server configurations', insertText: 'mcp_servers:\n  ' },
    { label: 'subagents', detail: 'Sub-agent definitions', insertText: 'subagents:\n  - path: ' },
];

const MCP_SERVER_FIELDS = [
    { label: 'command', detail: 'Command to run (npx, node, uvx, uv)', insertText: 'command: ' },
    { label: 'args', detail: 'Command arguments', insertText: 'args:\n      - ' },
    { label: 'requiredEnvVars', detail: 'Required environment variables', insertText: 'requiredEnvVars:\n      - ' },
    { label: 'allowedEnvVars', detail: 'Optional environment variables', insertText: 'allowedEnvVars:\n      - ' },
    { label: 'env', detail: 'Direct environment variables', insertText: 'env:\n      ' },
    { label: 'url', detail: 'Remote MCP server URL', insertText: 'url: ' },
    { label: 'auth', detail: 'Authentication configuration', insertText: 'auth:\n      type: bearer\n      token: ${' },
];

const MCP_COMMANDS = [
    { label: 'npx', detail: 'Run npm package' },
    { label: 'node', detail: 'Run Node.js script' },
    { label: 'uvx', detail: 'Run Python package' },
    { label: 'uv', detail: 'Run Python with uv' },
];

const COMMON_MCP_SERVERS: { [key: string]: { snippet: string; detail: string } } = {
    'filesystem': {
        detail: 'File system access',
        snippet: `filesystem:
    command: "npx"
    args:
      - "-y"
      - "@modelcontextprotocol/server-filesystem"
      - "./tmp"`
    },
    'puppeteer': {
        detail: 'Browser automation',
        snippet: `puppeteer:
    command: "npx"
    args:
      - "-y"
      - "@modelcontextprotocol/server-puppeteer"`
    },
    'slack': {
        detail: 'Slack integration',
        snippet: `slack:
    command: "npx"
    args:
      - "-y"
      - "@modelcontextprotocol/server-slack"
    allowedEnvVars:
      - SLACK_BOT_TOKEN
      - SLACK_TEAM_ID`
    },
    'fetch': {
        detail: 'HTTP fetch capabilities',
        snippet: `fetch:
    command: "uvx"
    args:
      - "mcp-server-fetch"`
    },
    'github': {
        detail: 'GitHub API access',
        snippet: `github:
    command: "npx"
    args:
      - "-y"
      - "@modelcontextprotocol/server-github"
    requiredEnvVars:
      - GITHUB_PERSONAL_ACCESS_TOKEN`
    },
    'memory': {
        detail: 'Persistent memory storage',
        snippet: `memory:
    command: "npx"
    args:
      - "-y"
      - "@modelcontextprotocol/server-memory"`
    },
    'brave-search': {
        detail: 'Brave search API',
        snippet: `brave-search:
    command: "npx"
    args:
      - "-y"
      - "@modelcontextprotocol/server-brave-search"
    requiredEnvVars:
      - BRAVE_API_KEY`
    },
    'google-maps': {
        detail: 'Google Maps API',
        snippet: `google-maps:
    command: "npx"
    args:
      - "-y"
      - "@modelcontextprotocol/server-google-maps"
    requiredEnvVars:
      - GOOGLE_MAPS_API_KEY`
    },
    'sqlite': {
        detail: 'SQLite database access',
        snippet: `sqlite:
    command: "uvx"
    args:
      - "mcp-server-sqlite"
      - "--db-path"
      - "./data.db"`
    },
    'postgres': {
        detail: 'PostgreSQL database access',
        snippet: `postgres:
    command: "npx"
    args:
      - "-y"
      - "@modelcontextprotocol/server-postgres"
    requiredEnvVars:
      - POSTGRES_CONNECTION_STRING`
    },
    'exa': {
        detail: 'Exa search API',
        snippet: `exa:
    command: "npx"
    args:
      - "-y"
      - "exa-mcp-server"
    requiredEnvVars:
      - EXA_API_KEY`
    },
    'notion': {
        detail: 'Notion integration',
        snippet: `notion:
    command: "npx"
    args:
      - "-y"
      - "@suekou/mcp-notion-server"
    requiredEnvVars:
      - NOTION_API_KEY`
    },
    'slack-webhook': {
        detail: 'Slack webhook notifications',
        snippet: `slack:
    command: "npx"
    args:
      - "-y"
      - "@agentuse/mcp-slack-webhook"
    requiredEnvVars:
      - SLACK_WEBHOOK_URL`
    },
};

// ============================================================================
// Completion Provider
// ============================================================================

class AgentUseCompletionProvider implements vscode.CompletionItemProvider {

    provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken,
        _context: vscode.CompletionContext
    ): vscode.ProviderResult<vscode.CompletionItem[] | vscode.CompletionList> {
        const text = document.getText();
        const lineText = document.lineAt(position.line).text;
        const linePrefix = lineText.substring(0, position.character);

        // Check if we're in the frontmatter
        const frontmatterMatch = text.match(/^---\n([\s\S]*?)(\n---|\n?$)/);
        if (!frontmatterMatch) {
            // Not in frontmatter yet, suggest starting it
            if (position.line === 0 && linePrefix === '') {
                return [this.createSnippetCompletion(
                    '---',
                    'Start frontmatter',
                    '---\nmodel: ${1|anthropic:claude-sonnet-4-0,anthropic:claude-opus-4-1,openai:gpt-5|}\n---\n\n$0',
                    vscode.CompletionItemKind.Snippet
                )];
            }
            return [];
        }

        const frontmatterStart = 0;
        const frontmatterEnd = frontmatterMatch[0].length;
        const cursorOffset = document.offsetAt(position);

        // Check if cursor is within frontmatter
        if (cursorOffset < 4 || cursorOffset > frontmatterEnd) {
            return [];
        }

        const frontmatterContent = frontmatterMatch[1];
        const inMcpServers = this.isInMcpServersBlock(document, position, frontmatterContent);
        const inSubagents = this.isInSubagentsBlock(document, position, frontmatterContent);
        const inTools = this.isInToolsBlock(document, position, frontmatterContent);

        // Determine indentation level
        const indentMatch = linePrefix.match(/^(\s*)/);
        const indent = indentMatch ? indentMatch[1].length : 0;

        // Model value completion
        if (linePrefix.match(/^\s*model:\s*$/)) {
            return MODELS.map(m => this.createCompletion(
                m.label,
                m.detail,
                m.label,
                vscode.CompletionItemKind.Value
            ));
        }

        // Command value completion
        if (linePrefix.match(/^\s*command:\s*["']?$/)) {
            return MCP_COMMANDS.map(c => this.createCompletion(
                c.label,
                c.detail,
                `"${c.label}"`,
                vscode.CompletionItemKind.Value
            ));
        }

        // In mcp_servers block - suggest server names or server config fields
        if (inMcpServers) {
            if (indent === 2 && linePrefix.trim() === '') {
                // Suggest common MCP server templates
                return Object.entries(COMMON_MCP_SERVERS).map(([name, config]) =>
                    this.createSnippetCompletion(
                        name,
                        config.detail,
                        config.snippet,
                        vscode.CompletionItemKind.Module
                    )
                );
            }
            if (indent >= 4 && linePrefix.trim() === '') {
                // Inside a server config, suggest fields
                return MCP_SERVER_FIELDS.map(f => this.createCompletion(
                    f.label,
                    f.detail,
                    f.insertText,
                    vscode.CompletionItemKind.Property
                ));
            }
        }

        // In subagents block
        if (inSubagents && indent >= 2) {
            if (linePrefix.match(/^\s*-\s*$/)) {
                return [
                    this.createCompletion('path', 'Path to subagent file', 'path: ./', vscode.CompletionItemKind.Property),
                ];
            }
            if (linePrefix.match(/^\s*path:\s*$/)) {
                // Suggest .agentuse files in workspace
                return this.getAgentUseFiles(document);
            }
            if (linePrefix.trim() === '') {
                return [
                    this.createCompletion('name', 'Reference name for subagent', 'name: ', vscode.CompletionItemKind.Property),
                ];
            }
        }

        // In tools block
        if (inTools && indent >= 2) {
            if (linePrefix.match(/^\s*-\s*$/)) {
                // Could add known tool suggestions here
                return [];
            }
        }

        // Top-level frontmatter fields
        if (indent === 0 && linePrefix.trim() === '') {
            const existingFields = this.getExistingFields(frontmatterContent);
            return FRONTMATTER_FIELDS
                .filter(f => !existingFields.has(f.label))
                .map(f => this.createCompletion(
                    f.label,
                    f.detail,
                    f.insertText,
                    vscode.CompletionItemKind.Property
                ));
        }

        return [];
    }

    private isInMcpServersBlock(document: vscode.TextDocument, position: vscode.Position, frontmatter: string): boolean {
        // position.line is 0-indexed, line 0 is "---", so frontmatter content starts at line 1
        const frontmatterLineIndex = position.line - 1; // Convert to frontmatter array index
        const lines = frontmatter.split('\n');

        if (frontmatterLineIndex < 0 || frontmatterLineIndex >= lines.length) {
            return false;
        }

        let inBlock = false;
        for (let i = 0; i <= frontmatterLineIndex; i++) {
            const line = lines[i];
            if (line.match(/^mcp_servers:/)) {
                inBlock = true;
            } else if (inBlock && line.trim() && !line.match(/^\s/)) {
                inBlock = false;
            }
        }
        return inBlock;
    }

    private isInSubagentsBlock(document: vscode.TextDocument, position: vscode.Position, frontmatter: string): boolean {
        const frontmatterLineIndex = position.line - 1;
        const lines = frontmatter.split('\n');

        if (frontmatterLineIndex < 0 || frontmatterLineIndex >= lines.length) {
            return false;
        }

        let inBlock = false;
        for (let i = 0; i <= frontmatterLineIndex; i++) {
            const line = lines[i];
            if (line.match(/^subagents:/)) {
                inBlock = true;
            } else if (inBlock && line.trim() && !line.match(/^\s/)) {
                inBlock = false;
            }
        }
        return inBlock;
    }

    private isInToolsBlock(document: vscode.TextDocument, position: vscode.Position, frontmatter: string): boolean {
        const frontmatterLineIndex = position.line - 1;
        const lines = frontmatter.split('\n');

        if (frontmatterLineIndex < 0 || frontmatterLineIndex >= lines.length) {
            return false;
        }

        let inBlock = false;
        for (let i = 0; i <= frontmatterLineIndex; i++) {
            const line = lines[i];
            if (line.match(/^tools:/)) {
                inBlock = true;
            } else if (inBlock && line.trim() && !line.match(/^\s/)) {
                inBlock = false;
            }
        }
        return inBlock;
    }

    private getExistingFields(frontmatter: string): Set<string> {
        const fields = new Set<string>();
        const lines = frontmatter.split('\n');
        for (const line of lines) {
            const match = line.match(/^(\w+):/);
            if (match) {
                fields.add(match[1]);
            }
        }
        return fields;
    }

    private getAgentUseFiles(document: vscode.TextDocument): vscode.CompletionItem[] {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
        if (!workspaceFolder) {
            return [];
        }

        const items: vscode.CompletionItem[] = [];
        const currentDir = path.dirname(document.uri.fsPath);

        try {
            const files = this.findAgentUseFilesRecursive(workspaceFolder.uri.fsPath, 3);
            for (const file of files) {
                const relativePath = './' + path.relative(currentDir, file);
                const item = new vscode.CompletionItem(relativePath, vscode.CompletionItemKind.File);
                item.detail = path.basename(file);
                items.push(item);
            }
        } catch {
            // Ignore errors in file discovery
        }

        return items;
    }

    private findAgentUseFilesRecursive(dir: string, maxDepth: number, currentDepth = 0): string[] {
        if (currentDepth >= maxDepth) {
            return [];
        }

        const files: string[] = [];
        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.name.startsWith('.') || entry.name === 'node_modules') {
                    continue;
                }
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    files.push(...this.findAgentUseFilesRecursive(fullPath, maxDepth, currentDepth + 1));
                } else if (entry.name.endsWith('.agentuse')) {
                    files.push(fullPath);
                }
            }
        } catch {
            // Ignore permission errors
        }
        return files;
    }

    private createCompletion(
        label: string,
        detail: string,
        insertText: string,
        kind: vscode.CompletionItemKind
    ): vscode.CompletionItem {
        const item = new vscode.CompletionItem(label, kind);
        item.detail = detail;
        item.insertText = insertText;
        return item;
    }

    private createSnippetCompletion(
        label: string,
        detail: string,
        snippet: string,
        kind: vscode.CompletionItemKind
    ): vscode.CompletionItem {
        const item = new vscode.CompletionItem(label, kind);
        item.detail = detail;
        item.insertText = new vscode.SnippetString(snippet);
        return item;
    }
}

// ============================================================================
// Hover Provider
// ============================================================================

class AgentUseHoverProvider implements vscode.HoverProvider {
    provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.Hover> {
        const lineText = document.lineAt(position.line).text;
        const wordRange = document.getWordRangeAtPosition(position);
        if (!wordRange) {
            return null;
        }

        const word = document.getText(wordRange);

        // Field documentation
        const fieldDocs: { [key: string]: string } = {
            'model': '**model** - The LLM provider and model to use.\n\nFormat: `provider:model-name`\n\nExamples:\n- `anthropic:claude-sonnet-4-0`\n- `openai:gpt-5`',
            'timeout': '**timeout** - Execution timeout in milliseconds.\n\nExample: `timeout: 2000`',
            'maxSteps': '**maxSteps** - Maximum number of reasoning steps the agent can take.\n\nExample: `maxSteps: 200`',
            'tools': '**tools** - List of custom tools to make available to the agent.\n\nExample:\n```yaml\ntools:\n  - greet\n  - file-ops.write\n```',
            'mcp_servers': '**mcp_servers** - MCP (Model Context Protocol) server configurations.\n\nProvides tools and capabilities to the agent.',
            'subagents': '**subagents** - Sub-agent definitions for delegating tasks.\n\nExample:\n```yaml\nsubagents:\n  - path: ./helper.agentuse\n    name: helper\n```',
            'command': '**command** - Command to start the MCP server.\n\nOptions: `npx`, `node`, `uvx`, `uv`',
            'args': '**args** - Arguments to pass to the MCP server command.',
            'requiredEnvVars': '**requiredEnvVars** - Environment variables that must be set.',
            'allowedEnvVars': '**allowedEnvVars** - Environment variables that can optionally be used.',
            'url': '**url** - URL for remote MCP server proxy.',
            'auth': '**auth** - Authentication configuration for remote MCP servers.',
        };

        if (fieldDocs[word] && lineText.includes(`${word}:`)) {
            return new vscode.Hover(new vscode.MarkdownString(fieldDocs[word]));
        }

        // Model documentation
        if (lineText.includes('model:')) {
            const modelInfo = MODELS.find(m => m.label === word || lineText.includes(m.label));
            if (modelInfo) {
                return new vscode.Hover(new vscode.MarkdownString(`**${modelInfo.label}**\n\n${modelInfo.detail}`));
            }
        }

        // MCP server documentation
        if (COMMON_MCP_SERVERS[word]) {
            const server = COMMON_MCP_SERVERS[word];
            return new vscode.Hover(new vscode.MarkdownString(`**${word}** - ${server.detail}\n\n\`\`\`yaml\n${server.snippet}\n\`\`\``));
        }

        return null;
    }
}

// ============================================================================
// Pseudoterminal
// ============================================================================

class AgentUsePseudoterminal implements vscode.Pseudoterminal {
    private writeEmitter = new vscode.EventEmitter<string>();
    onDidWrite: vscode.Event<string> = this.writeEmitter.event;
    private closeEmitter = new vscode.EventEmitter<number>();
    onDidClose?: vscode.Event<number> = this.closeEmitter.event;

    private process?: cp.ChildProcess;

    constructor(private filePath: string) {}

    open(): void {
        this.writeEmitter.fire(`Running: agentuse run "${this.filePath}"\r\n`);
        this.writeEmitter.fire('='.repeat(80) + '\r\n\r\n');

        this.process = cp.spawn('agentuse', ['run', this.filePath], {
            shell: true,
            cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
            env: {
                ...process.env,
                FORCE_COLOR: '1',
                TERM: 'xterm-256color'
            }
        });

        this.process.stdout?.on('data', (data: Buffer) => {
            this.writeEmitter.fire(data.toString().replace(/\n/g, '\r\n'));
        });

        this.process.stderr?.on('data', (data: Buffer) => {
            this.writeEmitter.fire(data.toString().replace(/\n/g, '\r\n'));
        });

        this.process.on('close', (code: number) => {
            this.writeEmitter.fire('\r\n' + '='.repeat(80) + '\r\n');
            this.writeEmitter.fire(`Process exited with code ${code}\r\n`);
            // Don't close the terminal
        });

        this.process.on('error', (error: Error) => {
            this.writeEmitter.fire(`Error: ${error.message}\r\n`);
        });
    }

    handleInput(data: string): void {
        // Handle Ctrl+C (ASCII 3)
        if (data === '\x03') {
            if (this.process && !this.process.killed) {
                this.process.kill('SIGINT');
                this.writeEmitter.fire('^C\r\n');
            }
        } else if (this.process?.stdin) {
            // Pass other input to the process
            this.process.stdin.write(data);
        }
    }

    close(): void {
        if (this.process && !this.process.killed) {
            this.process.kill();
        }
    }
}

export function activate(context: vscode.ExtensionContext) {
    // Register completion provider
    const completionProvider = vscode.languages.registerCompletionItemProvider(
        { language: 'agentuse', scheme: 'file' },
        new AgentUseCompletionProvider(),
        ':', ' ', '-', '\n'  // Trigger characters
    );

    // Register hover provider
    const hoverProvider = vscode.languages.registerHoverProvider(
        { language: 'agentuse', scheme: 'file' },
        new AgentUseHoverProvider()
    );

    const runCommand = vscode.commands.registerCommand('agentuse.run', async () => {
        const editor = vscode.window.activeTextEditor;

        if (!editor) {
            vscode.window.showErrorMessage('No active file');
            return;
        }

        const document = editor.document;
        const filePath = document.uri.fsPath;

        if (!filePath.endsWith('.agentuse')) {
            vscode.window.showErrorMessage('Current file is not an .agentuse file');
            return;
        }

        // Save the file before running
        await document.save();

        const fileName = filePath.split('/').pop() || 'output';
        const pty = new AgentUsePseudoterminal(filePath);

        const terminal = vscode.window.createTerminal({
            name: `AgentUse: ${fileName}`,
            pty
        });

        terminal.show(true); // true = preserve focus on editor
    });

    const closeTerminalCommand = vscode.commands.registerCommand('agentuse.closeTerminal', () => {
        const activeTerminal = vscode.window.activeTerminal;

        if (activeTerminal && activeTerminal.name.startsWith('AgentUse:')) {
            activeTerminal.dispose();
        }
    });

    context.subscriptions.push(
        completionProvider,
        hoverProvider,
        runCommand,
        closeTerminalCommand
    );
}

export function deactivate() {}
