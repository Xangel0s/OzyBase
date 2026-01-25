#!/bin/bash
# deploy/scripts/install.sh
# FlowKore Automated Linux Deployment Script

set -e

# Configuration
INSTALL_DIR="/opt/flowkore"
BIN_NAME="flowkore"
SYSTEMD_PATH="/etc/systemd/system/flowkore.service"
SYSCTL_PATH="/etc/sysctl.d/99-flowkore.conf"
NGINX_AVAILABLE="/etc/nginx/sites-available/flowkore"
NGINX_ENABLED="/etc/nginx/sites-enabled/flowkore"

echo "🚀 Starting FlowKore Installation..."

# 1. Create Dedicated User
if ! id "flowkore" &>/dev/null; then
    echo "👤 Creating flowkore system user..."
    sudo useradd --system --no-create-home --shell /usr/sbin/nologin flowkore
fi

# 2. Setup Directories
echo "📁 Setting up installation directories..."
sudo mkdir -p $INSTALL_DIR/data
sudo chown -R flowkore:flowkore $INSTALL_DIR

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
if [ -f "./deploy/systemd/flowkore.service" ]; then
    sudo cp ./deploy/systemd/flowkore.service $SYSTEMD_PATH
    sudo systemctl daemon-reload
    sudo systemctl enable flowkore
    echo "✅ FlowKore service enabled"
else
    echo "❌ Error: flowkore.service file not found in deploy/systemd/"
fi

# 5. Kernel Tuning
echo "⚡ Optimizing kernel (sysctl)..."
if [ -f "./deploy/sysctl/99-flowkore.conf" ]; then
    sudo cp ./deploy/sysctl/99-flowkore.conf $SYSCTL_PATH
    sudo sysctl -p $SYSCTL_PATH
    echo "✅ Kernel optimized"
fi

# 6. Nginx Configuration
if command -v nginx &>/dev/null; then
    echo "🌐 Configuring Nginx reverse proxy..."
    if [ -f "./deploy/nginx/flowkore.conf" ]; then
        sudo cp ./deploy/nginx/flowkore.conf $NGINX_AVAILABLE
        sudo ln -sf $NGINX_AVAILABLE $NGINX_ENABLED
        sudo nginx -t && sudo systemctl reload nginx
        echo "✅ Nginx configured"
    fi
else
    echo "ℹ️ Nginx not installed. Skipping proxy configuration."
fi

echo "===================================================="
echo "✅ FlowKore Installation Complete!"
echo "===================================================="
echo "Next Steps:"
echo "1. Nano $INSTALL_DIR/.env   # Set DB credentials"
echo "2. sudo systemctl start flowkore # Start the engine"
echo "3. sudo journalctl -u flowkore -f # Watch logs"
echo "===================================================="
