import * as vscode from 'vscode';
import { TimeTracker } from './timeTracker';

export class StatusBarManager implements vscode.Disposable {
    private statusBarItem: vscode.StatusBarItem;
    private timeTracker: TimeTracker;
    private updateIntervalId: NodeJS.Timeout | null = null;

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
    }

    private updateStatusBar(): void {
        const project = this.timeTracker.getCurrentProject();

        if (!project) {
            this.statusBarItem.text = '$(watch) No active project';
            this.statusBarItem.tooltip = 'Project Timer: No active project folder found.';
            return;
        }

        // Main status text
        let text: string;
        if (this.timeTracker.isCurrentlyTracking()) {
            const sessionTime = this.formatTime(this.timeTracker.getCurrentSessionTime());
            const todayTotalTime = this.formatTime(this.timeTracker.getTodayTotalTime());
            text = `$(clock) ${project}: ${sessionTime} (Today: ${todayTotalTime})`;
        } else {
            const todayTotalTime = this.formatTime(this.timeTracker.getTodayTotalTime());
            text = `$(watch) ${project}: ${todayTotalTime} today (paused)`;
        }

        // Goal progress text and tooltip
        const goalProgress = this.timeTracker.getGoalProgress();
        const dailyPercent = Math.floor(goalProgress.daily.percentage);
        const weeklyPercent = Math.floor(goalProgress.weekly.percentage);

        let goalText = '';
        if (goalProgress.daily.goal > 0 || goalProgress.weekly.goal > 0) {
            goalText = ` | $(target) D:${dailyPercent}% W:${weeklyPercent}%`;
        }

        this.statusBarItem.text = text + goalText;

        const dailyGoalFormatted = this.formatTime(goalProgress.daily.goal);
        const dailySpentFormatted = this.formatTime(goalProgress.daily.spent);
        const weeklyGoalFormatted = this.formatTime(goalProgress.weekly.goal);
        const weeklySpentFormatted = this.formatTime(goalProgress.weekly.spent);

        this.statusBarItem.tooltip = new vscode.MarkdownString(
            `**Project Timer**\n\n---\n\n` +
            `**Today's Goal:** ${dailySpentFormatted} / ${dailyGoalFormatted} (${dailyPercent}%)\n\n` +
            `**Weekly Goal:** ${weeklySpentFormatted} / ${weeklyGoalFormatted} (${weeklyPercent}%)\n\n---\n\n` +
            `Click to show dashboard.`
        );
    }
    
    private formatTime(seconds: number): string {
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

    dispose(): void {
        if (this.updateIntervalId) {
            clearInterval(this.updateIntervalId);
        }
        
        this.statusBarItem.dispose();
    }
}
