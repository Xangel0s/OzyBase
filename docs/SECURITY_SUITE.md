# 🛡️ OzyBase Security Suite - Complete Guide

## Overview

OzyBase includes an **Enterprise-Grade Security System** with multi-layer protection, real-time threat monitoring, and automated security notifications. This document provides a complete guide to all implemented security features.

---

## 🔐 Security Suite Components

### 1. **RBAC (Role-Based Access Control)**
Granular access control based on roles for every database operation.

**Features:**
- ✅ Independent rules for `List`, `Create`, `Update`, `Delete`
- ✅ Predefined role profiles: `public`, `auth`, `admin`, `editor`, `manager`
- ✅ Real-time rule evaluation per API request
- ✅ Visual interface for permission management

**Location**: `Authentication > Permissions`

---

### 2. **Geo-Fencing**
Access control restricted by client geographic origin.

**Features:**
- ✅ Country whitelist configuration
- ✅ Automatic IP geolocation resolution
- ✅ Geolocation caching in DB and memory
- ✅ Instant blocking of unauthorized access attempts

**Location**: `Authentication > Geo-Fencing`

---

### 3. **Security Dashboard**
Centralized command panel for threat monitoring and security analytics.

**Metrics:**
- 📊 **Total Checks**: Total requests inspected
- 🚫 **Blocked Threats**: Blocked security threats
- 💚 **Health Score**: Overall security rating
- ⚡ **Last Breach**: Timestamp of latest alert

**Location**: `Authentication > Security Hub`

---

### 4. **Email Notifications**
Real-time notification system for critical security alerts.

**Alert Categories:**
- 🌍 **Geo Breach**: Access attempt from an unauthorized country
- 🔒 **Unauthorized Access**: Failed authentication spikes
- ⚠️ **Rate Limit Exceeded**: Throttling violations

**Location**: `Authentication > Alert Notifications`

---

### 5. **Audit Logs**
Comprehensive request logger enriched with geographic IP data.

**Recorded Data:**
- User ID (if authenticated)
- Client IP Address
- HTTP Method & Endpoint
- Status Code & Latency
- Country & City
- User Agent & Timestamp

**Location**: `Observability > Logs & Analytics`

---

## 🚀 Quick Start Guide

### Step 1: Enable Geo-Fencing
1. Navigate to **Authentication > Geo-Fencing**.
2. Toggle **Enabled**.
3. Select allowed countries (e.g. United States, Spain, Germany).
4. Click **Save Settings**.

### Step 2: Configure Alert Recipients
1. Navigate to **Authentication > Alert Notifications**.
2. Add recipient email (e.g. `security@company.com`).
3. Select target alert types.
4. Click **Add**.

### Step 3: Configure RBAC Permissions
1. Navigate to **Authentication > Permissions**.
2. Select a target table.
3. Configure `List`, `Create`, `Update`, `Delete` rules.
4. Changes apply instantly across API handlers.

---

## 🔧 Security API Endpoints

### Geo-Fencing
```http
GET    /api/project/security/policies
POST   /api/project/security/policies
```

### Security Stats
```http
GET    /api/project/security/stats
```

### Notifications
```http
GET    /api/project/security/notifications
POST   /api/project/security/notifications
DELETE /api/project/security/notifications/:id
```

### RBAC
```http
PATCH  /api/collections/rules
```

---

## 🛠️ System Database Tables

| Table | Purpose |
|-------|-----------|
| `_v_audit_logs` | Full request audit log with geolocation data |
| `_v_security_alerts` | Recorded security alerts and breaches |
| `_v_security_policies` | System security configurations (Geo-Fencing) |
| `_v_security_notification_recipients` | Recipient email registry |
| `_v_ip_geo` | IP geolocation lookup cache |
| `_v_collections` | Table metadata including RBAC policies |

---

**Version**: 1.0.0  
**Updated**: 2026-07-26  
**Maintained by**: OzyBase Security Team
