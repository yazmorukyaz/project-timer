import * as vscode from 'vscode';
import { simpleGit, SimpleGit, StatusResult } from 'simple-git';
import * as path from 'path';

export interface GitInfo {
    branch: string;
    repository: string;
    remoteUrl?: string;
    isClean: boolean;
    ahead: number;
    behind: number;
    lastCommit?: {
        hash: string;
        message: string;
        author: string;
        date: Date;
    };
}

export interface CommitTimeEntry {
    hash: string;
    message: string;
    author: string;
    date: Date;
    branch: string;
    timeSpent: number; // seconds
    filesChanged: string[];
    linesAdded: number;
    linesDeleted: number;
}

export interface GitCommitListener {
    onCommitDetected: (commit: CommitTimeEntry) => void;
    onBranchSwitch: (fromBranch: string, toBranch: string) => void;
}

export class GitIntegration {
    private git: SimpleGit | null = null;
    private workspacePath: string = '';
    private currentGitInfo: GitInfo | null = null;
    private commitListeners: GitCommitListener[] = [];
    private lastCommitHash: string = '';
    private currentBranch: string = '';
    private gitWatcher: vscode.FileSystemWatcher | null = null;

    constructor() {
        this.updateWorkspace();
        
        // Listen for workspace changes
        vscode.workspace.onDidChangeWorkspaceFolders(() => {
            this.updateWorkspace();
        });
    }

