import { DailyRecord, ProjectTime, TimeEntry, ProductivityInsight } from './timeTracker';
import { format, startOfWeek, endOfWeek, eachDayOfInterval, parseISO, getHours, getDay } from 'date-fns';

export interface ProductivityPattern {
    mostProductiveHours: { hour: number; averageTime: number }[];
    leastProductiveHours: { hour: number; averageTime: number }[];
    bestDays: { day: string; totalTime: number }[];
    weeklyTrend: { week: string; totalTime: number; change: number }[];
    focusTimeRatio: number;
    averageSessionLength: number;
    contextSwitchFrequency: number;
}

export interface CodeVelocityMetrics {
    averageSessionTime: number;
    filesPerSession: number;
    branchSwitchFrequency: number;
    mostUsedFileTypes: { extension: string; timePercent: number }[];
    productivityByFileType: { extension: string; avgFocusRatio: number }[];
}

export interface WeeklyInsights {
    totalTime: number;
    averageDailyTime: number;
    longestDay: { date: string; time: number };
    shortestDay: { date: string; time: number };
    focusTimeImprovement: number;
    productivityTrend: 'improving' | 'stable' | 'declining';
    suggestions: string[];
}

export class AnalyticsEngine {
    private dailyData: { [date: string]: DailyRecord };
    private projectData: { [projectName: string]: ProjectTime };

    constructor(dailyData: { [date: string]: DailyRecord }, projectData: { [projectName: string]: ProjectTime }) {
        this.dailyData = dailyData;
        this.projectData = projectData;
    }

    public updateData(dailyData: { [date: string]: DailyRecord }, projectData: { [projectName: string]: ProjectTime }): void {
        this.dailyData = dailyData;
        this.projectData = projectData;
    }

    public generateProductivityPattern(days: number = 30): ProductivityPattern {
        const recentDays = this.getRecentDays(days);
        
        // Calculate hourly productivity
        const hourlyStats: { [hour: number]: number[] } = {};
        for (let hour = 0; hour < 24; hour++) {
            hourlyStats[hour] = [];
        }

        recentDays.forEach(day => {
            // Distribute daily time across hours based on session patterns
            Object.values(this.projectData).forEach(project => {
                project.entries.forEach(entry => {
                    const entryDate = format(new Date(entry.startTime), 'yyyy-MM-dd');
                    if (entryDate === day.date) {
                        const hour = getHours(new Date(entry.startTime));
                        hourlyStats[hour].push(entry.duration);
                    }
                });
            });
        });

        const hourlyAverages = Object.entries(hourlyStats).map(([hour, times]) => ({
            hour: parseInt(hour),
            averageTime: times.length > 0 ? times.reduce((sum, time) => sum + time, 0) / times.length : 0
        }));

        const sortedByTime = [...hourlyAverages].sort((a, b) => b.averageTime - a.averageTime);

        // Calculate weekly trends
        const weeklyTrends = this.calculateWeeklyTrends();

        // Calculate focus metrics
        const focusMetrics = this.calculateFocusMetrics();

        return {
            mostProductiveHours: sortedByTime.slice(0, 5),
            leastProductiveHours: sortedByTime.slice(-5).reverse(),
            bestDays: recentDays.sort((a, b) => b.totalTime - a.totalTime).slice(0, 7).map(day => ({ day: day.date, totalTime: day.totalTime })),
            weeklyTrend: weeklyTrends,
            focusTimeRatio: focusMetrics.focusTimeRatio,
            averageSessionLength: focusMetrics.averageSessionLength,
            contextSwitchFrequency: focusMetrics.contextSwitchFrequency
        };
    }

    public generateCodeVelocityMetrics(): CodeVelocityMetrics {
        const allEntries = this.getAllTimeEntries();
        
        if (allEntries.length === 0) {
            return {
                averageSessionTime: 0,
                filesPerSession: 0,
                branchSwitchFrequency: 0,
                mostUsedFileTypes: [],
                productivityByFileType: []
            };
        }

        // Calculate average session time
        const averageSessionTime = allEntries.reduce((sum, entry) => sum + entry.duration, 0) / allEntries.length;

        // Calculate file type statistics
        const fileTypeStats: { [ext: string]: { totalTime: number; sessions: number; totalFocus: number } } = {};
        allEntries.forEach(entry => {
            if (entry.fileTypes) {
                Object.entries(entry.fileTypes).forEach(([ext, time]) => {
                    if (!fileTypeStats[ext]) {
                        fileTypeStats[ext] = { totalTime: 0, sessions: 0, totalFocus: 0 };
                    }
                    fileTypeStats[ext].totalTime += time;
                    fileTypeStats[ext].sessions += 1;
                    fileTypeStats[ext].totalFocus += (entry.focusTime || 0);
                });
            }
        });

        const totalTime = Object.values(fileTypeStats).reduce((sum, stat) => sum + stat.totalTime, 0);
        
        const mostUsedFileTypes = Object.entries(fileTypeStats)
            .map(([ext, stat]) => ({
                extension: ext,
                timePercent: totalTime > 0 ? (stat.totalTime / totalTime) * 100 : 0
            }))
            .sort((a, b) => b.timePercent - a.timePercent)
            .slice(0, 10);

        const productivityByFileType = Object.entries(fileTypeStats)
            .map(([ext, stat]) => ({
                extension: ext,
                avgFocusRatio: stat.totalTime > 0 ? stat.totalFocus / stat.totalTime : 0
            }))
            .sort((a, b) => b.avgFocusRatio - a.avgFocusRatio)
            .slice(0, 10);

        // Calculate branch switching frequency
        const branchSwitches = this.calculateBranchSwitchFrequency(allEntries);

        return {
            averageSessionTime,
            filesPerSession: 0, // Would need file tracking to implement
            branchSwitchFrequency: branchSwitches,
            mostUsedFileTypes,
            productivityByFileType
        };
    }

