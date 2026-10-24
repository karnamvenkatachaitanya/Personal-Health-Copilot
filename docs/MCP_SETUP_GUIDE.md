# 🩺 Personal Health Copilot - Enterprise MCP Data Governance & Setup Guide

Connect your **Personal Health Copilot** directly to **ChatGPT**, **Cursor IDE**, and **Claude Desktop** via the official **Model Context Protocol (MCP)** using the modern **Streamable HTTP transport** with **zero-trust data isolation** and **in-app data governance**.

When connected, external AI models can query your family's medical records, active prescriptions, lab observations, drug interactions, and hospital specialists in real time.

---

## 🌐 Official Remote MCP Endpoint

- **Production Streamable HTTP Endpoint:**  
  `https://mycopilot.qd.je/mcp`
- **Direct API Endpoint:**  
  `https://api.mycopilot.qd.je/mcp`
- **Supported Transport:** Streamable HTTP (spec version `2024-11-05`)
- **Supported Clients:** ChatGPT, Cursor, Claude Desktop, Windsurf, custom MCP agents

---

## 🛡️ Enterprise Security & Multi-Tenant Isolation

In multi-tenant healthcare systems, an external AI model cannot read medical records without verified identity isolation:

1. **User Identity Detection via Personal MCP Keys (PAT):**
   - In the website's top navigation bar, click the **"ChatGPT & AI app access"** button (`ShieldCheck` icon).
   - Click **"Generate Personal MCP Key"**.
   - The application generates a cryptographically secure token (`phc_mcp_...`) bound uniquely to your verified user account (`owner_id`).
   - Claude Desktop and Cursor send this key via `Authorization: Bearer <key>`.
2. **Tenant Scoping & Patient Privacy:**
   - Every database query (`patients`, `health_records`, `medications`, `lab_observations`) filters strictly by `owner_id == authenticated_owner`.
   - Even if multiple users share the same database or server, User A **never** sees User B's family members or health documents.
3. **In-App Data Governance & Kill-Switch:**
   - **Emergency Kill-Switch:** Toggle off MCP access with one click from your web portal to immediately block all external AI access.
   - **Tool-Level Toggles:** Turn off specific clinical tools (e.g. allow reading lab reports, but disable AI clinical reasoning).
   - **Family Member Privacy Filter:** Selectively hide specific family members from being exposed to external LLMs.
   - **Live Audit Trail:** View every tool call made by ChatGPT, Claude, or Cursor with timestamps, queried patient names, and execution status.
4. **Isolated Sandbox Demo Mode (`DEMO_MODE=true`):**
   - For temporary demonstrations without authentication, an isolated environment (`demo_isolated_environment`) provides synthetic demonstration data without exposing real patient records.

---

## 🤖 1. Connecting to ChatGPT

### Step-by-Step Instructions:
1. Open [ChatGPT](https://chatgpt.com) and navigate to **Explore GPTs** &rarr; **Create a GPT** (or your Custom GPT / Developer Tools).
2. Go to **Configure** &rarr; **Actions / Connected Apps** &rarr; **Add MCP Server**.
3. **Server URL:**
   ```text
   https://mycopilot.qd.je/mcp
   ```
4. **Authentication:**
   - **For Isolated Demo Mode:**
     - When ChatGPT prompts *"Couldn't discover OAuth settings"*, scroll down to the **Authentication** section.
     - Switch from **OAuth** to **`No authentication`**.
     - Check the box: **`☑ I understand and want to continue`**.
     - Click **Create connector / Save**.
   - **For Authenticated Mode (Your Own Family Records):**
     - Select **Bearer Token**.
     - Paste your Personal Access Token (`phc_mcp_...`) generated from the website modal.
5. **Sample Prompt to Test in ChatGPT:**
   > *"Use the `get_synthetic_wellness_demo` tool to display sample heart rate and wellness trends for Aarav Patel."*
   >
   > *"Check if taking Aspirin and Warfarin together is safe using `check_drug_safety`."*

---

## 💻 2. Connecting to Cursor IDE

Cursor supports remote HTTP MCP servers natively.

### Automatic Configuration
Create or update `.cursor/mcp.json` in your project or `C:\Users\<username>\.cursor\mcp.json`:

```json
{
  "mcpServers": {
    "personal-health-copilot": {
      "url": "https://mycopilot.qd.je/mcp",
      "headers": {
        "Authorization": "Bearer phc_mcp_<your-token>"
      }
    }
  }
}
```

### Enable in Cursor:
1. Open **Cursor Settings** (`Ctrl + ,`) &rarr; **Features** &rarr; **MCP** (or search `mcp`).
2. You will see **`personal-health-copilot`** with a **green circle (🟢)**.
3. In **Agents &rarr; MCP Allowlist**, add:
   ```text
   personal-health-copilot:*
   ```
4. In **Agents &rarr; Fetch Domain Allowlist**, add:
   ```text
   mycopilot.qd.je
   ```
5. Open Cursor Chat (`Ctrl + L`), switch to **Agent mode**, and ask:
   > *"List the family members registered in my personal health copilot."*

---

## 🖥️ 3. Connecting to Claude Desktop

### Configuration File
Open `%APPDATA%\Claude\claude_desktop_config.json` (Windows) or `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS):

```json
{
  "mcpServers": {
    "personal-health-copilot": {
      "url": "https://mycopilot.qd.je/mcp",
      "headers": {
        "Authorization": "Bearer phc_mcp_<your-token>"
      }
    }
  }
}
```

Restart Claude Desktop. You will see the hammer 🔨 icon indicating that all 8 clinical tools are available.

---

## 🛠️ Registered Clinical Tools

| Tool Name | Scope | Description |
|---|---|---|
| `list_patient_profiles` | Profiles | Lists all registered family members (Self, Spouse, Parent, Child). |
| `get_patient_summary` | Summary | Retrieves an executive clinical summary for a specific family member. |
| `get_prescribed_medications` | Medications | Retrieves active medications, dosages, frequency, and food timings. |
| `get_lab_reports` | Diagnostics | Retrieves blood test results, observations, and HIGH/LOW abnormal flags. |
| `check_drug_safety` | Safety | Screens medications for dangerous drug-drug interactions and food contraindications. |
| `ask_health_copilot` | AI Reasoning | Answers medical questions strictly grounded in verified family health records. |
| `find_specialist_doctors` | Navigation | Finds verified local specialists and hospitals based on clinical diagnosis and city. |
| `get_synthetic_wellness_demo` | Demo | Returns synthetic heart-rate readings, vital stats, and 7-day wellness trends. |

---

## 🧪 Verifying Reachability via Terminal

Test the Streamable HTTP transport initialization directly from your terminal:

```bash
curl -i -X POST "https://mycopilot.qd.je/mcp" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer <your-mcp-token>" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
      "protocolVersion": "2024-11-05",
      "capabilities": {},
      "clientInfo": {"name": "terminal-test", "version": "1.0"}
    }
  }'
```

Expected response: `HTTP/1.1 200 OK` with header `mcp-session-id` and event message acknowledging server capabilities.
