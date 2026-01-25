#!/bin/bash
# deploy/scripts/install.sh
# OzyBase Automated Linux Deployment Script

set -e

# Configuration
INSTALL_DIR="/opt/OzyBase"
BIN_NAME="OzyBase"
SYSTEMD_PATH="/etc/systemd/system/OzyBase.service"
SYSCTL_PATH="/etc/sysctl.d/99-OzyBase.conf"
NGINX_AVAILABLE="/etc/nginx/sites-available/OzyBase"
NGINX_ENABLED="/etc/nginx/sites-enabled/OzyBase"

echo "🚀 Starting OzyBase Installation..."

# 1. Create Dedicated User
if ! id "OzyBase" &>/dev/null; then
    echo "👤 Creating OzyBase system user..."
    sudo useradd --system --no-create-home --shell /usr/sbin/nologin OzyBase
fi

# 2. Setup Directories
echo "📁 Setting up installation directories..."
sudo mkdir -p $INSTALL_DIR/data
sudo chown -R OzyBase:OzyBase $INSTALL_DIR

# 3. Copy Application Files
echo "📦 Deploying application files..."
if [ -f "./$BIN_NAME" ]; then
    sudo cp ./$BIN_NAME $INSTALL_DIR/
    sudo chmod +x $INSTALL_DIR/$BIN_NAME
else
    echo "⚠️ Warning: $BIN_NAME binary not found in current directory. Please copy it manually to $INSTALL_DIR later."
fi

if [ ! -f "$INSTALL_DIR/.env" ]; then
    if [ -f ".env.example" ]; then
        sudo cp .env.example $INSTALL_DIR/.env
        echo "✅ Created .env from .env.example"
        echo "⚠️ REMINDER: Update $INSTALL_DIR/.env with production credentials!"
    else
        echo "⚠️ Warning: .env.example not found."
    fi
fi

# 4. Install Systemd Service
echo "⚙️ Configuring systemd service..."
if [ -f "./deploy/systemd/OzyBase.service" ]; then
    sudo cp ./deploy/systemd/OzyBase.service $SYSTEMD_PATH
    sudo systemctl daemon-reload
    sudo systemctl enable OzyBase
    echo "✅ OzyBase service enabled"
else
    echo "❌ Error: OzyBase.service file not found in deploy/systemd/"
fi

# 5. Kernel Tuning
echo "⚡ Optimizing kernel (sysctl)..."
if [ -f "./deploy/sysctl/99-OzyBase.conf" ]; then
    sudo cp ./deploy/sysctl/99-OzyBase.conf $SYSCTL_PATH
    sudo sysctl -p $SYSCTL_PATH
    echo "✅ Kernel optimized"
fi

# 6. Nginx Configuration
if command -v nginx &>/dev/null; then
    echo "🌐 Configuring Nginx reverse proxy..."
    if [ -f "./deploy/nginx/OzyBase.conf" ]; then
        sudo cp ./deploy/nginx/OzyBase.conf $NGINX_AVAILABLE
        sudo ln -sf $NGINX_AVAILABLE $NGINX_ENABLED
        sudo nginx -t && sudo systemctl reload nginx
        echo "✅ Nginx configured"
    fi
else
    echo "ℹ️ Nginx not installed. Skipping proxy configuration."
fi

echo "===================================================="
echo "✅ OzyBase Installation Complete!"
echo "===================================================="
echo "Next Steps:"
echo "1. Nano $INSTALL_DIR/.env   # Set DB credentials"
echo "2. sudo systemctl start OzyBase # Start the engine"
echo "3. sudo journalctl -u OzyBase -f # Watch logs"
echo "===================================================="

