import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

// Import generated schema data (synced from CLI via pnpm sync-cli)
import {
    MODELS,
    FRONTMATTER_FIELDS,
    MCP_SERVER_FIELDS_ALL as MCP_SERVER_FIELDS,
    MCP_COMMANDS,
    COMMON_MCP_SERVERS,
} from './generated/schema';

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

        // In mcp_servers block - suggest server config fields
        if (inMcpServers && indent >= 4 && linePrefix.trim() === '') {
            // Inside a server config, suggest fields
            return MCP_SERVER_FIELDS.map(f => this.createCompletion(
                f.label,
                f.detail,
                f.insertText,
                vscode.CompletionItemKind.Property
            ));
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
            if (line.match(/^(mcp_servers|mcpServers):/)) {
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
// Inline Completion Provider (overrides Copilot in .agentuse files)
// ============================================================================

class AgentUseInlineCompletionProvider implements vscode.InlineCompletionItemProvider {
    provideInlineCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        context: vscode.InlineCompletionContext,
        _token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.InlineCompletionItem[] | vscode.InlineCompletionList> {
        const text = document.getText();
        const lineText = document.lineAt(position.line).text;
        const linePrefix = lineText.substring(0, position.character);

        // Check if we're in frontmatter
        const frontmatterMatch = text.match(/^---\n([\s\S]*?)(\n---|\n?$)/);
        if (!frontmatterMatch) {
            return [];
        }

        const frontmatterEnd = frontmatterMatch[0].length;
        const cursorOffset = document.offsetAt(position);
        if (cursorOffset < 4 || cursorOffset > frontmatterEnd) {
            return [];
        }

        // Provide inline completions for specific patterns
        const suggestions: { pattern: RegExp; completion: string }[] = [
            // After "tools:" on empty line with 2-space indent
            { pattern: /^  $/, completion: 'filesystem:\n    - path: ${root}/\n      permissions:\n        - read' },
            // After "model:"
            { pattern: /^\s*model:\s*$/, completion: 'anthropic:claude-opus-4-5' },
            // After "mcpServers:" on empty line with 2-space indent
            { pattern: /^  $/, completion: '' }, // Let regular completion handle this
        ];

        // Check context - are we after "tools:"?
        const frontmatterContent = frontmatterMatch[1];
        const lines = frontmatterContent.split('\n');
        const frontmatterLineIndex = position.line - 1;

        if (frontmatterLineIndex >= 0 && frontmatterLineIndex < lines.length) {
            // Check if previous non-empty line is "tools:"
            let prevLineIndex = frontmatterLineIndex - 1;
            while (prevLineIndex >= 0 && lines[prevLineIndex].trim() === '') {
                prevLineIndex--;
            }

            if (prevLineIndex >= 0) {
                const prevLine = lines[prevLineIndex];

                // After "tools:" - suggest filesystem config
                if (prevLine.match(/^tools:\s*$/) && linePrefix.match(/^\s*$/)) {
                    const indent = linePrefix;
                    const completion = `filesystem:\n${indent}  - path: \${root}/\n${indent}    permissions:\n${indent}      - read`;
                    return [new vscode.InlineCompletionItem(completion, new vscode.Range(position, position))];
                }

                // After "mcpServers:" - suggest a common server
                if (prevLine.match(/^mcpServers:\s*$/) && linePrefix.match(/^\s*$/)) {
                    const indent = linePrefix;
                    const completion = `fetch:\n${indent}  command: "uvx"\n${indent}  args:\n${indent}    - "mcp-server-fetch"`;
                    return [new vscode.InlineCompletionItem(completion, new vscode.Range(position, position))];
                }
            }
        }

        // Return empty to suppress Copilot suggestions in frontmatter
        // Only return [] when we're definitely in a context where Copilot would be wrong
        if (this.isInBlockContext(frontmatterContent, frontmatterLineIndex, ['tools', 'mcpServers', 'mcp_servers', 'subagents'])) {
            return []; // Suppress Copilot here
        }

        return []; // Let Copilot handle other cases
    }

    private isInBlockContext(frontmatter: string, lineIndex: number, blockNames: string[]): boolean {
        const lines = frontmatter.split('\n');
        if (lineIndex < 0 || lineIndex >= lines.length) {
            return false;
        }

        let currentBlock: string | null = null;
        for (let i = 0; i <= lineIndex; i++) {
            const line = lines[i];
            const blockMatch = line.match(/^(\w+):/);
            if (blockMatch) {
                currentBlock = blockMatch[1];
            }
        }

        return currentBlock !== null && blockNames.includes(currentBlock);
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
