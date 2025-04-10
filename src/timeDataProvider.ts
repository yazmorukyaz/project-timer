import * as vscode from 'vscode';
import { TimeTracker, ProjectTime, DailyRecord } from './timeTracker';

// Define tree item types for our view
export class ProjectTimeItem extends vscode.TreeItem {
    constructor(
        public readonly projectName: string,
        public readonly totalTime: number,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        const formattedTime = formatTime(totalTime);
        super(`${projectName} (${formattedTime})`, collapsibleState);
        
        this.tooltip = `Total time spent on ${projectName}: ${formattedTime}`;
        this.iconPath = new vscode.ThemeIcon('clock');
        this.contextValue = 'project';
    }
}

export class DayTimeItem extends vscode.TreeItem {
    constructor(
        public readonly date: string,
        public readonly totalTime: number,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        const formattedTime = formatTime(totalTime);
        super(`${formatDateLabel(date)} (${formattedTime})`, collapsibleState);
        
        this.tooltip = `Total time on ${formatDateLabel(date)}: ${formattedTime}`;
        this.iconPath = new vscode.ThemeIcon('calendar');
        this.contextValue = 'day';
    }
}

export class ProjectDayTimeItem extends vscode.TreeItem {
    constructor(
        public readonly projectName: string,
        public readonly time: number
    ) {
        const formattedTime = formatTime(time);
        super(`${projectName}: ${formattedTime}`, vscode.TreeItemCollapsibleState.None);
        
        this.tooltip = `Time spent on ${projectName}: ${formattedTime}`;
        this.iconPath = new vscode.ThemeIcon('symbol-field');
        this.contextValue = 'projectDay';
    }
}

export class TimeDataProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined | null | void> = new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | null | void> = this._onDidChangeTreeData.event;
    
    constructor(private timeTracker: TimeTracker) {
        // Register for data change events
        this.timeTracker.registerDataChangeListener(() => {
            this.refresh();
        });
    }
    
    refresh(): void {
        this._onDidChangeTreeData.fire();
    }
    
    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }
    
    getChildren(element?: vscode.TreeItem): Thenable<vscode.TreeItem[]> {
        if (!element) {
            // Root items: Overview, Projects, Daily
            return Promise.resolve([
                new vscode.TreeItem('Today', vscode.TreeItemCollapsibleState.Expanded),
                new vscode.TreeItem('Projects', vscode.TreeItemCollapsibleState.Collapsed),
                new vscode.TreeItem('Daily', vscode.TreeItemCollapsibleState.Collapsed)
            ]);
        }
        
        // Handle child elements based on their type
        switch (element.label) {
            case 'Today':
                return this.getTodayItems();
            case 'Projects':
                return this.getProjectItems();
            case 'Daily':
                return this.getDailyItems();
            default:
                // Check if it's a day item which would have project children
                if (element instanceof DayTimeItem) {
                    return this.getProjectsForDay(element.date);
                }
                return Promise.resolve([]);
        }
    }
    
    private getTodayItems(): Thenable<vscode.TreeItem[]> {
        const today = new Date();
        const todayString = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
        
        const dailyData = this.timeTracker.getDailyData();
        const todayData = dailyData[todayString];
        
        if (!todayData) {
            return Promise.resolve([
                new vscode.TreeItem('No activity recorded today', vscode.TreeItemCollapsibleState.None)
            ]);
        }
        
        // Create items for each project worked on today
        const items: vscode.TreeItem[] = [];
        
        // Current project with current session
        const currentProject = this.timeTracker.getCurrentProject();
        const isTracking = this.timeTracker.isCurrentlyTracking();
        
        if (isTracking && currentProject) {
            const sessionTime = this.timeTracker.getCurrentSessionTime();
            const projectTime = todayData.projects[currentProject] || 0;
            const totalTime = projectTime + sessionTime;
            
            const item = new ProjectDayTimeItem(
                `${currentProject} (Current)`,
                totalTime
            );
            items.push(item);
        }
        
        // Add other projects
        Object.entries(todayData.projects)
            .filter(([name]) => name !== currentProject)
            .sort((a, b) => b[1] - a[1]) // Sort by time descending
            .forEach(([name, time]) => {
                items.push(new ProjectDayTimeItem(name, time));
            });
        
        // Add total time item
        const totalTime = isTracking 
            ? todayData.totalTime + this.timeTracker.getCurrentSessionTime()
            : todayData.totalTime;
        
        items.push(new ProjectDayTimeItem("Total", totalTime));
        
        return Promise.resolve(items);
    }
    
    private getProjectItems(): Thenable<vscode.TreeItem[]> {
        const projectData = this.timeTracker.getProjectData();
        
        if (Object.keys(projectData).length === 0) {
            return Promise.resolve([
                new vscode.TreeItem('No projects tracked yet', vscode.TreeItemCollapsibleState.None)
            ]);
        }
        
        // Sort projects by total time (descending)
        const items = Object.values(projectData)
            .sort((a, b) => b.totalTime - a.totalTime)
            .map(project => new ProjectTimeItem(
                project.projectName,
                project.totalTime,
                vscode.TreeItemCollapsibleState.None
            ));
        
        return Promise.resolve(items);
    }
    
    private getDailyItems(): Thenable<vscode.TreeItem[]> {
        const dailyData = this.timeTracker.getDailyData();
        
        if (Object.keys(dailyData).length === 0) {
            return Promise.resolve([
                new vscode.TreeItem('No daily records yet', vscode.TreeItemCollapsibleState.None)
            ]);
        }
        
        // Sort days by date (newest first)
        const items = Object.values(dailyData)
            .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
            .map(day => new DayTimeItem(
                day.date,
                day.totalTime,
                vscode.TreeItemCollapsibleState.Collapsed
            ));
        
        return Promise.resolve(items);
    }
    
    private getProjectsForDay(date: string): Thenable<vscode.TreeItem[]> {
        const dailyData = this.timeTracker.getDailyData();
        const dayData = dailyData[date];
        
        if (!dayData) {
            return Promise.resolve([]);
        }
        
        // Sort projects by time (descending)
        const items = Object.entries(dayData.projects)
            .sort((a, b) => b[1] - a[1])
            .map(([name, time]) => new ProjectDayTimeItem(name, time));
        
        // Add total at the end
        items.push(new ProjectDayTimeItem(
            "Total",
            dayData.totalTime
        ));
        
        return Promise.resolve(items);
    }
}

// Helper functions
function formatTime(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    
    if (hours > 0) {
        return `${hours}h ${minutes}m`;
    } else if (minutes > 0) {
        return `${minutes}m`;
    } else {
        return `${Math.floor(seconds)}s`;
    }
}

function formatDateLabel(dateString: string): string {
    const date = new Date(dateString);
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    
    // Check if it's today, yesterday, or a regular date
    if (date.toDateString() === today.toDateString()) {
        return 'Today';
    } else if (date.toDateString() === yesterday.toDateString()) {
        return 'Yesterday';
    } else {
        return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    }
}
