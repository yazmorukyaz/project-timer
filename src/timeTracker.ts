import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

// Data structure interfaces
export interface TimeEntry {
    projectName: string;
    startTime: number;
    endTime: number;
    duration: number; // in seconds
}

export interface ProjectTime {
    projectName: string;
    projectPath: string;
    totalTime: number; // in seconds
    entries: TimeEntry[];
    lastActive?: number;
}

export interface DailyRecord {
    date: string;
    projects: { [projectName: string]: number }; // time in seconds
    totalTime: number; // in seconds
}

export interface ProjectStatistics {
    averageDailyTime: number;
    peakDay: { date: string; time: number };
    trend: number[]; // Last 7 days trend
}

export class TimeTracker {
    private context: vscode.ExtensionContext;
    private isTracking: boolean = false;
    private currentProject: string = '';
    private currentProjectPath: string = '';
    private startTime: number = 0;
    private lastActivityTime: number;

    // Timers
    private saveDataInterval: NodeJS.Timeout | null = null;
    private activityTimeout: NodeJS.Timeout | null = null;
    private activityDebounceTimeout: NodeJS.Timeout | null = null;
    private pomodoroTimeout: NodeJS.Timeout | null = null;

    // Data stores
    private projectData: { [projectName: string]: ProjectTime } = {};
    private dailyData: { [date: string]: DailyRecord } = {};
    private readonly dataFilePath: string;

    // Configuration settings
    private inactivityThreshold!: number; 
    private autoResume!: boolean;
    private autoResumeDelay!: number;
    private enablePomodoro!: boolean;
    private workDuration!: number;
    private breakDuration!: number;
    private dailyGoalHours!: number;
    private weeklyGoalHours!: number;
    private inBreak: boolean = false;

    private onDataChangedCallbacks: Array<() => void> = [];

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.lastActivityTime = Date.now();

        const storageFolder = context.globalStorageUri.fsPath;
        if (!fs.existsSync(storageFolder)) {
            fs.mkdirSync(storageFolder, { recursive: true });
        }
        this.dataFilePath = path.join(storageFolder, 'project-time-data.json');

        this.loadConfig();
        this.loadData();
        this.setupActivityDetection();

