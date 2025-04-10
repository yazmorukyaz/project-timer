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
            return;
        }
        
        if (this.timeTracker.isCurrentlyTracking()) {
            const sessionTime = this.formatTime(this.timeTracker.getCurrentSessionTime());
            const todayTime = this.formatTime(this.timeTracker.getTodayProjectTime(project));
            
            this.statusBarItem.text = `$(clock) ${project}: ${sessionTime} (Today: ${todayTime})`;
        } else {
            const todayTime = this.formatTime(this.timeTracker.getTodayProjectTime(project));
            this.statusBarItem.text = `$(watch) ${project}: ${todayTime} today (paused)`;
        }
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
