# Project Timer Feature Roadmap

This document outlines the planned features and improvements for the Project Timer VS Code extension.

────────────────────────────────────
### 1. Feature Enhancements (the “engine”)
────────────────────────────────────
- [ ] **Pomodoro & Break Reminders** – Add automatic work/break cycles with configurable lengths.
- [ ] **Goal Tracking** – Let users set daily or weekly hour goals per project and display progress as a percentage.
- [ ] **Idle Detection Across OS** – Use the system’s idle-time APIs (e.g., vscode.env.uiKind plus Node idle-time libraries) to pause more accurately.
- [ ] **Manual Time Adjustments** – Provide a quick-edit form in the dashboard for correcting or adding entries.
- [ ] **Export & Import** – CSV/JSON export and import for backups or reporting.
- [ ] **Cloud Sync** – Sync data to GitHub Gist, Dropbox, or Supabase, enabling the same timer across devices.
- [ ] **Commit Association** – Tag sessions with the current Git branch/commit to correlate time with code changes.
- [ ] **Team Mode** – Aggregate multiple developers’ stats (opt-in) for lightweight team dashboards.

────────────────────────────────────
### 2. UI / UX Improvements (the “dashboard & controls”)
────────────────────────────────────
- [ ] **Rich Dashboard Webview**
  – Inline charts (bar, line, pie) using a lightweight library such as Chart.js.
  – Tabs for “Today”, “Week”, “Project Breakdown”, and “Insights”.
- [ ] **Dark & Light Themes** – Use VS Code theme variables instead of hard-coded colors.
- [ ] **In-Editor Tooltip** – Hovering the status-bar item shows a tooltip with live session time and goal progress.
- [ ] **Quick-Pick Command Palette** – `Project Timer: Switch Project…` opens a VS Code Quick Pick to change the active project without leaving the editor.
- [ ] **Notifications Summary** – At day’s end, pop up a summary notification (“You logged 5h 23m on Project X”).
- [ ] **Settings UI (Configuration View)** – Create a dedicated settings page via `vscode.workspace.getConfiguration().update` so users don’t need JSON editing.
- [ ] **Responsive Layout** – Make the dashboard scale gracefully when undocked or resized.

────────────────────────────────────
### 3. Visual Polish & Branding
────────────────────────────────────
- [ ] **Custom Activity-bar Icon Set** – Provide separate icons for active/inactive states.
- [ ] **Lottie Animations** – Small animations on the dashboard when goals are met, adding delight.
- [ ] **Consistent Typography** – Adopt VS Code’s `var(--vscode-font-family)` for text in webviews.
