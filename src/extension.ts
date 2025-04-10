import * as vscode from 'vscode';
import { TimeTracker } from './timeTracker';
import { DashboardPanel } from './dashboardPanel';
import { TimeDataProvider } from './timeDataProvider';
import { StatusBarManager } from './statusBarManager';

let timeTracker: TimeTracker;
let statusBarManager: StatusBarManager;

export function activate(context: vscode.ExtensionContext) {
    console.log('Activating Project Timer extension');
    
    // Initialize the time tracker
    timeTracker = new TimeTracker(context);
    
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
        
        vscode.commands.registerCommand('project-timer.startTracking', () => {
            timeTracker.startTracking();
            vscode.window.showInformationMessage('Project Timer: Started tracking');
        }),
        
        vscode.commands.registerCommand('project-timer.stopTracking', () => {
            timeTracker.stopTracking();
            vscode.window.showInformationMessage('Project Timer: Stopped tracking');
        }),
        
        vscode.commands.registerCommand('project-timer.resetToday', () => {
            timeTracker.resetToday();
            vscode.window.showInformationMessage('Project Timer: Reset today\'s stats');
        })
    );
    
    // Start tracking when the extension activates
    timeTracker.startTracking();
}

export function deactivate() {
    // Save time data when the extension deactivates
    if (timeTracker) {
        timeTracker.stopTracking();
    }
}
