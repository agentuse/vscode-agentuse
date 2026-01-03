# AgentUse Runner for VS Code

[![VS Marketplace](https://img.shields.io/visual-studio-marketplace/v/agentuse.agentuse-runner?style=flat-square)](https://marketplace.visualstudio.com/items?itemName=agentuse.agentuse-runner)
[![Open VSX](https://img.shields.io/open-vsx/v/agentuse/agentuse-runner?style=flat-square)](https://open-vsx.org/extension/agentuse/agentuse-runner)
[![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)

Run `.agentuse` AI agent workflows directly in VS Code with IntelliSense, syntax highlighting, and one-click execution.

> **Preview Release** - This extension is in active development.

## Features

- **One-Click Run** - Play button in editor title bar, auto-saves before execution
- **IntelliSense** - Smart autocomplete for models, MCP servers, subagents, and config fields
- **Syntax Highlighting** - Full support for YAML frontmatter + Markdown content
- **Hover Docs** - Inline documentation for all configuration options
- **Code Snippets** - Pre-configured templates for common patterns
- **Subagent Discovery** - Auto-finds `.agentuse` files in your workspace

## Quick Start

```yaml
---
model: anthropic:claude-sonnet-4-5
timeout: 30000
maxSteps: 10
---

# Your Task

Describe what the agent should do...
```

## Requirements

- VS Code 1.85.0+
- [AgentUse CLI](https://agentuse.io) installed (`npm i -g agentuse`)

## Links

[Documentation](https://agentuse.io/docs) · [Issues](https://github.com/agentuse/vscode-agentuse/issues)

## License

MIT
