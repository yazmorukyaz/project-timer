import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { GitIntegration, GitInfo, CommitTimeEntry, GitCommitListener } from './gitIntegration';
import { FileTypeTracker } from './fileTypeTracker';

// Data structure interfaces
export interface TimeEntry {
    projectName: string;
    startTime: number;
    endTime: number;
    duration: number; // in seconds
    gitBranch?: string;
    commitHash?: string;
    fileTypes?: { [extension: string]: number }; // time spent per file type
    focusTime?: number; // uninterrupted work time
    context?: string; // additional context info
}

export interface ProjectTime {
    projectName: string;
    projectPath: string;
    totalTime: number; // in seconds
    entries: TimeEntry[];
    lastActive?: number;
    gitInfo?: {
        currentBranch: string;
        repository: string;
        remoteUrl?: string;
    };
    fileTypeStats: { [extension: string]: number }; // total time per file type
    branchStats: { [branch: string]: number }; // total time per branch
    productivity: {
        averageFocusTime: number;
        longestSession: number;
        totalSessions: number;
        interruptionCount: number;
    };
}

export interface DailyRecord {
    date: string;
    projects: { [projectName: string]: number }; // time in seconds
    totalTime: number; // in seconds
    fileTypes: { [extension: string]: number }; // time per file type
    branches: { [branch: string]: number }; // time per branch
    focusTime: number; // total uninterrupted time
    sessionCount: number; // number of work sessions
    mostProductiveHour: number; // 0-23
    productivity: {
        averageSessionLength: number;
        longestFocusSession: number;
        contextSwitches: number;
    };
}

export interface ProjectStatistics {
    averageDailyTime: number;
    peakDay: { date: string; time: number };
    trend: number[]; // Last 7 days trend
    fileTypeDistribution: { [extension: string]: number };
    branchDistribution: { [branch: string]: number };
    productivityPattern: {
        mostProductiveHours: number[];
        averageFocusTime: number;
        weeklyPattern: number[]; // 0=Sunday, 6=Saturday
    };
    codeVelocity: {
        linesPerHour?: number;
        commitsPerSession?: number;
        filesModifiedPerSession?: number;
    };
}

// New interfaces for enhanced features
export interface WorkSession {
    startTime: number;
    endTime: number;
    duration: number;
    focusTime: number;
    interruptions: number;
    filesWorkedOn: string[];
    gitBranch: string;
    productivity: 'high' | 'medium' | 'low';
}

export interface ProductivityInsight {
    type: 'pattern' | 'suggestion' | 'achievement';
    title: string;
    description: string;
    data?: any;
    importance: 'high' | 'medium' | 'low';
}

export interface CommitData {
    commitHash: string;
    message: string;
    author: string;
    date: Date;
    branch: string;
    timeSpent: number; // seconds of accumulated work before this commit
    filesChanged: string[];
    linesAdded: number;
    linesDeleted: number;
    productivity: 'high' | 'medium' | 'low';
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
    private statusBarFormat!: string;
    private trackFileTypes!: boolean;
    private trackGitInfo!: boolean;
    private inBreak: boolean = false;

    // Enhanced tracking
    private currentSession: WorkSession | null = null;
    private currentFileType: string = '';
    private currentGitBranch: string = '';
    private focusStartTime: number = 0;
    private lastContextSwitch: number = 0;
    private sessionInterruptions: number = 0;

    // Commit tracking
    private commitData: { [projectName: string]: CommitData[] } = {};
    private sessionStartTime: number = 0;
    private currentSessionTime: number = 0;
    private preCommitTime: number = 0; // Time accumulated before a commit

    // Integration modules
    private gitIntegration: GitIntegration;
    private fileTypeTracker: FileTypeTracker;

    private onDataChangedCallbacks: Array<() => void> = [];
    private onProductivityInsightCallbacks: Array<(insight: ProductivityInsight) => void> = [];

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

        // Initialize integration modules
        this.gitIntegration = new GitIntegration();
        this.fileTypeTracker = new FileTypeTracker();

        // Set up file type change listener
        this.fileTypeTracker.onFileTypeChange((fileType) => {
            this.currentFileType = fileType;
            this.onContextSwitch();
        });

