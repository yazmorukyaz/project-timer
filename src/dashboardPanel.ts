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
    private _activeTab: string = 'overview';
    private _htmlGenerated: boolean = false;

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
            (message: { command: string; format?: string; tab?: string }) => {
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
                    case 'tabChanged':
                        if (message.tab) {
                            this._activeTab = message.tab;
                        }
                        break;
                    case 'updateData':
                        // Just update dynamic data without changing HTML structure
                        this._updateDynamicContent();
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

        // Set up interval to update just the dynamic content (not full HTML)
        this._updateInterval = setInterval(() => {
            if (this._panel.visible && this._timeTracker.isCurrentlyTracking()) {
                this._updateDynamicContent();
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
     * Updates the webview content (full HTML regeneration)
     */
    private _update(): void {
        if (!this._panel.visible) {
            return;
        }
        
        this._panel.webview.html = this._getHtmlForWebview(this._panel.webview);
        this._htmlGenerated = true;
    }

    /**
     * Updates only dynamic content without regenerating HTML
     */
    private _updateDynamicContent(): void {
        if (!this._panel.visible || !this._htmlGenerated) {
            return;
        }

        const currentProject = this._timeTracker.getCurrentProject();
        const isTracking = this._timeTracker.isCurrentlyTracking();
        const sessionTime = this._timeTracker.getCurrentSessionTime();
        const currentGitBranch = this._timeTracker.getCurrentGitBranch();
        const currentFileType = this._timeTracker.getCurrentFileType();

        // Send updated data to webview
        this._panel.webview.postMessage({
            command: 'updateDynamicData',
            data: {
                currentProject: currentProject || 'None',
                isTracking,
                sessionTime: this._formatTime(sessionTime),
                gitBranch: currentGitBranch,
                fileType: currentFileType,
                focusTime: this._formatTime(this._timeTracker.getCurrentFocusTime()),
                interruptions: this._timeTracker.getSessionInterruptions(),
                activeTab: this._activeTab
            }
        });
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
     * Generates a consistent color for a project based on its name
     */
    private generateProjectColor(projectName: string): string {
        const colors = [
            '#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', 
            '#9966FF', '#FF9F40', '#FF6384', '#C9CBCF',
            '#4BC0C0', '#36A2EB', '#FFCE56', '#9966FF'
        ];
        
        let hash = 0;
        for (let i = 0; i < projectName.length; i++) {
            hash = ((hash << 5) - hash) + projectName.charCodeAt(i);
            hash = hash & hash; // Convert to 32bit integer
        }
        
        return colors[Math.abs(hash) % colors.length];
    }

    /**
     * Generates hourly heatmap data for productivity visualization
     */
    private generateHourlyHeatmapData(dailyData: { [date: string]: any }): number[][] {
        // Initialize 24x7 grid (hours x days of week)
        const heatmapGrid: number[][] = Array(24).fill(null).map(() => Array(7).fill(0));
        
        Object.values(dailyData).forEach((day: any) => {
            const dayOfWeek = new Date(day.date).getDay(); // 0 = Sunday
            
            // Distribute daily time across hours based on most productive hour
            const mostProductiveHour = day.mostProductiveHour || 9;
            const totalTime = day.totalTime / 3600; // Convert to hours
            
            // Create a distribution centered around the most productive hour
            for (let hour = 0; hour < 24; hour++) {
                const distance = Math.abs(hour - mostProductiveHour);
                const weight = Math.max(0, 1 - (distance / 8)); // Weight decreases with distance
                heatmapGrid[hour][dayOfWeek] += totalTime * weight;
            }
        });
        
        return heatmapGrid;
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
        const commitHistory = this._timeTracker.getCommitHistory();
        const commitStats = this._timeTracker.getCommitStats();

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

        // Generate commit rows
        let commitRows = commitHistory.slice(0, 20).map(commit => {
            const productivityBadge = commit.productivity === 'high' ? 
                '<span style="background: #4CAF50; color: white; padding: 2px 8px; border-radius: 12px; font-size: 0.8em;">High</span>' :
                commit.productivity === 'medium' ? 
                '<span style="background: #FF9800; color: white; padding: 2px 8px; border-radius: 12px; font-size: 0.8em;">Medium</span>' :
                '<span style="background: #757575; color: white; padding: 2px 8px; border-radius: 12px; font-size: 0.8em;">Low</span>';
            
            return `
                <tr>
                    <td style="max-width: 300px; word-wrap: break-word;">
                        <strong>${commit.message}</strong><br>
                        <small style="color: var(--vscode-descriptionForeground);">${commit.commitHash.substring(0, 8)} • ${commit.author}</small>
                    </td>
                    <td>${commit.branch}</td>
                    <td>${this._formatTime(commit.timeSpent)}</td>
                    <td>${commit.filesChanged.length} files</td>
                    <td>+${commit.linesAdded} -${commit.linesDeleted}</td>
                    <td>${productivityBadge}</td>
                    <td>${new Date(commit.date).toLocaleDateString()}</td>
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

        // Project distribution pie chart data
        const projectTimeData = Object.values(projectData).map(p => ({
            label: p.projectName,
            value: p.totalTime / 3600,
            color: this.generateProjectColor(p.projectName)
        }));

        // Commit productivity pie chart data
        const productivityData = [
            { label: 'High Productivity', value: commitStats.productivityDistribution.high, color: '#4CAF50' },
            { label: 'Medium Productivity', value: commitStats.productivityDistribution.medium, color: '#FF9800' },
            { label: 'Low Productivity', value: commitStats.productivityDistribution.low, color: '#757575' }
        ];

        // File type bar chart data
        const fileTypeData = this._timeTracker.getTopFileTypes(8);
        const fileTypeLabels = fileTypeData.map(ft => ft.extension);
        const fileTypeValues = fileTypeData.map(ft => ft.totalTime / 3600);

        // Commit timeline data (last 30 commits)
        const recentCommits = commitHistory.slice(0, 30);
        const commitTimelineLabels = recentCommits.map(c => c.date.toLocaleDateString());
        const commitTimelineData = recentCommits.map(c => c.timeSpent / 3600);

        // Hourly heatmap data (24 hours x 7 days)
        const heatmapData = this.generateHourlyHeatmapData(dailyData);

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
                    <button class="tab-link${this._activeTab === 'overview' ? ' active' : ''}" onclick="openTab(event, 'overview')">Overview</button>
                    <button class="tab-link${this._activeTab === 'commits' ? ' active' : ''}" onclick="openTab(event, 'commits')">Commits</button>
                    <button class="tab-link${this._activeTab === 'projects' ? ' active' : ''}" onclick="openTab(event, 'projects')">Projects</button>
                    <button class="tab-link${this._activeTab === 'daily' ? ' active' : ''}" onclick="openTab(event, 'daily')">Daily Breakdown</button>
                </div>

                <div id="overview" class="tab-content${this._activeTab === 'overview' ? ' active' : ''}" style="display: ${this._activeTab === 'overview' ? 'block' : 'none'}">
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1rem;">
                        <div class="card">
                            <h2>Weekly Activity</h2>
                            <div class="chart-container" style="height: 300px;">
                                <canvas id="weekly-chart"></canvas>
                            </div>
                        </div>
                        <div class="card">
                            <h2>Project Distribution</h2>
                            <div class="chart-container" style="height: 300px;">
                                <canvas id="project-pie-chart"></canvas>
                            </div>
                        </div>
                    </div>
                    
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1rem;">
                        <div class="card">
                            <h2>File Types</h2>
                            <div class="chart-container" style="height: 300px;">
                                <canvas id="filetype-bar-chart"></canvas>
                            </div>
                        </div>
                        <div class="card">
                            <h2>Commit Productivity</h2>
                            <div class="chart-container" style="height: 300px;">
                                <canvas id="productivity-pie-chart"></canvas>
                            </div>
                        </div>
                    </div>
                    
                    <div class="card">
                        <h2>Productivity Heatmap</h2>
                        <div style="text-align: center;">
                            <div id="heatmap-container" style="display: inline-block; margin: 1rem;"></div>
                        </div>
                    </div>
                    
                    <div class="card">
                        <h2>Commit Timeline</h2>
                        <div class="chart-container" style="height: 300px;">
                            <canvas id="commit-timeline-chart"></canvas>
                        </div>
                    </div>
                </div>

                <div id="commits" class="tab-content${this._activeTab === 'commits' ? ' active' : ''}" style="display: ${this._activeTab === 'commits' ? 'block' : 'none'}">
                    <div class="card">
                        <h2>Commit Analytics</h2>
                        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-bottom: 1rem;">
                            <div style="text-align: center; padding: 1rem; background: var(--vscode-editor-background); border-radius: 8px;">
                                <div style="font-size: 2em; font-weight: bold; color: var(--vscode-charts-blue);">${commitStats.totalCommits}</div>
                                <div style="font-size: 0.9em; color: var(--vscode-descriptionForeground);">Total Commits</div>
                            </div>
                            <div style="text-align: center; padding: 1rem; background: var(--vscode-editor-background); border-radius: 8px;">
                                <div style="font-size: 2em; font-weight: bold; color: var(--vscode-charts-green);">${this._formatTime(commitStats.totalTimeOnCommits)}</div>
                                <div style="font-size: 0.9em; color: var(--vscode-descriptionForeground);">Total Time</div>
                            </div>
                            <div style="text-align: center; padding: 1rem; background: var(--vscode-editor-background); border-radius: 8px;">
                                <div style="font-size: 2em; font-weight: bold; color: var(--vscode-charts-orange);">${this._formatTime(commitStats.averageTimePerCommit)}</div>
                                <div style="font-size: 0.9em; color: var(--vscode-descriptionForeground);">Avg per Commit</div>
                            </div>
                            <div style="text-align: center; padding: 1rem; background: var(--vscode-editor-background); border-radius: 8px;">
                                <div style="font-size: 1.2em; font-weight: bold;">
                                    <span style="color: #4CAF50;">${commitStats.productivityDistribution.high}</span> / 
                                    <span style="color: #FF9800;">${commitStats.productivityDistribution.medium}</span> / 
                                    <span style="color: #757575;">${commitStats.productivityDistribution.low}</span>
                                </div>
                                <div style="font-size: 0.9em; color: var(--vscode-descriptionForeground);">High/Med/Low Productivity</div>
                            </div>
                        </div>
                    </div>
                    
                    <div class="card">
                        <h2>Recent Commits</h2>
                        <div style="overflow-x: auto;">
                            <table style="width: 100%; min-width: 800px;">
                                <thead>
                                    <tr>
                                        <th style="width: 35%;">Message</th>
                                        <th>Branch</th>
                                        <th>Time Spent</th>
                                        <th>Files</th>
                                        <th>Changes</th>
                                        <th>Productivity</th>
                                        <th>Date</th>
                                    </tr>
                                </thead>
                                <tbody>${commitRows}</tbody>
                            </table>
                        </div>
                    </div>
                </div>

                <div id="projects" class="tab-content${this._activeTab === 'projects' ? ' active' : ''}" style="display: ${this._activeTab === 'projects' ? 'block' : 'none'}">
                    <div class="card">
                        <h2>All Projects</h2>
                        <table>
                            <thead><tr><th>Name</th><th>Total Time</th><th>Entries</th><th>Last Active</th></tr></thead>
                            <tbody>${projectRows}</tbody>
                        </table>
                    </div>
                </div>

                <div id="daily" class="tab-content${this._activeTab === 'daily' ? ' active' : ''}" style="display: ${this._activeTab === 'daily' ? 'block' : 'none'}">
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

                    let currentActiveTab = '${this._activeTab}';
                    
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
                        
                        // Notify extension about tab change
                        currentActiveTab = tabName;
                        vscode.postMessage({ command: 'tabChanged', tab: tabName });
                    }
                    
                    // Handle messages from extension
                    window.addEventListener('message', event => {
                        const message = event.data;
                        if (message.command === 'updateDynamicData') {
                            updateDynamicContent(message.data);
                        }
                    });
                    
                    function updateDynamicContent(data) {
                        // Update current status
                        const statusElement = document.querySelector('.card h2');
                        if (statusElement && statusElement.textContent === 'Current Status') {
                            const statusCard = statusElement.parentElement;
                            const statusText = data.isTracking ? \`Tracking (\${data.sessionTime})\` : 'Paused';
                            const projectInfo = statusCard.querySelector('p:first-of-type');
                            const statusInfo = statusCard.querySelector('p:nth-of-type(2)');
                            
                            if (projectInfo) projectInfo.innerHTML = \`<strong>Current Project:</strong> \${data.currentProject}\`;
                            if (statusInfo) statusInfo.innerHTML = \`<strong>Status:</strong> \${statusText}\`;
                        }
                        
                        // Preserve active tab
                        if (data.activeTab && data.activeTab !== currentActiveTab) {
                            const tabToActivate = document.querySelector(\`button[onclick*="\${data.activeTab}"]\`);
                            if (tabToActivate) {
                                tabToActivate.click();
                            }
                        }
                    }

                    document.getElementById('start-btn').addEventListener('click', () => vscode.postMessage({ command: 'startTracking' }));
                    document.getElementById('stop-btn').addEventListener('click', () => vscode.postMessage({ command: 'stopTracking' }));
                    document.getElementById('reset-btn').addEventListener('click', () => vscode.postMessage({ command: 'resetToday' }));
                    document.getElementById('export-json-btn').addEventListener('click', () => vscode.postMessage({ command: 'exportData', format: 'json' }));
                    document.getElementById('export-csv-btn').addEventListener('click', () => vscode.postMessage({ command: 'exportData', format: 'csv' }));
                    document.getElementById('import-btn').addEventListener('click', () => vscode.postMessage({ command: 'importData' }));

                    window.addEventListener('load', () => {
                        // Weekly Activity Bar Chart
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
                                    plugins: {
                                        legend: { display: false }
                                    },
                                    scales: {
                                        y: {
                                            beginAtZero: true,
                                            title: { display: true, text: 'Hours' }
                                        }
                                    }
                                }
                            });
                        }

                        // Project Distribution Pie Chart
                        const projectPieCtx = document.getElementById('project-pie-chart').getContext('2d');
                        if (projectPieCtx) {
                            new Chart(projectPieCtx, {
                                type: 'pie',
                                data: {
                                    labels: ${JSON.stringify(projectTimeData.map(p => p.label))},
                                    datasets: [{
                                        data: ${JSON.stringify(projectTimeData.map(p => p.value))},
                                        backgroundColor: ${JSON.stringify(projectTimeData.map(p => p.color))},
                                        borderWidth: 2
                                    }]
                                },
                                options: {
                                    responsive: true,
                                    maintainAspectRatio: false,
                                    plugins: {
                                        legend: { position: 'bottom' },
                                        tooltip: {
                                            callbacks: {
                                                label: function(context) {
                                                    return context.label + ': ' + context.parsed.toFixed(1) + 'h';
                                                }
                                            }
                                        }
                                    }
                                }
                            });
                        }

                        // File Types Bar Chart
                        const fileTypeCtx = document.getElementById('filetype-bar-chart').getContext('2d');
                        if (fileTypeCtx) {
                            new Chart(fileTypeCtx, {
                                type: 'bar',
                                data: {
                                    labels: ${JSON.stringify(fileTypeLabels)},
                                    datasets: [{
                                        label: 'Hours Spent',
                                        data: ${JSON.stringify(fileTypeValues)},
                                        backgroundColor: 'rgba(255, 159, 64, 0.6)',
                                        borderColor: 'rgba(255, 159, 64, 1)',
                                        borderWidth: 1
                                    }]
                                },
                                options: {
                                    responsive: true,
                                    maintainAspectRatio: false,
                                    plugins: {
                                        legend: { display: false }
                                    },
                                    scales: {
                                        y: {
                                            beginAtZero: true,
                                            title: { display: true, text: 'Hours' }
                                        }
                                    }
                                }
                            });
                        }

                        // Productivity Pie Chart
                        const productivityCtx = document.getElementById('productivity-pie-chart').getContext('2d');
                        if (productivityCtx) {
                            new Chart(productivityCtx, {
                                type: 'doughnut',
                                data: {
                                    labels: ${JSON.stringify(productivityData.map(p => p.label))},
                                    datasets: [{
                                        data: ${JSON.stringify(productivityData.map(p => p.value))},
                                        backgroundColor: ${JSON.stringify(productivityData.map(p => p.color))},
                                        borderWidth: 2
                                    }]
                                },
                                options: {
                                    responsive: true,
                                    maintainAspectRatio: false,
                                    plugins: {
                                        legend: { position: 'bottom' }
                                    }
                                }
                            });
                        }

                        // Commit Timeline Line Chart
                        const timelineCtx = document.getElementById('commit-timeline-chart').getContext('2d');
                        if (timelineCtx) {
                            new Chart(timelineCtx, {
                                type: 'line',
                                data: {
                                    labels: ${JSON.stringify(commitTimelineLabels)},
                                    datasets: [{
                                        label: 'Time per Commit (hours)',
                                        data: ${JSON.stringify(commitTimelineData)},
                                        borderColor: 'rgba(75, 192, 192, 1)',
                                        backgroundColor: 'rgba(75, 192, 192, 0.2)',
                                        fill: true,
                                        tension: 0.4
                                    }]
                                },
                                options: {
                                    responsive: true,
                                    maintainAspectRatio: false,
                                    plugins: {
                                        legend: { display: false }
                                    },
                                    scales: {
                                        y: {
                                            beginAtZero: true,
                                            title: { display: true, text: 'Hours' }
                                        },
                                        x: {
                                            title: { display: true, text: 'Commits (chronological)' }
                                        }
                                    }
                                }
                            });
                        }

                        // Productivity Heatmap
                        createHeatmap();
                    });

                    function createHeatmap() {
                        const heatmapData = ${JSON.stringify(heatmapData)};
                        const container = document.getElementById('heatmap-container');
                        if (!container) return;

                        const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
                        const cellSize = 20;
                        const maxValue = Math.max(...heatmapData.flat());

                        let html = '<div style="margin-bottom: 10px;"><strong>Productivity by Hour & Day</strong></div>';
                        html += '<div style="display: grid; grid-template-columns: 40px repeat(7, 25px); gap: 2px; font-size: 12px;">';
                        
                        // Header row with day names
                        html += '<div></div>';
                        days.forEach(day => {
                            html += \`<div style="text-align: center; font-weight: bold;">\${day}</div>\`;
                        });

                        // Hour rows
                        for (let hour = 0; hour < 24; hour++) {
                            html += \`<div style="text-align: right; padding-right: 5px; line-height: 25px;">\${hour.toString().padStart(2, '0')}</div>\`;
                            for (let day = 0; day < 7; day++) {
                                const value = heatmapData[hour][day];
                                const opacity = maxValue > 0 ? (value / maxValue) : 0;
                                const color = \`rgba(54, 162, 235, \${opacity})\`;
                                const title = \`\${days[day]} \${hour}:00 - \${value.toFixed(1)}h\`;
                                html += \`<div style="width: 25px; height: 25px; background-color: \${color}; border: 1px solid #ddd; cursor: pointer;" title="\${title}"></div>\`;
                            }
                        }
                        
                        html += '</div>';
                        container.innerHTML = html;
                    }
                </script>
            </body>
            </html>`;
    }
}