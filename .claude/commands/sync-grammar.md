Update the syntax highlighting grammar (`syntaxes/agentuse.tmLanguage.json`) to match the agentuse CLI schema.

## Steps

1. Read the schema definitions from `../agentuse/src/parser.ts` (AgentSchema, MCPServerSchema)
2. Read the tools config from `../agentuse/src/tools/types.ts` (ToolsConfigSchema, BashConfigSchema, FilesystemPathConfigSchema)
3. Update `syntaxes/agentuse.tmLanguage.json` to support ALL:
   - Top-level keys (model, mcpServers, mcp_servers, subagents, tools, openai, description, timeout, maxSteps)
   - MCP server fields (command, args, env, url, auth, headers, sessionId, requiredEnvVars, allowedEnvVars, disallowedTools, toolTimeout)
   - Tools fields (filesystem, bash, path, paths, permissions, commands, timeout, allowedPaths)
   - Subagent fields (path, name, maxSteps)
   - OpenAI fields (reasoningEffort, textVerbosity)
   - Enum values (read, write, edit, low, medium, high, bearer)
   - Variables (${root}, ${agentDir}, ${tmpDir}, ${env:VAR_NAME})
   - Model providers (anthropic, openai, openrouter, google, groq, mistral, ollama)

4. Ensure nested keys after list items (`- filesystem:`) are highlighted
5. Test that all YAML structures from the CLI are properly highlighted
