import * as vscode from 'vscode';
import { TimeTracker, ProjectTime, DailyRecord } from './timeTracker';
import { AnalyticsEngine } from './analyticsEngine';

/**
 * Manages the webview panel for the Project Timer dashboard
 */
export class DashboardPanel {
    public static currentPanel: DashboardPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private readonly _timeTracker: TimeTracker;
    private _disposables: vscode.Disposable[] = [];
    private _updateInterval: NodeJS.Timeout | null = null;
    private _analyticsEngine: AnalyticsEngine;

    /**
     * Creates or shows the dashboard panel
     */
    public static createOrShow(extensionUri: vscode.Uri, timeTracker: TimeTracker): void {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        // If we already have a panel, show it
        if (DashboardPanel.currentPanel) {
            DashboardPanel.currentPanel._panel.reveal(column);
            return;
        }

        // Otherwise, create a new panel
        const panel = vscode.window.createWebviewPanel(
            'projectTimerDashboard',
            'Project Timer Dashboard',
            column || vscode.ViewColumn.One,
            {
                // Enable scripts in the webview
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(extensionUri, 'media'),
                    vscode.Uri.joinPath(extensionUri, 'node_modules', 'chart.js', 'dist')
                ]
            }
        );

        DashboardPanel.currentPanel = new DashboardPanel(panel, extensionUri, timeTracker);
    }

    /**
     * Creates a new DashboardPanel
     */
    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, timeTracker: TimeTracker) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._timeTracker = timeTracker;
        
        // Initialize analytics engine
        this._analyticsEngine = new AnalyticsEngine(
            this._timeTracker.getDailyData(),
            this._timeTracker.getProjectData()
        );

        // Set the webview's initial html content
        this._update();

        // Update content when the panel is revealed
        this._panel.onDidChangeViewState(
            (e: vscode.WebviewPanelOnDidChangeViewStateEvent) => {
                if (this._panel.visible) {
                    this._update();
                }
            },
            null,
            this._disposables
        );

        // Handle messages from the webview
        this._panel.webview.onDidReceiveMessage(
            (message: { command: string; format?: string }) => {
                switch (message.command) {
                    case 'startTracking':
                        this._timeTracker.startTracking();
                        vscode.window.showInformationMessage('Project Timer: Started tracking');
                        break;
                    case 'stopTracking':
                        this._timeTracker.stopTracking();
                        vscode.window.showInformationMessage('Project Timer: Stopped tracking');
                        break;
                    case 'resetToday':
                        // Show confirmation dialog
                        vscode.window.showWarningMessage(
                            'Are you sure you want to reset today\'s stats?',
                            { modal: true },
                            'Yes'
                        ).then((response: string | undefined) => {
                            if (response === 'Yes') {
                                this._timeTracker.resetToday();
                                vscode.window.showInformationMessage('Project Timer: Reset today\'s stats');
                            }
                        });
                        break;
                    case 'exportData':
                        if (message.format) {
                            this._exportData(message.format);
                        }
                        break;
                    case 'importData':
                        this._importData();
                        break;
                }
            },
            null,
            this._disposables
        );

        // Register for data change events
        this._timeTracker.registerDataChangeListener(() => {
            if (this._panel.visible) {
                this._update();
            }
        });

        // Set up interval to update the panel
        this._updateInterval = setInterval(() => {
            if (this._panel.visible && this._timeTracker.isCurrentlyTracking()) {
                this._update();
            }
        }, 1000);

        // Handle disposal
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    }

    /**
     * Cleans up resources when the panel is disposed
     */
    public dispose(): void {
        DashboardPanel.currentPanel = undefined;

        // Clean up our resources
        this._panel.dispose();

        if (this._updateInterval) {
            clearInterval(this._updateInterval);
            this._updateInterval = null;
        }

        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }

    /**
     * Exports time data in the requested format
     */
    private _exportData(format: string): void {
        const projectData = this._timeTracker.getProjectData();
        const dailyData = this._timeTracker.getDailyData();
        
        let content = '';
        let filename = '';
        
        if (format === 'json') {
            content = JSON.stringify({
                projects: projectData,
                daily: dailyData
            }, null, 2);
            filename = 'project-timer-export.json';
        } else if (format === 'csv') {
            // Create CSV for daily data
            content = 'Date,Project,Time (seconds),Time (formatted)\n';
            
            Object.values(dailyData).forEach(day => {
                if (day && typeof day === 'object' && 'projects' in day) {
                    const typedDay = day as DailyRecord;
                    Object.entries(typedDay.projects).forEach(([project, time]) => {
                        content += `${typedDay.date},${project},${time},${this._formatTime(time)}\n`;
                    });
                }
            });
            
            filename = 'project-timer-export.csv';
        }
        
        if (content) {
            // Try to use showSaveDialog if available, otherwise fall back to clipboard
            vscode.window.showSaveDialog({
                defaultUri: vscode.Uri.file(filename),
                filters: format === 'json' ? 
                    { 'JSON Files': ['json'], 'All Files': ['*'] } :
                    { 'CSV Files': ['csv'], 'All Files': ['*'] }
            }).then(uri => {
                if (uri) {
                    vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8')).then(() => {
                        vscode.window.showInformationMessage(`Data exported successfully to ${uri.fsPath}`);
                    }, (error) => {
                        vscode.window.showErrorMessage(`Failed to export data: ${error.message}`);
                        // Fallback to clipboard
                        vscode.env.clipboard.writeText(content).then(() => {
                            vscode.window.showInformationMessage(`Export failed, data copied to clipboard instead`);
                        });
                    });
                } else {
                    // User cancelled, offer clipboard option
                    vscode.window.showInformationMessage('Export cancelled. Copy to clipboard instead?', 'Yes', 'No').then(response => {
                        if (response === 'Yes') {
                            vscode.env.clipboard.writeText(content).then(() => {
                                vscode.window.showInformationMessage(`Data copied to clipboard`);
                            });
                        }
                    });
                }
            });
        }
    }

    /**
     * Imports time data from a selected file
     */
    private _importData(): void {
        vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            filters: {
                'Project Timer Files': ['json'],
                'All Files': ['*']
            },
            openLabel: 'Import Data'
        }).then(uris => {
            if (uris && uris.length > 0) {
                const uri = uris[0];
                vscode.workspace.fs.readFile(uri).then(content => {
                    try {
                        const data = JSON.parse(content.toString());
                        
                        // Validate the data structure
                        if (data.projects && data.daily) {
                            // Show confirmation dialog
                            vscode.window.showWarningMessage(
                                'This will replace all current timer data. Are you sure?',
                                { modal: true },
                                'Import', 'Cancel'
                            ).then(response => {
                                if (response === 'Import') {
                                    // Call import method on time tracker
                                    this._timeTracker.importData(data.projects, data.daily);
                                    vscode.window.showInformationMessage('Data imported successfully!');
                                }
                            });
                        } else {
                            vscode.window.showErrorMessage('Invalid file format. Expected Project Timer JSON export file.');
                        }
                    } catch (error) {
                        vscode.window.showErrorMessage(`Failed to parse import file: ${error instanceof Error ? error.message : 'Unknown error'}`);
                    }
                }, error => {
                    vscode.window.showErrorMessage(`Failed to read file: ${error.message}`);
                });
            }
        });
    }

    /**
     * Formats a time value in seconds to a human-readable string
     */
    private _formatTime(seconds: number): string {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);
        
        if (hours > 0) {
            return `${hours}h ${minutes}m ${secs}s`;
        } else if (minutes > 0) {
            return `${minutes}m ${secs}s`;
        } else {
            return `${secs}s`;
        }
    }

    /**
     * Updates the webview content
     */
    private _update(): void {
        if (!this._panel.visible) {
            return;
        }
        
        this._panel.webview.html = this._getHtmlForWebview(this._panel.webview);
    }

    /**
     * Generates a random nonce for CSP
     */
    private _getNonce(): string {
        let text = '';
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }

    /**
     * Generates the HTML for the webview panel
     */
    private _getHtmlForWebview(webview: vscode.Webview): string {
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'style.css'));
        const chartJsUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'node_modules', 'chart.js', 'dist', 'chart.umd.js'));
        const nonce = this._getNonce();

        const projectData = this._timeTracker.getProjectData();
        const dailyData = this._timeTracker.getDailyData();
        const currentProject = this._timeTracker.getCurrentProject();
        const isTracking = this._timeTracker.isCurrentlyTracking();
        const sessionTime = this._timeTracker.getCurrentSessionTime();

        let projectRows = Object.values(projectData).map(p => `
            <tr>
                <td>${p.projectName}</td>
                <td>${this._formatTime(p.totalTime)}</td>
                <td>${p.entries.length}</td>
                <td>${p.lastActive ? new Date(p.lastActive).toLocaleString() : 'N/A'}</td>
            </tr>`).join('');

        const sortedDailyKeys = Object.keys(dailyData).sort((a, b) => new Date(b).getTime() - new Date(a).getTime()).slice(0, 30);
        let dailyRows = sortedDailyKeys.map(date => {
            const record = dailyData[date];
            return `
                <tr>
                    <td>${record.date}</td>
                    <td>${this._formatTime(record.totalTime)}</td>
                    <td>${Object.keys(record.projects).join(', ')}</td>
                </tr>
            `;
        }).join('');

        // Prepare data for charts
        const last7Days = Object.keys(dailyData)
            .map(d => ({ ...dailyData[d] }))
            .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
            .slice(0, 7)
            .reverse();

        const weeklyChartLabels = last7Days.map(d => new Date(d.date).toLocaleDateString(undefined, { weekday: 'short' }));
        const weeklyChartData = last7Days.map(d => d.totalTime / 3600); // in hours

        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Project Timer Dashboard</title>
                <link href="${styleUri}" rel="stylesheet">
                <style>
                    body { font-family: var(--vscode-font-family); color: var(--vscode-editor-foreground); background-color: var(--vscode-editor-background); }
                    .tabs { display: flex; border-bottom: 1px solid var(--vscode-panel-border); margin-bottom: 1rem; }
                    .tab-link { padding: 0.5rem 1rem; cursor: pointer; border: none; background-color: transparent; color: var(--vscode-foreground); border-bottom: 2px solid transparent; }
                    .tab-link.active { border-bottom: 2px solid var(--vscode-tab-activeBorder); color: var(--vscode-tab-activeForeground); }
                    .tab-content { display: none; }
                    .tab-content.active { display: block; }
                    .chart-container { position: relative; height: 40vh; width: 80vw; }
                    .card { background-color: var(--vscode-sideBar-background); border: 1px solid var(--vscode-sideBar-border); border-radius: 5px; padding: 1rem; margin-bottom: 1rem; }
                    h1, h2 { color: var(--vscode-editor-foreground); }
                    table { width: 100%; border-collapse: collapse; }
                    th, td { padding: 8px; text-align: left; border-bottom: 1px solid var(--vscode-panel-border); }
                    button { background-color: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 8px 12px; border-radius: 4px; cursor: pointer; }
                    button:hover { background-color: var(--vscode-button-hoverBackground); }
                    .actions { display: flex; gap: 10px; margin-top: 1rem; }
                </style>
            </head>
            <body>
                <h1>Project Timer Dashboard</h1>

                <div class="card">
                    <h2>Current Status</h2>
                    <p><strong>Current Project:</strong> ${currentProject || 'None'}</p>
                    <p><strong>Status:</strong> ${isTracking ? `Tracking (${this._formatTime(sessionTime)})` : 'Paused'}</p>
                    <div class="actions">
                        <button id="start-btn">Start</button>
                        <button id="stop-btn">Stop</button>
                        <button id="reset-btn">Reset Today</button>
                    </div>
                </div>

                <div class="tabs">
                    <button class="tab-link active" onclick="openTab(event, 'overview')">Overview</button>
                    <button class="tab-link" onclick="openTab(event, 'projects')">Projects</button>
                    <button class="tab-link" onclick="openTab(event, 'daily')">Daily Breakdown</button>
                </div>

                <div id="overview" class="tab-content active">
                    <div class="card">
                        <h2>Last 7 Days Activity</h2>
                        <div class="chart-container">
                            <canvas id="weekly-chart"></canvas>
                        </div>
                    </div>
                </div>

                <div id="projects" class="tab-content">
                    <div class="card">
                        <h2>All Projects</h2>
                        <table>
                            <thead><tr><th>Name</th><th>Total Time</th><th>Entries</th><th>Last Active</th></tr></thead>
                            <tbody>${projectRows}</tbody>
                        </table>
                    </div>
                </div>

                <div id="daily" class="tab-content">
                    <div class="card">
                        <h2>Recent Activity</h2>
                        <table>
                            <thead><tr><th>Date</th><th>Total Time</th><th>Projects</th></tr></thead>
                            <tbody>${dailyRows}</tbody>
                        </table>
                    </div>
                </div>

                <div class="card">
                    <h2>Export Data</h2>
                    <div class="actions">
                        <button id="export-json-btn">Export as JSON</button>
                        <button id="export-csv-btn">Export as CSV</button>
                        <button id="import-btn">Import Data</button>
                    </div>
                </div>

                <script nonce="${nonce}" src="${chartJsUri}"></script>
                <script nonce="${nonce}">
                    const vscode = acquireVsCodeApi();

                    function openTab(event, tabName) {
                        let i, tabcontent, tablinks;
                        tabcontent = document.getElementsByClassName("tab-content");
                        for (i = 0; i < tabcontent.length; i++) {
                            tabcontent[i].style.display = "none";
                        }
                        tablinks = document.getElementsByClassName("tab-link");
                        for (i = 0; i < tablinks.length; i++) {
                            tablinks[i].className = tablinks[i].className.replace(" active", "");
                        }
                        document.getElementById(tabName).style.display = "block";
                        event.currentTarget.className += " active";
                    }

                    document.getElementById('start-btn').addEventListener('click', () => vscode.postMessage({ command: 'startTracking' }));
                    document.getElementById('stop-btn').addEventListener('click', () => vscode.postMessage({ command: 'stopTracking' }));
                    document.getElementById('reset-btn').addEventListener('click', () => vscode.postMessage({ command: 'resetToday' }));
                    document.getElementById('export-json-btn').addEventListener('click', () => vscode.postMessage({ command: 'exportData', format: 'json' }));
                    document.getElementById('export-csv-btn').addEventListener('click', () => vscode.postMessage({ command: 'exportData', format: 'csv' }));
                    document.getElementById('import-btn').addEventListener('click', () => vscode.postMessage({ command: 'importData' }));

                    window.addEventListener('load', () => {
                        const weeklyCtx = document.getElementById('weekly-chart').getContext('2d');
                        if (weeklyCtx) {
                            new Chart(weeklyCtx, {
                                type: 'bar',
                                data: {
                                    labels: ${JSON.stringify(weeklyChartLabels)},
                                    datasets: [{
                                        label: 'Hours Tracked',
                                        data: ${JSON.stringify(weeklyChartData)},
                                        backgroundColor: 'rgba(54, 162, 235, 0.6)',
                                        borderColor: 'rgba(54, 162, 235, 1)',
                                        borderWidth: 1
                                    }]
                                },
                                options: {
                                    responsive: true,
                                    maintainAspectRatio: false,
                                    scales: {
                                        y: {
                                            beginAtZero: true
                                        }
                                    }
                                }
                            });
                        }
                    });
                </script>
            </body>
            </html>`;
    }
}