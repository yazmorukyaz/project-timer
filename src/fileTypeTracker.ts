import * as vscode from 'vscode';
import * as path from 'path';

export interface FileTypeInfo {
    extension: string;
    language: string;
    category: string;
    icon?: string;
}

export interface FileTypeStats {
    extension: string;
    totalTime: number; // in seconds
    sessionCount: number;
    averageSessionTime: number;
    lastActive: number;
    category: string;
}

export class FileTypeTracker {
    private currentFileType: string = '';
    private fileTypeStartTime: number = 0;
    private fileTypeStats: { [extension: string]: FileTypeStats } = {};
    private onFileTypeChangeCallbacks: Array<(fileType: string) => void> = [];

    // File type categories for better organization
    private readonly fileTypeCategories: { [extension: string]: string } = {
        // Programming Languages
        '.ts': 'TypeScript',
        '.js': 'JavaScript',
        '.tsx': 'React TypeScript',
        '.jsx': 'React JavaScript',
        '.py': 'Python',
        '.java': 'Java',
        '.c': 'C',
        '.cpp': 'C++',
        '.cs': 'C#',
        '.go': 'Go',
        '.rs': 'Rust',
        '.php': 'PHP',
        '.rb': 'Ruby',
        '.swift': 'Swift',
        '.kt': 'Kotlin',
        '.scala': 'Scala',
        '.clj': 'Clojure',
        '.hs': 'Haskell',
        '.elm': 'Elm',
        '.dart': 'Dart',
        '.lua': 'Lua',
        '.r': 'R',
        '.m': 'Objective-C',
        '.mm': 'Objective-C++',
        '.f90': 'Fortran',
        '.pas': 'Pascal',
        '.pl': 'Perl',
        '.sh': 'Shell Script',
        '.ps1': 'PowerShell',
        '.bat': 'Batch',

        // Web Technologies
        '.html': 'HTML',
        '.htm': 'HTML',
        '.css': 'CSS',
        '.scss': 'SCSS',
        '.sass': 'Sass',
        '.less': 'Less',
        '.vue': 'Vue.js',
        '.svelte': 'Svelte',

        // Data & Config
        '.json': 'JSON',
        '.xml': 'XML',
        '.yaml': 'YAML',
        '.yml': 'YAML',
        '.toml': 'TOML',
        '.ini': 'INI',
        '.conf': 'Config',
        '.cfg': 'Config',
        '.env': 'Environment',
        '.properties': 'Properties',

        // Documentation
        '.md': 'Markdown',
        '.txt': 'Text',
        '.rst': 'reStructuredText',
        '.tex': 'LaTeX',
        '.rtf': 'Rich Text',

        // Database
        '.sql': 'SQL',
        '.db': 'Database',
        '.sqlite': 'SQLite',

        // Other
        '.log': 'Log File',
        '.csv': 'CSV',
        '.tsv': 'TSV'
    };

    constructor() {
        this.setupFileTypeTracking();
    }

    private setupFileTypeTracking(): void {
        // Track active editor changes
        vscode.window.onDidChangeActiveTextEditor((editor) => {
            if (editor) {
                this.onFileChange(editor.document.fileName);
            }
        });

        // Track when documents are opened
        vscode.workspace.onDidOpenTextDocument((document) => {
            if (document.fileName && vscode.window.activeTextEditor?.document === document) {
                this.onFileChange(document.fileName);
            }
        });

        // Initialize with current active editor if any
        if (vscode.window.activeTextEditor) {
            this.onFileChange(vscode.window.activeTextEditor.document.fileName);
        }
    }

    private onFileChange(fileName: string): void {
        const newFileType = this.getFileExtension(fileName);
        
        if (newFileType !== this.currentFileType) {
            // End timing for previous file type
            if (this.currentFileType && this.fileTypeStartTime > 0) {
                const duration = (Date.now() - this.fileTypeStartTime) / 1000;
                this.addTimeToFileType(this.currentFileType, duration);
            }

            // Start timing for new file type
            this.currentFileType = newFileType;
            this.fileTypeStartTime = Date.now();

            // Notify listeners
            this.onFileTypeChangeCallbacks.forEach(callback => callback(newFileType));
        }
    }

    private getFileExtension(fileName: string): string {
        const ext = path.extname(fileName).toLowerCase();
        return ext || '.unknown';
    }

    private addTimeToFileType(extension: string, duration: number): void {
        if (!this.fileTypeStats[extension]) {
            this.fileTypeStats[extension] = {
                extension,
                totalTime: 0,
                sessionCount: 0,
                averageSessionTime: 0,
                lastActive: Date.now(),
                category: this.getFileTypeCategory(extension)
            };
        }

        const stats = this.fileTypeStats[extension];
        stats.totalTime += duration;
        stats.sessionCount += 1;
        stats.averageSessionTime = stats.totalTime / stats.sessionCount;
        stats.lastActive = Date.now();
    }

    private getFileTypeCategory(extension: string): string {
        return this.fileTypeCategories[extension] || 'Other';
    }

    public getCurrentFileType(): string {
        return this.currentFileType;
    }

    public getCurrentFileCategory(): string {
        return this.getFileTypeCategory(this.currentFileType);
    }

    public getFileTypeStats(): { [extension: string]: FileTypeStats } {
        return { ...this.fileTypeStats };
    }

    public getTopFileTypes(limit: number = 5): FileTypeStats[] {
        return Object.values(this.fileTypeStats)
            .sort((a, b) => b.totalTime - a.totalTime)
            .slice(0, limit);
    }

    public getCategoryStats(): { [category: string]: { totalTime: number; fileTypes: string[] } } {
        const categoryStats: { [category: string]: { totalTime: number; fileTypes: string[] } } = {};

        Object.values(this.fileTypeStats).forEach(stats => {
            if (!categoryStats[stats.category]) {
                categoryStats[stats.category] = { totalTime: 0, fileTypes: [] };
            }
            categoryStats[stats.category].totalTime += stats.totalTime;
            categoryStats[stats.category].fileTypes.push(stats.extension);
        });

        return categoryStats;
    }

    public getFileTypeForSession(): string {
        return this.currentFileType;
    }

    public getSessionTimeForCurrentFileType(): number {
        if (this.fileTypeStartTime === 0) {
            return 0;
        }
        return (Date.now() - this.fileTypeStartTime) / 1000;
    }

    public endCurrentFileTypeSession(): { [extension: string]: number } {
        const result: { [extension: string]: number } = {};
        
        if (this.currentFileType && this.fileTypeStartTime > 0) {
            const duration = (Date.now() - this.fileTypeStartTime) / 1000;
            this.addTimeToFileType(this.currentFileType, duration);
            result[this.currentFileType] = duration;
            this.fileTypeStartTime = 0;
        }
        
        return result;
    }

    public startNewSession(): void {
        if (this.currentFileType) {
            this.fileTypeStartTime = Date.now();
        }
    }

    public onFileTypeChange(callback: (fileType: string) => void): void {
        this.onFileTypeChangeCallbacks.push(callback);
    }

    public formatTime(seconds: number): string {
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

    public importStats(stats: { [extension: string]: FileTypeStats }): void {
        this.fileTypeStats = { ...stats };
    }

    public resetStats(): void {
        this.fileTypeStats = {};
    }
}