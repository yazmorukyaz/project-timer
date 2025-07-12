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

export class GitIntegration {
    private git: SimpleGit | null = null;
    private workspacePath: string = '';
    private currentGitInfo: GitInfo | null = null;

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
        } else {
            this.git = null;
            this.workspacePath = '';
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
}