import * as vscode from 'vscode';
import { TimeTracker, ProjectTime, DailyRecord } from './timeTracker';

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
        
        // Use showSaveDialog when that feature is added
        // For now, put into clipboard
        if (content) {
            vscode.env.clipboard.writeText(content).then(() => {
                vscode.window.showInformationMessage(`Data exported to clipboard. Save as: ${filename}`);
            });
        }
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
        
        this._panel.webview.html = this._getHtmlForWebview();
    }

    /**
     * Generates the HTML for the webview panel
     */
    private _getHtmlForWebview(): string {
        // Get the data
        const projectData = this._timeTracker.getProjectData();
        const dailyData = this._timeTracker.getDailyData();
        const currentProject = this._timeTracker.getCurrentProject();
        const isTracking = this._timeTracker.isCurrentlyTracking();
        const sessionTime = this._timeTracker.getCurrentSessionTime();
        
        // Get project statistics and insights if available
        const projectStats = currentProject ? this._timeTracker.getProjectStatistics(currentProject) : null;
        const projectInsights = currentProject ? this._timeTracker.getProductivityInsights(currentProject) : [];
        
        // Get the chart.js script
        const chartJsUri = this._panel.webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'node_modules', 'chart.js', 'dist', 'chart.umd.js')
        );
        
        // Create sorted data for charts
        const today = new Date().toISOString().split('T')[0];
        const todayData = dailyData[today] || { projects: {}, totalTime: 0 };
        
        // If tracking, add the current session time to the data
        let adjustedTodayData = { ...todayData };
        if (isTracking && currentProject) {
            adjustedTodayData = {
                ...todayData,
                projects: {
                    ...todayData.projects,
                    [currentProject]: (todayData.projects[currentProject] || 0) + sessionTime
                },
                totalTime: todayData.totalTime + sessionTime
            };
        }
        
        // Project data for today's chart
        const projectLabels = Object.keys(adjustedTodayData.projects);
        const projectTimes = Object.values(adjustedTodayData.projects);
        
        // Daily data for the weekly chart (last 7 days)
        const last7Days = this._getLast7Days();
        const dailyLabels = last7Days.map(date => {
            const d = new Date(date);
            return d.toLocaleDateString(undefined, { weekday: 'short' });
        });
        const dailyTimes = last7Days.map(date => {
            const day = dailyData[date];
            return day ? day.totalTime : 0;
        });
        
        // Handle current session for today's data
        if (isTracking && currentProject && last7Days[0] === today) {
            dailyTimes[0] += sessionTime;
        }
        
        // Format data for JSON
        const projectChartData = JSON.stringify({
            labels: projectLabels,
            datasets: [{
                label: 'Time Spent (seconds)',
                data: projectTimes as number[],
                backgroundColor: [
                    'rgba(54, 162, 235, 0.5)',
                    'rgba(255, 99, 132, 0.5)',
                    'rgba(255, 206, 86, 0.5)',
                    'rgba(75, 192, 192, 0.5)',
                    'rgba(153, 102, 255, 0.5)',
                    'rgba(255, 159, 64, 0.5)'
                ],
                borderColor: [
                    'rgba(54, 162, 235, 1)',
                    'rgba(255, 99, 132, 1)',
                    'rgba(255, 206, 86, 1)',
                    'rgba(75, 192, 192, 1)',
                    'rgba(153, 102, 255, 1)',
                    'rgba(255, 159, 64, 1)'
                ],
                borderWidth: 1
            }]
        });
        
        const dailyChartData = JSON.stringify({
            labels: dailyLabels,
            datasets: [{
                label: 'Daily Time Spent (seconds)',
                data: dailyTimes,
                backgroundColor: 'rgba(54, 162, 235, 0.5)',
                borderColor: 'rgba(54, 162, 235, 1)',
                borderWidth: 1,
                tension: 0.1
            }]
        });
        
        // Create HTML for the tables
        let projectTableHtml = '';
        
        if (Object.keys(projectData).length === 0) {
            projectTableHtml = '<tr><td colspan="2" class="centered">No projects tracked yet</td></tr>';
        } else {
            // Sort projects by total time (descending)
            projectTableHtml = Object.values(projectData)
                .sort((a, b) => b.totalTime - a.totalTime)
                .map(project => {
                    return `
                    <tr>
                        <td>${project.projectName}</td>
                        <td>${this._formatTime(project.totalTime)}</td>
                    </tr>`;
                })
                .join('');
        }
        
        let dailyTableHtml = '';
        
        if (Object.keys(dailyData).length === 0) {
            dailyTableHtml = '<tr><td colspan="2" class="centered">No daily records yet</td></tr>';
        } else {
            // Sort days by date (newest first)
            dailyTableHtml = Object.values(dailyData)
                .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                .slice(0, 7) // Only show the last 7 days
                .map(day => {
                    const date = new Date(day.date);
                    const dateLabel = day.date === today ? 'Today' : date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
                    
                    return `
                    <tr>
                        <td>${dateLabel}</td>
                        <td>${this._formatTime(day.totalTime)}</td>
                    </tr>`;
                })
                .join('');
        }
        
        // Generate the main HTML
        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Project Timer Dashboard</title>
            <script src="${chartJsUri}"></script>
            <style>
                body {
                    font-family: var(--vscode-font-family);
                    color: var(--vscode-foreground);
                    background-color: var(--vscode-editor-background);
                    padding: 20px;
                    max-width: 1200px;
                    margin: 0 auto;
                }
                
                .dashboard {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: 20px;
                }
                
                @media (max-width: 800px) {
                    .dashboard {
                        grid-template-columns: 1fr;
                    }
                }
                
                .card {
                    background-color: var(--vscode-editor-background);
                    border: 1px solid var(--vscode-panel-border);
                    border-radius: 6px;
                    padding: 16px;
                    margin-bottom: 20px;
                    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
                }
                
                .session-card {
                    grid-column: 1 / -1;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }
                
                .card-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 12px;
                    border-bottom: 1px solid var(--vscode-panel-border);
                    padding-bottom: 8px;
                }
                
                h2 {
                    margin: 0;
                    font-size: 18px;
                    color: var(--vscode-editor-foreground);
                }
                
                .button {
                    background-color: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border: none;
                    padding: 6px 12px;
                    border-radius: 2px;
                    cursor: pointer;
                    font-size: 13px;
                    margin-left: 8px;
                }
                
                .button:hover {
                    background-color: var(--vscode-button-hoverBackground);
                }
                
                .danger {
                    background-color: var(--vscode-errorForeground);
                }
                
                .chart-container {
                    position: relative;
                    height: 300px;
                    width: 100%;
                }
                
                table {
                    width: 100%;
                    border-collapse: collapse;
                    margin-top: 12px;
                }
                
                th, td {
                    padding: 8px;
                    text-align: left;
                    border-bottom: 1px solid var(--vscode-panel-border);
                }
                
                th {
                    font-weight: bold;
                    background-color: var(--vscode-list-hoverBackground);
                }
                
                tr:nth-child(even) {
                    background-color: var(--vscode-list-hoverBackground);
                }
                
                .centered {
                    text-align: center;
                }
                
                .status {
                    font-size: 16px;
                    margin-right: 20px;
                }
                
                .time {
                    font-size: 24px;
                    font-weight: bold;
                }
                
                .actions {
                    display: flex;
                }
                
                .footer {
                    grid-column: 1 / -1;
                    text-align: center;
                    margin-top: 20px;
                    color: var(--vscode-descriptionForeground);
                    font-size: 12px;
                }
                
                .export-buttons {
                    display: flex;
                    justify-content: center;
                    gap: 10px;
                    margin-top: 10px;
                }
                
                .stats-card {
                    grid-column: 1 / -1;
                }
                
                .stats-table {
                    margin-top: 12px;
                }
                
                .stats-table th, .stats-table td {
                    padding: 8px;
                    text-align: left;
                    border-bottom: 1px solid var(--vscode-panel-border);
                }
                
                .stats-table th {
                    font-weight: bold;
                    background-color: var(--vscode-list-hoverBackground);
                }
                
                .stats-table tr:nth-child(even) {
                    background-color: var(--vscode-list-hoverBackground);
                }
                
                .insights-card {
                    grid-column: 1 / -1;
                }
                
                .insights-list {
                    margin-top: 12px;
                    padding: 0;
                    list-style: none;
                }
                
                .insights-list li {
                    padding: 8px;
                    border-bottom: 1px solid var(--vscode-panel-border);
                }
                
                .insights-list li:last-child {
                    border-bottom: none;
                }
            </style>
        </head>
        <body>
            <div class="dashboard">
                <div class="card session-card">
                    <div>
                        <div class="status">
                            ${currentProject ? `Project: <strong>${currentProject}</strong>` : 'No active project'}
                        </div>
                        <div class="time" id="sessionTime">
                            ${isTracking ? `Current session: ${this._formatTime(sessionTime)}` : 'Not tracking'}
                        </div>
                    </div>
                    <div class="actions">
                        ${isTracking 
                          ? `<button class="button" id="stopBtn">Stop Tracking</button>` 
                          : `<button class="button" id="startBtn">Start Tracking</button>`}
                        <button class="button danger" id="resetBtn">Reset Today</button>
                    </div>
                </div>
                
                <div class="card">
                    <div class="card-header">
                        <h2>Today's Projects</h2>
                    </div>
                    ${adjustedTodayData.totalTime > 0 
                     ? `<div class="chart-container"><canvas id="projectChart"></canvas></div>`
                     : `<p class="centered">No data for today yet</p>`}
                </div>
                
                <div class="card">
                    <div class="card-header">
                        <h2>Weekly Activity</h2>
                    </div>
                    ${dailyTimes.some(t => t > 0)
                     ? `<div class="chart-container"><canvas id="dailyChart"></canvas></div>`
                     : `<p class="centered">No activity data yet</p>`}
                </div>
                
                <div class="card">
                    <div class="card-header">
                        <h2>Project Summary</h2>
                    </div>
                    <table>
                        <thead>
                            <tr>
                                <th>Project</th>
                                <th>Total Time</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${projectTableHtml}
                        </tbody>
                    </table>
                </div>
                
                <div class="card">
                    <div class="card-header">
                        <h2>Recent Activity</h2>
                    </div>
                    <table>
                        <thead>
                            <tr>
                                <th>Day</th>
                                <th>Total Time</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${dailyTableHtml}
                        </tbody>
                    </table>
                </div>
                
                ${projectStats 
                 ? `<div class="card stats-card">
                        <div class="card-header">
                            <h2>Project Statistics</h2>
                        </div>
                        <table class="stats-table">
                            <thead>
                                <tr>
                                    <th>Statistic</th>
                                    <th>Value</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${Object.entries(projectStats).map(([stat, value]) => {
                                    return `
                                    <tr>
                                        <td>${stat}</td>
                                        <td>${value}</td>
                                    </tr>`;
                                }).join('')}
                            </tbody>
                        </table>
                    </div>`
                 : ''}
                
                ${projectInsights.length > 0 
                 ? `<div class="card insights-card">
                        <div class="card-header">
                            <h2>Productivity Insights</h2>
                        </div>
                        <ul class="insights-list">
                            ${projectInsights.map(insight => {
                                return `
                                <li>${insight}</li>`;
                            }).join('')}
                        </ul>
                    </div>`
                 : ''}
                
                <div class="footer">
                    <p>Export your time tracking data:</p>
                    <div class="export-buttons">
                        <button class="button" id="exportJsonBtn">Export JSON</button>
                        <button class="button" id="exportCsvBtn">Export CSV</button>
                    </div>
                </div>
            </div>
            
            <script>
                (function() {
                    const vscode = acquireVsCodeApi();
                    
                    // Setup buttons
                    document.getElementById('${isTracking ? 'stopBtn' : 'startBtn'}').addEventListener('click', () => {
                        vscode.postMessage({
                            command: '${isTracking ? 'stopTracking' : 'startTracking'}'
                        });
                    });
                    
                    document.getElementById('resetBtn').addEventListener('click', () => {
                        vscode.postMessage({
                            command: 'resetToday'
                        });
                    });
                    
                    document.getElementById('exportJsonBtn').addEventListener('click', () => {
                        vscode.postMessage({
                            command: 'exportData',
                            format: 'json'
                        });
                    });
                    
                    document.getElementById('exportCsvBtn').addEventListener('click', () => {
                        vscode.postMessage({
                            command: 'exportData',
                            format: 'csv'
                        });
                    });
                    
                    // Setup charts
                    ${adjustedTodayData.totalTime > 0 ? `
                    const projectCtx = document.getElementById('projectChart').getContext('2d');
                    new Chart(projectCtx, {
                        type: 'pie',
                        data: ${projectChartData},
                        options: {
                            responsive: true,
                            maintainAspectRatio: false,
                            animation: {
                                duration: 0 // Disable animations
                            },
                            plugins: {
                                legend: {
                                    position: 'right',
                                }
                            }
                        }
                    });
                    ` : ''}
                    
                    ${dailyTimes.some(t => t > 0) ? `
                    const dailyCtx = document.getElementById('dailyChart').getContext('2d');
                    new Chart(dailyCtx, {
                        type: 'bar',
                        data: ${dailyChartData},
                        options: {
                            responsive: true,
                            maintainAspectRatio: false,
                            animation: {
                                duration: 0 // Disable animations
                            },
                            scales: {
                                y: {
                                    beginAtZero: true,
                                    ticks: {
                                        callback: function(value) {
                                            const hours = Math.floor(value / 3600);
                                            const minutes = Math.floor((value % 3600) / 60);
                                            if (hours > 0) {
                                                return hours + 'h ' + minutes + 'm';
                                            } else {
                                                return minutes + 'm';
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    });
                    ` : ''}
                    
                    // Update session timer if tracking
                    ${isTracking ? `
                    let sessionSeconds = ${Math.floor(sessionTime)};
                    const sessionTimeEl = document.getElementById('sessionTime');
                    
                    setInterval(() => {
                        sessionSeconds++;
                        const hours = Math.floor(sessionSeconds / 3600);
                        const minutes = Math.floor((sessionSeconds % 3600) / 60);
                        const secs = Math.floor(sessionSeconds % 60);
                        
                        let timeStr = '';
                        if (hours > 0) {
                            timeStr = \`Current session: \${hours}h \${minutes}m \${secs}s\`;
                        } else if (minutes > 0) {
                            timeStr = \`Current session: \${minutes}m \${secs}s\`;
                        } else {
                            timeStr = \`Current session: \${secs}s\`;
                        }
                        
                        sessionTimeEl.textContent = timeStr;
                    }, 1000);
                    ` : ''}
                })();
            </script>
        </body>
        </html>`;
    }
    
    /**
     * Gets the dates of the last 7 days
     */
    private _getLast7Days(): string[] {
        const dates: string[] = [];
        for (let i = 0; i < 7; i++) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            const dateString = date.toISOString().split('T')[0];
            dates.push(dateString);
        }
        return dates;
    }

    /**
     * Disposes of the panel
     */
    public dispose(): void {
        DashboardPanel.currentPanel = undefined;
        
        if (this._updateInterval) {
            clearInterval(this._updateInterval);
        }

        // Clean up our resources
        this._panel.dispose();

        while (this._disposables.length) {
            const disposable = this._disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }
}
