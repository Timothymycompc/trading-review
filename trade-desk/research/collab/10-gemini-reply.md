### 1. What a First-Time Visitor Sees & What's Crowding It
- **Home ([OverviewPage.tsx](file:///root/pulse-site/src/pages/OverviewPage.tsx)):** Above the fold is a **static** `PreflightReport` picture (`12 October 2026`) you can't edit or run, and a `Connect an agent` button that dumps visitors onto a 13-editor wall of config files ([GuidePages.tsx](file:///root/pulse-site/src/pages/GuidePages.tsx#L53-L178)). Below the fold, 5 sections compete: the 4-step pipeline, an 18-tool price grid, a trivial `convert` snippet, an x402 pitch, and [ServiceUsagePanel.tsx](file:///root/pulse-site/src/components/ServiceUsagePanel.tsx#L86) announcing *"Paid runs by others: 0"* on the landing page.
- **Toolbox ([ToolboxPage.tsx](file:///root/pulse-site/src/pages/ToolboxPage.tsx)):**
  - **9 controls before running a call:** Tool dropdown, `HTTP | MCP`, `25/25 free, then $0.02`, `Form | JSON`, `Explain inputs`, `Live example`, `Clear`, `Run`, and `cURL`.
  - **Blank start:** Default tool is `tools[0]` (`explain_tx`, not `check_tx`), and the Response pane starts as an empty dashed box (`Run the request to see the live response`).
  - **6 stacked output boxes in [ToolResult.tsx](file:///root/pulse-site/src/components/playground/ToolResult.tsx#L56-L125):** HTTP status bar, `MoneyFlow`, `VerdictReport`, `Report this transaction`, `CallFlow` RPC waterfall ([CallFlow.tsx](file:///root/pulse-site/src/components/playground/CallFlow.tsx)), raw `JsonView`, and the `What every returned field is` table—plus `Your calls` history below.

### 2. Simpler Site Structure
- **Top bar:** **Toolbox** · **Proof** (`/track-record`) · **Connect** · **Pricing** · **GitHub**.
- **Drop `/docs/calls`** ([GuidePages.tsx](file:///root/pulse-site/src/pages/GuidePages.tsx#L180-L214)): The restaurant analogy makes an agent-security tool look like a beginner tutorial.
- **Merge `/docs/quickstart` into `/docs/connect`:** Replace the 13 stacked MCP sections in [`ConnectPage`](file:///root/pulse-site/src/pages/GuidePages.tsx#L53-L178) with **one client selector dropdown** (`Claude`, `Cursor`, `VS Code`, `Codex`, `ElizaOS`, `AgentKit`, `cURL / HTTP`).
- **Merge `/docs/flows`** ([FlowsPage.tsx](file:///root/pulse-site/src/pages/FlowsPage.tsx)) into the Toolbox's "More details" drawer, and keep `ServiceUsagePanel` on `/status` only.
- **Home above the fold:** Headline + one checkable proof bar (**9/9 mainnet drainers blocked · 0/200 swap false alarms · 7 upstream v1 fixes merged**), with the **live simplified Toolbox embedded right above the fold**, preloaded on `check_tx`.

### 3. Simpler Toolbox Design (One Shared Screen)
Use **one shared Toolbox component** (on Home and `/toolbox`, retiring duplicate [`TryItPanel`](file:///root/pulse-site/src/components/playground/TryItPanel.tsx)):
1. **Pick a tool:** 4 visible tabs for core checks (**`check_tx`** · **`tx_matches`** · **`token_safety`** · **`tx_version` `-32015`**) + a **`More tools (14) ▾`** searchable menu.
2. **Input (own data OR ready example):**
   - Start with a **preloaded example already answered** so visitors see a real input and verdict immediately.
   - Above the input: 1-tap preset chips (e.g. `Example: Drainer (BLOCK)`, `Example: Swap (OK)`, `Fresh mainnet example`) + a **`Clear / Paste your own`** button.
   - Show only **required fields** by default; tuck optionals under `+ Optional inputs`.
3. **Run & Read Answer:**
   - One **`Run check_tx`** button (`25 free/day · real mainnet data`).
   - **Answer pane shows only:** `VerdictReport` (`Stamp` + summary + checks with named sources) + `MoneyFlow` (when relevant) + key facts (explicitly printing `"unknown"` when missing).
4. **Hide behind `"More details & code ▾"`:**
   - Raw `JsonView`, `Copy cURL / MCP` (`HTTP | MCP` toggle), `Edit as JSON`, `CallFlow` RPC waterfall (`How this answer was made`), `What every returned field is` table, and `Your calls` (hidden when empty).

### 4. What Reviewers Trip Over Right Now
1. **Hero curl snippet is `convert` (5 USDC $\times 10^6$)** on Home ([OverviewPage.tsx](file:///root/pulse-site/src/pages/OverviewPage.tsx#L155-L156)) and Quickstart ([GuidePages.tsx](file:///root/pulse-site/src/pages/GuidePages.tsx#L19-L22))—swap to `check_tx`.
2. **`SAFETY_CHECKS` ([nav.ts](file:///root/pulse-site/src/nav.ts#L60-L64)) puts `token_safety` first** instead of `check_tx` -> `tx_matches`.
3. **`/track-record` ([TrackRecordPage.tsx](file:///root/pulse-site/src/pages/TrackRecordPage.tsx)) omits the 9/9 drainer & 0/200 false-alarm benchmark** on `check_tx`/`tx_matches`, showing only `token_safety`.
4. **Hardcoded `*.run.app` URL in [nav.ts](file:///root/pulse-site/src/nav.ts#L10).**