        this.saveDataInterval = setInterval(() => this.saveData(), 60000);

        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('projectTimer')) {
                this.loadConfig();
                this.notifyDataChanged();
            }
        });
    }

    private loadConfig(): void {
        const config = vscode.workspace.getConfiguration('projectTimer');
        this.inactivityThreshold = config.get('inactivityThreshold', 10);
        this.autoResume = config.get('autoResume', true);
        this.autoResumeDelay = config.get('autoResumeDelay', 2);
        this.enablePomodoro = config.get('enablePomodoro', false);
        this.workDuration = config.get('workDuration', 25);
        this.breakDuration = config.get('breakDuration', 5);
        this.dailyGoalHours = config.get('dailyGoalHours', 0);
        this.weeklyGoalHours = config.get('weeklyGoalHours', 0);
    }

    public startTracking(): void {
        if (this.isTracking) return;

        this.updateCurrentProject();
        if (!this.currentProject) {
            vscode.window.showWarningMessage('No active project detected. Time will not be tracked.');
            return;
        }

        this.isTracking = true;
        this.startTime = Date.now();
        this.lastActivityTime = this.startTime;

        if (this.enablePomodoro && !this.pomodoroTimeout) {
            this.startPomodoroCycle();
        }

        this.notifyDataChanged();
    }

    public stopTracking(): void {
        if (!this.isTracking) return;

        const endTime = Date.now();
        const duration = (endTime - this.startTime) / 1000; // seconds

        if (this.currentProject && this.startTime > 0 && duration > 1) {
            this.addTimeEntry(this.currentProject, this.startTime, endTime, duration);
        }

        this.isTracking = false;
        this.startTime = 0;
        this.stopPomodoroCycle();
        this.notifyDataChanged();
    }

    public resumeTracking(): void {
        if (!this.isTracking) {
            // Ensure we have a current project before resuming
            this.updateCurrentProject();
            if (this.currentProject && this.currentProject !== 'No Project') {
                this.startTracking();
            } else {
                vscode.window.showWarningMessage(
                    'Cannot resume tracking: No active project detected.',
                    { modal: false }
                );
            }
        }
    }

    public resetToday(): void {
        const todayStr = this.getTodayString();
        const todayStartMs = new Date(todayStr).getTime();

        if (this.dailyData[todayStr]) {
            delete this.dailyData[todayStr];
        }

        Object.keys(this.projectData).forEach(projectName => {
            const project = this.projectData[projectName];
            project.entries = project.entries.filter(entry => entry.startTime < todayStartMs);
            project.totalTime = project.entries.reduce((sum, entry) => sum + entry.duration, 0);
        });

        this.saveData();
        this.notifyDataChanged();
    }

    private addTimeEntry(projectName: string, startTime: number, endTime: number, duration: number): void {
        if (!this.projectData[projectName]) {
            // Ensure we have a path before creating the project entry
            if (!this.currentProjectPath) {
                console.error('Cannot create a new project entry without a path.');
                return;
            }
            this.projectData[projectName] = {
                projectName,
                projectPath: this.currentProjectPath,
                totalTime: 0,
                entries: [],
                lastActive: Date.now()
            };
        }

        const entry: TimeEntry = { projectName, startTime, endTime, duration };
        this.projectData[projectName].entries.push(entry);
        this.projectData[projectName].totalTime += duration;
        this.projectData[projectName].lastActive = Date.now();

        const dateString = this.getDateString(new Date(startTime));
        if (!this.dailyData[dateString]) {
            this.dailyData[dateString] = { date: dateString, projects: {}, totalTime: 0 };
        }

        if (!this.dailyData[dateString].projects[projectName]) {
            this.dailyData[dateString].projects[projectName] = 0;
        }

        this.dailyData[dateString].projects[projectName] += duration;
        this.dailyData[dateString].totalTime += duration;

        this.saveData();
    }

    // --- Data Accessors ---
    public getProjectData = () => ({ ...this.projectData });
    public getDailyData = () => ({ ...this.dailyData });
    public getCurrentProject = () => this.currentProject;
    public isCurrentlyTracking = () => this.isTracking;
    public getCurrentSessionTime = () => (this.isTracking && this.startTime > 0) ? (Date.now() - this.startTime) / 1000 : 0;
    public getTodayTotalTime = () => this.dailyData[this.getTodayString()]?.totalTime || 0;

    public getGoalProgress() {
        const now = new Date();
        const dayOfWeek = now.getDay(); // Sunday - 0, Monday - 1, ...
        const startOfWeek = new Date(now);
        startOfWeek.setDate(now.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1)); // Monday as start of week
        startOfWeek.setHours(0, 0, 0, 0);

        const weeklyRecords = Object.values(this.dailyData).filter(record => new Date(record.date) >= startOfWeek);
        const weeklyTotal = weeklyRecords.reduce((sum, record) => sum + record.totalTime, 0);
        const dailyTotal = this.getTodayTotalTime();

        const dailyGoalSeconds = this.dailyGoalHours * 3600;
        const weeklyGoalSeconds = this.weeklyGoalHours * 3600;

        return {
            daily: {
                spent: dailyTotal,
                goal: dailyGoalSeconds,
                percentage: dailyGoalSeconds > 0 ? (dailyTotal / dailyGoalSeconds) * 100 : 0
            },
            weekly: {
                spent: weeklyTotal,
                goal: weeklyGoalSeconds,
                percentage: weeklyGoalSeconds > 0 ? (weeklyTotal / weeklyGoalSeconds) * 100 : 0
            }
        };
    }

    // --- Activity Detection ---
    private setupActivityDetection(): void {
        const onActivity = () => {
            if (this.activityDebounceTimeout) clearTimeout(this.activityDebounceTimeout);
            this.activityDebounceTimeout = setTimeout(() => this.onActivity(), 1000);
        };

        this.context.subscriptions.push(
            // Document and editor events
            vscode.workspace.onDidChangeTextDocument(onActivity),
            vscode.window.onDidChangeActiveTextEditor(onActivity),
            vscode.window.onDidChangeWindowState(onActivity),
            vscode.window.onDidChangeTextEditorSelection(onActivity),
            vscode.window.onDidChangeActiveColorTheme(onActivity),
            vscode.window.onDidChangeTextEditorViewColumn(onActivity),
            
            // Workspace events
            vscode.workspace.onDidOpenTextDocument(onActivity),
            vscode.workspace.onDidCloseTextDocument(onActivity),
            vscode.workspace.onDidSaveTextDocument(onActivity),
            vscode.workspace.onDidChangeWorkspaceFolders(onActivity),
            
            // Terminal events
            vscode.window.onDidOpenTerminal(onActivity),
            vscode.window.onDidCloseTerminal(onActivity)
        );
    }

    private onActivity(): void {
        this.lastActivityTime = Date.now();

        // Auto-resume with delay if not currently tracking
        if (!this.isTracking && this.autoResume) {
            // Add a small delay before auto-resuming to avoid false triggers
            setTimeout(() => {
                if (!this.isTracking && this.autoResume) {
                    this.resumeTracking();
                    vscode.window.showInformationMessage(
                        `Activity detected - auto-resuming timer for ${this.currentProject}`,
                        { modal: false }
                    );
                }
            }, this.autoResumeDelay * 1000);
        }

        // Reset inactivity timer
        if (this.activityTimeout) clearTimeout(this.activityTimeout);

        this.activityTimeout = setTimeout(() => {
            if (this.isTracking) {
                vscode.window.showInformationMessage(
                    `Inactivity detected, pausing timer for ${this.currentProject}.`,
                    { modal: false }
                );
                this.stopTracking();
            }
        }, this.inactivityThreshold * 60 * 1000);
    }

    // --- Pomodoro --- 
    public togglePomodoro(): void {
        this.enablePomodoro = !this.enablePomodoro;
        vscode.workspace.getConfiguration('projectTimer').update('enablePomodoro', this.enablePomodoro, true);
        if (this.enablePomodoro) {
            vscode.window.showInformationMessage('Pomodoro enabled.');
            if (this.isTracking) this.startPomodoroCycle();
        } else {
            vscode.window.showInformationMessage('Pomodoro disabled.');
            this.stopPomodoroCycle();
        }
    }

    /**
     * Starts a Pomodoro or break timer depending on state.
     */
    private startPomodoroCycle(): void {
        if (this.pomodoroTimeout) clearTimeout(this.pomodoroTimeout);

        const duration = this.inBreak ? this.breakDuration : this.workDuration;
        const message = this.inBreak 
            ? `Break's over! Time to get back to work.`
            : `Time for a break! You've worked for ${this.workDuration} minutes.`;

        this.pomodoroTimeout = setTimeout(() => {
            vscode.window.showInformationMessage(message, 'Ok');
            this.inBreak = !this.inBreak;
            this.startPomodoroCycle();
        }, duration * 60 * 1000);
    }

    /**
     * Stops any active Pomodoro timer.
     */
    private stopPomodoroCycle(): void {
        if (this.pomodoroTimeout) {
            clearTimeout(this.pomodoroTimeout);
            this.pomodoroTimeout = null;
        }
        this.inBreak = false;
    }

    // --- Data Persistence ---
    private saveData(): void {
        try {
            const data = { projectData: this.projectData, dailyData: this.dailyData };
            fs.writeFileSync(this.dataFilePath, JSON.stringify(data, null, 2));
        } catch (error) {
            console.error('Error saving project timer data:', error);
        }
    }

    private loadData(): void {
        try {
            if (fs.existsSync(this.dataFilePath)) {
                const rawData = fs.readFileSync(this.dataFilePath, 'utf-8');
                const data = JSON.parse(rawData);
                this.projectData = data.projectData || {};
                this.dailyData = data.dailyData || {};
            }
        } catch (error) {
            console.error('Error loading project timer data:', error);
            this.projectData = {};
            this.dailyData = {};
        }
    }

    // --- Helpers ---
    private updateCurrentProject(): void {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            this.currentProjectPath = workspaceFolders[0].uri.fsPath;
            this.currentProject = path.basename(this.currentProjectPath);
        } else {
            this.currentProject = 'No Project';
            this.currentProjectPath = '';
        }
    }

    private getTodayString = () => this.getDateString(new Date());
    private getDateString = (date: Date) => `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}`;
    public registerDataChangeListener = (callback: () => void) => this.onDataChangedCallbacks.push(callback);
    private notifyDataChanged = () => this.onDataChangedCallbacks.forEach(cb => cb());

    public dispose(): void {
        this.stopTracking();
        if (this.saveDataInterval) clearInterval(this.saveDataInterval);
        if (this.activityTimeout) clearTimeout(this.activityTimeout);
        if (this.activityDebounceTimeout) clearTimeout(this.activityDebounceTimeout);
        if (this.pomodoroTimeout) clearTimeout(this.pomodoroTimeout);
        this.saveData();
    }
}