        // Set up Git commit listener
        const commitListener: GitCommitListener = {
            onCommitDetected: (commit: CommitTimeEntry) => {
                this.handleCommitDetected(commit);
            },
            onBranchSwitch: (fromBranch: string, toBranch: string) => {
                this.handleBranchSwitch(fromBranch, toBranch);
            }
        };
        this.gitIntegration.addCommitListener(commitListener);

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
        this.statusBarFormat = config.get('statusBarFormat', 'session');
        this.trackFileTypes = config.get('trackFileTypes', true);
        this.trackGitInfo = config.get('trackGitInfo', true);
    }

    public async startTracking(): Promise<void> {
        if (this.isTracking) return;

        this.updateCurrentProject();
        if (!this.currentProject) {
            vscode.window.showWarningMessage('No active project detected. Time will not be tracked.');
            return;
        }

        this.isTracking = true;
        this.startTime = Date.now();
        this.lastActivityTime = this.startTime;
        this.focusStartTime = this.startTime;
        this.sessionInterruptions = 0;

        // Get current Git info if tracking is enabled
        if (this.trackGitInfo) {
            const gitInfo = await this.gitIntegration.getCurrentGitInfo();
            if (gitInfo) {
                this.currentGitBranch = gitInfo.branch;
            }
        }

        // Start file type tracking
        if (this.trackFileTypes) {
            this.fileTypeTracker.startNewSession();
            this.currentFileType = this.fileTypeTracker.getCurrentFileType();
        }

        // Start new work session
        this.currentSession = {
            startTime: this.startTime,
            endTime: 0,
            duration: 0,
            focusTime: 0,
            interruptions: 0,
            filesWorkedOn: [],
            gitBranch: this.currentGitBranch,
            productivity: 'medium'
        };

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
            // Calculate focus time
            const focusTime = this.calculateFocusTime();
            
            // Get file type statistics for this session
            const fileTypeStats = this.trackFileTypes ? this.fileTypeTracker.endCurrentFileTypeSession() : {};

            // Complete current session
            if (this.currentSession) {
                this.currentSession.endTime = endTime;
                this.currentSession.duration = duration;
                this.currentSession.focusTime = focusTime;
                this.currentSession.interruptions = this.sessionInterruptions;
                this.currentSession.productivity = this.calculateProductivity(duration, focusTime, this.sessionInterruptions);
            }

            this.addTimeEntry(this.currentProject, this.startTime, endTime, duration, fileTypeStats);
        }

        this.isTracking = false;
        this.startTime = 0;
        this.focusStartTime = 0;
        this.currentSession = null;
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

    private addTimeEntry(projectName: string, startTime: number, endTime: number, duration: number, fileTypeStats: { [extension: string]: number } = {}): void {
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
                lastActive: Date.now(),
                fileTypeStats: {},
                branchStats: {},
                productivity: {
                    averageFocusTime: 0,
                    longestSession: 0,
                    totalSessions: 0,
                    interruptionCount: 0
                }
            };
        }

        const focusTime = this.calculateFocusTime();
        const entry: TimeEntry = { 
            projectName, 
            startTime, 
            endTime, 
            duration,
            gitBranch: this.currentGitBranch,
            fileTypes: fileTypeStats,
            focusTime,
            context: this.getCurrentContext()
        };
        
        this.projectData[projectName].entries.push(entry);
        this.projectData[projectName].totalTime += duration;
        this.projectData[projectName].lastActive = Date.now();

        // Update project-level statistics
        this.updateProjectStats(projectName, duration, focusTime, fileTypeStats);

        const dateString = this.getDateString(new Date(startTime));
        if (!this.dailyData[dateString]) {
            this.dailyData[dateString] = { 
                date: dateString, 
                projects: {}, 
                totalTime: 0,
                fileTypes: {},
                branches: {},
                focusTime: 0,
                sessionCount: 0,
                mostProductiveHour: new Date(startTime).getHours(),
                productivity: {
                    averageSessionLength: 0,
                    longestFocusSession: 0,
                    contextSwitches: 0
                }
            };
        }

        if (!this.dailyData[dateString].projects[projectName]) {
            this.dailyData[dateString].projects[projectName] = 0;
        }

        this.dailyData[dateString].projects[projectName] += duration;
        this.dailyData[dateString].totalTime += duration;
        this.dailyData[dateString].focusTime += focusTime;
        this.dailyData[dateString].sessionCount++;

        // Update file type stats for the day
        Object.entries(fileTypeStats).forEach(([extension, time]) => {
            this.dailyData[dateString].fileTypes[extension] = (this.dailyData[dateString].fileTypes[extension] || 0) + time;
        });

        // Update branch stats for the day
        if (this.currentGitBranch) {
            this.dailyData[dateString].branches[this.currentGitBranch] = (this.dailyData[dateString].branches[this.currentGitBranch] || 0) + duration;
        }

        // Update productivity stats
        this.dailyData[dateString].productivity.averageSessionLength = this.dailyData[dateString].totalTime / this.dailyData[dateString].sessionCount;
        this.dailyData[dateString].productivity.longestFocusSession = Math.max(this.dailyData[dateString].productivity.longestFocusSession, focusTime);
        this.dailyData[dateString].productivity.contextSwitches += this.sessionInterruptions;

        this.saveData();
    }

    // --- Data Accessors ---
    public getProjectData = () => ({ ...this.projectData });
    public getDailyData = () => ({ ...this.dailyData });
    public getCurrentProject = () => this.currentProject;
    public isCurrentlyTracking = () => this.isTracking;
    public getCurrentSessionTime = () => (this.isTracking && this.startTime > 0) ? (Date.now() - this.startTime) / 1000 : 0;
    public getTodayTotalTime = () => this.dailyData[this.getTodayString()]?.totalTime || 0;
    
    // Enhanced accessors
    public getCurrentGitBranch = () => this.currentGitBranch;
    public getCurrentFileType = () => this.currentFileType;
    public getCurrentFocusTime = () => this.calculateFocusTime();
    public getSessionInterruptions = () => this.sessionInterruptions;
    public getCurrentSession = () => this.currentSession ? { ...this.currentSession } : null;
    
    public getFileTypeStats = () => this.fileTypeTracker ? this.fileTypeTracker.getFileTypeStats() : {};
    public getTopFileTypes = (limit: number = 5) => this.fileTypeTracker ? this.fileTypeTracker.getTopFileTypes(limit) : [];
    public getGitInfo = () => this.gitIntegration ? this.gitIntegration.getCurrentGitInfo() : null;

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
        // Enhanced activity detection with intelligent filtering
        const onHighPriorityActivity = (activityType: 'text-edit' | 'file-save' | 'file-open') => {
            if (this.activityDebounceTimeout) clearTimeout(this.activityDebounceTimeout);
            this.activityDebounceTimeout = setTimeout(() => this.onActivity(activityType), 500); // Faster response for important activities
        };

        const onMediumPriorityActivity = (activityType: 'selection' | 'editor-switch' | 'window-focus') => {
            if (this.activityDebounceTimeout) clearTimeout(this.activityDebounceTimeout);
            this.activityDebounceTimeout = setTimeout(() => this.onActivity(activityType), 1000);
        };

        const onLowPriorityActivity = (activityType: 'theme-change' | 'layout-change') => {
            if (this.activityDebounceTimeout) clearTimeout(this.activityDebounceTimeout);
            this.activityDebounceTimeout = setTimeout(() => this.onActivity(activityType), 2000);
        };

        this.context.subscriptions.push(
            // High priority: Actual coding activities
            vscode.workspace.onDidChangeTextDocument((e) => {
                // Only trigger for actual content changes, not just cursor movements
                if (e.contentChanges.length > 0) {
                    onHighPriorityActivity('text-edit');
                }
            }),
            vscode.workspace.onDidSaveTextDocument(() => onHighPriorityActivity('file-save')),
            vscode.workspace.onDidOpenTextDocument(() => onHighPriorityActivity('file-open')),
            
            // Medium priority: Navigation and focus activities
            vscode.window.onDidChangeActiveTextEditor(() => onMediumPriorityActivity('editor-switch')),
            vscode.window.onDidChangeWindowState((state) => {
                // Only trigger on focus gain, not focus loss
                if (state.focused) {
                    onMediumPriorityActivity('window-focus');
                }
            }),
            vscode.window.onDidChangeTextEditorSelection(() => onMediumPriorityActivity('selection')),
            
            // Git events (medium priority)
            vscode.workspace.onDidChangeWorkspaceFolders(() => onMediumPriorityActivity('editor-switch')),
            
            // Low priority: UI changes
            vscode.window.onDidChangeActiveColorTheme(() => onLowPriorityActivity('theme-change')),
            vscode.window.onDidChangeTextEditorViewColumn(() => onLowPriorityActivity('layout-change')),
            
            // Terminal activities (medium priority)
            vscode.window.onDidOpenTerminal(() => onMediumPriorityActivity('editor-switch')),
            vscode.window.onDidCloseTerminal(() => onMediumPriorityActivity('editor-switch')),

            // Debug session activities
            vscode.debug.onDidStartDebugSession(() => onMediumPriorityActivity('editor-switch')),
            vscode.debug.onDidTerminateDebugSession(() => onMediumPriorityActivity('editor-switch')),
            
            // Task execution
            vscode.tasks.onDidStartTask(() => onMediumPriorityActivity('editor-switch')),
            vscode.tasks.onDidEndTask(() => onMediumPriorityActivity('editor-switch'))
        );
    }

    private onActivity(activityType?: string): void {
        this.lastActivityTime = Date.now();

        // Enhanced auto-resume logic based on activity type
        if (!this.isTracking && this.autoResume) {
            const highPriorityActivities = ['text-edit', 'file-save', 'file-open'];
            const shouldAutoResume = highPriorityActivities.includes(activityType || '') || 
                                   !activityType; // Legacy support
            
            if (shouldAutoResume) {
                // Immediate resume for high-priority activities, delayed for others
                const delay = highPriorityActivities.includes(activityType || '') ? 500 : this.autoResumeDelay * 1000;
                
                setTimeout(() => {
                    if (!this.isTracking && this.autoResume) {
                        this.resumeTracking();
                        const activityLabel = activityType ? 
                            this.getActivityLabel(activityType) : 'Activity';
                        
                        vscode.window.showInformationMessage(
                            `${activityLabel} detected - auto-resuming timer for ${this.currentProject}`,
                            { modal: false }
                        );
                    }
                }, delay);
            }
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

    private getActivityLabel(activityType: string): string {
        const labels: { [key: string]: string } = {
            'text-edit': 'Code editing',
            'file-save': 'File save',
            'file-open': 'File opened',
            'editor-switch': 'Editor navigation',
            'window-focus': 'Window focus',
            'selection': 'Text selection',
            'theme-change': 'Theme change',
            'layout-change': 'Layout change'
        };
        return labels[activityType] || 'Activity';
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
            const data = { 
                projectData: this.projectData, 
                dailyData: this.dailyData,
                commitData: this.commitData
            };
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
                this.commitData = data.commitData || {};
            }
        } catch (error) {
            console.error('Error loading project timer data:', error);
            this.projectData = {};
            this.dailyData = {};
            this.commitData = {};
        }
    }

    // --- Enhanced Helper Methods ---
    private calculateFocusTime(): number {
        if (this.focusStartTime === 0) return 0;
        return (Date.now() - this.focusStartTime) / 1000;
    }

    private calculateProductivity(duration: number, focusTime: number, interruptions: number): 'high' | 'medium' | 'low' {
        const focusRatio = focusTime / duration;
        const interruptionRate = interruptions / (duration / 3600); // interruptions per hour
        
        if (focusRatio > 0.8 && interruptionRate < 2) {
            return 'high';
        } else if (focusRatio > 0.5 && interruptionRate < 5) {
            return 'medium';
        } else {
            return 'low';
        }
    }

    private getCurrentContext(): string {
        const gitBranch = this.currentGitBranch ? `branch:${this.currentGitBranch}` : '';
        const fileType = this.currentFileType ? `file:${this.currentFileType}` : '';
        return [gitBranch, fileType].filter(Boolean).join(',');
    }

    private onContextSwitch(): void {
        const now = Date.now();
        if (this.lastContextSwitch > 0 && (now - this.lastContextSwitch) < 60000) { // Less than 1 minute
            this.sessionInterruptions++;
            // Reset focus time if context switch is too frequent
            this.focusStartTime = now;
        }
        this.lastContextSwitch = now;
    }

    private updateProjectStats(projectName: string, duration: number, focusTime: number, fileTypeStats: { [extension: string]: number }): void {
        const project = this.projectData[projectName];
        
        // Update file type stats
        Object.entries(fileTypeStats).forEach(([extension, time]) => {
            project.fileTypeStats[extension] = (project.fileTypeStats[extension] || 0) + time;
        });

        // Update branch stats
        if (this.currentGitBranch) {
            project.branchStats[this.currentGitBranch] = (project.branchStats[this.currentGitBranch] || 0) + duration;
        }

        // Update productivity stats
        project.productivity.totalSessions++;
        project.productivity.averageFocusTime = 
            (project.productivity.averageFocusTime * (project.productivity.totalSessions - 1) + focusTime) / 
            project.productivity.totalSessions;
        project.productivity.longestSession = Math.max(project.productivity.longestSession, duration);
        project.productivity.interruptionCount += this.sessionInterruptions;
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

    // --- Commit Handling ---
    private handleCommitDetected(commit: CommitTimeEntry): void {
        if (!this.currentProject || this.currentProject === 'No Project') {
            return;
        }

        // Calculate time spent on this commit (current session time)
        const timeSpent = this.getCurrentSessionTime();
        
        // Determine productivity level based on time spent and changes
        const productivity = this.calculateCommitProductivity(timeSpent, commit.linesAdded, commit.linesDeleted);

        const commitData: CommitData = {
            commitHash: commit.hash,
            message: commit.message,
            author: commit.author,
            date: commit.date,
            branch: commit.branch,
            timeSpent: timeSpent,
            filesChanged: commit.filesChanged,
            linesAdded: commit.linesAdded,
            linesDeleted: commit.linesDeleted,
            productivity: productivity
        };

        // Store commit data
        if (!this.commitData[this.currentProject]) {
            this.commitData[this.currentProject] = [];
        }
        this.commitData[this.currentProject].push(commitData);

        // Reset session time (commit marks end of work session for that commit)
        this.sessionStartTime = Date.now();
        
        this.saveData();
        this.notifyDataChanged();

        // Show notification about commit tracking
        vscode.window.showInformationMessage(
            `Commit tracked: ${this._formatTime(timeSpent)} on "${commit.message.substring(0, 50)}..."`
        );
    }

    private handleBranchSwitch(fromBranch: string, toBranch: string): void {
        this.currentGitBranch = toBranch;
        
        // Auto-resume tracking when switching branches (indicates work resumption)
        if (this.autoResume && !this.isTracking) {
            setTimeout(() => {
                this.startTracking();
                vscode.window.showInformationMessage(`Auto-resumed tracking on branch: ${toBranch}`);
            }, this.autoResumeDelay * 1000);
        }

        this.onContextSwitch();
    }

    private calculateCommitProductivity(timeSpent: number, linesAdded: number, linesDeleted: number): 'high' | 'medium' | 'low' {
        const totalChanges = linesAdded + linesDeleted;
        const changesPerMinute = totalChanges / (timeSpent / 60);

        if (changesPerMinute > 10 && timeSpent > 300) { // 5+ minutes with good velocity
            return 'high';
        } else if (changesPerMinute > 5 || timeSpent > 600) { // 10+ minutes or decent velocity
            return 'medium';
        } else {
            return 'low';
        }
    }

    public getCommitHistory(projectName?: string): CommitData[] {
        if (projectName) {
            return this.commitData[projectName] || [];
        }
        
        // Return all commits from all projects
        const allCommits: CommitData[] = [];
        Object.values(this.commitData).forEach(commits => {
            allCommits.push(...commits);
        });
        
        return allCommits.sort((a, b) => b.date.getTime() - a.date.getTime());
    }

    public getCommitStats(): {
        totalCommits: number;
        totalTimeOnCommits: number;
        averageTimePerCommit: number;
        productivityDistribution: { high: number; medium: number; low: number };
        topCommitsByTime: CommitData[];
    } {
        const allCommits = this.getCommitHistory();
        const totalCommits = allCommits.length;
        const totalTimeOnCommits = allCommits.reduce((sum, commit) => sum + commit.timeSpent, 0);
        const averageTimePerCommit = totalCommits > 0 ? totalTimeOnCommits / totalCommits : 0;

        const productivityDistribution = {
            high: allCommits.filter(c => c.productivity === 'high').length,
            medium: allCommits.filter(c => c.productivity === 'medium').length,
            low: allCommits.filter(c => c.productivity === 'low').length
        };

        const topCommitsByTime = allCommits
            .sort((a, b) => b.timeSpent - a.timeSpent)
            .slice(0, 10);

        return {
            totalCommits,
            totalTimeOnCommits,
            averageTimePerCommit,
            productivityDistribution,
            topCommitsByTime
        };
    }

    // --- Data Import/Export ---
    public importData(projectData: { [projectName: string]: ProjectTime }, dailyData: { [date: string]: DailyRecord }): void {
        // Validate and sanitize the imported data
        if (typeof projectData === 'object' && typeof dailyData === 'object') {
            this.projectData = { ...projectData };
            this.dailyData = { ...dailyData };
            this.saveData();
            this.notifyDataChanged();
        } else {
            throw new Error('Invalid data format');
        }
    }

    public dispose(): void {
        this.stopTracking();
        if (this.saveDataInterval) clearInterval(this.saveDataInterval);
        if (this.activityTimeout) clearTimeout(this.activityTimeout);
        if (this.activityDebounceTimeout) clearTimeout(this.activityDebounceTimeout);
        if (this.pomodoroTimeout) clearTimeout(this.pomodoroTimeout);
        this.saveData();
    }
}
