import * as vscode from 'vscode';
import { TimeTracker } from './timeTracker';

export class StatusBarManager implements vscode.Disposable {
    private statusBarItem: vscode.StatusBarItem;
    private timeTracker: TimeTracker;
    private updateIntervalId: NodeJS.Timeout | null = null;
    private statusBarFormat: string = 'session';

    constructor(timeTracker: TimeTracker) {
        this.timeTracker = timeTracker;
        
        // Create status bar item
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        this.statusBarItem.command = 'project-timer.showDashboard';
        this.statusBarItem.tooltip = 'View Project Timer Dashboard';
        
        // Start interval to update status bar
        this.updateIntervalId = setInterval(() => this.updateStatusBar(), 1000);
        
        // Show the status bar immediately
        this.updateStatusBar();
        this.statusBarItem.show();
        
        // Register for data change events
        this.timeTracker.registerDataChangeListener(() => this.updateStatusBar());
        
        // Listen for configuration changes
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('projectTimer.statusBarFormat')) {
                this.loadConfig();
                this.updateStatusBar();
            }
        });
        
        this.loadConfig();
    }

    private loadConfig(): void {
        const config = vscode.workspace.getConfiguration('projectTimer');
        this.statusBarFormat = config.get('statusBarFormat', 'session');
    }

    private updateStatusBar(): void {
        const project = this.timeTracker.getCurrentProject();

        if (!project) {
            this.statusBarItem.text = '$(watch) No active project';
            this.statusBarItem.tooltip = 'Project Timer: No active project folder found.';
            return;
        }

        // Get the text based on format preference
        const text = this.getStatusBarText(project);
        this.statusBarItem.text = text;
        this.statusBarItem.tooltip = this.getEnhancedTooltip();
    }

    private getStatusBarText(project: string): string {
        const isTracking = this.timeTracker.isCurrentlyTracking();
        const sessionTime = this.formatTime(this.timeTracker.getCurrentSessionTime());
        const todayTotalTime = this.formatTime(this.timeTracker.getTodayTotalTime());
        const goalProgress = this.timeTracker.getGoalProgress();
        
        // Get additional context info
        const gitBranch = this.timeTracker.getCurrentGitBranch();
        const fileType = this.timeTracker.getCurrentFileType();
        const focusTime = this.formatTime(this.timeTracker.getCurrentFocusTime());
        
        const icon = isTracking ? '$(clock)' : '$(watch)';
        const status = isTracking ? '' : ' (paused)';
        
        switch (this.statusBarFormat) {
            case 'session':
                return `${icon} ${project}: ${sessionTime}${status}`;
                
            case 'daily':
                return `${icon} ${project}: ${todayTotalTime} today${status}`;
                
            case 'goal':
                const dailyPercent = Math.floor(goalProgress.daily.percentage);
                const weeklyPercent = Math.floor(goalProgress.weekly.percentage);
                return `${icon} ${project}: D:${dailyPercent}% W:${weeklyPercent}%${status}`;
                
            case 'custom':
                let customText = `${icon} ${project}: ${sessionTime}`;
                if (gitBranch && gitBranch !== 'unknown') {
                    customText += ` [${gitBranch}]`;
                }
                if (fileType && fileType !== '.unknown') {
                    customText += ` ${fileType}`;
                }
                if (isTracking && focusTime) {
                    customText += ` (${focusTime} focus)`;
                }
                return customText + status;
                
            default:
                return `${icon} ${project}: ${sessionTime}${status}`;
        }
    }

    private getEnhancedTooltip(): vscode.MarkdownString {
        const goalProgress = this.timeTracker.getGoalProgress();
        const dailyPercent = Math.floor(goalProgress.daily.percentage);
        const weeklyPercent = Math.floor(goalProgress.weekly.percentage);
        const gitBranch = this.timeTracker.getCurrentGitBranch();
        const fileType = this.timeTracker.getCurrentFileType();
        const currentSession = this.timeTracker.getCurrentSession();
        const interruptions = this.timeTracker.getSessionInterruptions();
        
        const dailyGoalFormatted = this.formatTime(goalProgress.daily.goal);
        const dailySpentFormatted = this.formatTime(goalProgress.daily.spent);
        const weeklyGoalFormatted = this.formatTime(goalProgress.weekly.goal);
        const weeklySpentFormatted = this.formatTime(goalProgress.weekly.spent);
        const focusTime = this.formatTime(this.timeTracker.getCurrentFocusTime());
        
        let tooltip = `**Project Timer**\n\n`;
        
        // Current session info
        if (this.timeTracker.isCurrentlyTracking()) {
            tooltip += `**Current Session**\n`;
            tooltip += `• Session time: ${this.formatTime(this.timeTracker.getCurrentSessionTime())}\n`;
            tooltip += `• Focus time: ${focusTime}\n`;
            tooltip += `• Interruptions: ${interruptions}\n`;
            if (gitBranch && gitBranch !== 'unknown') {
                tooltip += `• Git branch: ${gitBranch}\n`;
            }
            if (fileType && fileType !== '.unknown') {
                tooltip += `• File type: ${fileType}\n`;
            }
            tooltip += `\n`;
        }
        
        // Goals section
        tooltip += `**Goals**\n`;
        tooltip += `• Daily: ${dailySpentFormatted} / ${dailyGoalFormatted} (${dailyPercent}%)\n`;
        tooltip += `• Weekly: ${weeklySpentFormatted} / ${weeklyGoalFormatted} (${weeklyPercent}%)\n\n`;
        
        // File types today
        const topFileTypes = this.timeTracker.getTopFileTypes(3);
        if (topFileTypes.length > 0) {
            tooltip += `**Today's File Types**\n`;
            topFileTypes.forEach(ft => {
                tooltip += `• ${ft.extension}: ${this.formatTime(ft.totalTime)}\n`;
            });
            tooltip += `\n`;
        }
        
        tooltip += `---\n\n**Commands**\n`;
        tooltip += `• Click: Show dashboard\n`;
        tooltip += `• Ctrl+Shift+P: Project Timer commands`;
        
        return new vscode.MarkdownString(tooltip);
    }
    
    private formatTime(seconds: number): string {
        if (seconds === 0) return '0s';
        
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);
        
        if (hours > 0) {
            return `${hours}h ${minutes}m`;
        } else if (minutes > 0) {
            return `${minutes}m ${secs}s`;
        } else {
            return `${secs}s`;
        }
    }

    public setFormat(format: string): void {
        this.statusBarFormat = format;
        this.updateStatusBar();
    }

    public getAvailableFormats(): { [key: string]: string } {
        return {
            'session': 'Current session time',
            'daily': 'Today\'s total time',
            'goal': 'Goal progress percentages',
            'custom': 'Session + Git + File type + Focus time'
        };
    }

    dispose(): void {
        if (this.updateIntervalId) {
            clearInterval(this.updateIntervalId);
        }
        
        this.statusBarItem.dispose();
    }
}
