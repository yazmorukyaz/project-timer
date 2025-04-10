import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export interface TimeEntry {
    projectName: string;
    startTime: number;
    endTime: number;
    duration: number;
    tags?: string[];
    category?: string;
    description?: string;
}

export interface ProjectTime {
    projectName: string;
    totalTime: number;
    entries: TimeEntry[];
    categories?: { [category: string]: number };
    tags?: { [tag: string]: number };
    productivity?: number; // 0-100 productivity score
    lastActive?: number;
}

export interface DailyRecord {
    date: string;
    projects: { [projectName: string]: number };
    totalTime: number;
    productivity?: number; // 0-100 productivity score
    focusTime?: number; // Time spent in deep focus (long stretches)
    breakTime?: number; // Time spent on breaks
}

export interface ProjectStatistics {
    averageDailyTime: number;
    peakDay: { date: string; time: number };
    mostProductiveTime: { hour: number; productivity: number };
    focusRating: number; // 0-100 focus score
    trend: number[]; // Recent trend in time spent
    tags: { tag: string; time: number }[];
}

export class TimeTracker {
    private context: vscode.ExtensionContext;
    private isTracking: boolean = false;
    private currentProject: string = '';
    private startTime: number = 0;
    private timeoutId: NodeJS.Timeout | null = null;
    private activityTimeout: NodeJS.Timeout | null = null;
    private activityDebounceTimeout: NodeJS.Timeout | null = null;
    private lastActivityTime: number = Date.now();
    private projectData: { [projectName: string]: ProjectTime } = {};
    private dailyData: { [date: string]: DailyRecord } = {};
    private readonly dataFilePath: string;
    private readonly dailyFilePath: string;
    private readonly inactivityThreshold: number;
    private projectStatistics: { [projectName: string]: ProjectStatistics } = {};
    
    private onDataChangedCallbacks: Array<() => void> = [];

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.inactivityThreshold = vscode.workspace.getConfiguration('projectTimer').get('inactivityThreshold', 10);
        
        // Create storage folder if it doesn't exist
        const storageFolder = context.globalStorageUri.fsPath;
        if (!fs.existsSync(storageFolder)) {
            fs.mkdirSync(storageFolder, { recursive: true });
        }
        
        this.dataFilePath = path.join(storageFolder, 'project-time-data.json');
        this.dailyFilePath = path.join(storageFolder, 'daily-time-data.json');
        
        // Load existing data
        this.loadData();
        
        // Setup activity detection
        this.setupActivityDetection();
        
