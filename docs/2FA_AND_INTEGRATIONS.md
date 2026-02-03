# 🔐 2FA & Integrations Guide

## Two-Factor Authentication (2FA)

OzyBase implements TOTP (Time-Based One-Time Password) for secure 2FA authentication, compatible with Google Authenticator, Authy, and Microsoft Authenticator.

### Setup Process
1. Navigate to **Authentication > 2FA Settings**
2. Click "Enable Two-Factor Authentication"
3. Scan the QR Code with your authenticator app
4. Enter the 6-digit verification code
5. **Important**: Download your Backup Codes immediately

These codes are encrypted in the database (`_v_user_2fa` table) and backup codes are stored securely.

### Recovery
If you lose your device, use one of the 10 generated backup codes to log in. Each code can be used only once.

---

## 🔌 Integrations & SIEM

Connect OzyBase to your existing SecOps infrastructure.

### Supported Integrations

| Type | Description | Alert Level |
|------|-------------|-------------|
| **Slack** | Sends rich formatted messages to a Slack channel | Critical/Warning |
| **Discord** | Sends embedded messages to a Discord webhook | Critical/Warning |
| **SIEM** | Raw JSON export for Splunk, ELK, Datadog | All Logs |

### Configuring Webhooks
1. Go to **Authentication > Integrations & SIEM**
2. Click **New Integration**
3. Select Provider (Slack, Discord, SIEM)
4. Enter the **Webhook URL**
   - For Slack: `https://hooks.slack.com/services/...`
   - For Discord: `https://discord.com/api/webhooks/...`
   - For Splunk HEC: `https://splunk-instance:8088/services/collector/event`
5. Click **Save**

### SIEM Log Export
When a **SIEM** integration is active:
- OzyBase starts a background worker automatically
- Logs are flushed every **30 seconds** in batches
- Format: JSON Array of audit logs
- Includes: Latency, IP, Geo Data, Method, Path, Status

### Testing
Use the **Test** button on any integration card to send a dummy alert and verify connectivity.
