#!/bin/bash
set -e

# ─────────────────────────────────────────────────────────────────
# documind MCP Server — One-Click Installer
#
# Run this on the VC's Mac:
#   curl -sSL <your-hosted-url>/install-documind.sh | bash
#   — or —
#   bash install-documind.sh
# ─────────────────────────────────────────────────────────────────

REPO="https://github.com/AbdelRahm4n/gtez-intelligence.git"
INSTALL_DIR="$HOME/documind"
CLAUDE_CONFIG="$HOME/Library/Application Support/Claude/claude_desktop_config.json"

echo ""
echo "╔══════════════════════════════════════╗"
echo "║   documind MCP Server — Installer    ║"
echo "╚══════════════════════════════════════╝"
echo ""

# ── Check prerequisites ──

if ! command -v git &>/dev/null; then
  echo "❌ git is not installed. Install Xcode Command Line Tools:"
  echo "   xcode-select --install"
  exit 1
fi

# ── Install Node.js via nvm if needed ──

export NVM_DIR="$HOME/.nvm"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  source "$NVM_DIR/nvm.sh"
fi

if ! command -v node &>/dev/null || [[ "$(node -v)" < "v20" ]]; then
  echo "📦 Installing Node.js 20 via nvm..."
  if ! command -v nvm &>/dev/null; then
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
    export NVM_DIR="$HOME/.nvm"
    source "$NVM_DIR/nvm.sh"
  fi
  nvm install 20
  nvm use 20
fi

NODE_PATH="$(dirname "$(which node)")"
echo "✅ Node.js $(node -v) at $NODE_PATH"

# ── Install pnpm if needed ──

if ! command -v pnpm &>/dev/null; then
  echo "📦 Installing pnpm..."
  npm install -g pnpm
fi

# ── Clone or update the repo ──

if [ -d "$INSTALL_DIR" ]; then
  echo "📂 Updating existing installation..."
  cd "$INSTALL_DIR"
  git pull --ff-only
else
  echo "📂 Cloning documind..."
  git clone "$REPO" "$INSTALL_DIR"
  cd "$INSTALL_DIR"
fi

# ── Install dependencies ──

echo "📦 Installing dependencies..."
pnpm install --frozen-lockfile 2>/dev/null || pnpm install

# ── Prompt for env vars if .env.local doesn't exist ──

if [ ! -f ".env.local" ]; then
  echo ""
  echo "🔑 First-time setup — enter your API keys."
  echo "   (Ask your developer for these values)"
  echo ""

  read -p "NEXT_PUBLIC_SUPABASE_URL: " SUPA_URL
  read -p "NEXT_PUBLIC_SUPABASE_ANON_KEY: " SUPA_ANON
  read -p "SUPABASE_SERVICE_ROLE_KEY: " SUPA_SERVICE
  read -p "COHERE_API_KEY: " COHERE
  read -p "OPENAI_API_KEY: " OPENAI
  read -p "AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT: " AZURE_EP
  read -p "AZURE_DOCUMENT_INTELLIGENCE_KEY: " AZURE_KEY
  read -p "ENCRYPTION_KEY: " ENC_KEY

  cat > .env.local <<EOF
NEXT_PUBLIC_SUPABASE_URL=$SUPA_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=$SUPA_ANON
SUPABASE_SERVICE_ROLE_KEY=$SUPA_SERVICE
COHERE_API_KEY=$COHERE
OPENAI_API_KEY=$OPENAI
AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT=$AZURE_EP
AZURE_DOCUMENT_INTELLIGENCE_KEY=$AZURE_KEY
ENCRYPTION_KEY=$ENC_KEY
EOF

  echo "✅ Saved to $INSTALL_DIR/.env.local"
fi

# ── Create the run script with absolute paths ──

cat > "$INSTALL_DIR/run-mcp.sh" <<RUNEOF
#!/bin/bash
cd "$INSTALL_DIR"
export PATH="$NODE_PATH:\$PATH"
exec node_modules/.bin/tsx src/mcp-server.ts
RUNEOF
chmod +x "$INSTALL_DIR/run-mcp.sh"

# ── Smoke test ──

echo ""
echo "🧪 Testing MCP server..."
RESULT=$(printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}}}\n' | timeout 15 "$INSTALL_DIR/run-mcp.sh" 2>/dev/null | head -1)

if echo "$RESULT" | grep -q '"serverInfo"'; then
  echo "✅ MCP server starts correctly"
else
  echo "❌ MCP server failed to start. Check .env.local keys."
  echo "   Debug: cd $INSTALL_DIR && ./run-mcp.sh"
  exit 1
fi

# ── Configure Claude Desktop ──

echo ""
echo "🔧 Configuring Claude Desktop..."

CLAUDE_DIR="$(dirname "$CLAUDE_CONFIG")"
mkdir -p "$CLAUDE_DIR"

if [ -f "$CLAUDE_CONFIG" ]; then
  # Check if documind is already configured
  if grep -q '"documind"' "$CLAUDE_CONFIG" 2>/dev/null; then
    echo "✅ Claude Desktop already configured for documind"
  else
    # Add documind to existing config using python (available on all Macs)
    python3 -c "
import json, sys
with open('$CLAUDE_CONFIG', 'r') as f:
    config = json.load(f)
if 'mcpServers' not in config:
    config['mcpServers'] = {}
config['mcpServers']['documind'] = {
    'command': '$INSTALL_DIR/run-mcp.sh',
    'args': []
}
with open('$CLAUDE_CONFIG', 'w') as f:
    json.dump(config, f, indent=2)
print('✅ Added documind to Claude Desktop config')
"
  fi
else
  # Create new config
  cat > "$CLAUDE_CONFIG" <<CONFEOF
{
  "mcpServers": {
    "documind": {
      "command": "$INSTALL_DIR/run-mcp.sh",
      "args": []
    }
  }
}
CONFEOF
  echo "✅ Created Claude Desktop config"
fi

# ── Done ──

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║   ✅ documind installed successfully!            ║"
echo "║                                                  ║"
echo "║   Next steps:                                    ║"
echo "║   1. Quit Claude Desktop (Cmd+Q)                 ║"
echo "║   2. Reopen Claude Desktop                       ║"
echo "║   3. Look for the 🔨 icon — 8 tools available   ║"
echo "║   4. Try: \"Search my documents for Xingfa\"       ║"
echo "║                                                  ║"
echo "║   To update later: cd ~/documind && git pull     ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""