        // Save data periodically (every minute)
        this.timeoutId = setInterval(() => this.saveData(), 60000);
    }

    public startTracking(): void {
        if (this.isTracking) {
            return;
        }
        
        // Get current project name
        this.updateCurrentProject();
        
        if (!this.currentProject) {
            vscode.window.showWarningMessage('No active project detected. Time will not be tracked.');
            return;
        }
        
        this.isTracking = true;
        this.startTime = Date.now();
        this.lastActivityTime = this.startTime;
        
        // Initialize project statistics if needed
        this.initializeProjectStatistics(this.currentProject);
        
        // Notify listeners
        this.notifyDataChanged();
    }

    public stopTracking(): void {
        if (!this.isTracking) {
            return;
        }
        
        this.isTracking = false;
        
        // Record time entry
        if (this.currentProject && this.startTime > 0) {
            const endTime = Date.now();
            const duration = (endTime - this.startTime) / 1000; // in seconds
            
            // Only log if more than 1 second was spent
            if (duration > 1) {
                this.addTimeEntry(this.currentProject, this.startTime, endTime, duration);
            }
        }
        
        this.startTime = 0;
        
        // Notify listeners
        this.notifyDataChanged();
    }
    
    public resetToday(): void {
        const today = this.getTodayString();
        
        // Reset daily data
        if (this.dailyData[today]) {
            delete this.dailyData[today];
        }
        
        // Remove today's entries from project data
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const todayStartMs = todayStart.getTime();
        
        Object.keys(this.projectData).forEach(projectName => {
            const project = this.projectData[projectName];
            project.entries = project.entries.filter(entry => entry.startTime < todayStartMs);
            
            // Recalculate total time
            project.totalTime = project.entries.reduce((sum, entry) => sum + entry.duration, 0);
        });
        
        // Save updated data
        this.saveData();
        
        // Notify listeners
        this.notifyDataChanged();
    }

    public getProjectData(): { [projectName: string]: ProjectTime } {
        return { ...this.projectData };
    }
    
    public getDailyData(): { [date: string]: DailyRecord } {
        return { ...this.dailyData };
    }
    
    public getCurrentProject(): string {
        return this.currentProject;
    }
    
    public isCurrentlyTracking(): boolean {
        return this.isTracking;
    }
    
    public getCurrentSessionTime(): number {
        if (!this.isTracking || this.startTime === 0) {
            return 0;
        }
        
        return (Date.now() - this.startTime) / 1000; // in seconds
    }
    
    public getTodayTotalTime(): number {
        const today = this.getTodayString();
        return this.dailyData[today]?.totalTime || 0;
    }
    
    public getTodayProjectTime(projectName: string): number {
        const today = this.getTodayString();
        return this.dailyData[today]?.projects[projectName] || 0;
    }
    
    public registerDataChangeListener(callback: () => void): void {
        this.onDataChangedCallbacks.push(callback);
    }

    private addTimeEntry(projectName: string, startTime: number, endTime: number, duration: number): void {
        // Create project data if it doesn't exist
        if (!this.projectData[projectName]) {
            this.projectData[projectName] = {
                projectName,
                totalTime: 0,
                entries: [],
                categories: {},
                tags: {},
                productivity: 75, // Default productivity score
                lastActive: Date.now()
            };
        }
        
        // Add time entry
        const entry: TimeEntry = {
            projectName,
            startTime,
            endTime,
            duration,
            category: this.detectCategory(projectName, duration)
        };
        
        this.projectData[projectName].entries.push(entry);
        this.projectData[projectName].totalTime += duration;
        this.projectData[projectName].lastActive = Date.now();
        
        // Update category data
        if (entry.category) {
            if (!this.projectData[projectName].categories) {
                this.projectData[projectName].categories = {};
            }
            
            if (!this.projectData[projectName].categories[entry.category]) {
                this.projectData[projectName].categories[entry.category] = 0;
            }
            
            this.projectData[projectName].categories[entry.category] += duration;
        }
        
        // Update daily data
        const date = new Date(startTime);
        const dateString = this.getDateString(date);
        
        if (!this.dailyData[dateString]) {
            this.dailyData[dateString] = {
                date: dateString,
                projects: {},
                totalTime: 0,
                productivity: 75, // Default productivity score
                focusTime: 0
            };
        }
        
        if (!this.dailyData[dateString].projects[projectName]) {
            this.dailyData[dateString].projects[projectName] = 0;
        }
        
        this.dailyData[dateString].projects[projectName] += duration;
        this.dailyData[dateString].totalTime += duration;
        
        // Calculate focus time - sessions over 25 minutes are considered focus time
        if (duration > 25 * 60) {
            if (!this.dailyData[dateString].focusTime) {
                this.dailyData[dateString].focusTime = 0;
            }
            this.dailyData[dateString].focusTime += duration;
        }
        
        // Update project statistics
        this.updateProjectStatistics(projectName);
        
        // Save data
        this.saveData();
    }

    /**
     * Intelligently detects the category of work based on project and duration
     */
    private detectCategory(projectName: string, duration: number): string {
        // Based on duration, make intelligent guesses
        if (duration < 5 * 60) {
            return 'Quick Task';
        } else if (duration < 25 * 60) {
            return 'Development';
        } else if (duration < 60 * 60) {
            return 'Deep Work';
        } else {
            return 'Extended Session';
        }
    }
    
    /**
     * Initializes project statistics for new projects
     */
    private initializeProjectStatistics(projectName: string): void {
        if (!this.projectStatistics[projectName]) {
            this.projectStatistics[projectName] = {
                averageDailyTime: 0,
                peakDay: { date: this.getTodayString(), time: 0 },
                mostProductiveTime: { hour: new Date().getHours(), productivity: 75 },
                focusRating: 0,
                trend: [0, 0, 0, 0, 0, 0, 0], // Last 7 days trend
                tags: []
            };
        }
    }
    
    /**
     * Updates project statistics with AI-driven insights
     */
    private updateProjectStatistics(projectName: string): void {
        this.initializeProjectStatistics(projectName);
        
        const project = this.projectData[projectName];
        const stats = this.projectStatistics[projectName];
        
        // Calculate average daily time
        const activeDays = Object.keys(this.dailyData).filter(
            date => this.dailyData[date].projects[projectName]
        ).length;
        
        stats.averageDailyTime = activeDays > 0 
            ? project.totalTime / activeDays
            : project.totalTime;
        
        // Find peak day
        Object.keys(this.dailyData).forEach(date => {
            const timeOnDay = this.dailyData[date].projects[projectName] || 0;
            if (timeOnDay > stats.peakDay.time) {
                stats.peakDay = { date, time: timeOnDay };
            }
        });
        
        // Calculate focus rating (0-100) based on session length patterns
        const focusTimeTotal = project.entries.reduce((sum, entry) => {
            return sum + (entry.duration > 25 * 60 ? entry.duration : 0);
        }, 0);
        
        stats.focusRating = project.totalTime > 0 
            ? Math.min(100, Math.round((focusTimeTotal / project.totalTime) * 100))
            : 0;
        
        // Update trend (last 7 days)
        const last7Days = this.getLast7Days();
        stats.trend = last7Days.map(date => {
            return this.dailyData[date]?.projects[projectName] || 0;
        });
    }
    
    /**
     * Gets the dates of the last 7 days
     */
    private getLast7Days(): string[] {
        const dates: string[] = [];
        for (let i = 0; i < 7; i++) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            const dateString = this.getDateString(date);
            dates.push(dateString);
        }
        return dates;
    }

    /**
     * Gets project statistics
     */
    public getProjectStatistics(projectName: string): ProjectStatistics | null {
        if (!this.projectStatistics[projectName]) {
            this.initializeProjectStatistics(projectName);
        }
        
        return this.projectStatistics[projectName];
    }
    
    /**
     * Gets AI-driven productivity insights
     */
    public getProductivityInsights(projectName: string): string[] {
        const stats = this.getProjectStatistics(projectName);
        const project = this.projectData[projectName];
        
        if (!stats || !project) {
            return ['Not enough data to generate insights yet.'];
        }
        
        const insights: string[] = [];
        
        // Focus time insight
        if (stats.focusRating < 30) {
            insights.push('Consider using the Pomodoro technique to improve focus time.');
        } else if (stats.focusRating > 70) {
            insights.push('Great job maintaining focus during work sessions!');
        }
        
        // Trend insight
        const trend = stats.trend.filter(t => t > 0);
        if (trend.length >= 3) {
            const isIncreasing = trend[0] > trend[trend.length - 1];
            if (isIncreasing) {
                insights.push('Your time investment in this project is increasing. Keep up the momentum!');
            } else {
                insights.push('Your time investment has been decreasing. Consider allocating more time if this is a priority project.');
            }
        }
        
        // Session length insight
        const averageSession = project.entries.reduce((sum, entry) => sum + entry.duration, 0) / project.entries.length;
        if (averageSession < 15 * 60) {
            insights.push('Your sessions are relatively short. Consider blocking longer periods for deeper work.');
        } else if (averageSession > 60 * 60) {
            insights.push('You have long work sessions. Remember to take breaks to maintain productivity.');
        }
        
        return insights.length > 0 ? insights : ['Continue tracking to generate more personalized insights.'];
    }

    private updateCurrentProject(): void {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        
        if (!workspaceFolders || workspaceFolders.length === 0) {
            // Use a default project name if no workspace is open
            if (!this.currentProject) {
                this.currentProject = 'Default Project';
                console.log('No workspace detected, using default project name');
            }
            return;
        }
        
        // For simplicity, use the first workspace folder as the project
        this.currentProject = workspaceFolders[0].name;
    }

    private setupActivityDetection(): void {
        // Track document changes and editor focus using event disposables
        // to ensure proper cleanup and less invasive monitoring
        this.context.subscriptions.push(
            vscode.workspace.onDidChangeTextDocument(() => {
                // Debounce activity detection to prevent interference with operations like paste
                this.debounceActivity();
            }),
            vscode.window.onDidChangeActiveTextEditor(() => {
                // Debounce activity detection
                this.debounceActivity();
            }),
            vscode.window.onDidChangeWindowState(e => {
                if (e.focused) {
                    // Debounce activity detection
                    this.debounceActivity();
                }
            })
        );
    }

    private debounceActivity(): void {
        // Clear previous timeout to prevent multiple calls
        if (this.activityDebounceTimeout) {
            clearTimeout(this.activityDebounceTimeout);
        }
        
        // Debounce activity detection to prevent interference with clipboard operations
        this.activityDebounceTimeout = setTimeout(() => {
            this.onActivity();
        }, 300); // 300ms debounce time
    }

    private onActivity(): void {
        this.lastActivityTime = Date.now();
        
        // Clear previous timeout
        if (this.activityTimeout) {
            clearTimeout(this.activityTimeout);
        }
        
        // Set new timeout for inactivity (in milliseconds)
        this.activityTimeout = setTimeout(() => {
            if (this.isTracking) {
                console.log(`Inactivity detected for ${this.inactivityThreshold} minutes, pausing timer.`);
                this.stopTracking();
            }
        }, this.inactivityThreshold * 60 * 1000);
    }

    private loadData(): void {
        try {
            if (fs.existsSync(this.dataFilePath)) {
                const data = fs.readFileSync(this.dataFilePath, 'utf8');
                this.projectData = JSON.parse(data);
            }
            
            if (fs.existsSync(this.dailyFilePath)) {
                const data = fs.readFileSync(this.dailyFilePath, 'utf8');
                this.dailyData = JSON.parse(data);
            }
        } catch (err) {
            console.error('Error loading project timer data:', err);
            // Initialize with empty data if there's an error
            this.projectData = {};
            this.dailyData = {};
        }
    }

    private saveData(): void {
        try {
            fs.writeFileSync(this.dataFilePath, JSON.stringify(this.projectData, null, 2));
            fs.writeFileSync(this.dailyFilePath, JSON.stringify(this.dailyData, null, 2));
        } catch (err) {
            console.error('Error saving project timer data:', err);
            vscode.window.showErrorMessage('Failed to save project timer data.');
        }
    }
    
    private getTodayString(): string {
        return this.getDateString(new Date());
    }
    
    private getDateString(date: Date): string {
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    }
    
    private notifyDataChanged(): void {
        this.onDataChangedCallbacks.forEach(callback => callback());
    }

    dispose(): void {
        if (this.timeoutId) {
            clearInterval(this.timeoutId);
        }
        
        if (this.activityTimeout) {
            clearTimeout(this.activityTimeout);
        }
        
        if (this.activityDebounceTimeout) {
            clearTimeout(this.activityDebounceTimeout);
        }
        
        // Make sure to save data when disposing
        this.saveData();
    }
}