    public generateWeeklyInsights(): WeeklyInsights {
        const lastWeek = this.getLastWeekData();
        const previousWeek = this.getPreviousWeekData();
        
        if (lastWeek.length === 0) {
            return {
                totalTime: 0,
                averageDailyTime: 0,
                longestDay: { date: '', time: 0 },
                shortestDay: { date: '', time: 0 },
                focusTimeImprovement: 0,
                productivityTrend: 'stable',
                suggestions: ['Start tracking time to get insights!']
            };
        }

        const totalTime = lastWeek.reduce((sum, day) => sum + day.totalTime, 0);
        const averageDailyTime = totalTime / 7;
        
        const sortedDays = [...lastWeek].sort((a, b) => b.totalTime - a.totalTime);
        const longestDay = sortedDays[0];
        const shortestDay = sortedDays[sortedDays.length - 1];

        // Calculate focus time improvement
        const lastWeekFocus = lastWeek.reduce((sum, day) => sum + (day.focusTime || 0), 0);
        const previousWeekFocus = previousWeek.reduce((sum, day) => sum + (day.focusTime || 0), 0);
        const focusTimeImprovement = previousWeekFocus > 0 ? 
            ((lastWeekFocus - previousWeekFocus) / previousWeekFocus) * 100 : 0;

        // Determine productivity trend
        const lastWeekTotal = totalTime;
        const previousWeekTotal = previousWeek.reduce((sum, day) => sum + day.totalTime, 0);
        let productivityTrend: 'improving' | 'stable' | 'declining' = 'stable';
        
        if (previousWeekTotal > 0) {
            const change = ((lastWeekTotal - previousWeekTotal) / previousWeekTotal) * 100;
            if (change > 10) productivityTrend = 'improving';
            else if (change < -10) productivityTrend = 'declining';
        }

        // Generate suggestions
        const suggestions = this.generateSuggestions(lastWeek, focusTimeImprovement, productivityTrend);

        return {
            totalTime,
            averageDailyTime,
            longestDay: { date: longestDay.date, time: longestDay.totalTime },
            shortestDay: { date: shortestDay.date, time: shortestDay.totalTime },
            focusTimeImprovement,
            productivityTrend,
            suggestions
        };
    }

    public generateProductivityInsights(): ProductivityInsight[] {
        const insights: ProductivityInsight[] = [];
        const pattern = this.generateProductivityPattern();
        const weeklyInsights = this.generateWeeklyInsights();
        const codeMetrics = this.generateCodeVelocityMetrics();

        // Most productive hour insight
        if (pattern.mostProductiveHours.length > 0) {
            const topHour = pattern.mostProductiveHours[0];
            insights.push({
                type: 'pattern',
                title: 'Peak Productivity Hour',
                description: `You're most productive at ${topHour.hour}:00. Consider scheduling important tasks during this time.`,
                data: { hour: topHour.hour, averageTime: topHour.averageTime },
                importance: 'high'
            });
        }

        // Focus time insight
        if (pattern.focusTimeRatio < 0.6) {
            insights.push({
                type: 'suggestion',
                title: 'Improve Focus Time',
                description: `Your focus time ratio is ${(pattern.focusTimeRatio * 100).toFixed(1)}%. Try minimizing distractions to increase deep work time.`,
                data: { focusRatio: pattern.focusTimeRatio },
                importance: 'high'
            });
        }

        // Weekly trend insight
        if (weeklyInsights.productivityTrend === 'improving') {
            insights.push({
                type: 'achievement',
                title: 'Great Progress!',
                description: `Your productivity is trending upward. Keep up the great work!`,
                importance: 'medium'
            });
        }

        // File type productivity insight
        if (codeMetrics.mostUsedFileTypes.length > 0) {
            const topFileType = codeMetrics.mostUsedFileTypes[0];
            insights.push({
                type: 'pattern',
                title: 'Primary Technology',
                description: `You spend ${topFileType.timePercent.toFixed(1)}% of your time working with ${topFileType.extension} files.`,
                data: topFileType,
                importance: 'low'
            });
        }

        return insights;
    }

    private getRecentDays(days: number): DailyRecord[] {
        const sortedDates = Object.keys(this.dailyData).sort().reverse();
        return sortedDates.slice(0, days).map(date => this.dailyData[date]);
    }