    private updateWorkspace(): void {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            this.workspacePath = workspaceFolders[0].uri.fsPath;
            this.git = simpleGit(this.workspacePath);
            this.setupGitWatcher();
        } else {
            this.git = null;
            this.workspacePath = '';
            this.disposeGitWatcher();
        }
    }

    private setupGitWatcher(): void {
        this.disposeGitWatcher();
        
        if (this.workspacePath) {
            // Watch for changes in the .git directory
            const gitPattern = path.join(this.workspacePath, '.git', '**');
            this.gitWatcher = vscode.workspace.createFileSystemWatcher(gitPattern);
            
            // Watch for commit changes (HEAD file changes)
            this.gitWatcher.onDidChange((uri) => {
                const fileName = path.basename(uri.fsPath);
                if (fileName === 'HEAD' || fileName === 'index') {
                    this.checkForNewCommits();
                }
            });
            
            this.gitWatcher.onDidCreate((uri) => {
                const fileName = path.basename(uri.fsPath);
                if (fileName === 'HEAD' || fileName === 'index') {
                    this.checkForNewCommits();
                }
            });
        }
    }

    private disposeGitWatcher(): void {
        if (this.gitWatcher) {
            this.gitWatcher.dispose();
            this.gitWatcher = null;
        }
    }

    public async getCurrentGitInfo(): Promise<GitInfo | null> {
        if (!this.git || !this.workspacePath) {
            return null;
        }

        try {
            // Check if this is a git repository
            const isRepo = await this.git.checkIsRepo();
            if (!isRepo) {
                return null;
            }

            // Get current branch
            const branch = await this.git.revparse(['--abbrev-ref', 'HEAD']);
            
            // Get repository name
            const repositoryName = path.basename(this.workspacePath);
            
            // Get remote URL
            let remoteUrl: string | undefined;
            try {
                const remotes = await this.git.getRemotes(true);
                if (remotes.length > 0) {
                    remoteUrl = remotes[0].refs.fetch;
                }
            } catch {
                // Ignore if no remote
            }

            // Get status
            const status: StatusResult = await this.git.status();
            const isClean = status.files.length === 0;

            // Get ahead/behind info
            let ahead = 0;
            let behind = 0;
            try {
                const tracking = status.tracking;
                if (tracking) {
                    ahead = status.ahead || 0;
                    behind = status.behind || 0;
                }
            } catch {
                // Ignore if no tracking info
            }

            // Get last commit info
            let lastCommit;
            try {
                const log = await this.git.log({ maxCount: 1 });
                if (log.latest) {
                    lastCommit = {
                        hash: log.latest.hash,
                        message: log.latest.message,
                        author: log.latest.author_name,
                        date: new Date(log.latest.date)
                    };
                }
            } catch {
                // Ignore if can't get commit info
            }

            this.currentGitInfo = {
                branch: branch.trim(),
                repository: repositoryName,
                remoteUrl,
                isClean,
                ahead,
                behind,
                lastCommit
            };

            return this.currentGitInfo;

        } catch (error) {
            console.error('Error getting Git info:', error);
            return null;
        }
    }

    public getCurrentBranch(): string {
        return this.currentGitInfo?.branch || 'unknown';
    }

    public getRepositoryName(): string {
        return this.currentGitInfo?.repository || 'unknown';
    }

    public async getBranchList(): Promise<string[]> {
        if (!this.git) {
            return [];
        }

        try {
            const branchSummary = await this.git.branchLocal();
            return branchSummary.all;
        } catch {
            return [];
        }
    }

    public async getRecentCommits(count: number = 10): Promise<Array<{
        hash: string;
        message: string;
        author: string;
        date: Date;
        branch: string;
    }>> {
        if (!this.git) {
            return [];
        }

        try {
            const log = await this.git.log({ maxCount: count });
            return log.all.map(commit => ({
                hash: commit.hash,
                message: commit.message,
                author: commit.author_name,
                date: new Date(commit.date),
                branch: this.getCurrentBranch()
            }));
        } catch {
            return [];
        }
    }

    public async hasUncommittedChanges(): Promise<boolean> {
        if (!this.git) {
            return false;
        }

        try {
            const status = await this.git.status();
            return status.files.length > 0;
        } catch {
            return false;
        }
    }

    public async getModifiedFiles(): Promise<string[]> {
        if (!this.git) {
            return [];
        }

        try {
            const status = await this.git.status();
            return status.files.map(file => file.path);
        } catch {
            return [];
        }
    }

    public isGitRepository(): boolean {
        return this.currentGitInfo !== null;
    }

    public async refreshGitInfo(): Promise<void> {
        await this.getCurrentGitInfo();
    }

    public addCommitListener(listener: GitCommitListener): void {
        this.commitListeners.push(listener);
    }

    public removeCommitListener(listener: GitCommitListener): void {
        const index = this.commitListeners.indexOf(listener);
        if (index > -1) {
            this.commitListeners.splice(index, 1);
        }
    }

    private async checkForNewCommits(): Promise<void> {
        if (!this.git) return;

        try {
            // Get current branch
            const currentBranch = await this.git.revparse(['--abbrev-ref', 'HEAD']);
            const trimmedBranch = currentBranch.trim();

            // Check for branch switch
            if (this.currentBranch && this.currentBranch !== trimmedBranch) {
                this.notifyBranchSwitch(this.currentBranch, trimmedBranch);
            }
            this.currentBranch = trimmedBranch;

            // Get latest commit
            const log = await this.git.log({ maxCount: 1 });
            if (log.latest && log.latest.hash !== this.lastCommitHash) {
                this.lastCommitHash = log.latest.hash;
                
                // Get commit details with stats
                const commitDetails = await this.getCommitDetails(log.latest.hash);
                if (commitDetails) {
                    this.notifyCommitDetected(commitDetails);
                }
            }
        } catch (error) {
            console.error('Error checking for new commits:', error);
        }
    }

    private async getCommitDetails(commitHash: string): Promise<CommitTimeEntry | null> {
        if (!this.git) return null;

        try {
            // Get commit info
            const log = await this.git.log({ from: commitHash, to: commitHash, maxCount: 1 });
            const commit = log.latest;
            if (!commit) return null;

            // Get commit stats
            const diffSummary = await this.git.diffSummary([`${commitHash}^`, commitHash]);
            const filesChanged = diffSummary.files.map(file => file.file);

            return {
                hash: commit.hash,
                message: commit.message,
                author: commit.author_name,
                date: new Date(commit.date),
                branch: this.currentBranch,
                timeSpent: 0, // Will be set by time tracker
                filesChanged,
                linesAdded: diffSummary.insertions,
                linesDeleted: diffSummary.deletions
            };
        } catch (error) {
            console.error('Error getting commit details:', error);
            return null;
        }
    }

    private notifyCommitDetected(commit: CommitTimeEntry): void {
        this.commitListeners.forEach(listener => {
            try {
                listener.onCommitDetected(commit);
            } catch (error) {
                console.error('Error notifying commit listener:', error);
            }
        });
    }

    private notifyBranchSwitch(fromBranch: string, toBranch: string): void {
        this.commitListeners.forEach(listener => {
            try {
                listener.onBranchSwitch(fromBranch, toBranch);
            } catch (error) {
                console.error('Error notifying branch switch listener:', error);
            }
        });
    }

    public async getCommitHistory(count: number = 50): Promise<CommitTimeEntry[]> {
        if (!this.git) return [];

        try {
            const log = await this.git.log({ maxCount: count });
            const commits: CommitTimeEntry[] = [];

            for (const commit of log.all) {
                try {
                    const diffSummary = await this.git.diffSummary([`${commit.hash}^`, commit.hash]);
                    const filesChanged = diffSummary.files.map(file => file.file);

                    commits.push({
                        hash: commit.hash,
                        message: commit.message,
                        author: commit.author_name,
                        date: new Date(commit.date),
                        branch: this.currentBranch, // Note: this might not be accurate for old commits
                        timeSpent: 0, // Will be populated from time tracking data
                        filesChanged,
                        linesAdded: diffSummary.insertions,
                        linesDeleted: diffSummary.deletions
                    });
                } catch {
                    // Skip commits where we can't get diff info (e.g., first commit)
                    commits.push({
                        hash: commit.hash,
                        message: commit.message,
                        author: commit.author_name,
                        date: new Date(commit.date),
                        branch: this.currentBranch,
                        timeSpent: 0,
                        filesChanged: [],
                        linesAdded: 0,
                        linesDeleted: 0
                    });
                }
            }

            return commits;
        } catch (error) {
            console.error('Error getting commit history:', error);
            return [];
        }
    }

    public dispose(): void {
        this.disposeGitWatcher();
        this.commitListeners = [];
    }
}