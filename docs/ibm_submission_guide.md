# OzyBase — IBM SkillsBuild Challenge Submission Guide

This document contains the step-by-step instructions, video script, and platform presentation checklist for submitting **OzyBase** to the **IBM SkillsBuild July 2026 Challenge**.

---

## 🎥 1. 3-Minute Demo Video Script (in English)

> [!IMPORTANT]
> Keep your presentation energy high and natural. Try to show the terminal/browser interface matching the spoken parts.

### **Section 1: The Hook & The Problem (0:00 – 0:45)**
* **Visuals:** Show the developer (you) introducing yourself, then cut to a screen recording showing the OzyBase logo and code running in a terminal.
* **Audio / Script:**
  > "Hello everyone! I'm Ángel, and today I'm excited to present **OzyBase** — the ultra-lightweight, **Agentic Backend-as-a-Service** designed for the future of autonomous cloud infrastructure. 
  > 
  > Modern BaaS platforms like Supabase or Firebase are great, but they have two critical limitations: First, they are resource-heavy, requiring over 1.2 gigabytes of RAM just to idle. This makes them expensive and difficult to run on edge servers. 
  > 
  > Second, they lack native AI integrations. For an AI developer agent to perform database migrations, change security policies, or handle backups, it requires continuous human intervention and manual commands.
  > 
  > This is why we created OzyBase."

---

### **Section 2: The Solution & Technical Architecture (0:45 – 1:30)**
* **Visuals:** Show OzyBase starting up, displaying the ~11MB memory footprint. Switch to the architecture diagram from the README.
* **Audio / Script:**
  > "OzyBase is built from the ground up in Go and React. It packs database access, authentication, storage, and edge functions into a single binary. 
  > 
  > Most importantly, OzyBase is built to run on only **56 megabytes of RAM** — saving 96% of typical cloud hosting costs.
  > 
  > But what makes OzyBase truly revolutionary is its native **Model Context Protocol (MCP) Control Layer**. It exposes a secure HTTP JSON-RPC endpoint that allows autonomous AI agents, like our development partner **IBM Bob**, to inspect and manage the backend infrastructure directly."

---

### **Section 3: Demo – Autonomous AI Operations (1:30 – 2:20)**
* **Visuals:** Screen recording showing a terminal or AI assistant (like IBM Bob) executing commands. Show the OzyBase dashboard showing the table update or backup file created instantly.
* **Audio / Script:**
  > "Let's see it in action. Since OzyBase natively implements the Model Context Protocol, we can connect our AI partner, IBM Bob.
  > 
  > Watch as we ask Bob to configure security rules. Bob automatically calls the `rls.configure` tool to set up Row Level Security. 
  > 
  > Next, we tell Bob we need a database backup. Bob runs the `backup.create` tool, which generates a secure SQL snapshot of our database instantly. 
  > 
  > Finally, if we need database migrations, Bob writes the DDL, generates a versioned migration file, and applies it using the `migration.create` tool. The agent automatically handles database constraints and API key rotations without any human intervention."

---

### **Section 4: How IBM Bob Was Used & Future Outlook (2:20 – 3:00)**
* **Visuals:** Show lines of code in `internal/api/essential_keys.go` or Git commits where IBM Bob helped.
* **Audio / Script:**
  > "Throughout development, **IBM Bob** was our pair programmer. It helped co-design our self-healing API key sync logic, resolved critical PostgreSQL constraint conflicts, and built the self-documentation engine (`system.guide`) so other agents can easily understand our architecture.
  > 
  > OzyBase is fully open-source and ready for production. It bridges the gap between cloud infrastructure and agentic AI. 
  > 
  > Thank you for watching, and thank you to IBM SkillsBuild for this challenge!"

---

## 🛠️ 2. Steps to Execute & Demonstrate OzyBase via IBM Bob

To show the judges how the project runs and how IBM Bob manages OzyBase via the Model Context Protocol (MCP):

### **Step 1: Start OzyBase Locally**
Start the backend and frontend services:
```powershell
# In the root directory, run the batch script:
.\start.bat
```
* The **Backend Go Engine** runs on [http://localhost:8090](http://localhost:8090).
* The **Frontend React Dashboard** runs on [http://localhost:5342](http://localhost:5342).

### **Step 2: Connecting the AI Agent (e.g. IBM Bob / Claude / Cursor)**
To let your AI agent use OzyBase MCP tools, configure the MCP connection.
OzyBase provides a standard JSON-RPC 2.0 interface at `http://localhost:8090/api/project/mcp`.

1. **Start the Device Connection Flow**:
   Call the initiation endpoint from the client agent:
   `POST http://localhost:8090/api/project/mcp/device/start`
2. **Authorize the Connection**:
   The response returns a `user_code` and a `verification_uri`.
   Open the link in your browser:
   `http://localhost:8090/api/project/mcp/device/approve?user_code=XXXX-XXXX`
   Click **"Approve Connection"** to generate a secure `service_role` credentials token.
3. **Use MCP Tools**:
   The AI agent can now issue JSON-RPC requests using the `Authorization: Bearer <mcp_token>` header to manage collections, RLS, storage, backups, and API keys.

---

## 📋 3. Final Submission Checklist

Ensure you complete and verify every item before the deadline (**July 31, 2026, 23:59 EST**):

1. **GitHub Repository (Public)**:
   * Double-check that [https://github.com/Xangel0s/OzyBase](https://github.com/Xangel0s/OzyBase) is set to **Public** so judges can access it.
   * Make sure your `README.md` contains the required sections: Problem Statement, Solution, AI Architecture, and How IBM Bob was used.
2. **SkillsBuild Training**:
   * Complete at least one course/webinar related to IBM Bob on **IBM SkillsBuild**.
   * Download the Completion Certificate and upload it to the submission page.
3. **3-Minute Presentation Video**:
   * Record the video based on the script above (keep it under 3 minutes).
   * Upload the video to YouTube, Vimeo, or Google Drive (ensure the link is set to **Public**).
4. **Publish Submission**:
   * Complete all fields on your project page on the challenge platform.
   * Add the link to the GitHub repository and the presentation video.
   * Click **"Publish"** before the deadline.