    private getLastWeekData(): DailyRecord[] {
        const now = new Date();
        const start = startOfWeek(now);
        const end = endOfWeek(now);
        
        return eachDayOfInterval({ start, end })
            .map(date => {
                const dateStr = format(date, 'yyyy-MM-dd');
                return this.dailyData[dateStr] || {
                    date: dateStr,
                    projects: {},
                    totalTime: 0,
                    fileTypes: {},
                    branches: {},
                    focusTime: 0,
                    sessionCount: 0,
                    mostProductiveHour: 9,
                    productivity: {
                        averageSessionLength: 0,
                        longestFocusSession: 0,
                        contextSwitches: 0
                    }
                };
            });
    }

    private getPreviousWeekData(): DailyRecord[] {
        const now = new Date();
        const thisWeekStart = startOfWeek(now);
        const lastWeekStart = new Date(thisWeekStart.getTime() - 7 * 24 * 60 * 60 * 1000);
        const lastWeekEnd = new Date(lastWeekStart.getTime() + 6 * 24 * 60 * 60 * 1000);
        
        return eachDayOfInterval({ start: lastWeekStart, end: lastWeekEnd })
            .map(date => {
                const dateStr = format(date, 'yyyy-MM-dd');
                return this.dailyData[dateStr];
            })
            .filter(Boolean);
    }

    private getAllTimeEntries(): TimeEntry[] {
        const entries: TimeEntry[] = [];
        Object.values(this.projectData).forEach(project => {
            entries.push(...project.entries);
        });
        return entries.sort((a, b) => a.startTime - b.startTime);
    }

    private calculateWeeklyTrends(): { week: string; totalTime: number; change: number }[] {
        // Simplified weekly trend calculation
        const weeks: { [week: string]: number } = {};
        
        Object.values(this.dailyData).forEach(day => {
            const date = parseISO(day.date);
            const weekStart = startOfWeek(date);
            const weekKey = format(weekStart, 'yyyy-MM-dd');
            weeks[weekKey] = (weeks[weekKey] || 0) + day.totalTime;
        });

        const sortedWeeks = Object.entries(weeks).sort();
        return sortedWeeks.map(([week, totalTime], index) => {
            const previousWeek = index > 0 ? sortedWeeks[index - 1][1] : totalTime;
            const change = previousWeek > 0 ? ((totalTime - previousWeek) / previousWeek) * 100 : 0;
            return { week, totalTime, change };
        });
    }

    private calculateFocusMetrics(): { focusTimeRatio: number; averageSessionLength: number; contextSwitchFrequency: number } {
        const allEntries = this.getAllTimeEntries();
        
        if (allEntries.length === 0) {
            return { focusTimeRatio: 0, averageSessionLength: 0, contextSwitchFrequency: 0 };
        }

        const totalTime = allEntries.reduce((sum, entry) => sum + entry.duration, 0);
        const totalFocusTime = allEntries.reduce((sum, entry) => sum + (entry.focusTime || 0), 0);
        const averageSessionLength = totalTime / allEntries.length;

        // Calculate context switches (simplified)
        let contextSwitches = 0;
        for (let i = 1; i < allEntries.length; i++) {
            const current = allEntries[i];
            const previous = allEntries[i - 1];
            
            if (current.gitBranch !== previous.gitBranch || 
                JSON.stringify(current.fileTypes) !== JSON.stringify(previous.fileTypes)) {
                contextSwitches++;
            }
        }

        const contextSwitchFrequency = allEntries.length > 0 ? contextSwitches / allEntries.length : 0;

        return {
            focusTimeRatio: totalTime > 0 ? totalFocusTime / totalTime : 0,
            averageSessionLength,
            contextSwitchFrequency
        };
    }

    private calculateBranchSwitchFrequency(entries: TimeEntry[]): number {
        let branchSwitches = 0;
        for (let i = 1; i < entries.length; i++) {
            if (entries[i].gitBranch !== entries[i - 1].gitBranch) {
                branchSwitches++;
            }
        }
        return entries.length > 1 ? branchSwitches / (entries.length - 1) : 0;
    }

    private generateSuggestions(weekData: DailyRecord[], focusImprovement: number, trend: string): string[] {
        const suggestions: string[] = [];
        
        const totalTime = weekData.reduce((sum, day) => sum + day.totalTime, 0);
        const averageDaily = totalTime / 7;
        
        if (averageDaily < 4 * 3600) { // Less than 4 hours per day
            suggestions.push('Consider increasing your daily coding time to build consistency.');
        }
        
        if (focusImprovement < 0) {
            suggestions.push('Your focus time decreased this week. Try eliminating distractions during work sessions.');
        }
        
        if (trend === 'declining') {
            suggestions.push('Your productivity is declining. Consider taking breaks and reviewing your workflow.');
        }
        
        const weekendWork = weekData.slice(5, 7).reduce((sum, day) => sum + day.totalTime, 0);
        if (weekendWork > totalTime * 0.3) {
            suggestions.push('You worked significantly on weekends. Consider better work-life balance.');
        }
        
        if (suggestions.length === 0) {
            suggestions.push('Great work this week! Keep maintaining your productivity patterns.');
        }
        
        return suggestions;
    }
}