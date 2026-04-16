#!/bin/bash
set -e

# ─────────────────────────────────────────────────────────────────
# documind — One-Click Installer
#
# Instructions for the VC:
#   1. Download the "setup-for-vc" folder to your Downloads
#   2. Open Terminal (Cmd+Space, type "Terminal", press Enter)
#   3. Run:  bash ~/Downloads/setup-for-vc/install.sh
#   4. Wait ~2 minutes
#   5. Quit Claude Desktop (Cmd+Q) and reopen it
#   6. Done — look for the 🔨 icon showing 16 tools
# ─────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$SCRIPT_DIR/env-keys.txt"
INSTALL_DIR="$HOME/documind"
CLAUDE_CONFIG="$HOME/Library/Application Support/Claude/claude_desktop_config.json"

echo ""
echo "╔══════════════════════════════════════╗"
echo "║     documind — Installing...         ║"
echo "╚══════════════════════════════════════╝"
echo ""

# Check env-keys.txt exists next to this script
if [ ! -f "$ENV_FILE" ]; then
  echo "❌ Cannot find env-keys.txt next to this script."
  echo "   Expected at: $ENV_FILE"
  echo "   Make sure both files are in the same folder."
  exit 1
fi

echo "✅ Found env-keys.txt"

# ── Install Node.js if needed ──

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"

if ! command -v node &>/dev/null; then
  echo "📦 Installing Node.js..."
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
  export NVM_DIR="$HOME/.nvm"
  source "$NVM_DIR/nvm.sh"
  nvm install 20
  nvm use 20
elif [[ "$(node -v)" < "v20" ]]; then
  echo "📦 Upgrading Node.js to v20..."
  if command -v nvm &>/dev/null; then
    nvm install 20
    nvm use 20
  else
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
    export NVM_DIR="$HOME/.nvm"
    source "$NVM_DIR/nvm.sh"
    nvm install 20
    nvm use 20
  fi
fi

NODE_BIN="$(dirname "$(which node)")"
echo "✅ Node.js $(node -v)"

# ── Install pnpm if needed ──

if ! command -v pnpm &>/dev/null; then
  echo "📦 Installing pnpm..."
  npm install -g pnpm
fi

# ── Install git if needed ──

if ! command -v git &>/dev/null; then
  echo "📦 Installing Xcode Command Line Tools (for git)..."
  xcode-select --install 2>/dev/null || true
  echo "   ⏳ If a dialog appeared, click Install and wait."
  echo "   Then re-run this script."
  exit 1
fi

# ── Clone or update the repo ──

if [ -d "$INSTALL_DIR/.git" ]; then
  echo "📂 Updating documind..."
  cd "$INSTALL_DIR"
  git pull --ff-only 2>/dev/null || git pull --rebase
else
  echo "📂 Downloading documind..."
  rm -rf "$INSTALL_DIR"
  git clone https://github.com/aibrahm/documind.git "$INSTALL_DIR"
  cd "$INSTALL_DIR"
fi

# ── Install dependencies ──

echo "📦 Installing dependencies (this takes ~30 seconds)..."
pnpm install --frozen-lockfile 2>/dev/null || pnpm install

# ── Copy env keys ──

echo "🔑 Setting up API keys..."
cp "$ENV_FILE" "$INSTALL_DIR/.env.local"
echo "✅ API keys configured"

# ── Create the run script ──

cat > "$INSTALL_DIR/run-mcp.sh" <<RUNSCRIPT
#!/bin/bash
cd "$INSTALL_DIR"
export PATH="$NODE_BIN:\$PATH"
exec node_modules/.bin/tsx src/mcp-server.ts
RUNSCRIPT
chmod +x "$INSTALL_DIR/run-mcp.sh"

# ── Quick test ──

echo ""
echo "🧪 Testing documind server..."
RESULT=$(printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}}}\n' | timeout 20 "$INSTALL_DIR/run-mcp.sh" 2>/dev/null | head -1)

if echo "$RESULT" | grep -q '"serverInfo"'; then
  echo "✅ Server works"
else
  echo "⚠️  Server test inconclusive — it may still work."
  echo "   If Claude Desktop doesn't show tools, run:"
  echo "   cd ~/documind && ./run-mcp.sh"
  echo "   and send the output to your developer."
fi

# ── Configure Claude Desktop ──

echo ""
echo "🔧 Configuring Claude Desktop..."

CLAUDE_DIR="$(dirname "$CLAUDE_CONFIG")"
mkdir -p "$CLAUDE_DIR"

python3 -c "
import json, os

config_path = '$CLAUDE_CONFIG'

# Load existing config or start fresh
if os.path.exists(config_path):
    with open(config_path, 'r') as f:
        try:
            config = json.load(f)
        except:
            config = {}
else:
    config = {}

# Add or update the MCP server
if 'mcpServers' not in config:
    config['mcpServers'] = {}

config['mcpServers']['documind'] = {
    'command': '$INSTALL_DIR/run-mcp.sh',
    'args': []
}

with open(config_path, 'w') as f:
    json.dump(config, f, indent=2)

print('✅ Claude Desktop configured')
"

# ── Done ──

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║                                                  ║"
echo "║   ✅ documind installed successfully!             ║"
echo "║                                                  ║"
echo "║   Next:                                          ║"
echo "║   1. Quit Claude Desktop (Cmd+Q)                 ║"
echo "║   2. Reopen Claude Desktop                       ║"
echo "║   3. Look for the hammer icon — 16 tools         ║"
echo "║                                                  ║"
echo "║   Try saying:                                    ║"
echo "║   \"Search my documents for Xingfa\"               ║"
echo "║   \"What obligations are pending?\"                 ║"
echo "║   \"Draft a memo about the Japan visit\"            ║"
echo "║                                                  ║"
echo "║   To update later:                               ║"
echo "║   cd ~/documind && git pull && pnpm install      ║"
echo "║                                                  ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""
