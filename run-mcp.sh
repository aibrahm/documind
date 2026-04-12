#!/bin/bash
cd /Users/aibrahim/documind
export PATH="/Users/aibrahim/.nvm/versions/node/v20.19.4/bin:$PATH"
exec node_modules/.bin/tsx src/mcp-server.ts
