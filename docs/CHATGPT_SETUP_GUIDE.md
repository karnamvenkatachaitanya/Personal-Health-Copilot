# 🤖 How to Connect ChatGPT to Personal Health Copilot

You can connect **ChatGPT** (Web, iOS, Android, macOS, or Windows) to your **Personal Health Copilot** so it can query your family's medical records, active prescriptions, lab reports, and drug safety in real time.

There are two supported connection methods:
1. **Method 1: Direct Remote MCP Connector (Recommended)** — Uses official Streamable HTTP Model Context Protocol.
2. **Method 2: Custom GPT OpenAPI Action** — Uses standard OpenAPI JSON schema (`chatgpt_actions_schema.json`).

---

## ⚡ Method 1: Remote MCP Server (Recommended)

This is the fastest method and supports all 8 real-time clinical tools.

### Step 1: Open ChatGPT GPT Editor
1. Log in to [chatgpt.com](https://chatgpt.com).
2. On the left sidebar, click **Explore GPTs** &rarr; **+ Create** (top right), or open:  
   👉 **[chatgpt.com/gpts/editor](https://chatgpt.com/gpts/editor)**.
3. Switch to the **Configure** tab.

### Step 2: Basic Configuration
- **Name:** `Personal Health Copilot`
- **Description:** `Queries verified family health records, prescriptions, lab values, and drug safety.`
- **Instructions:**
  ```text
  You are the AI Personal Health Copilot assistant. 
  Whenever the user asks about health, medications, lab tests, or doctor visits:
  1. Call 'list_patient_profiles' to see which family members exist in the account.
  2. For medicine questions, call 'get_prescribed_medications'. Always explain exact dosages, schedules, and food timing.
  3. For test results, call 'get_lab_reports' and highlight abnormal HIGH or LOW flags.
  4. For drug questions, call 'check_drug_safety' to check interactions and food warnings.
  5. For general demo requests, call 'get_synthetic_wellness_demo'.
  6. If symptoms suggest a severe crisis (chest pain, cannot breathe), prioritize emergency instructions (112 / 108).
  Always provide clear, reassuring explanations and remind the patient to confirm with their doctor.
  ```

### Step 3: Add Remote MCP Server
1. Under **Connected Apps / Actions**, select **Add MCP Server**.
2. **Server URL:**
   ```text
   https://mycopilot.qd.je/mcp
   ```
3. **Authentication:**
   - **For Isolated Demo Mode:**
     - When ChatGPT prompts *"Couldn't discover OAuth settings"*, scroll down to the **Authentication** section.
     - Select **`No authentication`** (collapses all OAuth fields).
     - Check: **`☑ I understand and want to continue`**.
     - Click **Create connector / Save**.
   - **For Authenticated Family Records:**
     - Select **Bearer Token**.
     - Paste your Personal Access Key (`phc_mcp_...`) generated from the website dashboard.

---

## 📋 Method 2: Custom GPT OpenAPI Action

If your ChatGPT plan does not yet support the MCP Connector UI, use the OpenAPI Action method:

### Step 1: Create an Action
1. In the GPT Editor **Configure** tab, scroll down to **Actions** and click **Create new action**.
2. Under **Authentication**, select **None** (for Demo mode) or **API Key / Bearer** (with your PAT).

### Step 2: Import the Schema
In the **Schema** box, import or paste the OpenAPI JSON schema located at:
`backend/chatgpt_actions_schema.json`

The schema defines endpoints for:
- `GET /api/v1/chatgpt/patients`
- `GET /api/v1/chatgpt/summary/{patient_id}`
- `GET /api/v1/chatgpt/medications/{patient_id}`
- `GET /api/v1/chatgpt/labs/{patient_id}`
- `POST /api/v1/chatgpt/check-drug-safety`

### Step 3: Set Privacy Policy
- **Privacy Policy URL:**  
  `https://mycopilot.qd.je/privacy`

---

## 🧪 Testing Prompts Inside ChatGPT

Once connected, ask ChatGPT:

1. **Synthetic Demo Trends:**
   > *"Show sample heart rate measurements and wellness trends for Aarav Patel."*
2. **Drug Interaction Check:**
   > *"Is it safe to take Warfarin and Aspirin at the same time?"*
3. **Family Records:**
   > *"What active medications are prescribed for my family?"*
