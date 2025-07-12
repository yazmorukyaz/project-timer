import * as vscode from 'vscode';
import { TimeTracker } from './timeTracker';
import { DashboardPanel } from './dashboardPanel';
import { TimeDataProvider } from './timeDataProvider';
import { StatusBarManager } from './statusBarManager';

let timeTracker: TimeTracker;
let statusBarManager: StatusBarManager;
let isTrackingContext: vscode.EventEmitter<boolean>;

export function activate(context: vscode.ExtensionContext) {
    console.log('Activating Project Timer extension');
    
    // Set up context keys for keyboard shortcuts
    vscode.commands.executeCommand('setContext', 'projectTimer.isTracking', false);
    
    // Initialize the time tracker
    timeTracker = new TimeTracker(context);
    
    // Set up tracking state context
    const updateTrackingContext = () => {
        vscode.commands.executeCommand('setContext', 'projectTimer.isTracking', timeTracker.isCurrentlyTracking());
    };
    timeTracker.registerDataChangeListener(updateTrackingContext);
    
    // Create status bar item
    statusBarManager = new StatusBarManager(timeTracker);
    context.subscriptions.push(statusBarManager);
    
    // Create the tree data provider for the dashboard view
    const timeDataProvider = new TimeDataProvider(timeTracker);
    const treeView = vscode.window.createTreeView('projectTimerDashboard', { 
        treeDataProvider: timeDataProvider 
    });
    context.subscriptions.push(treeView);
    
    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('project-timer.showDashboard', () => {
            DashboardPanel.createOrShow(context.extensionUri, timeTracker);
        }),
        
        vscode.commands.registerCommand('project-timer.startTracking', async () => {
            await timeTracker.startTracking();
            updateTrackingContext();
            vscode.window.showInformationMessage('Project Timer: Started tracking');
        }),
        
        vscode.commands.registerCommand('project-timer.stopTracking', () => {
            timeTracker.stopTracking();
            updateTrackingContext();
            vscode.window.showInformationMessage('Project Timer: Stopped tracking');
        }),
        
        vscode.commands.registerCommand('project-timer.resetToday', () => {
            timeTracker.resetToday();
            vscode.window.showInformationMessage('Project Timer: Reset today\'s stats');
        }),
        vscode.commands.registerCommand('project-timer.resumeTracking', () => {
            timeTracker.resumeTracking();
            vscode.window.showInformationMessage('Project Timer: Resumed tracking');
        }),

        vscode.commands.registerCommand('project-timer.togglePomodoro', () => {
            timeTracker.togglePomodoro();
        }),

        vscode.commands.registerCommand('project-timer.showGoalProgress', () => {
            const goalProgress = timeTracker.getGoalProgress();

            const formatTime = (seconds: number): string => {
                if (seconds === 0) return '0m';
                const hours = Math.floor(seconds / 3600);
                const minutes = Math.floor((seconds % 3600) / 60);
                return `${hours > 0 ? `${hours}h ` : ''}${minutes}m`;
            };

            const dailySpent = formatTime(goalProgress.daily.spent);
            const dailyGoal = formatTime(goalProgress.daily.goal);
            const dailyPercent = Math.floor(goalProgress.daily.percentage);

            const weeklySpent = formatTime(goalProgress.weekly.spent);
            const weeklyGoal = formatTime(goalProgress.weekly.goal);
            const weeklyPercent = Math.floor(goalProgress.weekly.percentage);

            vscode.window.showInformationMessage(
                `Daily Goal: ${dailySpent} / ${dailyGoal} (${dailyPercent}%) | Weekly Goal: ${weeklySpent} / ${weeklyGoal} (${weeklyPercent}%)`,
                { modal: false }
            );
        }),

        vscode.commands.registerCommand('project-timer.switchProject', async () => {
            const projectData = timeTracker.getProjectData();
            const projectItems: vscode.QuickPickItem[] = Object.values(projectData).map(p => ({
                label: p.projectName,
                description: p.projectPath,
                detail: `Total time: ${Math.floor(p.totalTime / 3600)}h ${Math.floor((p.totalTime % 3600) / 60)}m`
            }));

            const selectedProject = await vscode.window.showQuickPick(projectItems, {
                placeHolder: 'Select a project to open',
            });

            if (selectedProject && selectedProject.description) {
                const projectUri = vscode.Uri.file(selectedProject.description);
                vscode.commands.executeCommand('vscode.openFolder', projectUri, { forceNewWindow: true });
            }
        })
    );
    
    // Start tracking when the extension activates
    timeTracker.startTracking().then(() => {
        updateTrackingContext();
    });
}

export function deactivate() {
    // Save time data when the extension deactivates
    if (timeTracker) {
        timeTracker.stopTracking();
    }
}
